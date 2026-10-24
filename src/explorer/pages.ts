/**
 * @aicolab/insight-bridge/explorer/pages — what a report's pages read beyond
 * the drawers: the overview, the landscape of topics and groups, the topics a
 * search found, the questions the run put to every document, and the method's
 * facts. One definition over the canonical run schema, in the shapes the
 * contracts declare (`ReportOverview`, `Landscape`, `TopicHit`,
 * `QuestionDetail`, `MethodData`; a custom analysis task's overview is analysis.ts's); generalised from Training Data's own page
 * reads (2026-10-21), whose corpus-specific counts are that app's extension.
 *
 * Every count is of contributors; a contributor counts towards a topic by any
 * current membership, and a topic's documents are its strong ones (an
 * exemplar or high-value passage — the record's counting rule). Stances are
 * read on current topics only (the `current_topic` view leaves out retired
 * and confirmed-junk topics), so a stance on a topic an earlier build retired
 * is never counted. The lens is the facet the run compares stances along
 * (`RunWords.lens`); a contributor with no lens value is counted as
 * unclassified (null), never as a value of its own.
 */

import type {
	GalaxyData,
	GenerationCount,
	GroupProfile,
	Landscape,
	MethodData,
	QuestionDetail,
	ReportOverview,
	RunWords,
	TopicHit,
	TopicProfile,
} from '@aicolab/insight-bridge-contracts/explorer'
import type { CorpusDb } from '@aicolab/insight-bridge-contracts/schema'
import * as s from '@aicolab/insight-bridge-contracts/schema'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { cap } from '../grammar.ts'
import { generationLabel, treeOf } from '../tree.ts'
import { questionClause } from '../world/schema.ts'
import {
	documentCounts,
	documentOwners,
	hierarchy,
	stanceRows,
	strongDocumentMemberships,
	strongEntityMemberships,
	sumOf,
	topicRows,
} from './data.ts'
import { type EffectiveFacets, loadFacetCache } from './facets.ts'
import { groupNodeId, sourceNodeId, topicNodeId } from './readings.ts'
import { isKept, keepSources, type ReadScope, servedSources, textOf, wordsOf } from './scope.ts'

const pct = (part: number, whole: number) => (whole ? Math.round((1000 * part) / whole) / 10 : 0)
const mixOf = (positions: readonly string[]) => {
	const mix: Record<string, number> = {}
	for (const p of positions) mix[p] = (mix[p] ?? 0) + 1
	return mix
}
const countIn = (mix: Readonly<Record<string, number>>, set: ReadonlySet<string>) =>
	Object.entries(mix).reduce((a, [p, k]) => a + (set.has(p) ? k : 0), 0)

/** A contributor's lens value, or null when it has none. */
export const lensOf = (words: RunWords, facets: EffectiveFacets | undefined) =>
	(words.lens ? facets?.[words.lens]?.[0] : undefined) ?? null

/** The lens's values in the profile's order, then any the profile did not list, then the unclassified. */
export const lensRank = (words: RunWords) => {
	const order = words.lens ? (words.facets[words.lens]?.order ?? []) : []
	return (value: string | null) => {
		if (value === null) return Number.MAX_SAFE_INTEGER
		const at = order.indexOf(value)
		return at < 0 ? order.length : at
	}
}

/** The grouping generations present, roots first, each named. */
const generationsOf = (tree: ReturnType<typeof treeOf>): GenerationCount[] => {
	const nodes = [...tree.byId.values()].filter((node) => node.generation > 0)
	const top = Math.max(0, ...nodes.map((node) => node.generation))
	return [...new Set(nodes.map((node) => node.generation))]
		.sort((a, b) => b - a)
		.map((generation) => ({
			generation,
			label: generationLabel(generation, top),
			labelPlural: generationLabel(generation, top, true),
			count: nodes.filter((node) => node.generation === generation).length,
		}))
}

/** The record's rows (data.ts, read once per reader) on the topics `ids` names (every current topic when absent), the scope's sources only. */
const inScope = <R extends { topicClusterId: number; entityUuid: string }>(
	rows: readonly R[],
	ids: number[] | undefined,
	scope: ReadScope | undefined,
): R[] => {
	const wanted = ids ? new Set(ids) : null
	return rows.filter(
		(r) => (!wanted || wanted.has(r.topicClusterId)) && isKept(scope, r.entityUuid),
	)
}

