/**
 * The Brief's queries — ONE implementation over the canonical corpus tables,
 * for every Insight Bridge app.
 *
 * Settled 2026-09-16. Each app used to carry its own three-to-five-hundred
 * line `db/brief.ts`, and they diverged in exactly the way the components
 * did. They also all read a denormalised facet column (`entity.sector`,
 * `entity.voice`, `entity.period`) that the pipeline does not export: the
 * canonical `entity` has three columns and every attribute lives in
 * `facet_assignment`. Reading facets generically is what makes one
 * implementation possible at all.
 *
 * The corpus tables are small — a few thousand rows — so these are whole-table
 * reads joined in TypeScript, which is both cheaper than id-list queries and
 * clear of D1's ~100 bound-parameter cap.
 */
import { eq, inArray, ne } from 'drizzle-orm'
import type { SQLiteAsyncDatabase } from 'drizzle-orm/sqlite-core'
import {
	clusterEntityPerspective,
	clusterKeyPerspective,
	clusterKeyPoint,
	clusterKeyPointQuote,
	entity,
	entityTopicClusterMembership,
	facetAssignment,
	facet as facetTable,
	supercluster,
	superclusterEdge,
	topicCluster,
	topicStar,
} from './schema.ts'
import type {
	BriefContributor,
	BriefData,
	BriefFamily,
	BriefNode,
	BriefTheme,
	BriefTopic,
	ChapterReading,
	FacetPin,
	FacetShare,
	FacetSpec,
	Pushback,
	ReadingPoint,
} from './types.ts'

/**
 * Either SQLite drizzle speaks here.
 *
 * `DrizzleD1Database` is `SQLiteAsyncDatabase<'async', D1RunResult>` — what a
 * standalone app reads. `DrizzleSqliteDODatabase` is
 * `SQLiteAsyncDatabase<'sync', DurableSQLiteRunResult>` — what the pipeline
 * zone reads for a run, straight from the Durable Object's own storage. Both
 * extend the same class, and its select builder extends `QueryPromise`
 * whatever the result kind, so every query below reads the same and `await`
 * resolves a sync result as readily as an async one.
 */
export type BriefDb = SQLiteAsyncDatabase<'sync' | 'async', unknown>

/** The pipeline's position vocabulary, supportive first. */
export const POSITIONS = [
	'Supports',
	'Builds on',
	'Unclear',
	'Mixed',
	'Redirects',
	'Opposes',
] as const
/**
 * What the ends of a position scale MEAN.
 *
 * The pipeline's own stance scale is the default, and every corpus that runs
 * the standard profile gets it for nothing. It is not universal: a corpus can
 * analyse positions along a different scale entirely — a severity ladder
 * (Assurance → Systemic), say — and then "supportive" and "contesting" are its
 * own words, so a run declares them rather than the reading layer assuming.
 */
export interface PositionScale {
	/** Every position the run writes, weakest claim first. */
	order: readonly string[]
	/**
	 * An AGREEMENT axis, where one end agrees with a node's claim and the other
	 * pushes back. Omit both when the run's positions measure something else:
	 * Watchful State grades how serious a finding is, and there is no agreement
	 * in it to summarise. The reading then shows the position mix and says
	 * nothing it cannot support.
	 */
	supportive?: readonly string[]
	contesting?: readonly string[]
	/** The value that reads as neither, if the scale has one. */
	unclear?: string
}

const DEFAULT_SCALE: PositionScale = {
	order: POSITIONS,
	supportive: ['Supports', 'Builds on'],
	contesting: ['Mixed', 'Redirects', 'Opposes'],
	unclear: 'Unclear',
}

/**
 * Which facets the run ANALYSED, read from the analysis itself.
 *
 * `cluster_key_perspective` holds the positions the clustering stage wrote per
 * facet value, so a facet is in it precisely because it was analysed. This is
 * the only truthful source: `facet` is config for vocabulary resolution and
 * says nothing about analysis (its `analyse_at_depth` is null across every
 * corpus here), and `facet_assignment` holds every attribute a manifest ever
 * supplied, analysed or not. Ordered by weight, so the facet the run has most
 * to say about leads.
 */
