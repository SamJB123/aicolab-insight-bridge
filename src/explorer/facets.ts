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
import { asc, desc, eq, sql } from 'drizzle-orm'
import { provenanceRank } from '@aicolab/insight-bridge-contracts/manifest'
import { type CorpusDb, facetAssignment } from '@aicolab/insight-bridge-contracts/schema'

export type EffectiveFacets = Record<string, string[]>
/** v7: the same, with the resolved concept beside each value (null = free facet or unresolved). */
export type EffectiveConceptFacets = Record<string, { value: string; conceptId: number | null }[]>

/**
 * subject -> facet -> values (best provenance only; multi-valued within that
 * provenance). Within the best provenance, values are ordered as
 * db/exclusions.py load_facet_cache picks its single value — confidence
 * descending, then insertion — so `[0]` is the Python choice (ruling C2).
 */
export async function loadFacetCache(
	db: CorpusDb,
	subjectType: 'entity' | 'document' | 'chunk',
): Promise<Map<string, EffectiveFacets>> {
	const withConcepts = await loadConceptFacetCache(db, subjectType)
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
): Promise<Map<string, EffectiveConceptFacets>> {
	const rows = await db
		.select({
			subjectId: facetAssignment.subjectId,
			facet: facetAssignment.facet,
			value: facetAssignment.facetValue,
			conceptId: facetAssignment.conceptId,
			provenance: facetAssignment.provenance,
			confidence: facetAssignment.confidence,
		})
		.from(facetAssignment)
		.where(eq(facetAssignment.subjectType, subjectType))
		.orderBy(
			desc(sql`coalesce(${facetAssignment.confidence}, 0)`),
			asc(facetAssignment.facetAssignmentId),
		)
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
	for (const [subject, facets] of best)
		out.set(subject, Object.fromEntries([...facets].map(([facet, { values }]) => [facet, values])))
	return out
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