/** Every stance on a current topic (or on those `ids` names): who, which topic, which position. */
const currentStances = async (
	db: CorpusDb,
	ids: number[] | undefined,
	scope: ReadScope | undefined,
) => {
	const [stances, topics] = await Promise.all([stanceRows(db), topicRows(db)])
	return inScope(stances, ids ?? topics.map((t) => t.topicClusterId), scope)
}

/** Each current topic's (or each of those `ids` names) strong documents. */
const strongDocuments = async (
	db: CorpusDb,
	ids: number[] | undefined,
	scope: ReadScope | undefined,
) => inScope(await strongDocumentMemberships(db), ids, scope)

/** The current strong memberships (of those `ids` names), the scope's sources only. */
const strongMembers = async (
	db: CorpusDb,
	ids: number[] | undefined,
	scope: ReadScope | undefined,
) => inScope(await strongEntityMemberships(db), ids, scope)

/** The record's facets a page reads: the lens alone (the facet its figures compare along), or nothing without one. */
const lensFacets = (db: CorpusDb, words: RunWords) =>
	words.lens
		? loadFacetCache(db, 'entity', [words.lens])
		: Promise.resolve(new Map<string, EffectiveFacets>())

// ---------------------------------------------------------------- the overview

/** The record's documents counted by one document facet's value, in the run's order for it, then by count. */
export async function documentsBy(
	db: CorpusDb,
	words: RunWords,
	facet: string,
	scope?: ReadScope,
): Promise<{ value: string; documents: number }[]> {
	const [documentFacets, owners] = await Promise.all([
		loadFacetCache(db, 'document', [facet]),
		documentOwners(db),
	])
	const counted = new Map<string, number>()
	for (const d of owners.rows) {
		if (!isKept(scope, d.entityUuid)) continue
		const value = documentFacets.get(d.documentId)?.[facet]?.[0]
		if (value !== undefined) counted.set(value, (counted.get(value) ?? 0) + 1)
	}
	const order = words.facets[facet]?.order ?? []
	const rank = (value: string) => {
		const at = order.indexOf(value)
		return at < 0 ? order.length : at
	}
	return [...counted]
		.map(([value, documents]) => ({ value, documents }))
		.sort((a, b) => rank(a.value) - rank(b.value) || b.documents - a.documents)
}

/**
 * The record's scale and shape. `documentFacet` names the document facet the
 * host sorts its documents by (Training Data: `document_type`), if any.
 */
