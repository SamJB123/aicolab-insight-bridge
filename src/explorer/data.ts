/**
 * @aicolab/insight-bridge/explorer — the reads every report is made of: the
 * overview, the topics and one topic, the sources and one source, the
 * documents and one document, search, the vocabularies, the questions, the
 * task results, the grouping tree and the galaxy, each in the shape the
 * contracts declare (`@aicolab/insight-bridge-contracts/explorer`). One
 * definition, over the canonical run schema: the pipeline zone's run store,
 * every app's D1 and the door the hub reads a report through all call these.
 * Profile-driven: facets, tags and questions are whatever the run carries. An
 * app EXTENDS this with reads of its own tables; it never restates these.
 *
 * WHICH BUILD, WHICH TOPICS is the database's answer, not this file's: the
 * `current_*` views (contracts schema/views.ts) hold the committed build's
 * live, substantive rows, and every reach, membership and tree read here goes
 * through them. Nothing below names a build. The one read that looks past the
 * views is `topics(db, true)`, the review surface that lists confirmed-junk
 * topics by name; their counts still come from the views, so a junk topic
 * reads with no reach, which is what "excluded from every aggregate" means.
 *
 * WHICH EVIDENCE is the database's answer too: documents, passages, key points,
 * quotes, verdicts and answers are read from the `published_*` views, so what
 * an update append removed is kept for the record and never met here.
 *
 * Typed to `CorpusDb`, the supertype an app's D1 and a run's Durable Object
 * share (as the Brief and Sources are). Child rows are reached through their
 * parent's own predicate, never an id list where one can be avoided: D1 and
 * DO SQLite both bind ~100 parameters per statement. Moved from the pipeline
 * zone's store/explorer.ts on 2026-10-21.
 */

import type {
	DocumentDetail,
	DocumentSummary,
	EntityDetail,
	EntitySummary,
	FoundDocument,
	GalaxyData,
	GroupDetail,
	Hierarchy,
	Overview,
	QuestionSummary,
	RelatedTopic,
	RunWords,
	SearchHit,
	TagCategorySummary,
	TagDocument,
	TaskResultRow,
	TextHit,
	TopicDetail,
	TopicSummary,
} from '@aicolab/insight-bridge-contracts/explorer'
import type { CorpusDb } from '@aicolab/insight-bridge-contracts/schema'
import * as s from '@aicolab/insight-bridge-contracts/schema'
import { SITE_SECTIONS } from '@aicolab/insight-bridge-contracts/site'
import { taskTitle } from '@aicolab/insight-bridge-contracts/tasks'
import { PATH_SEP } from '@aicolab/insight-bridge-contracts/vocabulary'
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { treeOf } from '../tree.ts'
import { MEMBERSHIP_GRADES } from '../world/schema.ts'
import { loadFacetCache, subjectConcepts } from './facets.ts'

/**
 * The grades every count of the record counts: a source or a passage strongly
 * linked to its topic (exemplar or high value). A plain member has no written
 * analysis: it is never counted and never listed, a topic's members and a
 * source's topics included (user testing found plain members confused readers).
 */
export const STRONG = [...MEMBERSHIP_GRADES]
const strongSource = inArray(s.currentEntityMembership.membershipType, STRONG)

export type {
	DocumentDetail,
	DocumentSummary,
	EntityDetail,
	EntitySummary,
	GalaxyData,
	GroupDetail,
	Hierarchy,
	Overview,
	QuestionSummary,
	RunWords,
	TagCategorySummary,
	TopicDetail,
	TopicSummary,
}

const n = (v: unknown) => Number(v ?? 0)

/** Items in groups of `size`, each group one statement's worth of parameters. */
function inGroups<T>(items: T[], size: number): T[][] {
	const out: T[][] = []
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
	return out
}

/** A vocabulary facet's granularity, and an assignment's subject: CHECKed in the schema. */
const granularitySchema = z.enum(['entity', 'document'])

// ---------------------------------------------------------------- the run's words

/**
 * The words a run's readings are written in, from its own row: the site
 * where the site says, the profile where it does not — the same fallbacks the
 * world record reads by. A database with no run_meta, or one whose run cannot
 * account for itself (no profile), is not a canonical run: that throws.
 */
export async function runWords(db: CorpusDb): Promise<RunWords> {
	const [meta] = await db.select().from(s.runMeta).where(eq(s.runMeta.singleton, 1)).limit(1)
	const profile = meta?.profile
	if (!meta || !profile)
		throw new Error(
			'[explorer] run_meta or its profile is missing: the run cannot say its own words',
		)
	const site = meta.site
	const params = profile.prompts.params
	const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
	const facets: RunWords['facets'] = {}
	for (const f of profile.facets) {
		const said = site?.facets[f.name]
		const excluded = new Set(f.excluded_values)
		facets[f.name] = {
			heading: said?.heading ?? cap(f.noun),
			values: said?.values ?? {},
			descriptions: f.display_labels,
			order: (f.values ?? f.derive?.buckets.map((b) => b.label) ?? []).filter(
				(v) => !excluded.has(v),
			),
		}
	}
	for (const [name, said] of Object.entries(site?.facets ?? {}))
		facets[name] ??= {
			heading: said.heading ?? cap(name.replace(/_/g, ' ')),
			values: said.values,
			descriptions: {},
			order: [],
		}
	return {
		title: site?.title ?? meta.name,
		eyebrow: site?.eyebrow ?? null,
		standfirst: site?.standfirst ?? params.corpus_description,
		source: site?.source ?? null,
		nouns: {
			entity: params.entity_noun,
			entities: params.entity_noun_plural,
			document: params.document_noun,
			documents: params.document_noun_plural,
		},
		scale: {
			order: [...profile.stance.labels],
			supportive: [...(profile.stance.agreement?.supportive ?? [])],
			contesting: [...(profile.stance.agreement?.contesting ?? [])],
			unclear: profile.stance.agreement?.unclear ?? null,
		},
		lens: profile.facets_to_analyse[0] ?? profile.identity.primary_facet ?? null,
		facets,
		tasks: Object.fromEntries(
			profile.analysis_tasks.map((t) => [
				t.task_id,
				{ type: t.task_type, title: site?.tasks[t.task_id]?.title ?? taskTitle(t) },
			]),
		),
		sections: [...(site?.sections ?? SITE_SECTIONS)],
	}
}

// ---------------------------------------------------------------- overview

