/**
 * @aicolab/insight-bridge/explorer/tools — the tools every report's connector
 * serves, as ONE table: each tool's name, title, group, description, input
 * schema and read. A host serves the table through two calls
 * (`ExplorerToolHost`): `explorerToolContext()` — what the descriptions and
 * examples say about this run — and `explorerTool(name, args)`, which runs one
 * tool's read. The pipeline's run store answers both over its own database;
 * an app answers them over its D1 in the reader's scope
 * (`explorerToolHost(db, scope)`); the MCP layer (mcp.ts) registers the table
 * on a server, and the hub's door can serve the same table.
 *
 * The set (2026-10-21, the user's choice "one richer baseline"): the pipeline
 * connector's tools joined with the journey tools the six apps shared
 * (contested topics, every source's perspective, the tag pivot, the tree, one
 * lens profile), one name per job. An app adds only tools no other report has.
 *
 * Inputs are fixed schemas, so a host re-validates what reaches it without
 * knowing the run; a run's own values (the lens's values, a real topic id)
 * ride as examples and in the descriptions. Every read is over core's
 * explorer reads and honours the reader's scope: excluded sources are absent,
 * withheld sources' words read the notice.
 *
 * Two caveats every count-bearing answer repeats, because agents get both
 * wrong by default: counts of sources are not prevalence, and `topic_id` is
 * the topicClusterId.
 */
import type { GroupProfile, TopicProfile } from '@aicolab/insight-bridge-contracts/explorer'
import type { CorpusDb } from '@aicolab/insight-bridge-contracts/schema'
import * as s from '@aicolab/insight-bridge-contracts/schema'
import { asc, eq, inArray, like, or } from 'drizzle-orm'
import { z } from 'zod'
import { cap, withArticle } from '../grammar.ts'
import { treeOf } from '../tree.ts'
import { questionClause } from '../world/schema.ts'
import {
	dissentOf,
	documentOwners,
	facetFilter,
	facetHolders,
	halfFacetFilter,
	internalFacet,
	lensKey,
	lensValueOf,
	lensValues,
	lensWords,
	type NearestPassages,
	NO_TREE,
	notPrevalence,
	passagesOf,
	pct,
	profiles,
	rankedPassages,
	readerFacets,
	sourceCount,
	TOPIC_ID,
	type ToolContext,
	type ToolReadContext,
	toolContext,
	valueWord,
} from './catalogue/support.ts'
import * as x from './data.ts'
import { STRONG } from './data.ts'
import { loadFacetCache } from './facets.ts'
import * as pages from './pages.ts'
import { keepSources, type ReadScope, textOf, wordsOf } from './scope.ts'

// What a read stands on lives in ./catalogue/support, shared with the report
// catalogue that replaces this table report by report.
export { type NearestPassages, notPrevalence, type ToolContext, type ToolReadContext, toolContext }

/** How a host serves the table: the run's tool context, and one tool's read. */
export interface ExplorerToolHost {
	explorerToolContext(): Promise<ToolContext>
	/** Runs a tool's read; `nearest` carries a search tool's ranked passages (chunk id, score). */
	explorerTool(name: string, args: unknown, nearest?: [string, number][]): Promise<unknown>
}

const topicMatch = (t: TopicProfile, relevance?: number) => ({
	topic_id: t.topicClusterId,
	title: t.title,
	sources: t.sources,
	documents: t.documents,
	stances: t.stances,
	positionMix: t.positions,
	lineage: t.lineage,
	...(relevance === undefined ? {} : { relevance }),
})

const groupRow = (g: GroupProfile) => ({
	supercluster_id: g.superclusterId,
	generation: g.generation,
	kind: g.kind,
	title: g.title,
	description: g.description,
	parent_id: g.parentId,
	parentTitle: g.parentTitle,
	children: g.children,
	topics: g.topics,
	sources: g.sources,
	documents: g.documents,
	stances: g.stances,
	positionMix: g.positions,
})

/* ───────────────────────── the table ───────────────────────── */

const topicId = z.number().int().describe(TOPIC_ID)
const limitOf = (max: number) => z.number().int().min(1).max(max).optional()
const lensValue = z
	.string()
	.optional()
	.describe('One value of the run’s lens (see corpus_overview `lens.values`)')

/** Narrowing by any facet's value, beside the lens: the facet's key and the value to keep. */
const facetFilterInput = {
	facet: z
		.string()
		.optional()
		.describe('A facet key (see list_tags) to narrow by; give `value` with it'),
	value: z.string().optional().describe('The value of `facet` to keep'),
}

/** A tool's input: its parameters' schemas by name. */
type ToolInput = Record<string, z.ZodType>

/** A tool as it is written: its read typed by its own input. */
interface ToolDefinition<S extends ToolInput> {
	title: (t: ToolContext) => string
	group: (t: ToolContext) => string
	description: (t: ToolContext) => string
	input: S
	/** The run's own starting values for some inputs. */
	examples?: (t: ToolContext) => { [K in keyof S]?: unknown }
	/** Whether this run serves the tool at all. */
	when?: (t: ToolContext) => boolean
	/** A search tool: which input is its query, and how deep the host's index should rank for it. */
	searches?: { query: keyof S & string; topK: (args: z.output<z.ZodObject<S>>) => number }
	read: (
		c: ToolReadContext,
		args: z.output<z.ZodObject<S>>,
		nearest?: [string, number][],
	) => Promise<unknown>
}

/** A tool as a host serves it: its arguments arrive unknown and are validated by its own input. */
export interface ExplorerTool {
	title: (t: ToolContext) => string
	group: (t: ToolContext) => string
	description: (t: ToolContext) => string
	input: ToolInput
	examples?: (t: ToolContext) => Record<string, unknown>
	when?: (t: ToolContext) => boolean
	searches?: { query: string; topK: (args: unknown) => number }
	read: (c: ToolReadContext, args: unknown, nearest?: [string, number][]) => Promise<unknown>
}

/** One tool: written against its own input, served with that input as its validation. */
const tool = <S extends ToolInput>(t: ToolDefinition<S>): ExplorerTool => {
	const schema = z.object(t.input)
	const search = t.searches
	return {
		title: t.title,
		group: t.group,
		description: t.description,
		input: t.input,
		...(t.examples ? { examples: t.examples } : {}),
		...(t.when ? { when: t.when } : {}),
		...(search
			? { searches: { query: search.query, topK: (args) => search.topK(schema.parse(args ?? {})) } }
			: {}),
		read: (c, args, nearest) => t.read(c, schema.parse(args ?? {}), nearest),
	}
}

const ORIENTATION = () => 'Orientation & search'
const TREE = () => 'The grouping tree'
const TOPICS = () => 'Anatomy of a topic'
const WHO = (t: ToolContext) => cap(t.words.nouns.entities)
const DOCUMENTS = (t: ToolContext) => cap(t.words.nouns.documents)
const FACETS = () => 'Facets & vocabularies'
const ANALYSIS = () => 'Custom analysis'

/** The old table's refusal of a half-given facet filter, as a tool error object. */
const refusedFacetFilter = (a: { facet?: string; value?: string }) => {
	const refused = halfFacetFilter(a)
	return refused ? { error: refused } : null
}