export async function analysedFacets(db: BriefDb): Promise<string[]> {
	const rows = await db
		.select({ facet: clusterKeyPerspective.facet })
		.from(clusterKeyPerspective)
	const weight = new Map<string, number>()
	for (const r of rows) weight.set(r.facet, (weight.get(r.facet) ?? 0) + 1)
	return [...weight].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([facet]) => facet)
}

/** How a facet should READ. Presentation only — never which facets exist. */
export type FacetHint = Omit<FacetSpec, 'key'>

export interface BriefConfig {
	/**
	 * Presentation hints per facet, keyed by the facet's own name. WHICH facets
	 * the Brief surfaces is read from the run (see `analysedFacets`), so a
	 * corpus that starts analysing a second facet gains its section without
	 * this changing. A facet with no hint reads by its `facet.noun`, or its
	 * key.
	 */
	facets?: Record<string, FacetHint>
	/**
	 * Contributors to leave out of every figure — a corpus that collapses
	 * duplicate lodgements passes the copies here. Computed by the app from
	 * whatever it knows; the reading layer only needs the set.
	 */
	excludeEntities?: ReadonlySet<string>
	/**
	 * The run's position scale. Defaults to the pipeline's stance scale
	 * (Supports … Opposes); a corpus whose clustering wrote a different one
	 * declares it, and every "agrees" and "pushes back" figure follows.
	 */
	positions?: PositionScale
}

const pct = (n: number, d: number) => Math.round((100 * n) / (d || 1))
const countIn = (mix: Record<string, number>, set: ReadonlySet<string>) =>
	Object.entries(mix).reduce((a, [k, v]) => a + (set.has(k) ? v : 0), 0)

/** The pipeline titles every node "subject: claim". */
export const splitTitle = (title: string): { subject: string; claim: string } => {
	const i = title.indexOf(': ')
	return i > 0
		? { subject: title.slice(0, i), claim: title.slice(i + 2) }
		: { subject: title, claim: '' }
}

/** Human name for a grouping generation, counted from the top. */
export const generationLabel = (generation: number, top: number, plural = false): string => {
	const depth = top - generation
	if (depth === 0) return plural ? 'families' : 'family'
	if (depth === 1) return plural ? 'themes' : 'theme'
	return plural ? 'groups' : 'group'
}

type TreeNode = {
	id: number
	generation: number
	title: string
	description: string | null
	parentId: number | null
	topicClusterId: number | null
}