export async function overview(db: CorpusDb): Promise<Overview> {
	const count = async (table: string, where = '') =>
		n((await db.all<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM ${table} ${where}`)))[0]?.n)
	const facetCache = await loadFacetCache(db, 'entity')
	const facetValues = new Map<string, Map<string, number>>()
	for (const facets of facetCache.values()) {
		for (const [facet, values] of Object.entries(facets)) {
			if (facet === 'entity_name_provenance' || facet === 'llm_entity_name') continue
			const m = facetValues.get(facet) ?? new Map<string, number>()
			for (const v of values) m.set(v, (m.get(v) ?? 0) + 1)
			facetValues.set(facet, m)
		}
	}
	// v7: every vocabulary facet (a tagging category or a manifest facet with concepts), with its concept count and tagged subjects
	const tagRows = await db.all<{ category: string; tags: number; documents: number }>(sql`
		SELECT f.facet AS category,
			(SELECT COUNT(*) FROM concept k WHERE k.vocabulary_id = f.vocabulary_id) AS tags,
			(SELECT COUNT(DISTINCT a.subject_id) FROM facet_assignment a
			 WHERE a.facet = f.facet AND a.concept_id IS NOT NULL) AS documents
		FROM facet f WHERE f.kind = 'vocabulary' ORDER BY f.facet`)
	const state = Object.fromEntries(
		(
			await db
				.select({ key: s.pipelineState.key, value: s.pipelineState.value })
				.from(s.pipelineState)
		).map((r) => [r.key, r.value]),
	)
	return {
		documents: await count('published_document'),
		entities: await count('entity'),
		chunks: await count('published_chunk'),
		clusteredChunks: n(
			(
				await db.all<{ n: number }>(
					sql`SELECT COUNT(DISTINCT m.chunk_id) AS n FROM current_chunk_membership m JOIN published_chunk c ON c.id = m.chunk_id`,
				)
			)[0]?.n,
		),
		clusters: await count('topic_cluster', 'WHERE retired_build_id IS NULL'),
		junkConfirmedClusters: await count(
			'topic_cluster',
			"WHERE junk_status = 'confirmed' AND retired_build_id IS NULL",
		),
		keyPoints: await count('published_key_point'),
		keyQuotes: await count('published_key_quote'),
		superclusters: await count('current_supercluster', 'WHERE generation > 0'),
		facets: [...facetValues].map(([facet, values]) => ({
			facet,
			values: [...values]
				.map(([value, entities]) => ({ value, entities }))
				.sort((a, b) => b.entities - a.entities),
		})),
		tagCategories: tagRows.map((r) => ({
			category: r.category,
			tags: n(r.tags),
			documentsTagged: n(r.documents),
		})),
		questions: await count('question'),
		state,
	}
}

// ---------------------------------------------------------------- topics
export async function topics(db: CorpusDb, includeJunk = false): Promise<TopicSummary[]> {
	// Readers get the view. The review surface (includeJunk) also lists the
	// live topics a reviewer confirmed as junk, by name, from the table.
	const rows = includeJunk
		? await db
				.select({
					topicClusterId: s.topicCluster.topicClusterId,
					title: s.topicCluster.title,
					description: s.topicCluster.description,
					junkAiFlagged: s.topicCluster.junkAiFlagged,
					junkAiReason: s.topicCluster.junkAiReason,
					junkStatus: s.topicCluster.junkStatus,
				})
				.from(s.topicCluster)
				.where(isNull(s.topicCluster.retiredBuildId))
				.orderBy(asc(s.topicCluster.topicClusterId))
		: await db
				.select({
					topicClusterId: s.currentTopic.topicClusterId,
					title: s.currentTopic.title,
					description: s.currentTopic.description,
					junkAiFlagged: s.currentTopic.junkAiFlagged,
					junkAiReason: s.currentTopic.junkAiReason,
					junkStatus: s.currentTopic.junkStatus,
				})
				.from(s.currentTopic)
				.orderBy(asc(s.currentTopic.topicClusterId))
	const kp = new Map(
		(
			await db
				.select({ id: s.clusterKeyPoint.topicClusterId, n: sql<number>`count(*)` })
				.from(s.clusterKeyPoint)
				.groupBy(s.clusterKeyPoint.topicClusterId)
		).map((r) => [r.id, n(r.n)]),
	)
	const ent = new Map(
		(
			await db
				.select({ id: s.currentEntityMembership.topicClusterId, n: sql<number>`count(*)` })
				.from(s.currentEntityMembership)
				.where(strongSource)
				.groupBy(s.currentEntityMembership.topicClusterId)
		).map((r) => [r.id, n(r.n)]),
	)
	// a topic's documents are the ones it holds strongly: an exemplar or
	// high-value passage, the rule every count of the record follows
	const docs = new Map(
		(
			await db.all<{ id: number; n: number }>(
				sql`SELECT m.topic_cluster_id AS id, COUNT(DISTINCT c.document_id) AS n FROM current_chunk_membership m JOIN published_chunk c ON c.id = m.chunk_id WHERE m.membership_type IN ${STRONG} GROUP BY m.topic_cluster_id`,
			)
		).map((r) => [r.id, n(r.n)]),
	)
	const positions = await db
		.select({
			id: s.clusterEntityPerspective.topicClusterId,
			position: s.clusterEntityPerspective.position,
			n: sql<number>`count(*)`,
		})
		.from(s.clusterEntityPerspective)
		.groupBy(s.clusterEntityPerspective.topicClusterId, s.clusterEntityPerspective.position)
	const mix = new Map<number, Record<string, number>>()
	for (const p of positions) mix.set(p.id, { ...(mix.get(p.id) ?? {}), [p.position]: n(p.n) })
	return rows.map((c) => ({
		topicClusterId: c.topicClusterId,
		title: c.title,
		description: c.description,
		keyPoints: kp.get(c.topicClusterId) ?? 0,
		entities: ent.get(c.topicClusterId) ?? 0,
		documents: docs.get(c.topicClusterId) ?? 0,
		junkAiFlagged: c.junkAiFlagged === 1,
		junkAiReason: c.junkAiReason,
		junkStatus: c.junkStatus,
		positions: mix.get(c.topicClusterId) ?? {},
	}))
}

export async function topicById(db: CorpusDb, topicClusterId: number): Promise<TopicDetail | null> {
	const summary = (await topics(db, true)).find((t) => t.topicClusterId === topicClusterId)
	if (!summary) return null
	const tc = summary.topicClusterId
	// Child rows are reached through their parent's own predicate (a join back to
	// the topic), never through an id list: DO SQLite binds ~100 parameters per
	// statement, and a large topic's perspectives blew that on the galaxy
	// (2026-09-04, run 7f7f06f7 — the playground audit-corpus app settled the same way).
	const kpRows = await db
		.select()
		.from(s.clusterKeyPoint)
		.where(eq(s.clusterKeyPoint.topicClusterId, tc))
		.orderBy(asc(s.clusterKeyPoint.clusterKeyPointId))
	const kpQuotes = await db
		.select({
			kpId: s.clusterKeyPointQuote.clusterKeyPointId,
			text: s.clusterKeyPointQuote.quoteText,
			entityUuid: s.clusterKeyPointQuote.entityUuid,
			entityName: s.entity.entityName,
		})
		.from(s.clusterKeyPointQuote)
		.innerJoin(s.entity, eq(s.clusterKeyPointQuote.entityUuid, s.entity.id))
		.innerJoin(
			s.clusterKeyPoint,
			eq(s.clusterKeyPointQuote.clusterKeyPointId, s.clusterKeyPoint.clusterKeyPointId),
		)
		.where(eq(s.clusterKeyPoint.topicClusterId, tc))
		.orderBy(asc(s.clusterKeyPointQuote.quoteId))
	const facetCache = await loadFacetCache(db, 'entity')
	const persp = await db
		.select({
			id: s.clusterEntityPerspective.clusterEntityPerspectiveId,
			entityUuid: s.clusterEntityPerspective.entityUuid,
			entityId: s.entity.entityId,
			entityName: s.entity.entityName,
			title: s.clusterEntityPerspective.title,
			description: s.clusterEntityPerspective.description,
			position: s.clusterEntityPerspective.position,
			positionAnalysis: s.clusterEntityPerspective.positionAnalysis,
		})
		.from(s.clusterEntityPerspective)
		.innerJoin(s.entity, eq(s.clusterEntityPerspective.entityUuid, s.entity.id))
		.where(eq(s.clusterEntityPerspective.topicClusterId, tc))
		.orderBy(asc(s.entity.entityName))
	const perspKp = await db
		.select({
			keyPointId: s.clusterEntityPerspectiveKeyPoint.keyPointId,
			clusterEntityPerspectiveId: s.clusterEntityPerspectiveKeyPoint.clusterEntityPerspectiveId,
			keyPoint: s.clusterEntityPerspectiveKeyPoint.keyPoint,
			details: s.clusterEntityPerspectiveKeyPoint.details,
		})
		.from(s.clusterEntityPerspectiveKeyPoint)
		.innerJoin(
			s.clusterEntityPerspective,
			eq(
				s.clusterEntityPerspectiveKeyPoint.clusterEntityPerspectiveId,
				s.clusterEntityPerspective.clusterEntityPerspectiveId,
			),
		)
		.where(eq(s.clusterEntityPerspective.topicClusterId, tc))
		.orderBy(asc(s.clusterEntityPerspectiveKeyPoint.keyPointId))
	const perspKpQuotes = await db
		.select({
			keyPointId: s.clusterEntityPerspectiveKpQuote.keyPointId,
			quoteText: s.clusterEntityPerspectiveKpQuote.quoteText,
		})
		.from(s.clusterEntityPerspectiveKpQuote)
		.innerJoin(
			s.clusterEntityPerspectiveKeyPoint,
			eq(
				s.clusterEntityPerspectiveKpQuote.keyPointId,
				s.clusterEntityPerspectiveKeyPoint.keyPointId,
			),
		)
		.innerJoin(
			s.clusterEntityPerspective,
			eq(
				s.clusterEntityPerspectiveKeyPoint.clusterEntityPerspectiveId,
				s.clusterEntityPerspective.clusterEntityPerspectiveId,
			),
		)
		.where(eq(s.clusterEntityPerspective.topicClusterId, tc))
		.orderBy(asc(s.clusterEntityPerspectiveKpQuote.quoteId))
	const perspQuotes = await db
		.select({
			clusterEntityPerspectiveId: s.clusterEntityPerspectiveQuote.clusterEntityPerspectiveId,
			quoteText: s.clusterEntityPerspectiveQuote.quoteText,
		})
		.from(s.clusterEntityPerspectiveQuote)
		.innerJoin(
			s.clusterEntityPerspective,
			eq(
				s.clusterEntityPerspectiveQuote.clusterEntityPerspectiveId,
				s.clusterEntityPerspective.clusterEntityPerspectiveId,
			),
		)
		.where(eq(s.clusterEntityPerspective.topicClusterId, tc))
		.orderBy(asc(s.clusterEntityPerspectiveQuote.quoteId))
	const facetRows = await db
		.select()
		.from(s.clusterKeyPerspective)
		.where(eq(s.clusterKeyPerspective.topicClusterId, tc))
		.orderBy(asc(s.clusterKeyPerspective.facet), asc(s.clusterKeyPerspective.facetValue))
	const facetQuotes = await db
		.select({
			pid: s.clusterPerspectiveQuote.clusterKeyPerspectiveId,
			text: s.clusterPerspectiveQuote.quoteText,
			entityUuid: s.clusterPerspectiveQuote.entityUuid,
			entityName: s.entity.entityName,
			rationale: s.clusterPerspectiveQuote.rationale,
		})
		.from(s.clusterPerspectiveQuote)
		.innerJoin(s.entity, eq(s.clusterPerspectiveQuote.entityUuid, s.entity.id))
		.innerJoin(
			s.clusterKeyPerspective,
			eq(
				s.clusterPerspectiveQuote.clusterKeyPerspectiveId,
				s.clusterKeyPerspective.clusterKeyPerspectiveId,
			),
		)
		.where(eq(s.clusterKeyPerspective.topicClusterId, tc))
		.orderBy(asc(s.clusterPerspectiveQuote.quoteId))
	const sourceDocs = await db.all<{
		documentId: string
		fileName: string
		title: string | null
		entityName: string
		entityUuid: string
		chunks: number
	}>(sql`
		SELECT d.document_id AS documentId, d.file_name AS fileName, d.document_title AS title, e.entity_name AS entityName, e.id AS entityUuid, COUNT(*) AS chunks
		FROM current_chunk_membership m JOIN published_chunk c ON c.id = m.chunk_id JOIN published_document d ON d.document_id = c.document_id JOIN entity e ON e.id = d.entity_uuid
		WHERE m.topic_cluster_id = ${tc} AND m.membership_type IN ${STRONG} GROUP BY d.document_id ORDER BY chunks DESC`)
	const parents = await db.all<{
		superclusterId: number
		title: string | null
		generation: number
		isPrimary: number
		membershipType: string | null
		similarity: number | null
	}>(sql`
		SELECT p.supercluster_id AS superclusterId, p.title, p.generation, e.is_primary AS isPrimary, e.membership_type AS membershipType, e.similarity
		FROM current_supercluster child JOIN current_supercluster_edge e ON e.child_supercluster_id = child.supercluster_id JOIN current_supercluster p ON p.supercluster_id = e.parent_supercluster_id
		WHERE child.topic_cluster_id = ${tc} ORDER BY e.is_primary DESC, e.similarity DESC`)
	const members = await db
		.select({
			entityUuid: s.entity.id,
			entityId: s.entity.entityId,
			entityName: s.entity.entityName,
			membershipType: s.currentEntityMembership.membershipType,
		})
		.from(s.currentEntityMembership)
		.innerJoin(s.entity, eq(s.currentEntityMembership.entityUuid, s.entity.id))
		.where(and(eq(s.currentEntityMembership.topicClusterId, tc), strongSource))
		.orderBy(asc(s.entity.entityName))
	const tree = treeOf(await hierarchy(db))
	const base = tree.baseOfTopic.get(tc)
	return {
		...summary,
		keyPointItems: kpRows.map((r) => ({
			keyPoint: r.keyPoint,
			details: r.details,
			quotes: kpQuotes
				.filter((q) => q.kpId === r.clusterKeyPointId)
				.map((q) => ({
					text: q.text,
					entityName: q.entityName,
					entityUuid: q.entityUuid,
					rationale: null,
				})),
		})),
		entityPerspectives: persp.map((p) => ({
			entityUuid: p.entityUuid,
			entityId: p.entityId,
			entityName: p.entityName,
			title: p.title,
			description: p.description,
			position: p.position,
			positionAnalysis: p.positionAnalysis,
			keyPoints: perspKp
				.filter((k) => k.clusterEntityPerspectiveId === p.id)
				.map((k) => ({
					keyPoint: k.keyPoint,
					details: k.details,
					quotes: perspKpQuotes
						.filter((q) => q.keyPointId === k.keyPointId)
						.map((q) => q.quoteText),
				})),
			quotes: perspQuotes
				.filter((q) => q.clusterEntityPerspectiveId === p.id)
				.map((q) => q.quoteText),
			facets: facetCache.get(p.entityUuid) ?? {},
		})),
		facetPerspectives: facetRows.map((r) => ({
			facet: r.facet,
			facetValue: r.facetValue,
			position: r.position,
			positionAnalysis: r.positionAnalysis,
			quotes: facetQuotes
				.filter((q) => q.pid === r.clusterKeyPerspectiveId)
				.map((q) => ({
					text: q.text,
					entityName: q.entityName,
					entityUuid: q.entityUuid,
					rationale: q.rationale,
				})),
		})),
		sourceDocuments: sourceDocs.map((d) => ({ ...d, chunks: n(d.chunks) })),
		parents: parents.map((p) => ({ ...p, isPrimary: p.isPrimary === 1 })),
		members: members.map((m) => ({ ...m, facets: facetCache.get(m.entityUuid) ?? {} })),
		lineage: base ? tree.ancestorsOf(base.superclusterId) : [],
	}
}

/** A grouping node: its lineage, its direct sub-groups or topics, and the reach of everything beneath it. */
export async function groupById(db: CorpusDb, superclusterId: number): Promise<GroupDetail | null> {
	const tree = treeOf(await hierarchy(db))
	const node = tree.byId.get(superclusterId)
	if (!node || node.generation === 0) return null
	const summaries = new Map((await topics(db)).map((t) => [t.topicClusterId, t]))
	const membership = await db
		.select({
			topicClusterId: s.currentEntityMembership.topicClusterId,
			entityUuid: s.currentEntityMembership.entityUuid,
		})
		.from(s.currentEntityMembership)
		.where(strongSource)
	const membersOf = new Map<number, Set<string>>()
	for (const m of membership)
		membersOf.set(
			m.topicClusterId,
			(membersOf.get(m.topicClusterId) ?? new Set()).add(m.entityUuid),
		)
	const reachOf = (topicIds: number[]) => {
		const reach = new Set<string>()
		for (const t of topicIds) for (const e of membersOf.get(t) ?? []) reach.add(e)
		return reach.size
	}
	const facetCache = await loadFacetCache(db, 'entity')
	const stances = await db
		.select({
			topicClusterId: s.clusterEntityPerspective.topicClusterId,
			entityUuid: s.clusterEntityPerspective.entityUuid,
			position: s.clusterEntityPerspective.position,
		})
		.from(s.clusterEntityPerspective)
	const under = new Set(tree.topicsUnder(superclusterId))
	const positions: Record<string, number> = {}
	const spreadOf = new Map<number, Map<string, Set<string>>>()
	for (const st of stances) {
		if (!under.has(st.topicClusterId)) continue
		positions[st.position] = (positions[st.position] ?? 0) + 1
		const spread = spreadOf.get(st.topicClusterId) ?? new Map<string, Set<string>>()
		for (const [facet, values] of Object.entries(facetCache.get(st.entityUuid) ?? {}))
			spread.set(facet, (spread.get(facet) ?? new Set()).add(values[0] ?? 'Unknown'))
		spreadOf.set(st.topicClusterId, spread)
	}
	const children = tree.childrenOf(superclusterId).flatMap((id) => {
		const child = tree.byId.get(id)
		return child ? [child] : []
	})
	return {
		superclusterId,
		generation: node.generation,
		topGeneration: Math.max(0, ...[...tree.byId.values()].map((n) => n.generation)),
		title: node.title,
		description: node.description,
		lineage: tree.ancestorsOf(superclusterId),
		children: children
			.filter((c) => c.generation > 0)
			.map((c) => {
				const topicIds = tree.topicsUnder(c.superclusterId)
				return {
					superclusterId: c.superclusterId,
					generation: c.generation,
					title: c.title,
					topics: topicIds.length,
					entities: reachOf(topicIds),
				}
			})
			.sort((a, b) => b.entities - a.entities),
		topics: children
			.flatMap((c) =>
				c.generation === 0 && c.topicClusterId !== null && under.has(c.topicClusterId)
					? [c.topicClusterId]
					: [],
			)
			.flatMap((t) => {
				const summary = summaries.get(t)
				if (!summary) return []
				return [
					{
						topicClusterId: t,
						title: summary.title,
						entities: membersOf.get(t)?.size ?? 0,
						documents: summary.documents,
						positions: summary.positions,
						facetSpread: Object.fromEntries(
							[...(spreadOf.get(t) ?? new Map<string, Set<string>>())].map(([facet, values]) => [
								facet,
								values.size,
							]),
						),
					},
				]
			})
			.sort((a, b) => b.entities - a.entities),
		topicCount: under.size,
		entities: reachOf([...under]),
		positions,
	}
}

/** Topics sharing entities with a topic, ranked by shared entity count. */
export async function relatedTopics(
	db: CorpusDb,
	topicClusterId: number,
	limit = 10,
): Promise<RelatedTopic[]> {
	const pk = (
		await db
			.select({ id: s.currentTopic.topicClusterId })
			.from(s.currentTopic)
			.where(eq(s.currentTopic.topicClusterId, topicClusterId))
	)[0]?.id
	if (pk === undefined) return []
	const own = (
		await db
			.select({ e: s.currentEntityMembership.entityUuid })
			.from(s.currentEntityMembership)
			.where(and(eq(s.currentEntityMembership.topicClusterId, pk), strongSource))
	).map((r) => r.e)
	if (!own.length) return []
	const shared = new Map<number, number>()
	for (const group of inGroups(own, 80)) {
		for (const r of await db
			.select({
				id: s.currentEntityMembership.topicClusterId,
				n: sql<number>`count(distinct ${s.currentEntityMembership.entityUuid})`,
			})
			.from(s.currentEntityMembership)
			.where(and(inArray(s.currentEntityMembership.entityUuid, group), strongSource))
			.groupBy(s.currentEntityMembership.topicClusterId)) {
			if (r.id !== pk) shared.set(r.id, (shared.get(r.id) ?? 0) + n(r.n))
		}
	}
	const top = [...shared].sort((a, b) => b[1] - a[1]).slice(0, limit)
	const titles = new Map(
		(
			await db
				.select({ id: s.currentTopic.topicClusterId, title: s.currentTopic.title })
				.from(s.currentTopic)
				.where(inArray(s.currentTopic.topicClusterId, top.map(([id]) => id).concat([-1])))
		).map((r) => [r.id, r]),
	)
	return top.flatMap(([id, count]) => {
		const topic = titles.get(id)
		return topic ? [{ topicClusterId: topic.id, title: topic.title, sharedEntities: count }] : []
	})
}

// ---------------------------------------------------------------- entities
export async function entities(db: CorpusDb): Promise<EntitySummary[]> {
	const rows = await db.select().from(s.entity).orderBy(asc(s.entity.entityName))
	const facets = await loadFacetCache(db, 'entity')
	const docs = new Map(
		(
			await db
				.select({ id: s.publishedDocument.entityUuid, n: sql<number>`count(*)` })
				.from(s.publishedDocument)
				.groupBy(s.publishedDocument.entityUuid)
		).map((r) => [r.id, n(r.n)]),
	)
	const topicsN = new Map(
		(
			await db
				.select({ id: s.currentEntityMembership.entityUuid, n: sql<number>`count(*)` })
				.from(s.currentEntityMembership)
				.where(strongSource)
				.groupBy(s.currentEntityMembership.entityUuid)
		).map((r) => [r.id, n(r.n)]),
	)
	const kp = new Map(
		(
			await db
				.select({ id: s.publishedDocument.entityUuid, n: sql<number>`count(*)` })
				.from(s.publishedKeyPoint)
				.innerJoin(
					s.publishedDocument,
					eq(s.publishedKeyPoint.documentId, s.publishedDocument.documentId),
				)
				.groupBy(s.publishedDocument.entityUuid)
		).map((r) => [r.id, n(r.n)]),
	)
	return rows.map((e) => ({
		entityUuid: e.id,
		entityId: e.entityId,
		entityName: e.entityName,
		facets: facets.get(e.id) ?? {},
		documents: docs.get(e.id) ?? 0,
		topics: topicsN.get(e.id) ?? 0,
		keyPoints: kp.get(e.id) ?? 0,
	}))
}

/** A source by its uuid, its `entity_id` slug, or the id of one of its published documents — so prose can cite a source by any of them. */
export async function entityByKey(db: CorpusDb, key: string): Promise<EntityDetail | null> {
	const row =
		(
			await db
				.select()
				.from(s.entity)
				.where(or(eq(s.entity.id, key), eq(s.entity.entityId, key)))
		)[0] ??
		(
			await db
				.select({ entity: s.entity })
				.from(s.publishedDocument)
				.innerJoin(s.entity, eq(s.publishedDocument.entityUuid, s.entity.id))
				.where(eq(s.publishedDocument.documentId, key))
		)[0]?.entity
	if (!row) return null
	const summary = (await entities(db)).find((e) => e.entityUuid === row.id)
	if (!summary) return null
	const docs = await db
		.select({
			documentId: s.publishedDocument.documentId,
			fileName: s.publishedDocument.fileName,
			title: s.publishedDocument.documentTitle,
		})
		.from(s.publishedDocument)
		.where(eq(s.publishedDocument.entityUuid, row.id))
		.orderBy(asc(s.publishedDocument.fileName))
	// through the entity's own predicate, never an id list (see topicById)
	const kp = new Map(
		(
			await db
				.select({ id: s.publishedKeyPoint.documentId, n: sql<number>`count(*)` })
				.from(s.publishedKeyPoint)
				.innerJoin(
					s.publishedDocument,
					eq(s.publishedKeyPoint.documentId, s.publishedDocument.documentId),
				)
				.where(eq(s.publishedDocument.entityUuid, row.id))
				.groupBy(s.publishedKeyPoint.documentId)
		).map((r) => [r.id, n(r.n)]),
	)
	const memberships = await db
		.select({
			topicClusterId: s.currentTopic.topicClusterId,
			title: s.currentTopic.title,
			membershipType: s.currentEntityMembership.membershipType,
		})
		.from(s.currentEntityMembership)
		.innerJoin(
			s.currentTopic,
			eq(s.currentEntityMembership.topicClusterId, s.currentTopic.topicClusterId),
		)
		.where(and(eq(s.currentEntityMembership.entityUuid, row.id), strongSource))
		.orderBy(asc(s.currentTopic.topicClusterId))
	const persp = await db
		.select()
		.from(s.clusterEntityPerspective)
		.where(eq(s.clusterEntityPerspective.entityUuid, row.id))
	const perspQuotes = await db
		.select({
			clusterEntityPerspectiveId: s.clusterEntityPerspectiveQuote.clusterEntityPerspectiveId,
			quoteText: s.clusterEntityPerspectiveQuote.quoteText,
		})
		.from(s.clusterEntityPerspectiveQuote)
		.innerJoin(
			s.clusterEntityPerspective,
			eq(
				s.clusterEntityPerspectiveQuote.clusterEntityPerspectiveId,
				s.clusterEntityPerspective.clusterEntityPerspectiveId,
			),
		)
		.where(eq(s.clusterEntityPerspective.entityUuid, row.id))
	const documentFacets = await loadFacetCache(db, 'document')
	return {
		...summary,
		inferredName: row.inferredName ?? summary.facets.llm_entity_name?.[0] ?? null,
		documentItems: docs.map((d) => ({
			...d,
			keyPoints: kp.get(d.documentId) ?? 0,
			facets: documentFacets.get(d.documentId) ?? {},
		})),
		topicItems: memberships.map((m) => {
			const p = persp.find((x) => x.topicClusterId === m.topicClusterId)
			return {
				...m,
				position: p?.position ?? null,
				positionAnalysis: p?.positionAnalysis ?? null,
				perspectiveTitle: p?.title ?? null,
				quotes: p
					? perspQuotes
							.filter((q) => q.clusterEntityPerspectiveId === p.clusterEntityPerspectiveId)
							.map((q) => q.quoteText)
					: [],
			}
		}),
	}
}

// ---------------------------------------------------------------- documents
export async function documents(db: CorpusDb): Promise<DocumentSummary[]> {
	const rows = await db
		.select({
			documentId: s.publishedDocument.documentId,
			fileName: s.publishedDocument.fileName,
			title: s.publishedDocument.documentTitle,
			entityUuid: s.entity.id,
			entityName: s.entity.entityName,
		})
		.from(s.publishedDocument)
		.innerJoin(s.entity, eq(s.publishedDocument.entityUuid, s.entity.id))
		.orderBy(asc(s.entity.entityName), asc(s.publishedDocument.fileName))
	const facets = await loadFacetCache(db, 'document')
	const kp = new Map(
		(
			await db
				.select({ id: s.publishedKeyPoint.documentId, n: sql<number>`count(*)` })
				.from(s.publishedKeyPoint)
				.groupBy(s.publishedKeyPoint.documentId)
		).map((r) => [r.id, n(r.n)]),
	)
	const quotes = new Map(
		(
			await db
				.select({ id: s.publishedKeyPoint.documentId, n: sql<number>`count(*)` })
				.from(s.publishedKeyQuote)
				.innerJoin(
					s.publishedKeyPoint,
					eq(s.publishedKeyQuote.keyPointId, s.publishedKeyPoint.keyPointId),
				)
				.groupBy(s.publishedKeyPoint.documentId)
		).map((r) => [r.id, n(r.n)]),
	)
	const chunks = new Map(
		(
			await db
				.select({ id: s.publishedChunk.documentId, n: sql<number>`count(*)` })
				.from(s.publishedChunk)
				.groupBy(s.publishedChunk.documentId)
		).map((r) => [r.id, n(r.n)]),
	)
	return rows.map((d) => ({
		...d,
		facets: facets.get(d.documentId) ?? {},
		keyPoints: kp.get(d.documentId) ?? 0,
		quotes: quotes.get(d.documentId) ?? 0,
		chunks: chunks.get(d.documentId) ?? 0,
	}))
}

export async function documentById(
	db: CorpusDb,
	documentId: string,
): Promise<DocumentDetail | null> {
	const summary = (await documents(db)).find((d) => d.documentId === documentId)
	if (!summary) return null
	const kpRows = await db
		.select()
		.from(s.publishedKeyPoint)
		.where(eq(s.publishedKeyPoint.documentId, documentId))
		.orderBy(asc(s.publishedKeyPoint.keyPointId))
	// through the document's own predicate, never an id list (see topicById)
	const kpQuotes = await db
		.select({
			keyPointId: s.publishedKeyQuote.keyPointId,
			quote: s.publishedKeyQuote.quote,
			verified: s.publishedKeyQuoteVerification.verified,
		})
		.from(s.publishedKeyQuote)
		.innerJoin(
			s.publishedKeyPoint,
			eq(s.publishedKeyQuote.keyPointId, s.publishedKeyPoint.keyPointId),
		)
		.leftJoin(
			s.publishedKeyQuoteVerification,
			eq(s.publishedKeyQuoteVerification.keyQuoteId, s.publishedKeyQuote.keyQuoteId),
		)
		.where(eq(s.publishedKeyPoint.documentId, documentId))
		.orderBy(asc(s.publishedKeyQuote.keyQuoteId))
	// v7: the document's model-assigned concepts (the former document_tag rows), direct assignments only
	const tags = (
		await subjectConcepts(db, 'document', documentId, { provenance: 'llm_inferred' })
	).map((r) => ({
		category: r.facet,
		path: r.facet_value,
		name: r.label,
		level: r.depth + 1,
		relevance: r.relevance ?? '',
		context: r.context ?? '',
		isPrimary: r.is_primary,
	}))
	const qr = await db
		.select({
			id: s.publishedQuestionResponse.questionResponseId,
			questionKey: s.question.questionKey,
			questionText: s.question.questionText,
			ordinal: s.question.ordinal,
			addressed: s.publishedQuestionResponse.addressed,
			position: s.publishedQuestionResponse.position,
		})
		.from(s.publishedQuestionResponse)
		.innerJoin(s.question, eq(s.publishedQuestionResponse.questionId, s.question.questionId))
		.where(eq(s.publishedQuestionResponse.documentId, documentId))
		.orderBy(asc(s.question.ordinal))
	const qrKp = await db
		.select({
			questionResponseKeyPointId: s.publishedQuestionResponseKeyPoint.questionResponseKeyPointId,
			questionResponseId: s.publishedQuestionResponseKeyPoint.questionResponseId,
			keyPoint: s.publishedQuestionResponseKeyPoint.keyPoint,
			details: s.publishedQuestionResponseKeyPoint.details,
		})
		.from(s.publishedQuestionResponseKeyPoint)
		.innerJoin(
			s.publishedQuestionResponse,
			eq(
				s.publishedQuestionResponseKeyPoint.questionResponseId,
				s.publishedQuestionResponse.questionResponseId,
			),
		)
		.where(eq(s.publishedQuestionResponse.documentId, documentId))
		.orderBy(asc(s.publishedQuestionResponseKeyPoint.questionResponseKeyPointId))
	const qrQuotes = await db
		.select({
			questionResponseKeyPointId: s.publishedQuestionResponseQuote.questionResponseKeyPointId,
			quote: s.publishedQuestionResponseQuote.quote,
		})
		.from(s.publishedQuestionResponseQuote)
		.innerJoin(
			s.publishedQuestionResponseKeyPoint,
			eq(
				s.publishedQuestionResponseQuote.questionResponseKeyPointId,
				s.publishedQuestionResponseKeyPoint.questionResponseKeyPointId,
			),
		)
		.innerJoin(
			s.publishedQuestionResponse,
			eq(
				s.publishedQuestionResponseKeyPoint.questionResponseId,
				s.publishedQuestionResponse.questionResponseId,
			),
		)
		.where(eq(s.publishedQuestionResponse.documentId, documentId))
		.orderBy(asc(s.publishedQuestionResponseQuote.questionResponseQuoteId))
	const criteria = await db.all<{
		topic: string
		subtopic: string
		keyPoint: string
		details: string
		id: number
	}>(sql`
		SELECT t.topic_name AS topic, st.subtopic_name AS subtopic, ca.key_point AS keyPoint, ca.details, ca.criterion_analysis_id AS id
		FROM criterion_analysis ca JOIN doc_custom_analysis dca ON dca.custom_analysis_id = ca.custom_analysis_id
		JOIN analysis_subtopic st ON st.analysis_subtopic_id = ca.analysis_subtopic_id JOIN analysis_topic t ON t.analysis_topic_id = st.analysis_topic_id
		WHERE dca.document_id = ${documentId} ORDER BY t.topic_name, st.subtopic_name, ca.criterion_analysis_id`)
	const criteriaQuotes = await db
		.select({
			criterionAnalysisId: s.criterionQuote.criterionAnalysisId,
			quote: s.criterionQuote.quote,
		})
		.from(s.criterionQuote)
		.innerJoin(
			s.criterionAnalysis,
			eq(s.criterionQuote.criterionAnalysisId, s.criterionAnalysis.criterionAnalysisId),
		)
		.innerJoin(
			s.docCustomAnalysis,
			eq(s.criterionAnalysis.customAnalysisId, s.docCustomAnalysis.customAnalysisId),
		)
		.where(eq(s.docCustomAnalysis.documentId, documentId))
		.orderBy(asc(s.criterionQuote.quoteId))
	const metricRows = await db.all<{
		id: number
		metricType: string
		metricName: string
		explicitness: string
		metricDescription: string
	}>(sql`
		SELECT m.metric_id AS id, m.metric_type AS metricType, m.metric_name AS metricName, m.explicitness, m.metric_description AS metricDescription
		FROM metric m JOIN doc_custom_analysis dca ON dca.custom_analysis_id = m.custom_analysis_id
		WHERE dca.document_id = ${documentId} ORDER BY m.metric_type, m.metric_id`)
	const metricReqs = await db
		.select({
			metricId: s.metricCollectionRequirement.metricId,
			requirement: s.metricCollectionRequirement.requirement,
		})
		.from(s.metricCollectionRequirement)
		.innerJoin(s.metric, eq(s.metricCollectionRequirement.metricId, s.metric.metricId))
		.innerJoin(
			s.docCustomAnalysis,
			eq(s.metric.customAnalysisId, s.docCustomAnalysis.customAnalysisId),
		)
		.where(eq(s.docCustomAnalysis.documentId, documentId))
		.orderBy(asc(s.metricCollectionRequirement.requirementId))
	const metricStars = await db
		.select({
			metricId: s.metricNorthStarAlignment.metricId,
			northStar: s.northStar.northStarName,
			how: s.metricNorthStarAlignment.alignmentHow,
		})
		.from(s.metricNorthStarAlignment)
		.innerJoin(s.northStar, eq(s.metricNorthStarAlignment.northStarId, s.northStar.northStarId))
		.innerJoin(s.metric, eq(s.metricNorthStarAlignment.metricId, s.metric.metricId))
		.innerJoin(
			s.docCustomAnalysis,
			eq(s.metric.customAnalysisId, s.docCustomAnalysis.customAnalysisId),
		)
		.where(eq(s.docCustomAnalysis.documentId, documentId))
		.orderBy(asc(s.metricNorthStarAlignment.alignmentId))
	const topicRows = await db.all<{ topicClusterId: number; title: string; chunks: number }>(sql`
		SELECT tc.topic_cluster_id AS topicClusterId, tc.title, COUNT(*) AS chunks FROM current_chunk_membership m JOIN published_chunk c ON c.id = m.chunk_id JOIN current_topic tc ON tc.topic_cluster_id = m.topic_cluster_id
		WHERE c.document_id = ${documentId} GROUP BY tc.topic_cluster_id ORDER BY chunks DESC`)
	const text = (
		await db
			.select({ text: s.publishedChunk.text })
			.from(s.publishedChunk)
			.where(eq(s.publishedChunk.documentId, documentId))
			.orderBy(asc(s.publishedChunk.chunkIndex))
	)
		.map((r) => r.text)
		.join(' ')
	return {
		...summary,
		keyPointItems: kpRows.map((k) => ({
			keyPoint: k.keyPoint,
			details: k.details,
			quotes: kpQuotes
				.filter((q) => q.keyPointId === k.keyPointId)
				.map((q) => ({ text: q.quote, verified: q.verified !== 0 })),
		})),
		tags: tags.map((t) => ({ ...t, isPrimary: t.isPrimary === 1 })),
		questionResponses: qr.map((r) => ({
			questionKey: r.questionKey,
			questionText: r.questionText,
			addressed: r.addressed === 1,
			position: r.position,
			keyPoints: qrKp
				.filter((k) => k.questionResponseId === r.id)
				.map((k) => ({
					keyPoint: k.keyPoint,
					details: k.details,
					quotes: qrQuotes
						.filter((q) => q.questionResponseKeyPointId === k.questionResponseKeyPointId)
						.map((q) => q.quote),
				})),
		})),
		criteria: criteria.map((c) => ({
			topic: c.topic,
			subtopic: c.subtopic,
			keyPoint: c.keyPoint,
			details: c.details,
			quotes: criteriaQuotes.filter((q) => q.criterionAnalysisId === c.id).map((q) => q.quote),
		})),
		metrics: metricRows.map((m) => ({
			metricType: m.metricType,
			metricName: m.metricName,
			explicitness: m.explicitness,
			metricDescription: m.metricDescription,
			requirements: metricReqs.filter((r) => r.metricId === m.id).map((r) => r.requirement),
			northStars: metricStars
				.filter((x) => x.metricId === m.id)
				.map((x) => ({ northStar: x.northStar, how: x.how })),
		})),
		topics: topicRows.map((t) => ({ ...t, chunks: n(t.chunks) })),
		text,
	}
}

export async function findDocuments(
	db: CorpusDb,
	query: string,
	limit = 15,
): Promise<FoundDocument[]> {
	const pattern = `%${query.replace(/[%_]/g, '')}%`
	return db
		.select({
			documentId: s.publishedDocument.documentId,
			title: s.publishedDocument.documentTitle,
			fileName: s.publishedDocument.fileName,
			entityName: s.entity.entityName,
		})
		.from(s.publishedDocument)
		.innerJoin(s.entity, eq(s.publishedDocument.entityUuid, s.entity.id))
		.where(
			or(
				like(s.publishedDocument.documentTitle, pattern),
				like(s.publishedDocument.fileName, pattern),
				like(s.entity.entityName, pattern),
			),
		)
		.limit(limit)
}

// ---------------------------------------------------------------- vocabularies (v7) + questions

/** A vocabulary's concepts as a tree with paths: id, external id, pref label, depth, path and parent path. */
async function conceptTree(
	db: CorpusDb,
	vocabularyId: number,
): Promise<
	Map<
		number,
		{
			conceptId: number
			externalId: string
			notation: string | null
			name: string
			depth: number
			path: string
			parentPath: string | null
			parentId: number | null
			deprecated: boolean
		}
	>
> {
	const concepts = await db
		.select({
			conceptId: s.concept.conceptId,
			externalId: s.concept.externalId,
			notation: s.concept.notation,
			deprecated: s.concept.deprecated,
			label: s.conceptLabel.label,
		})
		.from(s.concept)
		.leftJoin(
			s.conceptLabel,
			and(eq(s.conceptLabel.conceptId, s.concept.conceptId), eq(s.conceptLabel.kind, 'pref')),
		)
		.where(eq(s.concept.vocabularyId, vocabularyId))
	const edges = await db
		.select({ conceptId: s.conceptBroader.conceptId, broaderId: s.conceptBroader.broaderId })
		.from(s.conceptBroader)
		.innerJoin(s.concept, eq(s.conceptBroader.conceptId, s.concept.conceptId))
		.where(eq(s.concept.vocabularyId, vocabularyId))
	const parent = new Map<number, number>()
	for (const e of edges) if (!parent.has(e.conceptId)) parent.set(e.conceptId, e.broaderId) // first broader = display parent
	const byId = new Map(concepts.map((c) => [c.conceptId, c]))
	const out = new Map<
		number,
		{
			conceptId: number
			externalId: string
			notation: string | null
			name: string
			depth: number
			path: string
			parentPath: string | null
			parentId: number | null
			deprecated: boolean
		}
	>()
	const build = (id: number, seen: Set<string>): { path: string; depth: number } => {
		const done = out.get(id)
		if (done) return { path: done.path, depth: done.depth }
		const c = byId.get(id)
		const name = c?.label ?? c?.externalId ?? String(id)
		const p = parent.get(id)
		if (p === undefined || !byId.has(p) || seen.has(String(id))) {
			out.set(id, {
				conceptId: id,
				externalId: c?.externalId ?? String(id),
				notation: c?.notation ?? null,
				name,
				depth: 0,
				path: name,
				parentPath: null,
				parentId: null,
				deprecated: c?.deprecated === 1,
			})
			return { path: name, depth: 0 }
		}
		seen.add(String(id))
		const up = build(p, seen)
		const path = `${up.path}${PATH_SEP}${name}`
		out.set(id, {
			conceptId: id,
			externalId: c?.externalId ?? String(id),
			notation: c?.notation ?? null,
			name,
			depth: up.depth + 1,
			path,
			parentPath: up.path,
			parentId: p,
			deprecated: c?.deprecated === 1,
		})
		return { path, depth: up.depth + 1 }
	}
	for (const c of concepts) build(c.conceptId, new Set())
	return out
}

/** A concept addressed by full path, external id, notation, or — when unique in the vocabulary — its preferred label. */
function findConcept<
	T extends { path: string; externalId: string; notation: string | null; name: string },
>(tree: Map<number, T>, ref: string): T | undefined {
	const nodes = [...tree.values()]
	const exact = nodes.find(
		(c) => c.path === ref || c.externalId === ref || (c.notation !== null && c.notation === ref),
	)
	if (exact) return exact
	const wanted = ref.trim().toLowerCase()
	const byName = nodes.filter((c) => c.name.trim().toLowerCase() === wanted)
	return byName.length === 1 ? byName[0] : undefined
}

/**
 * Every vocabulary facet with its concept tree and, per concept, how many
 * subjects carry it (ancestors counted through concept_closure, as the former
 * document_tag_closure did), primaries and relevance grades. The former
 * tagSummary: the same shape, now over any vocabulary facet.
 */
export async function vocabularySummary(
	db: CorpusDb,
	options: { facet?: string } = {},
): Promise<TagCategorySummary[]> {
	const facets = await db
		.select({
			facet: s.facet.facet,
			kind: s.facet.kind,
			vocabularyId: s.facet.vocabularyId,
			granularity: s.facet.granularity,
			allowsPrimary: s.facet.allowsPrimary,
			analyseAtDepth: s.facet.analyseAtDepth,
			key: s.vocabulary.key,
			version: s.vocabulary.version,
			title: s.vocabulary.title,
			levelNames: s.vocabulary.levelNames,
		})
		.from(s.facet)
		.innerJoin(s.vocabulary, eq(s.facet.vocabularyId, s.vocabulary.vocabularyId))
		.where(
			options.facet
				? and(eq(s.facet.kind, 'vocabulary'), eq(s.facet.facet, options.facet))
				: eq(s.facet.kind, 'vocabulary'),
		)
		.orderBy(asc(s.facet.facet))
	const out: TagCategorySummary[] = []
	for (const f of facets) {
		if (f.vocabularyId === null) continue
		const tree = await conceptTree(db, f.vocabularyId)
		const rows = await db.all<{
			concept_id: number
			subjects: number
			primaries: number
			relevance: string | null
			n: number
		}>(sql`
			SELECT cl.ancestor_id AS concept_id, COUNT(DISTINCT a.subject_id) AS subjects, SUM(a.is_primary) AS primaries, a.relevance, COUNT(*) AS n
			FROM facet_assignment a JOIN concept_closure cl ON cl.descendant_id = a.concept_id
			WHERE a.facet = ${f.facet} GROUP BY cl.ancestor_id, a.relevance`)
		const byConcept = new Map<
			number,
			{ subjects: number; primaries: number; relevance: Record<string, number> }
		>()
		for (const r of rows) {
			const cur = byConcept.get(r.concept_id) ?? { subjects: 0, primaries: 0, relevance: {} }
			cur.subjects = Math.max(cur.subjects, n(r.subjects)) // distinct per relevance group; the max is the floor of the true distinct count
			cur.primaries += n(r.primaries)
			if (r.relevance) cur.relevance[r.relevance] = (cur.relevance[r.relevance] ?? 0) + n(r.n)
			byConcept.set(r.concept_id, cur)
		}
		const distinct = await db.all<{ concept_id: number; subjects: number }>(sql`
			SELECT cl.ancestor_id AS concept_id, COUNT(DISTINCT a.subject_id) AS subjects
			FROM facet_assignment a JOIN concept_closure cl ON cl.descendant_id = a.concept_id
			WHERE a.facet = ${f.facet} GROUP BY cl.ancestor_id`)
		for (const r of distinct) {
			const cur = byConcept.get(r.concept_id) ?? { subjects: 0, primaries: 0, relevance: {} }
			cur.subjects = n(r.subjects)
			byConcept.set(r.concept_id, cur)
		}
		const nodes = [...tree.values()]
			.filter((c) => !c.deprecated)
			.sort((a, b) => a.path.localeCompare(b.path))
		out.push({
			category: f.facet,
			hierarchical: nodes.some((c) => c.depth > 0),
			allowsPrimary: f.allowsPrimary === 1,
			levelNames: f.levelNames ?? [],
			granularity: granularitySchema.parse(f.granularity),
			vocabulary: { key: f.key, version: f.version, title: f.title },
			analyseAtDepth: f.analyseAtDepth,
			tags: nodes.map((c) => ({
				tagId: c.conceptId,
				externalId: c.externalId,
				notation: c.notation,
				path: c.path,
				name: c.name,
				level: c.depth + 1,
				parentPath: c.parentPath,
				documents: byConcept.get(c.conceptId)?.subjects ?? 0,
				primaryDocuments: byConcept.get(c.conceptId)?.primaries ?? 0,
				relevance: byConcept.get(c.conceptId)?.relevance ?? {},
			})),
		})
	}
	return out
}

/** The former tagSummary: vocabulary facets at document granularity (what tagging tasks write). */
export async function tagSummary(db: CorpusDb): Promise<TagCategorySummary[]> {
	return (await vocabularySummary(db)).filter((v) => v.granularity === 'document')
}

/**
 * Subjects (entities or documents) carrying a concept — directly or through a
 * descendant (marked derived) — addressed by path, external id or notation.
 * The former documentsForTag, now for any vocabulary facet. A document a
 * committed update removed is not met.
 */
export async function subjectsForConcept(
	db: CorpusDb,
	ref: string,
	facet: string | null = null,
): Promise<TagDocument[]> {
	const facets = await db
		.select({
			facet: s.facet.facet,
			vocabularyId: s.facet.vocabularyId,
			granularity: s.facet.granularity,
		})
		.from(s.facet)
		.where(
			facet
				? and(eq(s.facet.kind, 'vocabulary'), eq(s.facet.facet, facet))
				: eq(s.facet.kind, 'vocabulary'),
		)
	const out: TagDocument[] = []
	for (const f of facets) {
		if (f.vocabularyId === null) continue
		const tree = await conceptTree(db, f.vocabularyId)
		const target = findConcept(tree, ref)
		if (!target) continue
		const rows = await db.all<{
			subjectId: string
			subjectType: string
			title: string | null
			fileName: string | null
			entityName: string
			relevance: string | null
			isPrimary: number
			derived: number
			context: string | null
		}>(sql`
			SELECT a.subject_id AS subjectId, a.subject_type AS subjectType, d.document_title AS title, d.file_name AS fileName,
			       COALESCE(e.entity_name, e2.entity_name) AS entityName, a.relevance, a.is_primary AS isPrimary,
			       CASE WHEN cl.depth > 0 THEN 1 ELSE 0 END AS derived, a.context
			FROM facet_assignment a JOIN concept_closure cl ON cl.descendant_id = a.concept_id AND cl.ancestor_id = ${target.conceptId}
			LEFT JOIN published_document d ON a.subject_type = 'document' AND d.document_id = a.subject_id
			LEFT JOIN entity e ON d.entity_uuid = e.id
			LEFT JOIN entity e2 ON a.subject_type = 'entity' AND e2.id = a.subject_id
			WHERE a.facet = ${f.facet} AND (a.subject_type <> 'document' OR d.document_id IS NOT NULL)
			ORDER BY a.is_primary DESC, a.relevance, entityName`)
		const seen = new Set<string>()
		for (const r of rows) {
			const key = `${r.subjectType}:${r.subjectId}`
			if (seen.has(key)) continue
			seen.add(key)
			out.push({
				documentId: r.subjectId,
				subjectType: granularitySchema.parse(r.subjectType),
				title: r.title,
				fileName: r.fileName ?? '',
				entityName: r.entityName ?? '',
				relevance: r.relevance ?? '',
				isPrimary: r.isPrimary === 1,
				derived: r.derived === 1,
				context: r.context ?? '',
				facet: f.facet,
			})
		}
	}
	return out
}

/** The former documentsForTag (alias): documents tagged with a path, ancestors included. */
export async function documentsForTag(
	db: CorpusDb,
	tagPath: string,
	category: string | null = null,
): Promise<TagDocument[]> {
	return (await subjectsForConcept(db, tagPath, category)).filter(
		(r) => r.subjectType === 'document',
	)
}

/** One concept by path, external id or notation within a facet's vocabulary: its tree node, labels, notes, matches, related. */
export async function conceptDetail(db: CorpusDb, facetName: string, ref: string) {
	const f = (
		await db
			.select({ facet: s.facet.facet, vocabularyId: s.facet.vocabularyId })
			.from(s.facet)
			.where(eq(s.facet.facet, facetName))
	)[0]
	if (!f || f.vocabularyId === null) return null
	const tree = await conceptTree(db, f.vocabularyId)
	const node = findConcept(tree, ref)
	if (!node) return null
	const labels = await db
		.select({ label: s.conceptLabel.label, kind: s.conceptLabel.kind, lang: s.conceptLabel.lang })
		.from(s.conceptLabel)
		.where(eq(s.conceptLabel.conceptId, node.conceptId))
	const notes = await db
		.select({ kind: s.conceptNote.kind, text: s.conceptNote.text })
		.from(s.conceptNote)
		.where(eq(s.conceptNote.conceptId, node.conceptId))
	const matches = await db
		.select({ scheme: s.conceptMatch.scheme, uri: s.conceptMatch.uri, kind: s.conceptMatch.kind })
		.from(s.conceptMatch)
		.where(eq(s.conceptMatch.conceptId, node.conceptId))
	const related = await db
		.select({ relatedId: s.conceptRelated.relatedId })
		.from(s.conceptRelated)
		.where(eq(s.conceptRelated.conceptId, node.conceptId))
	const broader = await db
		.select({ broaderId: s.conceptBroader.broaderId })
		.from(s.conceptBroader)
		.where(eq(s.conceptBroader.conceptId, node.conceptId))
	const narrower = [...tree.values()]
		.filter((c) => c.parentId === node.conceptId)
		.map((c) => ({ conceptId: c.conceptId, externalId: c.externalId, path: c.path, name: c.name }))
	const uri =
		(
			await db
				.select({ uri: s.concept.uri })
				.from(s.concept)
				.where(eq(s.concept.conceptId, node.conceptId))
		)[0]?.uri ?? null
	return {
		facet: f.facet,
		conceptId: node.conceptId,
		externalId: node.externalId,
		notation: node.notation,
		uri,
		name: node.name,
		path: node.path,
		depth: node.depth,
		labels,
		notes,
		matches,
		broader: broader
			.map((b) => tree.get(b.broaderId))
			.filter((x): x is NonNullable<typeof x> => !!x)
			.map((c) => ({
				conceptId: c.conceptId,
				externalId: c.externalId,
				path: c.path,
				name: c.name,
			})),
		narrower,
		related: related
			.map((r) => tree.get(r.relatedId))
			.filter((x): x is NonNullable<typeof x> => !!x)
			.map((c) => ({
				conceptId: c.conceptId,
				externalId: c.externalId,
				path: c.path,
				name: c.name,
			})),
	}
}

export async function questionSummary(db: CorpusDb): Promise<QuestionSummary[]> {
	const qs = await db
		.select()
		.from(s.question)
		.orderBy(asc(s.question.ordinal), asc(s.question.questionKey))
	const rows = await db
		.select({
			questionId: s.publishedQuestionResponse.questionId,
			documentId: s.publishedQuestionResponse.documentId,
			addressed: s.publishedQuestionResponse.addressed,
			position: s.publishedQuestionResponse.position,
			entityName: s.entity.entityName,
			title: s.publishedDocument.documentTitle,
		})
		.from(s.publishedQuestionResponse)
		.innerJoin(
			s.publishedDocument,
			eq(s.publishedQuestionResponse.documentId, s.publishedDocument.documentId),
		)
		.innerJoin(s.entity, eq(s.publishedDocument.entityUuid, s.entity.id))
	return qs.map((q) => {
		const mine = rows.filter((r) => r.questionId === q.questionId)
		return {
			questionKey: q.questionKey,
			questionText: q.questionText,
			ordinal: q.ordinal,
			responses: mine.length,
			addressed: mine.filter((r) => r.addressed === 1).length,
			positions: mine
				.filter((r) => r.addressed === 1)
				.map((r) => ({
					documentId: r.documentId,
					entityName: r.entityName,
					title: r.title,
					position: r.position,
				})),
		}
	})
}

// ---------------------------------------------------------------- custom analysis (task results)
/** Corpus-wide results per custom-analysis task PRESENT in the store, one rollup shape per task
 *  type (contracts/explorer.ts taskResultRowSchema), over published documents. */
export async function taskResults(db: CorpusDb): Promise<TaskResultRow[]> {
	const tasks = await db.all<{ taskId: string; taskType: string; documents: number }>(sql`
		SELECT dca.task_id AS taskId, dca.task_type AS taskType, COUNT(DISTINCT dca.document_id) AS documents
		FROM doc_custom_analysis dca JOIN published_document d ON d.document_id = dca.document_id
		GROUP BY dca.task_id, dca.task_type ORDER BY dca.task_id`)
	const results: TaskResultRow[] = []
	for (const t of tasks) {
		const row: TaskResultRow = {
			taskId: t.taskId,
			taskType: t.taskType,
			documentsAnalysed: n(t.documents),
			tagCategories: null,
			questions: null,
			topics: null,
			metrics: null,
		}
		if (t.taskType === 'metadata_tagging') {
			// v7: the task's assignments (facet_assignment rows it wrote), grouped by facet and the value's path
			const tagRows = await db.all<{
				category: string
				path: string
				documents: number
				primaries: number
			}>(sql`
				SELECT a.facet AS category, a.facet_value AS path, COUNT(DISTINCT a.subject_id) AS documents, SUM(a.is_primary) AS primaries
				FROM facet_assignment a JOIN doc_custom_analysis dca ON dca.custom_analysis_id = a.custom_analysis_id
				JOIN published_document d ON d.document_id = dca.document_id
				WHERE dca.task_id = ${t.taskId} GROUP BY a.facet, a.facet_value ORDER BY a.facet, a.facet_value`)
			const byCategory = new Map<
				string,
				{ path: string; documents: number; primaryDocuments: number }[]
			>()
			for (const r of tagRows)
				byCategory.set(r.category, [
					...(byCategory.get(r.category) ?? []),
					{ path: r.path, documents: n(r.documents), primaryDocuments: n(r.primaries) },
				])
			row.tagCategories = [...byCategory].map(([category, tags]) => ({ category, tags }))
		} else if (t.taskType === 'question_response') {
			const qRows = await db.all<{
				questionKey: string
				questionText: string
				responses: number
				addressed: number
			}>(sql`
				SELECT q.question_key AS questionKey, q.question_text AS questionText, COUNT(*) AS responses, SUM(qr.addressed) AS addressed
				FROM published_question_response qr JOIN doc_custom_analysis dca ON dca.custom_analysis_id = qr.custom_analysis_id
				JOIN question q ON q.question_id = qr.question_id
				WHERE dca.task_id = ${t.taskId} GROUP BY qr.question_id ORDER BY q.ordinal, q.question_key`)
			row.questions = qRows.map((r) => ({
				questionKey: r.questionKey,
				questionText: r.questionText,
				responses: n(r.responses),
				addressed: n(r.addressed),
			}))
		} else if (t.taskType === 'perspective_analysis' || t.taskType === 'criteria_assessment') {
			const cRows = await db.all<{ topic: string; subtopic: string; documents: number }>(sql`
				SELECT tt.topic_name AS topic, st.subtopic_name AS subtopic, COUNT(DISTINCT dca.document_id) AS documents
				FROM criterion_analysis ca JOIN doc_custom_analysis dca ON dca.custom_analysis_id = ca.custom_analysis_id
				JOIN published_document d ON d.document_id = dca.document_id
				JOIN analysis_subtopic st ON st.analysis_subtopic_id = ca.analysis_subtopic_id JOIN analysis_topic tt ON tt.analysis_topic_id = st.analysis_topic_id
				WHERE dca.task_id = ${t.taskId} GROUP BY st.analysis_subtopic_id ORDER BY tt.topic_name, st.subtopic_name`)
			const byTopic = new Map<string, { subtopic: string; documents: number }[]>()
			for (const r of cRows)
				byTopic.set(r.topic, [
					...(byTopic.get(r.topic) ?? []),
					{ subtopic: r.subtopic, documents: n(r.documents) },
				])
			row.topics = [...byTopic].map(([topic, subtopics]) => ({ topic, subtopics }))
		} else if (t.taskType === 'metrics_evaluation') {
			const mRows = await db.all<{ metricType: string; metricName: string; documents: number }>(sql`
				SELECT m.metric_type AS metricType, m.metric_name AS metricName, COUNT(DISTINCT dca.document_id) AS documents
				FROM metric m JOIN doc_custom_analysis dca ON dca.custom_analysis_id = m.custom_analysis_id
				JOIN published_document d ON d.document_id = dca.document_id
				WHERE dca.task_id = ${t.taskId} GROUP BY m.metric_type, m.metric_name ORDER BY m.metric_type, m.metric_name`)
			row.metrics = mRows.map((r) => ({
				metricType: r.metricType,
				metricName: r.metricName,
				documents: n(r.documents),
			}))
		}
		results.push(row)
	}
	return results
}

// ---------------------------------------------------------------- hierarchy
export async function hierarchy(db: CorpusDb): Promise<Hierarchy> {
	const nodes = await db
		.select({
			superclusterId: s.currentSupercluster.superclusterId,
			generation: s.currentSupercluster.generation,
			topicClusterId: s.currentSupercluster.topicClusterId,
			title: sql<string | null>`COALESCE(${s.currentSupercluster.title}, ${s.currentTopic.title})`,
			description: sql<
				string | null
			>`COALESCE(${s.currentSupercluster.description}, ${s.currentTopic.description})`,
			nBaseTopics: s.currentSupercluster.nBaseTopics,
		})
		.from(s.currentSupercluster)
		.leftJoin(
			s.currentTopic,
			eq(s.currentSupercluster.topicClusterId, s.currentTopic.topicClusterId),
		)
		.orderBy(desc(s.currentSupercluster.generation), asc(s.currentSupercluster.superclusterId))
	const edges = await db
		.select({
			childSuperclusterId: s.currentSuperclusterEdge.childSuperclusterId,
			parentSuperclusterId: s.currentSuperclusterEdge.parentSuperclusterId,
			isPrimary: s.currentSuperclusterEdge.isPrimary,
			membershipType: s.currentSuperclusterEdge.membershipType,
			similarity: s.currentSuperclusterEdge.similarity,
		})
		.from(s.currentSuperclusterEdge)
	return {
		nodes,
		edges: edges.map((e) => ({
			child: e.childSuperclusterId,
			parent: e.parentSuperclusterId,
			isPrimary: e.isPrimary === 1,
			membershipType: e.membershipType,
			similarity: e.similarity,
		})),
	}
}

// ---------------------------------------------------------------- search (text)
export async function searchText(db: CorpusDb, query: string, limit = 20): Promise<TextHit[]> {
	const pattern = `%${query.replace(/[%_]/g, ' ').trim()}%`
	return db.all(sql`
		SELECT c.id AS chunkId, d.document_id AS documentId, d.document_title AS title, d.file_name AS fileName, e.entity_name AS entityName, c.text
		FROM published_chunk c JOIN published_document d ON d.document_id = c.document_id JOIN entity e ON e.id = d.entity_uuid
		WHERE c.text LIKE ${pattern} LIMIT ${limit}`)
}

/** Hydrate chunk ids (semantic search hits) with provenance and topic membership. */
export async function hydrateChunks(
	db: CorpusDb,
	chunkIds: string[],
): Promise<Omit<SearchHit, 'score'>[]> {
	const out: Omit<SearchHit, 'score'>[] = []
	for (const group of inGroups(chunkIds, 80)) {
		const rows = await db
			.select({
				chunkId: s.publishedChunk.id,
				documentId: s.publishedDocument.documentId,
				title: s.publishedDocument.documentTitle,
				fileName: s.publishedDocument.fileName,
				entityName: s.entity.entityName,
				text: s.publishedChunk.text,
			})
			.from(s.publishedChunk)
			.innerJoin(
				s.publishedDocument,
				eq(s.publishedChunk.documentId, s.publishedDocument.documentId),
			)
			.innerJoin(s.entity, eq(s.publishedDocument.entityUuid, s.entity.id))
			.where(inArray(s.publishedChunk.id, group))
		const memberships = await db
			.select({
				chunkId: s.currentChunkMembership.chunkId,
				topicClusterId: s.currentTopic.topicClusterId,
				title: s.currentTopic.title,
				type: s.currentChunkMembership.membershipType,
			})
			.from(s.currentChunkMembership)
			.innerJoin(
				s.currentTopic,
				eq(s.currentChunkMembership.topicClusterId, s.currentTopic.topicClusterId),
			)
			.where(
				and(
					inArray(s.currentChunkMembership.chunkId, group),
					inArray(s.currentChunkMembership.membershipType, STRONG),
				),
			)
		for (const r of rows)
			out.push({
				...r,
				topics: memberships
					.filter((m) => m.chunkId === r.chunkId)
					.map((m) => ({ topicClusterId: m.topicClusterId, title: m.title })),
			})
	}
	return out
}