export const EXPLORER_TOOLS: Readonly<Record<string, ExplorerTool>> = {
	/* ── orientation & search ── */
	corpus_overview: tool({
		title: () => 'Corpus overview',
		group: ORIENTATION,
		description: (t) =>
			`Scale and shape of the record: ${t.overview.entities} ${t.words.nouns.entities}, their ${t.words.nouns.documents}, the passages, the topics and the grouping tree, the lens${lensWords(t) ? ` (${lensWords(t)} — who is speaking)` : ''}, the position scale and the overall position mix, the facets, the vocabularies and the questions. Read this first: it explains how positions are framed and carries the standing caveats.`,
		input: {},
		read: async (c) => {
			const [overview, report] = await Promise.all([
				x.overview(c.db, c.scope),
				pages.reportOverview(c.db, c.words, {}, c.scope),
			])
			const contesting = c.words.scale.contesting.reduce(
				(a, p) => a + (report.positionMix[p] ?? 0),
				0,
			)
			const lens = c.words.lens
			return {
				name: c.words.title,
				corpus: c.words.standfirst,
				...overview,
				clusters: overview.clusters - overview.junkConfirmedClusters,
				topics: report.topics,
				junkTopicsExcluded: report.junkTopics,
				generations: report.generations,
				stances: report.stances,
				positionMix: report.positionMix,
				contestingStances: contesting,
				positionScale: c.words.scale,
				lens: lens
					? {
							facet: lens,
							heading: c.words.facets[lens]?.heading ?? lens,
							values: report.lensValues.map((v) => ({
								value: v.value,
								label: v.value === null ? 'Unclassified' : valueWord(c.words, lens, v.value),
								reading:
									v.value === null ? null : (c.words.facets[lens]?.descriptions[v.value] ?? null),
								[c.words.nouns.entities]: v.sources,
							})),
						}
					: null,
				notes: [
					notPrevalence(c.words, report.sources),
					`Positions are relative to each topic's own proposition: they measure stance toward a framing, not absolute agreement.${c.words.scale.contesting.length ? ` ${contesting} of ${report.stances} stances push back (${c.words.scale.contesting.join(' / ')}); see contested_topics.` : ''}`,
					report.generations.length
						? `The grouping tree has ${report.generations.length} generation(s): ${report.generations.map((g) => `${g.count} ${g.labelPlural}`).join(' over ')} over ${report.topics} topics. Ids of every generation work with topics_in_supercluster.`
						: NO_TREE,
				],
			}
		},
	}),

	search_passages: tool({
		title: () => 'Passage search',
		group: ORIENTATION,
		description: (t) =>
			`Search over the ${t.overview.chunks} verbatim passages of every ${t.words.nouns.document}: the most relevant passages with their ${t.words.nouns.document}, ${t.words.nouns.entity}${lensWords(t) ? `, its ${lensWords(t)}` : ''} and the topics each strongly belongs to. Narrow to one ${t.words.nouns.document}, one lens value, one value of any facet, or one topic.`,
		input: {
			query: z.string().describe('What you are after, in plain words'),
			top_k: limitOf(50),
			document_id: z.string().optional().describe('Only passages of this document'),
			lens_value: lensValue,
			...facetFilterInput,
			topic_id: z
				.number()
				.int()
				.optional()
				.describe(`Only passages strongly in this topic. ${TOPIC_ID}`),
		},
		examples: (t) => ({ query: t.examples.query, top_k: 6 }),
		searches: {
			query: 'query',
			// a narrowed search reads further down the ranking before it narrows
			topK: (a) =>
				Math.min(
					150,
					(a.top_k ?? 12) * (a.document_id || a.lens_value || a.facet || a.topic_id ? 5 : 1),
				),
		},
		read: async (c, a, nearest) => {
			const topK = a.top_k ?? 12
			const refused = refusedFacetFilter(a)
			if (refused) return refused
			const filtered = !!(a.document_id || a.lens_value || a.facet || a.topic_id)
			const [ranked, kept] = await Promise.all([
				rankedPassages(c, a.query, filtered ? topK * 5 : topK, nearest),
				facetFilter(c, a),
			])
			return (await passagesOf(c, ranked))
				.filter((p) => !a.document_id || p.document_id === a.document_id)
				.filter((p) => !a.lens_value || p.lensValue === a.lens_value)
				.filter((p) => !kept || kept.documents.has(p.document_id))
				.filter((p) => !a.topic_id || p.topics.some((t) => t.topic_id === a.topic_id))
				.slice(0, topK)
		},
	}),

	find_topics: tool({
		title: () => 'Find topics',
		group: ORIENTATION,
		description: (t) =>
			`Describe what you are after; returns the topics whose passages best match, ranked by relevance, each with its topic_id, ${t.words.nouns.entity} reach, position mix and lineage in the grouping tree. ${notPrevalence(t.words, t.overview.entities)}`,
		input: { query: z.string(), limit: limitOf(40) },
		examples: (t) => ({ query: t.examples.query, limit: 8 }),
		searches: { query: 'query', topK: () => 100 },
		read: async (c, a, nearest) => {
			const limit = a.limit ?? 15
			if (nearest)
				return (await pages.topicSearch(c.db, c.words, new Map(nearest), limit, c.scope)).map((h) =>
					topicMatch(h, h.relevance),
				)
			// no index: topics whose title or description holds the words
			const ids = new Set(
				(
					await c.db
						.select({ id: s.currentTopic.topicClusterId })
						.from(s.currentTopic)
						.where(
							or(
								like(s.currentTopic.title, x.likePattern(a.query)),
								like(s.currentTopic.description, x.likePattern(a.query)),
							),
						)
				).map((r) => r.id),
			)
			const { land } = await profiles(c)
			return land.topics
				.filter((t) => ids.has(t.topicClusterId))
				.slice(0, limit)
				.map((t) => topicMatch(t))
		},
	}),

	list_topics: tool({
		title: () => 'List all topics',
		group: ORIENTATION,
		description: (t) =>
			`Every topic (${t.overview.clusters - t.overview.junkConfirmedClusters}), widest reach first, each with its topic_id, ${t.words.nouns.entity} and ${t.words.nouns.document} counts, position mix and lineage. Prefer find_topics when you know what you are looking for.`,
		input: {},
		read: async (c) => (await profiles(c)).land.topics.map((t) => topicMatch(t)),
	}),

	search: tool({
		title: () => 'Search (alias)',
		group: ORIENTATION,
		description: () =>
			'Passage search (alias of search_passages); results carry ids usable with fetch.',
		input: { query: z.string() },
		examples: (t) => ({ query: t.examples.query }),
		searches: { query: 'query', topK: () => 10 },
		read: async (c, a, nearest) => ({
			results: (await passagesOf(c, await rankedPassages(c, a.query, 10, nearest))).map((p) => ({
				id: p.passage_id,
				title: `${p.documentTitle} — ${p.source}`,
				text: p.text,
			})),
		}),
	}),

	fetch: tool({
		title: () => 'Fetch (alias)',
		group: ORIENTATION,
		description: () =>
			'Fetch a full record by id from search results: a document_id or a passage id returns the document analysis.',
		input: { id: z.string() },
		examples: (t) => ({ id: t.examples.documentId }),
		read: async (c, a) => {
			const direct = await x.documentById(c.db, a.id, c.scope)
			if (direct) return { ...direct, id: a.id, title: direct.title ?? direct.fileName }
			const documentId = a.id.slice(0, a.id.lastIndexOf('_'))
			const via = documentId ? await x.documentById(c.db, documentId, c.scope) : null
			return via
				? { ...via, id: a.id, title: via.title ?? via.fileName }
				: { error: `no document or passage ${a.id}` }
		},
	}),

	/* ── the grouping tree ── */
	list_families: tool({
		title: () => 'List families (the root generation)',
		group: TREE,
		description: (t) =>
			`The top-level FAMILIES — the root generation of the grouping tree — each with its topics, ${t.words.nouns.entity} reach and position mix. With one generation built, the families are the themes and list_superclusters returns the same nodes. ${notPrevalence(t.words, t.overview.entities)}`,
		input: {},
		when: (t) => t.tree,
		read: async (c) => {
			const { land } = await profiles(c)
			if (!land.top) return { families: [], note: NO_TREE }
			return {
				families: land.groups.filter((g) => g.generation === land.top).map(groupRow),
			}
		},
	}),

	list_superclusters: tool({
		title: () => 'List themes (the generation below the roots)',
		group: TREE,
		description: (t) =>
			`The named THEMES one generation below the families (with one generation built, the same nodes as list_families). Pass family_id to list only the themes under one family. ${notPrevalence(t.words, t.overview.entities)}`,
		input: {
			family_id: z.number().int().optional().describe('Only the themes under this family'),
		},
		when: (t) => t.tree,
		read: async (c, a) => {
			const { land } = await profiles(c)
			if (!land.top) return { superclusters: [], note: NO_TREE }
			const generation = land.top > 1 ? land.top - 1 : land.top
			return {
				superclusters: land.groups
					.filter((g) => g.generation === generation)
					.filter((g) => a.family_id === undefined || g.parentId === a.family_id)
					.map(groupRow),
				...(land.top === 1
					? {
							note: 'This run built ONE grouping generation: these themes sit directly on the topics, and list_families returns the same nodes.',
						}
					: {}),
			}
		},
	}),

	topics_in_supercluster: tool({
		title: () => 'Topics in a theme or family',
		group: TREE,
		description: (t) =>
			`Every topic beneath a grouping node of ANY generation, each with ${t.words.nouns.entity} reach, position mix and its own lineage. ${notPrevalence(t.words, t.overview.entities)}`,
		input: {
			supercluster_id: z.number().int().describe('A family, theme or group id — any generation'),
		},
		examples: (t) => ({ supercluster_id: t.examples.groupId }),
		when: (t) => t.tree,
		read: async (c, a) => {
			const [{ land, byId }, h] = await Promise.all([profiles(c), x.hierarchy(c.db)])
			if (!land.top) return { topics: [], note: NO_TREE }
			const under = treeOf(h).topicsUnder(a.supercluster_id)
			return {
				topics: under.flatMap((id) => {
					const t = byId.get(id)
					return t ? [topicMatch(t)] : []
				}),
			}
		},
	}),

	/* ── a topic ── */
	get_topic: tool({
		title: () => 'Get a topic',
		group: TOPICS,
		description: (t) =>
			`Full profile of one topic: its proposition and description, cross-cutting key findings, lineage in the tree, ${t.words.nouns.entity} reach by membership tier, the position mix overall${lensWords(t) ? ` and by ${lensWords(t)}` : ''}, a contestation summary, and every ${t.words.nouns.entity} holding a stance with its framing (dissent first). Positions are relative to THIS topic's own proposition. ${notPrevalence(t.words, t.overview.entities)}`,
		input: { topic_id: topicId },
		examples: (t) => ({ topic_id: t.examples.topicId }),
		read: async (c, a) => {
			// the synthesis: every stance's words, none of its own key points and quotes (source_perspectives reads those)
			const detail = await x.topicSynthesis(c.db, a.topic_id, c.scope)
			if (!detail) return { error: `no topic with id ${a.topic_id}` }
			const dissent = dissentOf(c.words.scale)
			const stances = detail.stances.map((p) => ({
				...p,
				lensValue: lensValueOf(c.words, p.facets),
			}))
			const byLens = new Map<string, Record<string, number>>()
			for (const p of stances) {
				const key = p.lensValue ?? 'Unclassified'
				const mix = byLens.get(key) ?? {}
				mix[p.position] = (mix[p.position] ?? 0) + 1
				byLens.set(key, mix)
			}
			const contesting = stances.filter((p) => c.words.scale.contesting.includes(p.position))
			const tiers: Record<string, number> = {}
			for (const m of detail.members) tiers[m.membershipType] = (tiers[m.membershipType] ?? 0) + 1
			const shown = 60
			return {
				topic_id: detail.topicClusterId,
				title: detail.title,
				description: detail.description,
				...(detail.junkStatus === 'confirmed'
					? {
							junk: true,
							junkReason: detail.junkAiReason,
							warning:
								'This topic was confirmed as junk in review and is excluded from every aggregate.',
						}
					: {}),
				lineage: detail.lineage,
				documents: detail.documents,
				reach: { [c.words.nouns.entities]: detail.members.length, byTier: tiers },
				positionMix: detail.positions,
				...(c.words.lens
					? {
							positionsByLens: Object.fromEntries(
								[...byLens].sort(
									(x1, x2) =>
										pages.lensRank(c.words)(x1[0] === 'Unclassified' ? null : x1[0]) -
										pages.lensRank(c.words)(x2[0] === 'Unclassified' ? null : x2[0]),
								),
							),
						}
					: {}),
				contestation: {
					contestingStances: contesting.length,
					contestingLensValues: [...new Set(contesting.map((p) => p.lensValue ?? 'Unclassified'))],
					distinctLensValues: byLens.size,
					singleLensValue: byLens.size === 1,
				},
				keyFindings: detail.keyPointItems.map((k) => k.keyPoint),
				stancesHeld: stances.length,
				stances: stances
					.map((p) => ({
						source: p.entityName,
						source_id: p.entityId,
						lensValue: p.lensValue,
						position: p.position,
						framing: p.title,
						...(p.withheld ? { withheld: true } : {}),
						...(p.notice === undefined ? {} : { notice: p.notice }),
					}))
					.sort(
						(p1, p2) =>
							dissent(p2.position) - dissent(p1.position) || p1.source.localeCompare(p2.source),
					)
					.slice(0, shown),
				...(stances.length > shown
					? {
							stancesTruncated: `showing ${shown} of ${stances.length}, dissent first — call source_perspectives for all of them`,
						}
					: {}),
				note: notPrevalence(c.words, await sourceCount(c)),
			}
		},
	}),

	topic_quotes: tool({
		title: () => 'Topic quotes',
		group: TOPICS,
		description: (t) =>
			`Verbatim cross-cutting quotes for a topic, each attributed to the ${t.words.nouns.entity}${lensWords(t) ? ` (with its ${lensWords(t)})` : ''} that wrote it and the finding it supports.`,
		input: { topic_id: topicId, limit: limitOf(60) },
		examples: (t) => ({ topic_id: t.examples.topicId, limit: 10 }),
		read: async (c, a) => {
			const detail = await x.topicSynthesis(c.db, a.topic_id, c.scope)
			if (!detail) return { error: `no topic with id ${a.topic_id}` }
			const lens = await lensValues(
				c,
				detail.keyPointItems.flatMap((kp) =>
					kp.quotes.flatMap((q) => (q.entityUuid ? [q.entityUuid] : [])),
				),
			)
			return detail.keyPointItems
				.flatMap((kp) =>
					kp.quotes.map((q) => ({
						quote: q.text,
						source: q.entityName,
						lensValue: q.entityUuid ? (lens.get(q.entityUuid) ?? null) : null,
						finding: kp.keyPoint,
						...(q.withheld ? { withheld: true } : {}),
						...(q.notice === undefined ? {} : { notice: q.notice }),
					})),
				)
				.slice(0, a.limit ?? 12)
		},
	}),

	topic_perspectives: tool({
		title: (t) => `Topic perspectives${lensWords(t) ? ` (the ${lensWords(t)} lens)` : ''}`,
		group: TOPICS,
		description: (t) =>
			`How a topic is framed by each value of an analysed facet${lensWords(t) ? ` (the lens: ${lensWords(t)})` : ''} — a synthesised position with an analysis and up to two attributed quotes, dissent first. Values absent from the list wrote nothing the pipeline could place on this topic.`,
		input: {
			topic_id: topicId,
			facet: z.string().optional().describe('An analysed facet; the lens when absent'),
		},
		examples: (t) => ({ topic_id: t.examples.topicId }),
		read: async (c, a) => {
			const detail = await x.topicSynthesis(c.db, a.topic_id, c.scope)
			if (!detail) return { error: `no topic with id ${a.topic_id}` }
			const facet = a.facet ?? c.words.lens
			const dissent = dissentOf(c.words.scale)
			return detail.facetPerspectives
				.filter((p) => !facet || p.facet === facet)
				.map((p) => ({
					facet: p.facet,
					value: p.facetValue,
					label: valueWord(c.words, p.facet, p.facetValue),
					position: p.position,
					analysis: p.positionAnalysis,
					quotes: p.quotes.slice(0, 2).map((q) => ({
						quote: q.text,
						source: q.entityName,
						...(q.withheld ? { withheld: true } : {}),
						...(q.notice === undefined ? {} : { notice: q.notice }),
					})),
				}))
				.sort(
					(p1, p2) =>
						dissent(p2.position) - dissent(p1.position) ||
						pages.lensRank(c.words)(p1.value) - pages.lensRank(c.words)(p2.value),
				)
		},
	}),

	source_perspectives: tool({
		title: (t) => `${cap(t.words.nouns.entity)} perspectives on a topic`,
		group: TOPICS,
		description: (t) =>
			`Every ${t.words.nouns.entity} that took a stance on a topic — its position, its framing and its OWN extracted points with verbatim quotes. Slice by ${lensWords(t) ?? 'lens value'} and/or position; every answer also returns \`available\`, the distribution across ALL stances on the topic, so you can see what there is to ask for. Dissent first; \`limit\` truncates the tail, and \`total\` / \`matching\` / \`returned\` say exactly what you are looking at.`,
		input: {
			topic_id: topicId,
			lens_value: lensValue,
			position: z.string().optional().describe('Only this position — see `available.positions`'),
			limit: limitOf(120),
		},
		examples: (t) => ({ topic_id: t.examples.topicId, limit: 10 }),
		read: async (c, a) => {
			const detail = await x.topicById(c.db, a.topic_id, c.scope)
			if (!detail) return { error: `no topic with id ${a.topic_id}` }
			const dissent = dissentOf(c.words.scale)
			const all = detail.entityPerspectives.map((p) => ({
				...p,
				lensValue: lensValueOf(c.words, p.facets),
			}))
			const tally = (key: (p: (typeof all)[number]) => string) => {
				const m = new Map<string, number>()
				for (const p of all) m.set(key(p), (m.get(key(p)) ?? 0) + 1)
				return m
			}
			const matching = all
				.filter((p) => !a.lens_value || p.lensValue === a.lens_value)
				.filter((p) => !a.position || p.position === a.position)
				.sort(
					(p1, p2) =>
						dissent(p2.position) - dissent(p1.position) ||
						p1.entityName.localeCompare(p2.entityName),
				)
			const kept = matching.slice(0, Math.max(1, a.limit ?? 25))
			const truncated = matching.length - kept.length
			return {
				topic_id: a.topic_id,
				total: all.length,
				matching: matching.length,
				returned: kept.length,
				filters: { lens_value: a.lens_value ?? null, position: a.position ?? null },
				available: {
					lensValues: [...tally((p) => p.lensValue ?? 'Unclassified')]
						.map(([value, stances]) => ({ value, stances }))
						.sort((p1, p2) => p2.stances - p1.stances),
					positions: Object.fromEntries(
						[...tally((p) => p.position)].sort((p1, p2) => dissent(p2[0]) - dissent(p1[0])),
					),
				},
				perspectives: kept.map((p) => ({
					source: p.entityName,
					source_id: p.entityId,
					lensValue: p.lensValue,
					position: p.position,
					framing: p.title,
					summary: p.description,
					findings: p.keyPoints.map((k) => ({
						keyPoint: k.keyPoint,
						quotes: k.quotes.slice(0, 2),
					})),
					...(p.withheld ? { withheld: true } : {}),
					...(p.notice === undefined ? {} : { notice: p.notice }),
				})),
				note:
					notPrevalence(c.words, await sourceCount(c)) +
					(truncated > 0
						? ` Dissent first; ${truncated} further matching stances — raise \`limit\` or narrow (see \`available\`).`
						: '') +
					(matching.length === 0 && all.length > 0
						? ' No stance matches those filters on this topic — see `available`.'
						: ''),
			}
		},
	}),

	related_topics: tool({
		title: () => 'Related topics',
		group: TOPICS,
		description: (t) =>
			t.tree
				? 'Topics related to a topic — those sharing a nearest-generation group with it (strong edges), ranked by how many of those groups they share. Pass supercluster_ids to choose the basis yourself.'
				: `Topics whose ${t.words.nouns.entities} overlap a topic's, ranked by shared ${t.words.nouns.entities}.`,
		input: {
			topic_id: topicId,
			supercluster_ids: z
				.array(z.number().int())
				.optional()
				.describe('Use these groups as the basis instead of the topic’s own'),
			limit: limitOf(40),
		},
		examples: (t) => ({ topic_id: t.examples.topicId, limit: 10 }),
		read: async (c, a) => {
			const limit = a.limit ?? 15
			const [h, { byId }] = await Promise.all([x.hierarchy(c.db), profiles(c)])
			const base = h.nodes.find((n) => n.generation === 0 && n.topicClusterId === a.topic_id)
			const strong = h.edges.filter(
				(e) => e.isPrimary || STRONG.some((grade) => grade === e.membershipType),
			)
			const basis = a.supercluster_ids?.length
				? a.supercluster_ids
				: base
					? strong.filter((e) => e.child === base.superclusterId).map((e) => e.parent)
					: []
			if (!basis.length) {
				// no tree above it: the topics its sources also hold strongly
				return {
					basis: 'shared sources',
					topics: (await x.relatedTopics(c.db, a.topic_id, limit, c.scope)).flatMap((r) => {
						const t = byId.get(r.topicClusterId)
						return t ? [{ ...topicMatch(t), sharedSources: r.sharedEntities }] : []
					}),
				}
			}
			const topicOfNode = new Map(
				h.nodes.flatMap((n) =>
					n.generation === 0 && n.topicClusterId !== null
						? [[n.superclusterId, n.topicClusterId]]
						: [],
				),
			)
			const shared = new Map<number, number>()
			for (const g of basis)
				for (const e of strong) {
					if (e.parent !== g) continue
					const t = topicOfNode.get(e.child)
					if (t === undefined || t === a.topic_id) continue
					shared.set(t, (shared.get(t) ?? 0) + 1)
				}
			return {
				basis: basis,
				topics: [...shared]
					.flatMap(([id, n]) => {
						const t = byId.get(id)
						return t ? [{ ...topicMatch(t), sharedGroups: n }] : []
					})
					.sort((t1, t2) => t2.sharedGroups - t1.sharedGroups || t2.sources - t1.sources)
					.slice(0, limit),
			}
		},
	}),

	contested_topics: tool({
		title: (t) => `Contested topics${lensWords(t) ? ` (${lensWords(t)} divergence)` : ''}`,
		group: TOPICS,
		description: (t) =>
			`The record's disagreements: topics where some stances push back on the topic's proposition (${t.words.scale.contesting.join(' / ')}) while others support it, ranked by contesting stances. Each names the dissenting ${t.words.nouns.entities}${lensWords(t) ? `, their ${lensWords(t)}` : ''} and their framing. Set cross_lens_only for the sharpest cases: a contesting ${lensWords(t) ?? 'lens value'} absent from the supporters. ${notPrevalence(t.words, t.overview.entities)}`,
		input: {
			limit: limitOf(50),
			min_contesting: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe('At least this many contesting stances (default 1)'),
			cross_lens_only: z
				.boolean()
				.optional()
				.describe('Only topics where a contesting lens value is absent from the supporting ones'),
		},
		examples: () => ({ limit: 10, min_contesting: 1 }),
		when: (t) => t.words.scale.contesting.length > 0,
		read: async (c, a) => {
			const scale = c.words.scale
			const [{ byId }, entityFacets, rows, lensRows] = await Promise.all([
				profiles(c),
				loadFacetCache(c.db, 'entity'),
				c.db
					.select({
						topicClusterId: s.clusterEntityPerspective.topicClusterId,
						position: s.clusterEntityPerspective.position,
						title: s.clusterEntityPerspective.title,
						entityUuid: s.entity.id,
						entityId: s.entity.entityId,
						entityName: s.entity.entityName,
					})
					.from(s.clusterEntityPerspective)
					.innerJoin(s.entity, eq(s.entity.id, s.clusterEntityPerspective.entityUuid))
					.innerJoin(
						s.currentTopic,
						eq(s.currentTopic.topicClusterId, s.clusterEntityPerspective.topicClusterId),
					)
					.where(keepSources(s.entity.id, c.scope)),
				c.words.lens
					? c.db
							.select({
								topicClusterId: s.clusterKeyPerspective.topicClusterId,
								value: s.clusterKeyPerspective.facetValue,
								position: s.clusterKeyPerspective.position,
							})
							.from(s.clusterKeyPerspective)
							.where(eq(s.clusterKeyPerspective.facet, c.words.lens))
					: Promise.resolve([]),
			])
			const dissent = dissentOf(scale)
			const byTopic = new Map<number, ((typeof rows)[number] & { lensValue: string })[]>()
			for (const r of rows)
				byTopic.set(r.topicClusterId, [
					...(byTopic.get(r.topicClusterId) ?? []),
					{
						...r,
						lensValue: lensValueOf(c.words, entityFacets.get(r.entityUuid)) ?? 'Unclassified',
					},
				])
			const out = []
			for (const [id, stances] of byTopic) {
				const contesters = stances.filter((p) => scale.contesting.includes(p.position))
				const supporters = stances.filter((p) => scale.supportive.includes(p.position))
				if (contesters.length < (a.min_contesting ?? 1) || !supporters.length) continue
				const supporting = [...new Set(supporters.map((p) => p.lensValue))]
				const contestingValues = [...new Set(contesters.map((p) => p.lensValue))]
				const crossLens = contestingValues.some((v) => !supporting.includes(v))
				if (a.cross_lens_only && !crossLens) continue
				const topic = byId.get(id)
				out.push({
					topic_id: id,
					title: topic?.title ?? '',
					lineage: topic?.lineage ?? [],
					supportingStances: supporters.length,
					contestingStances: contesters.length,
					unclearStances: stances.filter((p) => p.position === scale.unclear).length,
					distinctLensValues: new Set(stances.map((p) => p.lensValue)).size,
					crossLens,
					supportingLensValues: supporting,
					contestingLensValues: contestingValues,
					contesters: contesters
						.map((p) => ({
							source: p.entityName,
							source_id: p.entityId,
							lensValue: p.lensValue,
							position: p.position,
							framing: textOf(c.scope, p.entityUuid, p.title),
							...wordsOf(c.scope, p.entityUuid),
						}))
						.sort((p1, p2) => dissent(p2.position) - dissent(p1.position)),
					lensDivergence: lensRows
						.filter(
							(l) =>
								l.topicClusterId === id &&
								(scale.contesting.includes(l.position) || l.position === scale.unclear),
						)
						.map((l) => ({ value: l.value, position: l.position })),
				})
			}
			return out
				.sort(
					(t1, t2) =>
						t2.contestingStances - t1.contestingStances ||
						t2.contestingLensValues.length - t1.contestingLensValues.length ||
						t2.supportingStances - t1.supportingStances,
				)
				.slice(0, a.limit ?? 15)
		},
	}),

	/* ── who ── */
	lens_profile: tool({
		title: (t) => `Profile ${withArticle(lensWords(t) ?? 'lens value')}`,
		group: WHO,
		description: (t) =>
			`Everything one ${lensWords(t)} value does across the record: which ${t.words.nouns.entities} it holds, its position mix and how often it contests, the topics it engages most, and the topics it DOMINATES (60% or more of all stances on them) — where one ${lensWords(t)} speaks effectively unopposed. ${notPrevalence(t.words, t.overview.entities)}`,
		input: {
			lens_value: z
				.string()
				.describe('One value of the run’s lens (see corpus_overview `lens.values`)'),
		},
		examples: (t) => ({ lens_value: t.lensValues[0] }),
		when: (t) => t.words.lens !== null,
		read: async (c, a) => {
			const [entities, entityFacets, { byId }, stances] = await Promise.all([
				x.entities(c.db, c.scope),
				loadFacetCache(c.db, 'entity'),
				profiles(c),
				c.db
					.select({
						topicClusterId: s.clusterEntityPerspective.topicClusterId,
						entityUuid: s.clusterEntityPerspective.entityUuid,
						position: s.clusterEntityPerspective.position,
					})
					.from(s.clusterEntityPerspective)
					.innerJoin(
						s.currentTopic,
						eq(s.currentTopic.topicClusterId, s.clusterEntityPerspective.topicClusterId),
					)
					.where(keepSources(s.clusterEntityPerspective.entityUuid, c.scope)),
			])
			const members = entities.filter(
				(e) => lensValueOf(c.words, entityFacets.get(e.entityUuid)) === a.lens_value,
			)
			if (!members.length)
				return { error: `no ${c.words.nouns.entity} with ${lensKey(c.words)} "${a.lens_value}"` }
			const ids = new Set(members.map((e) => e.entityUuid))
			const totalOn = new Map<number, number>()
			for (const p of stances)
				totalOn.set(p.topicClusterId, (totalOn.get(p.topicClusterId) ?? 0) + 1)
			const mine = stances.filter((p) => ids.has(p.entityUuid))
			const mix: Record<string, number> = {}
			const onTopic = new Map<number, number>()
			for (const p of mine) {
				mix[p.position] = (mix[p.position] ?? 0) + 1
				onTopic.set(p.topicClusterId, (onTopic.get(p.topicClusterId) ?? 0) + 1)
			}
			const row = ([id, n]: [number, number]) => ({
				topic_id: id,
				title: byId.get(id)?.title ?? '',
				stances: n,
				shareOfTopic: pct(n, totalOn.get(id) ?? n),
			})
			const lens = lensKey(c.words)
			return {
				lens,
				value: a.lens_value,
				label: valueWord(c.words, lens, a.lens_value),
				reading: c.words.facets[lens]?.descriptions[a.lens_value] ?? null,
				[c.words.nouns.entities]: members.length,
				documents: members.reduce((n, e) => n + e.documents, 0),
				stances: mine.length,
				positionMix: mix,
				contestingStances: mine.filter((p) => c.words.scale.contesting.includes(p.position)).length,
				members: members
					.map((e) => ({ source: e.entityName, source_id: e.entityId }))
					.sort((e1, e2) => e1.source.localeCompare(e2.source)),
				topTopics: [...onTopic]
					.sort((t1, t2) => t2[1] - t1[1])
					.slice(0, 12)
					.map(row),
				dominatedTopics: [...onTopic]
					.filter(([id, n]) => (totalOn.get(id) ?? n) >= 2 && n / (totalOn.get(id) ?? n) >= 0.6)
					.sort((t1, t2) => t2[1] - t1[1])
					.slice(0, 12)
					.map(row),
				note: notPrevalence(c.words, entities.length),
			}
		},
	}),

	list_sources: tool({
		title: (t) => `List ${t.words.nouns.entities}`,
		group: WHO,
		description: (t) =>
			`The ${t.overview.entities} ${t.words.nouns.entities} behind the ${t.words.nouns.documents}: each with its stable id (source_id, for get_source), its facets, its ${t.words.nouns.document} count, how many stances it holds and how many topics it strongly represents. Filter by ${lensWords(t) ?? 'lens value'}, by a value of any facet, or by a fragment of the name. ${notPrevalence(t.words, t.overview.entities)}`,
		input: {
			lens_value: lensValue,
			...facetFilterInput,
			query: z.string().optional().describe('A fragment of the name or id'),
			limit: limitOf(200),
		},
		examples: () => ({ limit: 25 }),
		read: async (c, a) => {
			const refused = refusedFacetFilter(a)
			if (refused) return refused
			const [entities, stanceRows, reachRows, inferred, kept] = await Promise.all([
				x.entities(c.db, c.scope),
				c.db
					.select({ entityUuid: s.clusterEntityPerspective.entityUuid })
					.from(s.clusterEntityPerspective)
					.innerJoin(
						s.currentTopic,
						eq(s.currentTopic.topicClusterId, s.clusterEntityPerspective.topicClusterId),
					),
				c.db
					.select({ entityUuid: s.currentEntityMembership.entityUuid })
					.from(s.currentEntityMembership)
					.where(inArray(s.currentEntityMembership.membershipType, STRONG)),
				c.db.select({ id: s.entity.id, inferredName: s.entity.inferredName }).from(s.entity),
				facetFilter(c, a),
			])
			const count = (rows: { entityUuid: string }[]) => {
				const m = new Map<string, number>()
				for (const r of rows) m.set(r.entityUuid, (m.get(r.entityUuid) ?? 0) + 1)
				return m
			}
			const stancesOf = count(stanceRows)
			const reachOf = count(reachRows)
			const inferredOf = new Map(inferred.map((e) => [e.id, e.inferredName]))
			const needle = a.query?.trim().toLowerCase()
			return entities
				.map((e) => ({ e, lens: lensValueOf(c.words, e.facets) }))
				.filter(({ lens }) => !a.lens_value || lens === a.lens_value)
				.filter(({ e }) => !kept || kept.entities.has(e.entityUuid))
				.filter(
					({ e }) =>
						!needle ||
						[
							e.entityName,
							e.entityId,
							inferredOf.get(e.entityUuid) ?? '',
							...(e.facets.llm_entity_name ?? []),
						].some((v) => v.toLowerCase().includes(needle)),
				)
				.map(({ e, lens }) => ({
					source: e.entityName,
					source_id: e.entityId,
					lensValue: lens,
					facets: Object.fromEntries(Object.entries(e.facets).filter(([k]) => !internalFacet(k))),
					documents: e.documents,
					stances: stancesOf.get(e.entityUuid) ?? 0,
					strongTopics: reachOf.get(e.entityUuid) ?? 0,
				}))
				.sort((e1, e2) => e1.source.localeCompare(e2.source))
				.slice(0, a.limit ?? 100)
		},
	}),

	get_source: tool({
		title: (t) => `Profile ${withArticle(t.words.nouns.entity)}`,
		group: WHO,
		description: (t) =>
			`Profile of one ${t.words.nouns.entity} — by its source_id, its uuid or a fragment of its name: its facets, its ${t.words.nouns.documents}, every topic it is strongly linked to with its position and framing there.`,
		input: { source: z.string().describe('A source_id, uuid or a fragment of the name') },
		examples: (t) => ({ source: t.examples.sourceId }),
		read: async (c, a) => {
			const direct = await x.entityByKey(c.db, a.source, c.scope)
			const found =
				direct ??
				(await (async () => {
					const needle = a.source.trim().toLowerCase()
					const hit = (await x.entities(c.db, c.scope)).find((e) =>
						[e.entityName, e.entityId].some((v) => v.toLowerCase().includes(needle)),
					)
					return hit ? x.entityByKey(c.db, hit.entityId, c.scope) : null
				})())
			if (!found) return { error: `no ${c.words.nouns.entity} matching "${a.source}"` }
			const dissent = dissentOf(c.words.scale)
			return {
				...found,
				lensValue: lensValueOf(c.words, found.facets),
				topicItems: [...found.topicItems].sort(
					(t1, t2) =>
						(t2.position === null ? -1 : dissent(t2.position)) -
						(t1.position === null ? -1 : dissent(t1.position)),
				),
			}
		},
	}),

	/* ── documents ── */
	find_documents: tool({
		title: (t) => `Find ${t.words.nouns.documents}`,
		group: DOCUMENTS,
		description: (t) =>
			`Search the ${t.words.nouns.documents} by words in their title, file name or the ${t.words.nouns.entity}'s name; each with its document_id (for get_document), its facets and whether the pipeline could analyse it.`,
		input: { query: z.string(), limit: limitOf(50) },
		read: async (c, a) => {
			const [found, documentFacets, analysed] = await Promise.all([
				x.findDocuments(c.db, a.query, a.limit ?? 20, c.scope),
				loadFacetCache(c.db, 'document'),
				c.db
					.selectDistinct({ documentId: s.publishedKeyPoint.documentId })
					.from(s.publishedKeyPoint),
			])
			const done = new Set(analysed.map((d) => d.documentId))
			return found.map((d) => ({
				document_id: d.documentId,
				title: d.title ?? d.fileName,
				source: d.entityName,
				facets: Object.fromEntries(
					Object.entries(documentFacets.get(d.documentId) ?? {}).filter(([k]) => !internalFacet(k)),
				),
				analysed: done.has(d.documentId),
			}))
		},
	}),

	get_document: tool({
		title: (t) => `Get ${withArticle(t.words.nouns.document)}`,
		group: DOCUMENTS,
		description: (t) =>
			`Full analysis of one ${t.words.nouns.document} by document_id (or a source_id, which returns its first ${t.words.nouns.document}): its facets, key points with verbatim quotes, tags, question answers, criteria findings, metrics, the topics its passages fell into and — with include_text — its full extracted text.`,
		input: { document_id: z.string(), include_text: z.boolean().optional() },
		examples: (t) => ({ document_id: t.examples.documentId }),
		read: async (c, a) => {
			const direct = await x.documentById(c.db, a.document_id, c.scope)
			const d =
				direct ??
				(await (async () => {
					const owner = await x.entityByKey(c.db, a.document_id, c.scope)
					const first = owner?.documentItems[0]
					return first ? x.documentById(c.db, first.documentId, c.scope) : null
				})())
			if (!d) return { error: `no document or source ${a.document_id}` }
			const facets = (await loadFacetCache(c.db, 'document')).get(d.documentId) ?? {}
			return {
				...d,
				facets: Object.fromEntries(Object.entries(facets).filter(([k]) => !internalFacet(k))),
				text: a.include_text ? d.text : `${d.text.slice(0, 600)}…`,
				...(d.keyPointItems.length || d.withheld
					? {}
					: {
							note: 'Step 1 could not analyse this document; it has no key points. It still holds topic memberships.',
						}),
			}
		},
	}),

	/* ── facets & vocabularies ── */
	list_tags: tool({
		title: () => 'List values of a facet',
		group: FACETS,
		description: (t) =>
			`One facet of the record with its ${t.words.nouns.entity} count per value — ${t.facets.map((f) => f.label).join(', ')}. ${cap(withArticle(t.words.nouns.document))} facet counts the ${t.words.nouns.entities} who wrote those ${t.words.nouns.documents}. ${notPrevalence(t.words, t.overview.entities)}`,
		input: { category: z.string().describe('A facet, by key or heading (see the description)') },
		examples: (t) => ({ category: t.facets[0]?.label }),
		when: (t) => t.facets.length > 0,
		read: async (c, a) => {
			const facets = await readerFacets(c.db, c.words)
			const facet = facets.find(
				(f) => f.key === a.category || f.label.toLowerCase() === a.category.toLowerCase(),
			)
			if (!facet)
				return {
					error: `unknown category "${a.category}" — one of ${facets.map((f) => f.label).join(', ')}`,
				}
			const held = new Map<string, Set<string>>()
			for (const r of await facetHolders(c, facet.key))
				held.set(r.value, (held.get(r.value) ?? new Set()).add(r.entityUuid))
			return {
				category: facet.label,
				facet: facet.key,
				tags: [...held]
					.map(([tag, who]) => ({
						tag,
						label: valueWord(c.words, facet.key, tag),
						[c.words.nouns.entities]: who.size,
					}))
					.sort(
						(t1, t2) => Number(t2[c.words.nouns.entities]) - Number(t1[c.words.nouns.entities]),
					),
				note: notPrevalence(c.words, await sourceCount(c)),
			}
		},
	}),

	tag_pivot: tool({
		title: () => 'Facet pivot',
		group: FACETS,
		description: (t) =>
			`The analyst's pivot table: ${t.words.nouns.entity} counts per value of one facet, optionally cross-tabbed by another (by = ${t.facets.map((f) => f.key).join(' | ')}), and filterable to one lens value, one value, or one grouping node (the ${t.words.nouns.entities} strongly linked to a topic beneath it). ${notPrevalence(t.words, t.overview.entities)}`,
		input: {
			category: z.string().describe('The facet counted, by key or heading'),
			by: z.string().optional().describe('The cross-tab facet, by key or heading'),
			lens_value: lensValue,
			tag: z.string().optional().describe('Only this value of the counted facet'),
			group_id: z
				.number()
				.int()
				.optional()
				.describe('Only sources beneath this family, theme or group'),
		},
		examples: (t) => ({ category: t.facets[1]?.label ?? t.facets[0]?.label, by: t.words.lens }),
		when: (t) => t.facets.length > 0,
		read: async (c, a) => {
			const facets = await readerFacets(c.db, c.words)
			const find = (name: string) =>
				facets.find((f) => f.key === name || f.label.toLowerCase() === name.toLowerCase())
			const facet = find(a.category)
			if (!facet)
				return {
					error: `unknown category "${a.category}" — one of ${facets.map((f) => f.label).join(', ')}`,
				}
			const by = a.by ? find(a.by) : undefined
			if (a.by && !by)
				return {
					error: `unknown cross-tab facet "${a.by}" — one of ${facets.map((f) => f.key).join(', ')}`,
				}
			const [pairs, axisPairs, entityFacets] = await Promise.all([
				facetHolders(c, facet.key),
				by ? facetHolders(c, by.key) : Promise.resolve([]),
				loadFacetCache(c.db, 'entity'),
			])
			const axisOf = new Map<string, string[]>()
			for (const r of axisPairs)
				axisOf.set(r.entityUuid, [...(axisOf.get(r.entityUuid) ?? []), r.value])
			let inGroup: Set<string> | null = null
			if (a.group_id !== undefined) {
				const under = new Set(treeOf(await x.hierarchy(c.db)).topicsUnder(a.group_id))
				const links = await c.db
					.select({
						entityUuid: s.currentEntityMembership.entityUuid,
						topicClusterId: s.currentEntityMembership.topicClusterId,
					})
					.from(s.currentEntityMembership)
					.where(inArray(s.currentEntityMembership.membershipType, STRONG))
				inGroup = new Set(links.filter((l) => under.has(l.topicClusterId)).map((l) => l.entityUuid))
			}
			const rows = new Map<string, { who: Set<string>; byAxis: Map<string, Set<string>> }>()
			for (const p of pairs) {
				if (a.lens_value && lensValueOf(c.words, entityFacets.get(p.entityUuid)) !== a.lens_value)
					continue
				if (a.tag && p.value !== a.tag) continue
				if (inGroup && !inGroup.has(p.entityUuid)) continue
				const row = rows.get(p.value) ?? {
					who: new Set<string>(),
					byAxis: new Map<string, Set<string>>(),
				}
				row.who.add(p.entityUuid)
				if (by)
					for (const v of axisOf.get(p.entityUuid) ?? ['Unclassified'])
						row.byAxis.set(v, (row.byAxis.get(v) ?? new Set()).add(p.entityUuid))
				rows.set(p.value, row)
			}
			return {
				category: facet.label,
				facet: facet.key,
				by: by?.key ?? null,
				rows: [...rows]
					.map(([tag, row]) => ({
						tag,
						label: valueWord(c.words, facet.key, tag),
						[c.words.nouns.entities]: row.who.size,
						...(by
							? {
									[by.key]: Object.fromEntries(
										[...row.byAxis]
											.map(([v, who]): [string, number] => [
												valueWord(c.words, by.key, v),
												who.size,
											])
											.sort((v1, v2) => v2[1] - v1[1]),
									),
								}
							: {}),
					}))
					.sort(
						(r1, r2) => Number(r2[c.words.nouns.entities]) - Number(r1[c.words.nouns.entities]),
					),
				note: notPrevalence(c.words, await sourceCount(c)),
			}
		},
	}),

	list_vocabularies: tool({
		title: () => 'Vocabularies',
		group: FACETS,
		description: (t) =>
			`Every vocabulary-backed facet (${t.overview.tagCategories.map((v) => v.category).join(', ')}) with its concept tree: paths, the stable external id and notation each concept carries in its source scheme, and how many ${t.words.nouns.entities} or ${t.words.nouns.documents} carry each concept, ancestors included. Pass facet to fetch one.`,
		input: { facet: z.string().optional() },
		examples: (t) => ({ facet: t.overview.tagCategories[0]?.category }),
		when: (t) => t.overview.tagCategories.length > 0,
		read: (c, a) => x.vocabularySummary(c.db, a.facet ? { facet: a.facet } : {}, c.scope),
	}),

	get_concept: tool({
		title: () => 'Get a concept',
		group: FACETS,
		description: () =>
			"One concept of a vocabulary facet by path (levels joined by ' › '), external id or notation: its labels (preferred, alternate), definitions, broader / narrower / related concepts and its matches into other schemes.",
		input: { facet: z.string(), concept: z.string() },
		examples: (t) => ({ facet: t.overview.tagCategories[0]?.category }),
		when: (t) => t.overview.tagCategories.length > 0,
		read: async (c, a) =>
			(await x.conceptDetail(c.db, a.facet, a.concept)) ?? {
				error: `no concept ${a.concept} in ${a.facet}`,
			},
	}),

	entities_for_concept: tool({
		title: (t) => `${cap(t.words.nouns.entities)} for a concept`,
		group: FACETS,
		description: (t) =>
			`The ${t.words.nouns.entities} whose facet carries a concept directly or through a descendant (marked derived), by path, external id or notation. Ids round-trip to get_source.`,
		input: { concept: z.string(), facet: z.string().optional() },
		examples: (t) => ({ facet: t.overview.tagCategories[0]?.category }),
		when: (t) => t.overview.tagCategories.length > 0,
		read: async (c, a) =>
			(await x.subjectsForConcept(c.db, a.concept, a.facet ?? null, c.scope)).filter(
				(r) => r.subjectType === 'entity',
			),
	}),

	documents_for_concept: tool({
		title: (t) => `${cap(t.words.nouns.documents)} for a concept`,
		group: FACETS,
		description: (t) =>
			`The ${t.words.nouns.documents} tagged with a concept directly or through a descendant (marked derived), with relevance, primary flag and the evidencing context where a model assigned it. Ids round-trip to get_document.`,
		input: { concept: z.string(), facet: z.string().optional() },
		examples: (t) => ({ facet: t.overview.tagCategories[0]?.category }),
		when: (t) => t.overview.tagCategories.length > 0,
		read: async (c, a) =>
			(await x.subjectsForConcept(c.db, a.concept, a.facet ?? null, c.scope)).filter(
				(r) => r.subjectType === 'document',
			),
	}),

	/* ── custom analysis ── */
	list_questions: tool({
		title: () => 'Questions put to every document',
		group: ANALYSIS,
		description: (t) =>
			`The ${t.overview.questions} questions the run put to every ${t.words.nouns.document}, by task, each with how many ${t.words.nouns.documents} and ${t.words.nouns.entities} answered it. An answer was recorded only where one was located in the text: an unanswered question is absence of evidence, not a view. Use a question's key or clause with question_answers. ${notPrevalence(t.words, t.overview.entities)}`,
		input: { task_id: z.string().optional().describe('Only this question task’s questions') },
		when: (t) => t.overview.questions > 0,
		read: async (c, a) => {
			const [questions, rows, { ownerOf }] = await Promise.all([
				c.db
					.select()
					.from(s.question)
					.where(a.task_id ? eq(s.question.taskId, a.task_id) : undefined)
					.orderBy(asc(s.question.taskId), asc(s.question.ordinal), asc(s.question.questionId)),
				c.db
					.select({
						questionId: s.publishedQuestionResponse.questionId,
						documentId: s.publishedQuestionResponse.documentId,
						addressed: s.publishedQuestionResponse.addressed,
					})
					.from(s.publishedQuestionResponse),
				documentOwners(c),
			])
			return questions.map((q) => {
				const mine = rows.filter((r) => r.questionId === q.questionId && ownerOf.has(r.documentId))
				const answered = mine.filter((r) => r.addressed === 1)
				return {
					task: c.words.tasks[q.taskId]?.title ?? q.taskId,
					task_id: q.taskId,
					key: q.questionKey,
					clause: questionClause(q.questionKey, q.questionText),
					text: q.questionText,
					documentsPutTo: mine.length,
					documentsAnswering: answered.length,
					[`${c.words.nouns.entities}Answering`]: new Set(
						answered.map((r) => ownerOf.get(r.documentId)),
					).size,
				}
			})
		},
	}),

	question_answers: tool({
		title: () => 'Answers to one question',
		group: ANALYSIS,
		description: (t) =>
			`Every answer to one question — the ${t.words.nouns.entity}${lensWords(t) ? `, its ${lensWords(t)}` : ''}, the ${t.words.nouns.document}, the position it took and its key points with verbatim quotes — sliceable by lens value. Returns \`available\`, the lens distribution of all answers. ${notPrevalence(t.words, t.overview.entities)}`,
		input: {
			question: z.string().describe('The question key, or its clause ("a", "(a)")'),
			task_id: z.string().optional().describe('The question task, when several use the same keys'),
			lens_value: lensValue,
			limit: limitOf(200),
		},
		examples: (t) => ({ question: t.examples.questionKey, limit: 12 }),
		when: (t) => t.overview.questions > 0,
		read: async (c, a) => {
			const questions = await c.db
				.select()
				.from(s.question)
				.where(a.task_id ? eq(s.question.taskId, a.task_id) : undefined)
			const wanted = a.question.trim().toLowerCase().replace(/[()]/g, '')
			const q = questions.find(
				(row) =>
					row.questionKey.toLowerCase() === wanted ||
					questionClause(row.questionKey, row.questionText).replace(/[()]/g, '').toLowerCase() ===
						wanted ||
					row.questionKey.toLowerCase().endsWith(`-${wanted}`),
			)
			if (!q)
				return {
					error: `no question "${a.question}" — one of ${questions.map((row) => row.questionKey).join(', ')}`,
				}
			const detail = await pages.questionDetail(c.db, c.words, q.questionId, c.scope)
			if (!detail) return { error: `no question "${a.question}"` }
			const all = detail.byLensValue.flatMap((v) => v.answers)
			const matching = all.filter((r) => !a.lens_value || r.lensValue === a.lens_value)
			const kept = matching.slice(0, Math.max(1, a.limit ?? 40))
			return {
				task: c.words.tasks[q.taskId]?.title ?? q.taskId,
				key: q.questionKey,
				clause: detail.question.clause,
				text: q.questionText,
				total: all.length,
				matching: matching.length,
				returned: kept.length,
				available: {
					lensValues: detail.byLensValue.map((v) => ({
						value: v.value ?? 'Unclassified',
						answers: v.answers.length,
					})),
				},
				answers: kept.map((r) => ({
					source: r.name,
					source_id: r.entityId,
					lensValue: r.lensValue,
					document_id: r.documentId,
					position: r.position,
					keyPoints: r.keyPoints.map((k) => ({ ...k, quotes: k.quotes.slice(0, 2) })),
					...(r.withheld ? { withheld: true } : {}),
					...(r.notice === undefined ? {} : { notice: r.notice }),
				})),
				note: `An answer is per ${c.words.nouns.document}; ${withArticle(c.words.nouns.entity)} with several may answer more than once.${matching.length > kept.length ? ` ${matching.length - kept.length} further answers match — raise \`limit\` or narrow by lens value.` : ''}`,
			}
		},
	}),

	task_results: tool({
		title: () => 'Custom analysis results',
		group: ANALYSIS,
		description: (t) => {
			const tasks = Object.values(t.words.tasks)
			return `The run's ${tasks.length} custom analysis task(s) — ${tasks.map((task) => task.title).join(', ')} — each with its corpus-wide results: tag assignment counts, question coverage, findings by category, or metrics. A task with documentsAnalysed 0 produced nothing. Per-${t.words.nouns.document} detail rides on get_document.`
		},
		input: {},
		when: (t) => Object.keys(t.words.tasks).length > 0,
		read: (c) => x.taskResults(c.db, c.scope),
	}),
}

/* ───────────────────────── serving the table ───────────────────────── */

/** Run one tool's read: its arguments validated against its own input, the scope applied. */
export async function runExplorerTool(
	db: CorpusDb,
	name: string,
	args: unknown,
	options: { scope?: ReadScope; nearest?: [string, number][] } = {},
): Promise<unknown> {
	const t = EXPLORER_TOOLS[name]
	if (!t) throw new Error(`[explorer] no tool named ${name}`)
	const words = await x.runWords(db)
	return t.read(
		{ db, words, ...(options.scope ? { scope: options.scope } : {}) },
		args,
		options.nearest,
	)
}

/** The table served over a corpus database in the reader's scope: what an app passes. */
export const explorerToolHost = (db: CorpusDb, scope?: ReadScope): ExplorerToolHost => ({
	explorerToolContext: () => toolContext(db, scope),
	explorerTool: (name, args, nearest) => runExplorerTool(db, name, args, { scope, nearest }),
})
