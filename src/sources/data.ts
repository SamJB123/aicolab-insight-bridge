/**
 * The source record, read from the canonical corpus tables. Nothing here names
 * a sector, a voice or a period: a filter is a facet.
 *
 * Filtering runs in SQL because it reaches the whole record; ordering and
 * paging run in TS over the matching ids, because these corpora are 50–1,501
 * contributors and a facet sort is an ordinal lookup rather than a join per
 * sort key. Batched clear of D1's ~100 bound-parameter cap.
 */
import { and, eq, inArray, like, or } from 'drizzle-orm'
import type { SQLiteAsyncDatabase } from 'drizzle-orm/sqlite-core'
import { document, entity, facetAssignment, facet as facetTable } from '../brief/schema.ts'
import type {
	SourceDocument,
	SourceFacet,
	SourceFacetValue,
	SourceGroup,
	SourceRow,
	SourcesConfig,
	SourcesResult,
	SourcesSearch,
} from './types.ts'

/** Either SQLite drizzle speaks: D1 (`'async'`) or a Durable Object's own
 *  storage (`'sync'`). See the note on `BriefDb`. */
export type SourcesDb = SQLiteAsyncDatabase<'sync' | 'async', unknown>

const CHUNK = 80
const DEFAULT_PAGE_SIZE = 40

/**
 * D1 caps a LIKE pattern at 50 characters ("LIKE or GLOB pattern too
 * complex"). Metacharacters are stripped rather than escaped: Drizzle binds
 * the pattern as a parameter, so there is no ESCAPE clause to lean on.
 */
const needle = (q: string) => `%${q.trim().replace(/[%_]/g, '').slice(0, 46)}%`

const chunked = <T,>(xs: T[], size = CHUNK): T[][] => {
	const out: T[][] = []
	for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
	return out
}