export async function reportOverview(
	db: CorpusDb,
	words: RunWords,
	options: { documentFacet?: string } = {},
	scope?: ReadScope,
): Promise<ReportOverview> {
	const supportive = new Set(words.scale.supportive)
	const hard = new Set(words.scale.contesting.slice(-2))
	const [
		entityFacets,
		byDocumentValue,
		stances,
		lensPerspectives,
		sources,
		owners,
		counts,
		topics,
		junkCount,
		members,
		h,
		questionCount,
		answerRows,
		entityRows,
	] = await Promise.all([
		lensFacets(db, words),
		options.documentFacet
			? documentsBy(db, words, options.documentFacet, scope)
			: Promise.resolve([]),
		currentStances(db, undefined, scope),
		words.lens
			? db
					.select({ position: s.clusterKeyPerspective.position })
					.from(s.clusterKeyPerspective)
					.innerJoin(
						s.currentTopic,
						eq(s.currentTopic.topicClusterId, s.clusterKeyPerspective.topicClusterId),
					)
					.where(eq(s.clusterKeyPerspective.facet, words.lens))
			: Promise.resolve([]),
		db.$count(s.entity, keepSources(s.entity.id, scope)),
		documentOwners(db),
		// the passages, points and quotes of each published document, kept per record
		documentCounts(db),
		topicRows(db),
		db.$count(
			s.topicCluster,
			sql`${s.topicCluster.retiredBuildId} IS NULL AND ${s.topicCluster.junkStatus} = 'confirmed'`,
		),
		strongMembers(db, undefined, scope),
		hierarchy(db),
		db.$count(s.question),
		db
			.select({ documentId: s.publishedQuestionResponse.documentId })
			.from(s.publishedQuestionResponse)
			.where(eq(s.publishedQuestionResponse.addressed, 1)),
		db.select({ id: s.entity.id }).from(s.entity).where(keepSources(s.entity.id, scope)),
	])
	const tree = treeOf(h)
	const positionMix = mixOf(stances.map((r) => r.position))
	const lensMix = mixOf(lensPerspectives.map((r) => r.position))
	const lensTotal = lensPerspectives.length
	const hardFriction = countIn(positionMix, hard)
	const docRows = owners.rows.filter((d) => isKept(scope, d.entityUuid))
	const ownerOf = new Map(docRows.map((d) => [d.documentId, d.entityUuid]))
	// an excluded source's document is not in docRows, so its answers fall away here
	const answers = answerRows.filter((r) => ownerOf.has(r.documentId))
	// a document the pipeline analysed holds a published key point
	const analysed = (d: { documentId: string }) => (counts.get(d.documentId)?.keyPoints ?? 0) > 0
	const reachOf = new Map<number, Set<string>>()
	for (const m of members)
		reachOf.set(m.topicClusterId, (reachOf.get(m.topicClusterId) ?? new Set()).add(m.entityUuid))
	const quotes = sumOf(docRows, counts, (c) => c.quotes)
	const verified = sumOf(docRows, counts, (c) => c.verified)

	const byLens = new Map<string | null, number>()
	const entityIds = entityRows.map((e) => e.id)
	for (const id of entityIds) {
		const value = lensOf(words, entityFacets.get(id))
		byLens.set(value, (byLens.get(value) ?? 0) + 1)
	}
	const rank = lensRank(words)

	return {
		sources,
		documents: docRows.length,
		documentsBy: byDocumentValue,
		unanalysedDocuments: docRows.filter((d) => !analysed(d)).length,
		passages: sumOf(docRows, counts, (c) => c.passages),
		keyPoints: sumOf(docRows, counts, (c) => c.keyPoints),
		quotes,
		quotesVerified: verified,
		quotesVerifiedPct: pct(verified, quotes),
		topics: topics.length,
		junkTopics: junkCount,
		generations: generationsOf(tree),
		groups: [...tree.byId.values()].filter((node) => node.generation > 0).length,
		memberships: members.length,
		stances: stances.length,
		stancedSources: new Set(stances.map((r) => r.entityUuid)).size,
		lensRows: lensTotal,
		positionMix,
		lensMix,
		supportivePct: pct(countIn(positionMix, supportive), stances.length),
		lensSupportivePct: pct(countIn(lensMix, supportive), lensTotal),
		hardFriction,
		hardFrictionPct: pct(hardFriction, stances.length),
		frictionSources: new Set(stances.filter((r) => hard.has(r.position)).map((r) => r.entityUuid))
			.size,
		lensValues: [...byLens]
			.map(([value, count]) => ({ value, sources: count }))
			.sort((a, b) => b.sources - a.sources || rank(a.value) - rank(b.value)),
		singleSourceTopics: [...reachOf.values()].filter((sources) => sources.size === 1).length,
		questions: questionCount,
		answers: answers.length,
		answeringSources: new Set(answers.map((r) => ownerOf.get(r.documentId))).size,
	}
}

// ---------------------------------------------------------------- the landscape

/**
 * The current topics' profiles — every one, or only those `ids` names — and
 * the per-topic facts the grouping nodes roll up.
 */