export async function briefData(db: BriefDb, config: BriefConfig): Promise<BriefData> {
	const keys = await analysedFacets(db)
	const scale = config.positions ?? DEFAULT_SCALE
	const supportive = new Set(scale.supportive ?? [])
	const contesting = new Set(scale.contesting ?? [])
	/** Whether this run's positions are about agreement at all. */
	const agreementAxis = supportive.size > 0 || contesting.size > 0
	const [
		facetMeta,
		topicRows,
		scRows,
		edgeRows,
		memberRows,
		stanceRows,
		assignRows,
		entityRows,
		starRows,
	] = await Promise.all([
		keys.length
			? db
					.select({ facet: facetTable.facet, noun: facetTable.noun })
					.from(facetTable)
					.where(inArray(facetTable.facet, keys))
			: Promise.resolve([]),
		db.select().from(topicCluster).where(ne(topicCluster.junkStatus, 'confirmed')),
		db.select().from(supercluster),
		db.select().from(superclusterEdge),
		db.select().from(entityTopicClusterMembership),
		db
			.select({
				topicClusterId: clusterEntityPerspective.topicClusterId,
				entityUuid: clusterEntityPerspective.entityUuid,
				position: clusterEntityPerspective.position,
			})
			.from(clusterEntityPerspective),
		keys.length
			? db
					.select({
						subjectId: facetAssignment.subjectId,
						facet: facetAssignment.facet,
						facetValue: facetAssignment.facetValue,
						isPrimary: facetAssignment.isPrimary,
					})
					.from(facetAssignment)
					.where(eq(facetAssignment.subjectType, 'entity'))
			: Promise.resolve([]),
		db
			.select({ id: entity.id, entityId: entity.entityId, entityName: entity.entityName })
			.from(entity),
		db.select().from(topicStar),
	])

	const nounBy = new Map(facetMeta.map((f) => [f.facet, f.noun]))
	const facets = keys.map((key) => {
		const hint = config.facets?.[key] ?? {}
		return { ...hint, key, label: hint.label ?? nounBy.get(key) ?? key }
	})
	const declared = new Set(keys)

	/** Each contributor's value per declared facet; `is_primary` wins a tie. */
	const valuesOf = new Map<string, Map<string, string>>()
	for (const a of assignRows) {
		if (!declared.has(a.facet)) continue
		const byFacet = valuesOf.get(a.subjectId) ?? new Map<string, string>()
		if (!byFacet.has(a.facet) || a.isPrimary === 1) byFacet.set(a.facet, a.facetValue)
		valuesOf.set(a.subjectId, byFacet)
	}
	const names = new Map(entityRows.map((e) => [e.id, e]))
	const excluded = config.excludeEntities
	const kept = (uuid: string) => !excluded?.has(uuid)
	const detailOf = (uuid: string) => {
		const v = valuesOf.get(uuid)
		if (!v) return null
		const parts = facets.map((f) => v.get(f.key)).filter((x): x is string => Boolean(x))
		return parts.length ? parts.join(' · ') : null
	}

	/* ── the tree, from supercluster + its primary edges ── */
	const primaryParent = new Map<number, number>()
	for (const e of edgeRows)
		if (e.isPrimary === 1) primaryParent.set(e.childSuperclusterId, e.parentSuperclusterId)
	const nodes = new Map<number, TreeNode>()
	const baseOfTopic = new Map<number, number>()
	const generations = new Set<number>()
	for (const s of scRows) {
		const node: TreeNode = {
			id: s.superclusterId,
			generation: s.generation,
			title: s.title ?? `Group ${s.superclusterId}`,
			description: s.description,
			parentId: primaryParent.get(s.superclusterId) ?? null,
			topicClusterId: s.topicClusterId,
		}
		nodes.set(node.id, node)
		if (node.generation === 0 && node.topicClusterId != null)
			baseOfTopic.set(node.topicClusterId, node.id)
		if (node.generation > 0) generations.add(node.generation)
	}
	const top = generations.size ? Math.max(...generations) : 0
	const substantive = new Set(topicRows.map((t) => t.topicClusterId))
	/** The grouping node directly above a topic, and the chain to the root. */
	const lineageOf = (topicClusterId: number): number[] => {
		const chain: number[] = []
		let cur = baseOfTopic.get(topicClusterId)
		for (let hops = 0; cur != null && hops < 8; hops++) {
			const parent = nodes.get(cur)?.parentId ?? null
			if (parent == null) break
			chain.push(parent)
			cur = parent
		}
		return chain
	}
	const topicsUnder = new Map<number, number[]>()
	for (const t of substantive) {
		for (const g of lineageOf(t)) topicsUnder.set(g, [...(topicsUnder.get(g) ?? []), t])
	}
	const parentOfTopic = new Map<number, number | null>()
	for (const t of substantive) parentOfTopic.set(t, lineageOf(t)[0] ?? null)

	/* ── reach, stances and facet shares, per topic ── */
	const reach = new Map<number, Set<string>>()
	const exemplars = new Map<number, Set<string>>()
	for (const m of memberRows) {
		if (!substantive.has(m.topicClusterId) || !kept(m.entityUuid)) continue
		reach.set(m.topicClusterId, (reach.get(m.topicClusterId) ?? new Set()).add(m.entityUuid))
		if (m.membershipType === 'exemplar')
			exemplars.set(
				m.topicClusterId,
				(exemplars.get(m.topicClusterId) ?? new Set()).add(m.entityUuid),
			)
	}
	const stancesByTopic = new Map<number, { entityUuid: string; position: string }[]>()
	for (const s of stanceRows) {
		if (!substantive.has(s.topicClusterId) || !kept(s.entityUuid)) continue
		stancesByTopic.set(s.topicClusterId, [...(stancesByTopic.get(s.topicClusterId) ?? []), s])
	}

	const mixOf = (rows: { position: string }[]) => {
		const mix: Record<string, number> = {}
		for (const r of rows) mix[r.position] = (mix[r.position] ?? 0) + 1
		return mix
	}
	const sharesOf = (rows: { entityUuid: string }[]): FacetShare[] => {
		const out: FacetShare[] = []
		for (const f of facets) {
			const byValue = new Map<string, number>()
			let total = 0
			for (const r of rows) {
				const v = valuesOf.get(r.entityUuid)?.get(f.key)
				if (!v) continue
				byValue.set(v, (byValue.get(v) ?? 0) + 1)
				total++
			}
			const ordered = [...byValue.entries()].sort((a, b) =>
				f.ordinal ? orderOf(f, a[0]) - orderOf(f, b[0]) : b[1] - a[1],
			)
			for (const [value, stances] of ordered)
				out.push({ facet: f.key, value, stances, pct: pct(stances, total) })
		}
		return out
	}
	const contributorsOf = (topicIds: number[]): { rows: BriefContributor[]; total: number } => {
		const counts = new Map<string, number>()
		for (const t of topicIds)
			for (const uuid of exemplars.get(t) ?? []) counts.set(uuid, (counts.get(uuid) ?? 0) + 1)
		const rows = [...counts.entries()]
			.map(([uuid, count]) => {
				const e = names.get(uuid)
				return e
					? { entityId: e.entityId, name: e.entityName, detail: detailOf(uuid), count }
					: null
			})
			.filter((x): x is BriefContributor => x !== null)
			.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
		return { rows: rows.slice(0, 5), total: rows.length }
	}

	const nodeOf = (
		id: number,
		kind: string,
		title: string,
		description: string | null,
		topicIds: number[],
	): BriefNode => {
		const sources = new Set<string>()
		const stances: { entityUuid: string; position: string }[] = []
		for (const t of topicIds) {
			for (const uuid of reach.get(t) ?? []) sources.add(uuid)
			stances.push(...(stancesByTopic.get(t) ?? []))
		}
		const positions = mixOf(stances)
		const contributors = contributorsOf(topicIds)
		return {
			id,
			kind,
			title,
			...splitTitle(title),
			description,
			topics: topicIds.length,
			sources: sources.size,
			stances: stances.length,
			positions,
			contesting: countIn(positions, contesting),
			unclear: (scale.unclear ? positions[scale.unclear] : 0) ?? 0,
			supportivePct: pct(countIn(positions, supportive), stances.length),
			facets: sharesOf(stances),
			contributors: contributors.rows,
			contributorTotal: contributors.total,
		}
	}

	/* ── topics ── */
	const stars = new Map(starRows.map((s) => [s.topicClusterId, { x: s.x, y: s.y, r: s.r }]))
	const topics: Record<number, BriefTopic> = {}
	const chapters: Record<number, BriefNode> = {}
	for (const t of topicRows) {
		const id = t.topicClusterId
		const st = stancesByTopic.get(id) ?? []
		const positions = mixOf(st)
		const facetCounts: Record<string, number> = {}
		const singleValue: Record<string, string> = {}
		for (const f of facets) {
			const values = new Set<string>()
			for (const s of st) {
				const v = valuesOf.get(s.entityUuid)?.get(f.key)
				if (v) values.add(v)
			}
			facetCounts[f.key] = values.size
			const only = values.size === 1 ? [...values][0] : undefined
			if (only !== undefined) singleValue[f.key] = only
		}
		topics[id] = {
			id,
			title: t.title,
			...splitTitle(t.title),
			description: t.description,
			parentId: parentOfTopic.get(id) ?? null,
			sources: reach.get(id)?.size ?? 0,
			stances: st.length,
			positions,
			contesting: countIn(positions, contesting),
			facetCounts,
			singleValue,
			star: stars.get(id) ?? null,
		}
		chapters[id] = nodeOf(id, 'topic', t.title, t.description, [id])
	}
	const byReach = <T extends { sources: number }>(a: T, b: T) => b.sources - a.sources
	const topicOrder = Object.values(topics)
		.sort(byReach)
		.map((t) => t.id)

	/* ── groups ── */
	const groupNodes = [...nodes.values()].filter((n) => n.generation > 0)
	const built = new Map<number, BriefNode>()
	for (const g of groupNodes)
		built.set(
			g.id,
			nodeOf(
				g.id,
				generationLabel(g.generation, top),
				g.title,
				g.description,
				topicsUnder.get(g.id) ?? [],
			),
		)
	const directTopics = (id: number) =>
		Object.values(topics)
			.filter((t) => t.parentId === id)
			.sort(byReach)
			.map((t) => t.id)

	const themes: Record<number, BriefTheme> = {}
	for (const g of groupNodes) {
		if (g.generation === top) continue
		const base = built.get(g.id)
		if (base) themes[g.id] = { ...base, familyId: g.parentId, topicIds: directTopics(g.id) }
	}
	const families: BriefFamily[] = groupNodes
		.filter((g) => g.generation === top)
		.map((g) => {
			const base = built.get(g.id)
			if (!base) return null
			return {
				...base,
				themeIds: Object.values(themes)
					.filter((t) => t.familyId === g.id)
					.sort(byReach)
					.map((t) => t.id),
				topicIds: directTopics(g.id),
			}
		})
		.filter((x): x is BriefFamily => x !== null)
		.sort(byReach)

	// A one-generation run has roots sitting straight on the topics, so the
	// roots ARE the chapters and each also reads as a theme of its own topics.
	const singleGeneration = top === 1
	if (singleGeneration)
		for (const f of families) themes[f.id] = { ...f, familyId: null, topicIds: f.topicIds }

	const allSources = new Set<string>()
	for (const s of reach.values()) for (const uuid of s) allSources.add(uuid)

	return {
		scale: { sources: allSources.size, topics: topicRows.length },
		facets,
		agreementAxis,
		flat: groupNodes.length === 0,
		singleGeneration,
		deeperTree: groupNodes.some((g) => g.generation > 0 && g.generation < top - 1),
		families,
		themes,
		topics,
		topicOrder,
		chapters,
	}
}