/** The chosen value of one facet, read off the flat search params. */
const chosen = (search: SourcesSearch, key: string): string | undefined => {
	const v = search[key]
	return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

export async function sourcesData(
	db: SourcesDb,
	config: SourcesConfig,
	search: SourcesSearch = {},
): Promise<SourcesResult> {
	const pageSize = config.pageSize ?? DEFAULT_PAGE_SIZE
	const filterKeys = config.filters.map((f) => f.key)

	const [facetMeta, held, everyone] = await Promise.all([
		db.select({ facet: facetTable.facet, noun: facetTable.noun, granularity: facetTable.granularity }).from(facetTable),
		db
			.selectDistinct({ facet: facetAssignment.facet, subjectType: facetAssignment.subjectType })
			.from(facetAssignment),
		db.select({ id: entity.id, entityId: entity.entityId, name: entity.entityName }).from(entity),
	])
	const nounOf = new Map(facetMeta.map((f) => [f.facet, f.noun]))

	// Granularity comes from the assignments, because for many facets there is
	// nowhere else to read it. `facet` holds the facets the run's PROFILE
	// defines (register_profile_facet). A facet declared in the run manifest
	// goes through assign_facet(), which writes facet_assignment and no `facet`
	// row — First Resort defines 1 in its profile and assigns 20; High Water
	// defines 11 and assigns 24. Both kinds are first-class facets, and only
	// one of them has a declaration to read granularity from.
	//
	// Note this is NOT about what gets analysed: that is a third and smaller
	// set again (High Water defines 11 facets and analyses positions along
	// exactly one), and it has no bearing on what a record can filter by.
	const granularityOf = new Map(facetMeta.map((f) => [f.facet, f.granularity]))
	for (const h of held) {
		if (h.subjectType === 'entity' || h.subjectType === 'document') granularityOf.set(h.facet, h.subjectType)
	}

	const excluded = config.excludeEntities
	const record = excluded?.size ? everyone.filter((e) => !excluded.has(e.id)) : everyone
	const inRecord = new Set(record.map((e) => e.id))
	const grandTotal = record.length

	/* ── the subjects of one facet, always as ENTITY ids ────────────────────
	 * A document facet is filed against the document, so it is projected up to
	 * the contributor who lodged it — every count on these pages counts
	 * contributors. An entity facet passes straight through. */
	const subjectsOf = async (key: string, value?: string): Promise<{ id: string; value: string }[]> => {
		const where = value ? and(eq(facetAssignment.facet, key), eq(facetAssignment.facetValue, value)) : eq(facetAssignment.facet, key)
		if (granularityOf.get(key) === 'document') {
			const rows = await db
				.select({ id: document.entityUuid, value: facetAssignment.facetValue })
				.from(facetAssignment)
				.innerJoin(document, eq(document.documentId, facetAssignment.subjectId))
				.where(and(eq(facetAssignment.subjectType, 'document'), where))
			return rows
		}
		const rows = await db
			.select({ id: facetAssignment.subjectId, value: facetAssignment.facetValue })
			.from(facetAssignment)
			.where(and(eq(facetAssignment.subjectType, 'entity'), where))
		return rows
	}

	/* ── 1. the matching set ───────────────────────────────────────────────── */
	let matching = new Set(inRecord)

	for (const key of filterKeys) {
		const value = chosen(search, key)
		if (!value) continue
		const held = new Set((await subjectsOf(key, value)).map((r) => r.id))
		matching = new Set([...matching].filter((id) => held.has(id)))
	}

	// Free text matches the contributor's name or slug, or ANY facet value they
	// hold — so searching an author, a publication or an episode's site title
	// works without a corpus declaring that it should.
	const q = typeof search.q === 'string' ? search.q.trim() : ''
	if (q) {
		const pattern = needle(q)
		const [byName, byFacet] = await Promise.all([
			db.select({ id: entity.id }).from(entity).where(or(like(entity.entityName, pattern), like(entity.entityId, pattern))),
			db
				.select({ id: facetAssignment.subjectId, subjectType: facetAssignment.subjectType })
				.from(facetAssignment)
				.where(like(facetAssignment.facetValue, pattern)),
		])
		const hit = new Set(byName.map((r) => r.id))
		for (const r of byFacet) if (r.subjectType === 'entity') hit.add(r.id)
		const docHits = byFacet.filter((r) => r.subjectType === 'document').map((r) => r.id)
		for (const batch of chunked(docHits)) {
			const owners = await db.select({ id: document.entityUuid }).from(document).where(inArray(document.documentId, batch))
			for (const o of owners) hit.add(o.id)
		}
		matching = new Set([...matching].filter((id) => hit.has(id)))
	}

	/* ── 2. order and page ─────────────────────────────────────────────────── */
	const sortKeys = config.sort ?? []
	const sortValues = new Map<string, Map<string, string>>()
	for (const s of sortKeys) {
		const first = new Map<string, string>()
		for (const r of await subjectsOf(s.facet)) if (!first.has(r.id)) first.set(r.id, r.value)
		sortValues.set(s.facet, first)
	}
	const ordinalRank = new Map<string, Map<string, number>>()
	for (const spec of config.filters) {
		if (spec.order?.length) ordinalRank.set(spec.key, new Map(spec.order.map((v, i) => [v, i])))
	}
	const rankOf = (key: string, value: string | undefined): number | string => {
		const ranks = ordinalRank.get(key)
		if (!ranks) return value ?? '￿'
		return value == null ? ranks.size : (ranks.get(value) ?? ranks.size)
	}

	const matched = record.filter((e) => matching.has(e.id))
	matched.sort((a, b) => {
		for (const s of sortKeys) {
			const va = rankOf(s.facet, sortValues.get(s.facet)?.get(a.id))
			const vb = rankOf(s.facet, sortValues.get(s.facet)?.get(b.id))
			const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
			if (cmp !== 0) return s.desc ? -cmp : cmp
		}
		return a.name.localeCompare(b.name)
	})

	const total = matched.length
	const pages = Math.max(1, Math.ceil(total / pageSize))
	const page = Math.min(Math.max(1, Math.floor(Number(search.page) || 1)), pages)
	const slice = matched.slice((page - 1) * pageSize, page * pageSize)
	const ids = slice.map((e) => e.id)

	/* ── 3. the page's facets, entity and document ─────────────────────────── */
	// Every facet of the page's 40 rows, not a declared subset: the row chrome
	// draws from whatever the run recorded, and at this size that is one
	// indexed read either way.
	const entityFacets = new Map<string, Record<string, string[]>>()
	const docsOf = new Map<string, SourceDocument[]>()
	const bagUp = (into: Map<string, Record<string, string[]>>, id: string, key: string, value: string) => {
		const bag = into.get(id) ?? {}
		bag[key] = [...(bag[key] ?? []), value]
		into.set(id, bag)
	}
	if (ids.length) {
		for (const batch of chunked(ids)) {
			const rows = await db
				.select({ id: facetAssignment.subjectId, facet: facetAssignment.facet, value: facetAssignment.facetValue })
				.from(facetAssignment)
				.where(and(eq(facetAssignment.subjectType, 'entity'), inArray(facetAssignment.subjectId, batch)))
			for (const r of rows) bagUp(entityFacets, r.id, r.facet, r.value)
		}

		const docRows: { documentId: string; entityUuid: string }[] = []
		for (const batch of chunked(ids)) {
			const rows = await db
				.select({ documentId: document.documentId, entityUuid: document.entityUuid })
				.from(document)
				.where(inArray(document.entityUuid, batch))
			docRows.push(...rows)
		}
		const docFacets = new Map<string, Record<string, string[]>>()
		for (const batch of chunked(docRows.map((d) => d.documentId))) {
			const rows = await db
				.select({ id: facetAssignment.subjectId, facet: facetAssignment.facet, value: facetAssignment.facetValue })
				.from(facetAssignment)
				.where(and(eq(facetAssignment.subjectType, 'document'), inArray(facetAssignment.subjectId, batch)))
			for (const r of rows) bagUp(docFacets, r.id, r.facet, r.value)
		}
		for (const d of docRows) {
			docsOf.set(d.entityUuid, [...(docsOf.get(d.entityUuid) ?? []), { documentId: d.documentId, facets: docFacets.get(d.documentId) ?? {} }])
		}
	}

	const rows: SourceRow[] = slice.map((e) => ({
		entityId: e.entityId,
		name: e.name,
		facets: entityFacets.get(e.id) ?? {},
		documents: (docsOf.get(e.id) ?? []).sort((a, b) => a.documentId.localeCompare(b.documentId)),
	}))

	/* ── 4. the filter vocabularies, over the WHOLE record ─────────────────── */
	const facets: SourceFacet[] = []
	for (const spec of config.filters) {
		const counts = new Map<string, Set<string>>()
		for (const r of await subjectsOf(spec.key)) {
			if (!inRecord.has(r.id)) continue
			const held = counts.get(r.value) ?? new Set<string>()
			held.add(r.id)
			counts.set(r.value, held)
		}
		let values: SourceFacetValue[] = [...counts].map(([value, held]) => ({ value, sources: held.size }))
		const ranks = ordinalRank.get(spec.key)
		values = ranks
			? values.sort((a, b) => (ranks.get(a.value) ?? ranks.size) - (ranks.get(b.value) ?? ranks.size))
			: values.sort((a, b) => b.sources - a.sources || a.value.localeCompare(b.value))
		facets.push({ ...spec, label: spec.label ?? nounOf.get(spec.key) ?? spec.key, values })
	}

	/* ── 5. the page, grouped ──────────────────────────────────────────────── */
	const groupBy = config.groupBy ?? null
	const groups: SourceGroup[] = []
	if (groupBy) {
		// Rows already arrive in order, so a run of the same value IS its group.
		for (const row of rows) {
			const value = row.facets[groupBy]?.[0] ?? null
			const last = groups[groups.length - 1]
			if (last && last.value === value) last.rows.push(row)
			else groups.push({ value, rows: [row] })
		}
	} else if (rows.length) {
		groups.push({ value: null, rows })
	}

	return { rows, groups, page, pages, pageSize, total, grandTotal, facets, groupBy }
}

/**
 * The route's search-param validator, built from the facets it declares.
 *
 * Every corpus's record reads the same way in a URL — `?q=…&<facet>=…&page=…`
 * — so this is the whole of the contract and no app writes its own.
 */
export const sourcesSearchValidator =
	(filters: { key: string }[]) =>
	(raw: Record<string, unknown>): SourcesSearch => {
		const out: SourcesSearch = {}
		const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
		const q = str(raw.q)
		if (q) out.q = q
		for (const f of filters) {
			const v = str(raw[f.key])
			if (v) out[f.key] = v
		}
		const page = Number(raw.page)
		if (Number.isFinite(page) && page > 1) out.page = Math.floor(page)
		return out
	}