async function topicFacts(
	db: CorpusDb,
	words: RunWords,
	ids: number[] | undefined,
	scope: ReadScope | undefined,
) {
	const supportive = new Set(words.scale.supportive)
	const contesting = new Set(words.scale.contesting)
	const [h, entityFacets, allTopics, memberRows, stances, strong] = await Promise.all([
		hierarchy(db),
		lensFacets(db, words),
		topicRows(db),
		strongMembers(db, ids, scope),
		currentStances(db, ids, scope),
		strongDocuments(db, ids, scope),
	])
	const wanted = ids ? new Set(ids) : null
	const topicRows_ = wanted ? allTopics.filter((t) => wanted.has(t.topicClusterId)) : allTopics
	const tree = treeOf(h)
	const generations = generationsOf(tree)
	const top = generations[0]?.generation ?? 0
	const membersOf = new Map<number, Set<string>>()
	const exemplarsOf = new Map<number, number>()
	for (const m of memberRows) {
		membersOf.set(
			m.topicClusterId,
			(membersOf.get(m.topicClusterId) ?? new Set()).add(m.entityUuid),
		)
		if (m.membershipType === 'exemplar')
			exemplarsOf.set(m.topicClusterId, (exemplarsOf.get(m.topicClusterId) ?? 0) + 1)
	}
	const stancesOf = new Map<number, { entityUuid: string; position: string }[]>()
	for (const r of stances)
		stancesOf.set(r.topicClusterId, [...(stancesOf.get(r.topicClusterId) ?? []), r])
	const documentsOf = new Map<number, Set<string>>()
	for (const r of strong)
		documentsOf.set(
			r.topicClusterId,
			(documentsOf.get(r.topicClusterId) ?? new Set()).add(r.documentId),
		)
	const lensValueOf = (entityUuid: string) => lensOf(words, entityFacets.get(entityUuid))

	const topics: TopicProfile[] = topicRows_.map((t) => {
		const mine = stancesOf.get(t.topicClusterId) ?? []
		const positions = mixOf(mine.map((r) => r.position))
		const values = new Map<string, number>()
		for (const r of mine) {
			const value = lensValueOf(r.entityUuid)
			if (value !== null) values.set(value, (values.get(value) ?? 0) + 1)
		}
		const ranked = [...values].sort((a, b) => b[1] - a[1])
		const base = tree.baseOfTopic.get(t.topicClusterId)
		const lineage = base ? tree.ancestorsOf(base.superclusterId) : []
		return {
			topicClusterId: t.topicClusterId,
			title: t.title,
			lineage,
			parentId: lineage[0]?.superclusterId ?? null,
			documents: documentsOf.get(t.topicClusterId)?.size ?? 0,
			sources: membersOf.get(t.topicClusterId)?.size ?? 0,
			exemplars: exemplarsOf.get(t.topicClusterId) ?? 0,
			positions,
			stances: mine.length,
			supportivePct: pct(countIn(positions, supportive), mine.length),
			contestedPct: pct(countIn(positions, contesting), mine.length),
			lensValueCount: values.size,
			topLensValue: ranked[0]?.[0] ?? null,
			singleLensValue: values.size === 1 ? (ranked[0]?.[0] ?? null) : null,
		}
	})

	return { tree, generations, top, topics, membersOf, documentsOf, stancesOf, lensValueOf }
}

/** Every grouping node's profile, rolled up through the primary tree, in the build's node order. */
function groupsOf({
	tree,
	top,
	membersOf,
	documentsOf,
	stancesOf,
	lensValueOf,
}: Awaited<ReturnType<typeof topicFacts>>): GroupProfile[] {
	return [...tree.byId.values()]
		.filter((node) => node.generation > 0)
		.map((node) => {
			const topicIds = tree.topicsUnder(node.superclusterId)
			const reach = new Set<string>()
			const documents = new Set<string>()
			const mine: { entityUuid: string; position: string }[] = []
			for (const t of topicIds) {
				for (const e of membersOf.get(t) ?? []) reach.add(e)
				for (const d of documentsOf.get(t) ?? []) documents.add(d)
				mine.push(...(stancesOf.get(t) ?? []))
			}
			const parentId = tree.ancestorsOf(node.superclusterId)[0]?.superclusterId ?? null
			const parent = parentId !== null ? tree.byId.get(parentId) : undefined
			return {
				superclusterId: node.superclusterId,
				generation: node.generation,
				kind: generationLabel(node.generation, top),
				title: node.title ?? `Group ${node.superclusterId}`,
				description: node.description,
				parentId,
				parentTitle: parent?.title ?? null,
				topics: topicIds.length,
				children: tree.childrenOf(node.superclusterId).length,
				documents: documents.size,
				sources: reach.size,
				positions: mixOf(mine.map((r) => r.position)),
				stances: mine.length,
				lensValueCount: new Set(
					mine.map((r) => lensValueOf(r.entityUuid)).filter((v): v is string => v !== null),
				).size,
			}
		})
}

/** Every current topic and every grouping node, with live counts rolled up through the primary tree. */
export async function landscape(
	db: CorpusDb,
	words: RunWords,
	scope?: ReadScope,
): Promise<Landscape> {
	const facts = await topicFacts(db, words, undefined, scope)
	return {
		generations: facts.generations,
		top: facts.top,
		groups: groupsOf(facts).sort((a, b) => b.generation - a.generation || b.sources - a.sources),
		topics: facts.topics.sort(
			(a, b) => b.sources - a.sources || a.topicClusterId - b.topicClusterId,
		),
	}
}

// ---------------------------------------------------------------- the galaxy

/** How strongly a membership grade binds a contributor to a topic, strongest highest. */
const GRADE_RANK: Readonly<Record<string, number>> = { exemplar: 3, high_value: 2, member: 1 }

