/**
 * How a run's facets resolve — one definition for every reader and for the
 * pipeline's own steps. Facet resolution follows the provenance ranking
 * (human › respondent_supplied › manifest › rule › llm_inferred › derived);
 * exclusions are applied by the caller from the profile's rules.
 *
 * Moved from the pipeline zone's run store (store/queries.ts) when the
 * explorer reads became core's (2026-10-21), and typed to `CorpusDb` so an
 * app's D1 and a run's Durable Object read them alike.
 */

import { provenanceRank } from '@aicolab/insight-bridge-contracts/manifest'
import type { Profile } from '@aicolab/insight-bridge-contracts/profile'
import { type CorpusDb, facetAssignment, runMeta } from '@aicolab/insight-bridge-contracts/schema'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

export type EffectiveFacets = Record<string, string[]>
/** v7: the same, with the resolved concept beside each value (null = free facet or unresolved). */
export type EffectiveConceptFacets = Record<string, { value: string; conceptId: number | null }[]>

/** A facet the profile derives from another (Legal AI's era, from the year). */
export type DeriveRule = NonNullable<Profile['facets'][number]['derive']>

/**
 * A derived facet's value from the value it is derived from: a year, read
 * from its first four characters, placed in its bucket; the rule's unknown
 * label when there is no year or no bucket holds it. The one definition: the
 * pipeline's lens step derives with it, and every reader resolves facets with
 * it (loadConceptFacetCache).
 */
export function derivedValue(rule: DeriveRule, from: string | undefined): string {
	const year = Number.parseInt((from ?? '').slice(0, 4), 10)
	if (Number.isNaN(year)) return rule.unknown_label
	const bucket = rule.buckets.find(
		(b) => (b.min === null || year >= b.min) && (b.max === null || year <= b.max),
	)
	return bucket?.label ?? rule.unknown_label
}

/** The profile's derived facets at a granularity, where the run carries a profile. */
export async function derivedFacets(
	db: CorpusDb,
	granularity: 'entity' | 'document',
): Promise<{ name: string; rule: DeriveRule }[]> {
	const [table] = await db.all<{ name: string }>(
		sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_meta'`,
	)
	if (!table) return []
	const [meta] = await db
		.select({ profile: runMeta.profile })
		.from(runMeta)
		.where(eq(runMeta.singleton, 1))
		.limit(1)
	return (meta?.profile?.facets ?? []).flatMap((f) =>
		f.derive && (f.granularity ?? 'entity') === granularity
			? [{ name: f.name, rule: f.derive }]
			: [],
	)
}

/**
 * subject -> facet -> values (best provenance only; multi-valued within that
 * provenance). Within the best provenance, values are ordered as
 * db/exclusions.py load_facet_cache picks its single value — confidence
 * descending, then insertion — so `[0]` is the Python choice (ruling C2).
 */
export async function loadFacetCache(
	db: CorpusDb,
	subjectType: 'entity' | 'document' | 'chunk',
	/** Only these facets (a per-request rule that reads one facet need not read them all). */
	only?: readonly string[],
	/** Only these subjects (a page of rows need not read the whole record). */
	subjects?: readonly string[],
): Promise<Map<string, EffectiveFacets>> {
	const withConcepts = await loadConceptFacetCache(db, subjectType, only, subjects)
	const out = new Map<string, EffectiveFacets>()
	for (const [subject, facets] of withConcepts)
		out.set(
			subject,
			Object.fromEntries(
				Object.entries(facets).map(([facet, entries]) => [facet, entries.map((e) => e.value)]),
			),
		)
	return out
}