const orderOf = (f: FacetSpec, value: string) => {
	const i = f.order?.indexOf(value) ?? -1
	return i < 0 ? Number.MAX_SAFE_INTEGER : i
}

/* ───────────────────────── the reading, on demand ───────────────────────── */

const READ_TOPICS = 4
const POINTS_PER_TOPIC = 3
const PUSHBACK_LIMIT = 8

/** The reading for a set of topics: the pipeline's key points with one quote
 *  each, every declared facet's position pins, and the contributors that
 *  contest a claim. `topicIds` of one reads a single topic in full. */
export async function chapterReading(
	db: BriefDb,
	config: BriefConfig,
	id: number,
	topicIds: number[],
	full = false,
): Promise<ChapterReading> {
	if (!topicIds.length) return { id, topicIds: [], points: [], pins: [], pushback: [] }
	const keys = await analysedFacets(db)
	const scale = config.positions ?? DEFAULT_SCALE
	const contesting = new Set(scale.contesting ?? [])
	const ids = topicIds.slice(0, 90)
	const [kpRows, pinRows, contestRows, assignRows, entityRows] = await Promise.all([
		db
			.select({
				id: clusterKeyPoint.clusterKeyPointId,
				topicId: clusterKeyPoint.topicClusterId,
				point: clusterKeyPoint.keyPoint,
				details: clusterKeyPoint.details,
			})
			.from(clusterKeyPoint)
			.where(inArray(clusterKeyPoint.topicClusterId, ids)),
		db
			.select({
				topicId: clusterKeyPerspective.topicClusterId,
				facet: clusterKeyPerspective.facet,
				value: clusterKeyPerspective.facetValue,
				position: clusterKeyPerspective.position,
				analysis: clusterKeyPerspective.positionAnalysis,
			})
			.from(clusterKeyPerspective)
			.where(inArray(clusterKeyPerspective.topicClusterId, ids)),
		db
			.select({
				topicId: clusterEntityPerspective.topicClusterId,
				entityUuid: clusterEntityPerspective.entityUuid,
				position: clusterEntityPerspective.position,
				title: clusterEntityPerspective.title,
				analysis: clusterEntityPerspective.positionAnalysis,
			})
			.from(clusterEntityPerspective)
			.where(inArray(clusterEntityPerspective.topicClusterId, ids)),
		keys.length
			? db
					.select({
						subjectId: facetAssignment.subjectId,
						facet: facetAssignment.facet,
						facetValue: facetAssignment.facetValue,
						isPrimary: facetAssignment.isPrimary,
					})
					.from(facetAssignment)
					.where(eq(facetAssignment.subjectType, 'entity'))
			: Promise.resolve([]),
		db
			.select({ id: entity.id, entityId: entity.entityId, entityName: entity.entityName })
			.from(entity),
	])

	const declared = new Set(keys)
	const valuesOf = new Map<string, Map<string, string>>()
	for (const a of assignRows) {
		if (!declared.has(a.facet)) continue
		const byFacet = valuesOf.get(a.subjectId) ?? new Map<string, string>()
		if (!byFacet.has(a.facet) || a.isPrimary === 1) byFacet.set(a.facet, a.facetValue)
		valuesOf.set(a.subjectId, byFacet)
	}
	const names = new Map(entityRows.map((e) => [e.id, e]))
	const kept = (uuid: string) => !config.excludeEntities?.has(uuid)
	const detailOf = (uuid: string) => {
		const v = valuesOf.get(uuid)
		if (!v) return null
		const parts = keys.map((k) => v.get(k)).filter((x): x is string => Boolean(x))
		return parts.length ? parts.join(' · ') : null
	}

	const perTopic = new Map<number, typeof kpRows>()
	for (const r of [...kpRows].sort((a, b) => a.id - b.id)) {
		const l = perTopic.get(r.topicId) ?? []
		if (full || l.length < POINTS_PER_TOPIC) l.push(r)
		perTopic.set(r.topicId, l)
	}
	const chosen = ids.flatMap((t) => perTopic.get(t) ?? [])
	const quoteRows: { kpId: number; quoteId: number; text: string; entityUuid: string }[] = []
	for (let i = 0; i < chosen.length; i += 90) {
		quoteRows.push(
			...(await db
				.select({
					kpId: clusterKeyPointQuote.clusterKeyPointId,
					quoteId: clusterKeyPointQuote.quoteId,
					text: clusterKeyPointQuote.quoteText,
					entityUuid: clusterKeyPointQuote.entityUuid,
				})
				.from(clusterKeyPointQuote)
				.where(
					inArray(
						clusterKeyPointQuote.clusterKeyPointId,
						chosen.slice(i, i + 90).map((k) => k.id),
					),
				)),
		)
	}
	const firstQuote = new Map<number, (typeof quoteRows)[number]>()
	for (const q of [...quoteRows].sort((a, b) => a.quoteId - b.quoteId))
		if (kept(q.entityUuid) && !firstQuote.has(q.kpId)) firstQuote.set(q.kpId, q)

	const points: ReadingPoint[] = chosen.map((k) => {
		const q = firstQuote.get(k.id)
		const e = q ? names.get(q.entityUuid) : undefined
		return {
			id: k.id,
			topicId: k.topicId,
			point: k.point,
			details: k.details ?? '',
			quote:
				q && e
					? {
							text: q.text,
							source: e.entityName,
							entityId: e.entityId,
							detail: detailOf(q.entityUuid),
						}
					: null,
		}
	})
	const pins: FacetPin[] = pinRows
		.filter((r) => declared.has(r.facet))
		.map((r) => ({
			topicId: r.topicId,
			facet: r.facet,
			value: r.value,
			position: r.position,
			analysis: r.analysis,
		}))
	// Strongest pushback first: the LAST contesting value on the scale is the
	// furthest from agreement, whatever the run's words for it are.
	const contestOrder = [...(scale.contesting ?? [])].reverse()
	const rank = (p: string) => {
		const i = contestOrder.indexOf(p)
		return i < 0 ? contestOrder.length : i
	}
	const pushback: Pushback[] = contestRows
		.filter((r) => contesting.has(r.position) && kept(r.entityUuid) && names.has(r.entityUuid))
		.map((r) => {
			const e = names.get(r.entityUuid)
			return e
				? {
						topicId: r.topicId,
						entityId: e.entityId,
						name: e.entityName,
						detail: detailOf(r.entityUuid),
						position: r.position,
						title: r.title,
						analysis: r.analysis ?? '',
					}
				: null
		})
		.filter((x): x is Pushback => x !== null)
		.sort((a, b) => rank(a.position) - rank(b.position) || a.name.localeCompare(b.name))
		.slice(0, PUSHBACK_LIMIT)
	return { id, topicIds: ids, points, pins, pushback }
}

/** The most-read topics of a chapter, which is what its reading draws on. */
export const readTopics = (d: BriefData, topicIds: number[]) =>
	[...topicIds]
		.sort((a, b) => (d.topics[b]?.sources ?? 0) - (d.topics[a]?.sources ?? 0))
		.slice(0, READ_TOPICS)