/**
 * The record as a sky (core's GalaxyMap): every grouping node as a container
 * star by generation, every current topic a star, every contributor with a
 * STRONG membership (exemplar or high-value — the world-counts rule) as dust
 * bound to those topics. Stars weigh their reach; a contributor weighs its
 * strong memberships, its first strongest one primary. Node ids are the
 * readings' (`g:`, `t:`, `s:` + the contributor's slug), so a node opens the
 * same reading the drawer does.
 *
 * ORDER IS PART OF THE SKY: the layout is seeded and order-sensitive, so every
 * list is in key order — groups and topics by id, tree edges by parent then
 * child, contributors by slug and each one's memberships by topic — never in
 * the order rows happen to sit in a table, which a re-prepare or an import
 * can change. Any copy of the record draws the same sky, and the bake
 * (galaxy/stars.ts) reads this same read, so `topic_star` and the live galaxy
 * agree. `facets` are the contributor facets the dust can be read by; `seed`
 * is the host's (a corpus keeps one per sky).
 */
export async function galaxy(
	db: CorpusDb,
	words: RunWords,
	options: { facets: { key: string; label: string }[]; seed: number },
	scope?: ReadScope,
): Promise<GalaxyData> {
	const facts = await topicFacts(db, words, undefined, scope)
	const [h, entityFacets, entityRows, strongRows] = await Promise.all([
		hierarchy(db),
		// the facets the dust can be read by, and no other
		options.facets.length
			? loadFacetCache(
					db,
					'entity',
					options.facets.map((f) => f.key),
				)
			: Promise.resolve(new Map<string, EffectiveFacets>()),
		db
			.select({ uuid: s.entity.id, entityId: s.entity.entityId, name: s.entity.entityName })
			.from(s.entity)
			.orderBy(asc(s.entity.entityId)),
		strongMembers(db, undefined, scope),
	])
	const nouns = words.nouns
	const lensHeading = words.lens ? (words.facets[words.lens]?.heading ?? words.lens) : null
	const nodes: GalaxyData['nodes'] = []
	const edges: GalaxyData['edges'] = []

	const groups = groupsOf(facts).sort((a, b) => a.superclusterId - b.superclusterId)
	for (const g of groups)
		nodes.push({
			id: groupNodeId(g.superclusterId),
			tier: g.generation,
			title: g.title,
			key: g.superclusterId,
			weight: g.sources,
			volume: g.documents,
			mix: g.positions,
			childCount: g.children,
			facets: null,
			flags: [],
		})
	const topics = [...facts.topics].sort((a, b) => a.topicClusterId - b.topicClusterId)
	for (const t of topics)
		nodes.push({
			id: topicNodeId(t.topicClusterId),
			tier: 0,
			title: t.title,
			key: t.topicClusterId,
			weight: t.sources,
			volume: t.documents,
			mix: t.positions,
			childCount: null,
			facets: null,
			flags: [
				...(t.sources === 1
					? [{ label: `1 ${nouns.entity}`, hot: false, tip: 'Only one contributor' }]
					: []),
				...(t.singleLensValue !== null && lensHeading
					? [{ label: `1 ${lensHeading.toLowerCase()}`, hot: true, tip: null }]
					: []),
			],
		})

	// the tree's edges between nodes drawn here — a group's sub-groups and its
	// current topics — by parent id, then child id
	const current = new Set(topics.map((t) => t.topicClusterId))
	const groupIds = new Set(groups.map((g) => g.superclusterId))
	for (const e of [...h.edges].sort((a, b) => a.parent - b.parent || a.child - b.child)) {
		if (!groupIds.has(e.parent)) continue
		const childNode = facts.tree.byId.get(e.child)
		const topicId = childNode?.generation === 0 ? childNode.topicClusterId : null
		const child =
			topicId !== null && topicId !== undefined
				? current.has(topicId)
					? topicNodeId(topicId)
					: null
				: groupIds.has(e.child)
					? groupNodeId(e.child)
					: null
		if (child)
			edges.push({
				child,
				parent: groupNodeId(e.parent),
				isPrimary: e.isPrimary,
				membershipType: e.membershipType,
				similarity: e.similarity,
				softIntensity: null,
			})
	}

	// the dust: each contributor with a strong membership (by slug), bound to those topics (by id)
	const strongOf = new Map<string, typeof strongRows>()
	for (const m of [...strongRows].sort((a, b) => a.topicClusterId - b.topicClusterId)) {
		if (!current.has(m.topicClusterId)) continue
		strongOf.set(m.entityUuid, [...(strongOf.get(m.entityUuid) ?? []), m])
	}
	for (const e of entityRows) {
		const memberships = strongOf.get(e.uuid)
		if (!memberships?.length) continue
		const id = sourceNodeId(e.entityId)
		const values = entityFacets.get(e.uuid)
		nodes.push({
			id,
			tier: -1,
			title: e.name,
			key: e.entityId,
			weight: memberships.length,
			volume: null,
			mix: null,
			childCount: null,
			facets: Object.fromEntries(
				options.facets.flatMap((f) => {
					const value = values?.[f.key]?.[0]
					return value === undefined ? [] : [[f.key, value]]
				}),
			),
			flags: [],
		})
		let best = memberships[0]
		for (const m of memberships)
			if ((GRADE_RANK[m.membershipType] ?? 0) > (GRADE_RANK[best?.membershipType ?? ''] ?? 0))
				best = m
		for (const m of memberships) {
			const rank = GRADE_RANK[m.membershipType] ?? 1
			edges.push({
				child: id,
				parent: topicNodeId(m.topicClusterId),
				isPrimary: m === best,
				membershipType: m.membershipType,
				similarity: rank === 3 ? 1 : rank === 2 ? 0.5 : 0.1,
				softIntensity: null,
			})
		}
	}

	// The galaxy's tiers are layers a reader moves between, so each is named
	// distinctly: where the generation names repeat (every generation below a
	// theme is a "group"), each such tier carries its generation number.
	const repeated = (label: string) => facts.generations.filter((g) => g.label === label).length > 1
	return {
		tiers: [
			...facts.generations.map((g) => ({
				tier: g.generation,
				label: repeated(g.label) ? `${cap(g.label)} ${g.generation}` : cap(g.label),
				labelPlural: repeated(g.label)
					? `${cap(g.labelPlural)} ${g.generation}`
					: cap(g.labelPlural),
				weightLabel: null,
			})),
			{ tier: 0, label: 'Topic', labelPlural: 'Topics', weightLabel: null },
			{
				tier: -1,
				label: cap(nouns.entity),
				labelPlural: cap(nouns.entities),
				weightLabel: 'topics',
			},
		],
		sourceFacets: options.facets,
		nodes,
		edges,
		weightLabel: nouns.entities,
		mixOrder: words.scale.order,
		seed: options.seed,
	}
}