/** As loadFacetCache, keeping each value's concept id (the hierarchy readers' input). */
export async function loadConceptFacetCache(
	db: CorpusDb,
	subjectType: 'entity' | 'document' | 'chunk',
	only?: readonly string[],
	subjects?: readonly string[],
): Promise<Map<string, EffectiveConceptFacets>> {
	const derived =
		subjectType === 'chunk'
			? []
			: (await derivedFacets(db, subjectType)).filter((d) => !only || only.includes(d.name))
	// a derived facet asked for by name is read from the facet it derives from
	const read = only ? [...new Set([...only, ...derived.map((d) => d.rule.from_facet)])] : null
	const select = (batch: readonly string[] | null) =>
		db
			.select({
				subjectId: facetAssignment.subjectId,
				facet: facetAssignment.facet,
				value: facetAssignment.facetValue,
				conceptId: facetAssignment.conceptId,
				provenance: facetAssignment.provenance,
				confidence: facetAssignment.confidence,
			})
			.from(facetAssignment)
			.where(
				and(
					eq(facetAssignment.subjectType, subjectType),
					read ? inArray(facetAssignment.facet, read) : undefined,
					batch ? inArray(facetAssignment.subjectId, [...batch]) : undefined,
				),
			)
			.orderBy(
				desc(sql`coalesce(${facetAssignment.confidence}, 0)`),
				asc(facetAssignment.facetAssignmentId),
			)
	// D1 binds at most 100 parameters: a subject list is read in batches that
	// leave room for the facet list. Each subject's rows are within one batch,
	// so the order the resolution below relies on holds per subject.
	const SUBJECT_BATCH = Math.max(1, 90 - (read?.length ?? 0))
	const rows = subjects
		? (
				await Promise.all(
					Array.from({ length: Math.ceil(subjects.length / SUBJECT_BATCH) }, (_, i) =>
						select(subjects.slice(i * SUBJECT_BATCH, (i + 1) * SUBJECT_BATCH)),
					),
				)
			).flat()
		: await select(null)
	const best = new Map<
		string,
		Map<string, { rank: number; values: { value: string; conceptId: number | null }[] }>
	>()
	for (const row of rows) {
		const rank = provenanceRank(row.provenance)
		const facets = best.get(row.subjectId) ?? new Map()
		best.set(row.subjectId, facets)
		const current = facets.get(row.facet)
		const entry = { value: row.value, conceptId: row.conceptId }
		if (!current || rank < current.rank) facets.set(row.facet, { rank, values: [entry] })
		else if (rank === current.rank) current.values.push(entry)
	}
	const out = new Map<string, EffectiveConceptFacets>()
	// a named subject with no facet of its own still takes its derived facets' unknown label
	for (const subject of subjects ?? []) out.set(subject, {})
	for (const [subject, facets] of best)
		out.set(subject, Object.fromEntries([...facets].map(([facet, { values }]) => [facet, values])))
	// a facet the profile derives (era from year) is resolved here for every
	// subject that holds no value of its own, as the pipeline's lens step did
	for (const { name, rule } of derived)
		for (const facets of out.values())
			if (!facets[name]?.length)
				facets[name] = [
					{ value: derivedValue(rule, facets[rule.from_facet]?.[0]?.value), conceptId: null },
				]
	// only what was asked for: a facet read to derive another is not returned unless asked
	return only
		? new Map(
				[...out].map(([subject, facets]) => [
					subject,
					Object.fromEntries(Object.entries(facets).filter(([facet]) => only.includes(facet))),
				]),
			)
		: out
}

/**
 * A subject's vocabulary-facet assignments with their concepts and, when asked,
 * every ancestor (marked derived) — the former document_tag_closure read,
 * now over facet_assignment × concept_closure for any facet and any provenance.
 */
export async function subjectConcepts(
	db: CorpusDb,
	subjectType: 'entity' | 'document',
	subjectId: string,
	options: { includeDerived?: boolean; facet?: string; provenance?: string } = {},
) {
	const includeDerived = options.includeDerived ? 1 : 0
	const rows = await db.all<{
		facet: string
		facet_value: string
		concept_id: number
		assigned_concept_id: number
		external_id: string
		label: string
		depth: number
		derived: number
		is_primary: number
		relevance: string | null
		context: string | null
		provenance: string
	}>(sql`
		SELECT a.facet, a.facet_value, cl.ancestor_id AS concept_id, a.concept_id AS assigned_concept_id, k.external_id, l.label,
		       (SELECT MIN(r.depth) FROM concept_closure r WHERE r.descendant_id = cl.ancestor_id
		          AND r.ancestor_id IN (SELECT descendant_id FROM concept_closure GROUP BY descendant_id HAVING COUNT(*) = 1)) AS depth,
		       CASE WHEN cl.depth > 0 THEN 1 ELSE 0 END AS derived, a.is_primary, a.relevance, a.context, a.provenance
		FROM facet_assignment a
		JOIN concept_closure cl ON cl.descendant_id = a.concept_id
		JOIN concept k ON k.concept_id = cl.ancestor_id
		JOIN concept_label l ON l.concept_id = k.concept_id AND l.kind = 'pref'
		WHERE a.subject_type = ${subjectType} AND a.subject_id = ${subjectId} AND a.concept_id IS NOT NULL
		  AND (${includeDerived} OR cl.depth = 0)
		  ${options.facet ? sql`AND a.facet = ${options.facet}` : sql``}
		  ${options.provenance ? sql`AND a.provenance = ${options.provenance}` : sql``}
		GROUP BY a.facet, a.facet_value, cl.ancestor_id
		ORDER BY a.facet, a.is_primary DESC, depth, l.label`)
	return rows
}