// ---------------------------------------------------------------- the topic search

/** D1 binds at most 100 parameters to a statement, so passage ids go in batches under it. */
const ID_BATCH = 90

/**
 * The topics a semantic search's passages point to. `scores` are the host's
 * nearest passages (chunk id → similarity, from whatever index it binds).
 * Each passage gives its score to its primary topic — its highest-scoring
 * current membership, the lower topic id on a tie — and the `limit` topics
 * with the most come back, most relevant first, relevance to three places.
 */
export async function topicSearch(
	db: CorpusDb,
	words: RunWords,
	scores: ReadonlyMap<string, number>,
	limit = 24,
	scope?: ReadScope,
): Promise<TopicHit[]> {
	const chunkIds = [...scores.keys()]
	const batches: string[][] = []
	for (let i = 0; i < chunkIds.length; i += ID_BATCH) batches.push(chunkIds.slice(i, i + ID_BATCH))
	const rows = (
		await Promise.all(
			batches.map((batch) =>
				db
					.select({
						chunkId: s.currentChunkMembership.chunkId,
						topicClusterId: s.currentChunkMembership.topicClusterId,
						softScore: s.currentChunkMembership.softScore,
					})
					.from(s.currentChunkMembership)
					.innerJoin(s.publishedChunk, eq(s.publishedChunk.id, s.currentChunkMembership.chunkId))
					.innerJoin(s.document, eq(s.document.documentId, s.publishedChunk.documentId))
					.where(
						and(
							inArray(s.currentChunkMembership.chunkId, batch),
							keepSources(s.document.entityUuid, scope),
							// a source whose passages are not served is never a search's match
							servedSources(s.document.entityUuid, scope),
						),
					),
			),
		)
	).flat()
	const primary = new Map<string, { topicClusterId: number; softScore: number }>()
	for (const r of rows) {
		const held = primary.get(r.chunkId)
		const softScore = r.softScore ?? 0
		if (
			!held ||
			softScore > held.softScore ||
			(softScore === held.softScore && r.topicClusterId < held.topicClusterId)
		)
			primary.set(r.chunkId, { topicClusterId: r.topicClusterId, softScore })
	}
	const relevance = new Map<number, number>()
	for (const [chunkId, p] of primary)
		relevance.set(
			p.topicClusterId,
			(relevance.get(p.topicClusterId) ?? 0) + (scores.get(chunkId) ?? 0),
		)
	const ranked = [...relevance].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit)
	if (!ranked.length) return []
	const { topics } = await topicFacts(
		db,
		words,
		ranked.map(([id]) => id),
		scope,
	)
	const byId = new Map(topics.map((t) => [t.topicClusterId, t]))
	return ranked.flatMap(([id, score]) => {
		const t = byId.get(id)
		return t ? [{ ...t, relevance: Math.round(score * 1000) / 1000 }] : []
	})
}

// ---------------------------------------------------------------- one question (a task's overview is analysis.ts's)

/** One question's answers, by lens value, each with its contributor, document and key points with their quotes. */
export async function questionDetail(
	db: CorpusDb,
	words: RunWords,
	questionId: number,
	scope?: ReadScope,
): Promise<QuestionDetail | null> {
	const [q] = await db
		.select()
		.from(s.question)
		.where(eq(s.question.questionId, questionId))
		.limit(1)
	if (!q) return null
	const [entityFacets, documentFacets, rows, keyPoints, quotes] = await Promise.all([
		loadFacetCache(db, 'entity'),
		loadFacetCache(db, 'document'),
		db
			.select({
				id: s.publishedQuestionResponse.questionResponseId,
				documentId: s.publishedQuestionResponse.documentId,
				position: s.publishedQuestionResponse.position,
				entityUuid: s.entity.id,
				entityId: s.entity.entityId,
				name: s.entity.entityName,
				documentTitle: s.document.documentTitle,
				fileName: s.document.fileName,
			})
			.from(s.publishedQuestionResponse)
			.innerJoin(s.document, eq(s.document.documentId, s.publishedQuestionResponse.documentId))
			.innerJoin(s.entity, eq(s.entity.id, s.document.entityUuid))
			.where(
				and(
					sql`${s.publishedQuestionResponse.questionId} = ${questionId} AND ${s.publishedQuestionResponse.addressed} = 1`,
					keepSources(s.entity.id, scope),
				),
			),
		db
			.select({
				id: s.publishedQuestionResponseKeyPoint.questionResponseKeyPointId,
				responseId: s.publishedQuestionResponseKeyPoint.questionResponseId,
				keyPoint: s.publishedQuestionResponseKeyPoint.keyPoint,
				details: s.publishedQuestionResponseKeyPoint.details,
			})
			.from(s.publishedQuestionResponseKeyPoint)
			.innerJoin(
				s.publishedQuestionResponse,
				eq(
					s.publishedQuestionResponse.questionResponseId,
					s.publishedQuestionResponseKeyPoint.questionResponseId,
				),
			)
			.where(eq(s.publishedQuestionResponse.questionId, questionId))
			.orderBy(asc(s.publishedQuestionResponseKeyPoint.questionResponseKeyPointId)),
		db
			.select({
				keyPointId: s.publishedQuestionResponseQuote.questionResponseKeyPointId,
				quote: s.publishedQuestionResponseQuote.quote,
			})
			.from(s.publishedQuestionResponseQuote)
			.innerJoin(
				s.publishedQuestionResponseKeyPoint,
				eq(
					s.publishedQuestionResponseKeyPoint.questionResponseKeyPointId,
					s.publishedQuestionResponseQuote.questionResponseKeyPointId,
				),
			)
			.innerJoin(
				s.publishedQuestionResponse,
				eq(
					s.publishedQuestionResponse.questionResponseId,
					s.publishedQuestionResponseKeyPoint.questionResponseId,
				),
			)
			.where(eq(s.publishedQuestionResponse.questionId, questionId))
			.orderBy(asc(s.publishedQuestionResponseQuote.questionResponseQuoteId)),
	])
	const quotesOf = new Map<number, string[]>()
	for (const r of quotes)
		quotesOf.set(r.keyPointId, [...(quotesOf.get(r.keyPointId) ?? []), r.quote])
	// an answer's source decides how its words read: a withheld answer's position
	// (the answer in prose) reads the notice, and its key points are not shown
	const sourceOf = new Map(rows.map((r) => [r.id, r.entityUuid]))
	const keptPoints = keyPoints.filter((k) => sourceOf.has(k.responseId))
	const keyPointsOf = new Map<number, { keyPoint: string; details: string; quotes: string[] }[]>()
	for (const k of keptPoints) {
		if (wordsOf(scope, sourceOf.get(k.responseId)).withheld) continue
		keyPointsOf.set(k.responseId, [
			...(keyPointsOf.get(k.responseId) ?? []),
			{ keyPoint: k.keyPoint, details: k.details, quotes: quotesOf.get(k.id) ?? [] },
		])
	}
	const byValue = new Map<string | null, QuestionDetail['byLensValue'][number]['answers']>()
	for (const r of rows) {
		const value = lensOf(words, entityFacets.get(r.entityUuid))
		byValue.set(value, [
			...(byValue.get(value) ?? []),
			{
				entityUuid: r.entityUuid,
				entityId: r.entityId,
				name: r.name,
				lensValue: value,
				documentId: r.documentId,
				documentTitle: r.documentTitle,
				fileName: r.fileName,
				documentFacets: documentFacets.get(r.documentId) ?? {},
				position: textOf(scope, r.entityUuid, r.position),
				keyPoints: keyPointsOf.get(r.id) ?? [],
				...wordsOf(scope, r.entityUuid),
			},
		])
	}
	const rank = lensRank(words)
	return {
		question: {
			questionId: q.questionId,
			key: q.questionKey,
			clause: questionClause(q.questionKey, q.questionText),
			text: q.questionText,
			ordinal: q.ordinal,
			sources: new Set(rows.map((r) => r.entityUuid)).size,
			responses: rows.length,
			keyPoints: keptPoints.length,
		},
		byLensValue: [...byValue]
			.map(([value, answers]) => ({
				value,
				answers: answers.sort((a, b) => a.name.localeCompare(b.name)),
			}))
			.sort((a, b) => rank(a.value) - rank(b.value) || b.answers.length - a.answers.length),
	}
}

// ---------------------------------------------------------------- the method's facts

/** What the method page states that the run's own row does not: the counts, the junk, the unread, the committed build. */
export async function methodData(
	db: CorpusDb,
	words: RunWords,
	scope?: ReadScope,
): Promise<MethodData> {
	const [overview, junk, docRows, counts, builds] = await Promise.all([
		reportOverview(db, words, {}, scope),
		db
			.select({
				topicClusterId: s.topicCluster.topicClusterId,
				title: s.topicCluster.title,
				reason: s.topicCluster.junkAiReason,
				aiFlagged: s.topicCluster.junkAiFlagged,
			})
			.from(s.topicCluster)
			.where(
				sql`${s.topicCluster.retiredBuildId} IS NULL AND ${s.topicCluster.junkStatus} = 'confirmed'`,
			),
		db
			.select({
				documentId: s.publishedDocument.documentId,
				title: s.publishedDocument.documentTitle,
				fileName: s.publishedDocument.fileName,
				entityId: s.entity.entityId,
				name: s.entity.entityName,
			})
			.from(s.publishedDocument)
			.innerJoin(s.entity, eq(s.entity.id, s.publishedDocument.entityUuid))
			.where(keepSources(s.entity.id, scope)),
		documentCounts(db),
		db
			.select({
				buildId: s.clusterBuild.buildId,
				kind: s.clusterBuild.kind,
				points: s.clusterBuild.points,
				params: s.clusterBuild.params,
				tuning: s.clusterBuild.tuning,
				hierarchy: s.clusterBuild.hierarchy,
				labels: s.clusterBuild.labels,
			})
			.from(s.clusterBuild)
			.innerJoin(s.runCurrentBuild, eq(s.runCurrentBuild.buildId, s.clusterBuild.buildId))
			.limit(1),
	])
	// a document the pipeline analysed holds a published key point
	const analysed = (d: { documentId: string }) => (counts.get(d.documentId)?.keyPoints ?? 0) > 0
	return {
		overview,
		junk: junk.map((t) => ({ ...t, aiFlagged: t.aiFlagged === 1 })),
		unanalysed: docRows
			.filter((d) => !analysed(d))
			.map((d) => ({ entityId: d.entityId, name: d.name, title: d.title ?? d.fileName }))
			.sort((a, b) => a.name.localeCompare(b.name)),
		build: builds[0] ?? null,
		// the passages the committed build clustered, as the build recorded them
		clusteredPassages: builds[0]?.points ?? 0,
	}
}
