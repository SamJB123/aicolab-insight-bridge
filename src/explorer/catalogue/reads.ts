/**
 * The reads every report's connector serves, defined once each with app-kit's
 * `Operation`: the name, what it is for in this run's own words, a zod input and
 * output, a REST path, for a topic, a source or a document a resource binding with the
 * reading as Markdown, and the handler over the explorer reads in the reader's scope.
 *
 * The set is the tool table's (2026-10-21, one name per job), with the same names and
 * inputs, so an agent that learned a report keeps its habits; what changed (2026-10-24)
 * is the answers: every one an object sized for a model's context, a listing a page
 * with its total, a detail trimmed to what a reader opens first and pointing at the
 * read that has the rest. ./sizes.test.ts holds each to its budget. `document_text` is
 * new: the whole text of a document, a page of passages at a time, as a resource and a
 * route and never a tool.
 *
 * Built per run (`readsFor`): the descriptions and examples are the run's own, as the
 * table's were, so the catalogue is a function of the run's facts (./support
 * `toolContext`) and a report Worker builds it once per record version.
 */
import { listing, NotFound, operationsFor } from '@aicolab/app-kit/api/define'
import {
	conceptDetailSchema,
	tagDocumentSchema,
	taskResultSchema,
} from '@aicolab/insight-bridge-contracts/explorer'
import type { CorpusDb } from '@aicolab/insight-bridge-contracts/schema'
import * as s from '@aicolab/insight-bridge-contracts/schema'
import { asc, eq, inArray, like, or } from 'drizzle-orm'
import { z } from 'zod'
import { cap, withArticle } from '../../grammar.ts'
import { toolGroup } from '../../mcp-tools.ts'
import { treeOf } from '../../tree.ts'
import { questionClause } from '../../world/schema.ts'
import * as x from '../data.ts'
import { STRONG } from '../data.ts'
import { loadFacetCache } from '../facets.ts'
import * as pages from '../pages.ts'
import { looksLikeQuote } from '../readings.ts'
import { keepSources, passagesServed, textOf, wordsOf } from '../scope.ts'
import { type ReportCtx, readContext } from './context.ts'
import {
	clip,
	DOCUMENT_FINDINGS_SHOWN,
	DOCUMENT_KEY_POINTS_SHOWN,
	type DocumentOutput,
	documentMarkdown,
	documentOutputSchema,
	documentUrl,
	groupRowOf,
	groupRowSchema,
	PAGE,
	PAGE_MAX,
	PASSAGE_CHARS,
	type Passage,
	pageOf,
	pageShape,
	passageSchema,
	QUOTE_CHARS,
	type Quote,
	quoteSchema,
	SOURCE_DOCUMENTS_SHOWN,
	SOURCE_TOPICS_SHOWN,
	type SourceOutput,
	sourceMarkdown,
	sourceOutputSchema,
	sourceUrl,
	stanceRowSchema,
	TEXT_CHARS_MAX,
	TEXT_PREVIEW_CHARS,
	TOPIC_STANCES_SHOWN,
	type TopicOutput,
	topicMarkdown,
	topicOutputSchema,
	topicRowOf,
	topicRowSchema,
	topicUrl,
} from './shapes.ts'
import {
	dissentOf,
	documentOwners,
	facetFilter,
	facetHolders,
	internalFacet,
	lensKey,
	lensValueOf,
	lensValues,
	lensWords,
	NO_TREE,
	notPrevalence,
	passagesOf,
	pct,
	profiles,
	rankedPassages,
	readerFacets,
	readerFacetValues,
	sourceCount,
	TOPIC_ID,
	type ToolContext,
	valueWord,
} from './support.ts'

const define = operationsFor<ReportCtx>()

/** How a search was ranked: by the host's vector index, or by the passages' words. */
type SearchMode = 'semantic' | 'text'
const searchMode = (nearest: unknown): SearchMode => (nearest ? 'semantic' : 'text')

/* ───────────────────────── the Connect page's groups ───────────────────────── */

export const GROUP = {
	orientation: 'Orientation & search',
	tree: 'The grouping tree',
	topics: 'Anatomy of a topic',
	facets: 'Facets & vocabularies',
	analysis: 'Custom analysis',
	readers: 'The report’s pages',
} as const

const grouped = (group: string) => ({ tags: [group], meta: toolGroup(group) })

/* ───────────────────────── inputs ───────────────────────── */

/** A field with this run's own starting value as its example (the Connect console's first input). */
const ex = <S extends z.ZodType>(schema: S, value: unknown): S =>
	value === undefined || value === null ? schema : schema.meta({ examples: [value] })

const topicId = z.coerce.number().int().describe(TOPIC_ID)
const limitOf = (max: number, fallback: number) =>
	z.coerce.number().int().min(1).max(max).default(fallback)
const offset = z.coerce.number().int().min(0).default(0)
const lensValueInput = z
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
const bothOrNeither = (a: { facet?: string; value?: string }) => !a.facet === !a.value
const BOTH_OR_NEITHER = { message: '`facet` and `value` go together: give both, or neither' }

/* ───────────────────────── shared pieces ───────────────────────── */

const words = (ctx: ReportCtx) => ctx.run.words

/** Each source's `entity_id` slug by uuid, for `source_id` on a row and a whole link. */
async function slugsOf(db: CorpusDb, uuids: readonly string[]): Promise<Map<string, string>> {
	const out = new Map<string, string>()
	const distinct = [...new Set(uuids)]
	for (let i = 0; i < distinct.length; i += 90) {
		const rows = await db
			.select({ id: s.entity.id, entityId: s.entity.entityId })
			.from(s.entity)
			.where(inArray(s.entity.id, distinct.slice(i, i + 90)))
		for (const r of rows) out.set(r.id, r.entityId)
	}
	return out
}

/** A passage row for a listing: its text clipped. */
const passageOf = (p: Awaited<ReturnType<typeof passagesOf>>[number]): Passage => ({
	...p,
	text: clip(p.text, PASSAGE_CHARS),
	truncated: p.text.length > PASSAGE_CHARS,
})

/** A quote for a detail, attributed and clipped. */
const quoteOf = (q: {
	text: string
	entityName: string | null
	entityId?: string | null
	lensValue?: string | null
	withheld?: boolean
	notice?: string
}): Quote => ({
	quote: clip(q.text, QUOTE_CHARS),
	source: q.entityName,
	source_id: q.entityId ?? null,
	lensValue: q.lensValue ?? null,
	...(q.withheld ? { withheld: true } : {}),
	...(q.notice === undefined ? {} : { notice: q.notice }),
})

const noTopic = (id: number) =>
	new NotFound(`No topic with id ${id}. find_topics and list_topics name them.`)

/* ───────────────────────── the reads, for one run ───────────────────────── */

export function readsFor(t: ToolContext) {
	const nouns = t.words.nouns
	const lens = lensWords(t)
	const vocabularies = t.overview.tagCategories.map((v) => v.category)

	/* ── orientation & search ── */

	const corpus_overview = define({
		name: 'corpus_overview',
		summary: 'Corpus overview',
		description: `Scale and shape of the record: ${t.overview.entities} ${nouns.entities}, their ${nouns.documents}, the passages, the topics and the grouping tree, the lens${lens ? ` (${lens} — who is speaking)` : ''}, the position scale and the overall position mix, the facets (their commonest values; list_tags has every value), the vocabularies, the questions and the analysis tasks. Read this first: it explains how positions are framed and carries the standing caveats.`,
		...grouped(GROUP.orientation),
		input: z.object({}),
		output: z.object({
			name: z.string(),
			corpus: z.string().nullable(),
			url: z.string(),
			nouns: z.object({
				entity: z.string(),
				entities: z.string(),
				document: z.string(),
				documents: z.string(),
			}),
			sources: z.number().int(),
			documents: z.number().int(),
			passages: z.number().int(),
			keyPoints: z.number().int(),
			quotes: z.number().int(),
			topics: z.number().int(),
			junkTopicsExcluded: z.number().int(),
			generations: z.array(
				z.object({
					generation: z.number().int(),
					label: z.string(),
					labelPlural: z.string(),
					count: z.number().int(),
				}),
			),
			stances: z.number().int(),
			positionMix: z.record(z.string(), z.number().int()),
			contestingStances: z.number().int(),
			positionScale: z.object({
				order: z.array(z.string()),
				supportive: z.array(z.string()),
				contesting: z.array(z.string()),
				unclear: z.string().nullable(),
			}),
			lens: z
				.object({
					facet: z.string(),
					heading: z.string(),
					values: z.array(
						z.object({
							value: z.string().nullable(),
							label: z.string(),
							reading: z.string().nullable(),
							sources: z.number().int(),
						}),
					),
				})
				.nullable(),
			/** Every facet the sources carry, with its five commonest values; list_tags has them all. */
			facets: z.array(
				z.object({
					key: z.string(),
					heading: z.string(),
					values: z.number().int(),
					top: z.array(
						z.object({ value: z.string(), label: z.string(), sources: z.number().int() }),
					),
				}),
			),
			vocabularies: z.array(
				z.object({
					facet: z.string(),
					concepts: z.number().int(),
					subjectsTagged: z.number().int(),
				}),
			),
			questions: z.number().int(),
			tasks: z.array(z.object({ task_id: z.string(), title: z.string(), type: z.string() })),
			notes: z.array(z.string()),
		}),
		rest: { method: 'GET', path: '/overview' },
		handler: async (_input, ctx) => {
			const c = readContext(ctx)
			const w = words(ctx)
			const [overview, report, facets] = await Promise.all([
				x.overview(c.db, c.scope),
				pages.reportOverview(c.db, w, {}, c.scope),
				readerFacets(c.db, w),
			])
			const contesting = w.scale.contesting.reduce((a, p) => a + (report.positionMix[p] ?? 0), 0)
			const headingOf = new Map(facets.map((f) => [f.key, f.label]))
			return {
				name: w.title,
				corpus: w.standfirst,
				url: ctx.origin,
				nouns: w.nouns,
				sources: report.sources,
				documents: report.documents,
				passages: report.passages,
				keyPoints: report.keyPoints,
				quotes: report.quotes,
				topics: report.topics,
				junkTopicsExcluded: report.junkTopics,
				generations: report.generations,
				stances: report.stances,
				positionMix: report.positionMix,
				contestingStances: contesting,
				positionScale: w.scale,
				lens: w.lens
					? {
							facet: w.lens,
							heading: w.facets[w.lens]?.heading ?? w.lens,
							values: report.lensValues.map((v) => ({
								value: v.value,
								label: v.value === null ? 'Unclassified' : valueWord(w, w.lens ?? '', v.value),
								reading:
									v.value === null ? null : (w.facets[w.lens ?? '']?.descriptions[v.value] ?? null),
								sources: v.sources,
							})),
						}
					: null,
				facets: overview.facets
					.filter((f) => !internalFacet(f.facet))
					.map((f) => ({
						key: f.facet,
						heading: headingOf.get(f.facet) ?? cap(f.facet.replace(/_/g, ' ')),
						values: f.values.length,
						top: f.values.slice(0, 5).map((v) => ({
							value: v.value,
							label: valueWord(w, f.facet, v.value),
							sources: v.entities,
						})),
					})),
				vocabularies: overview.tagCategories.map((v) => ({
					facet: v.category,
					concepts: v.tags,
					subjectsTagged: v.documentsTagged,
				})),
				questions: overview.questions,
				tasks: Object.entries(w.tasks).map(([task_id, task]) => ({
					task_id,
					title: task.title,
					type: task.type,
				})),
				notes: [
					notPrevalence(w, report.sources),
					`Positions are relative to each topic's own proposition: they measure stance toward a framing, not absolute agreement.${w.scale.contesting.length ? ` ${contesting} of ${report.stances} stances push back (${w.scale.contesting.join(' / ')}); see contested_topics.` : ''}`,
					report.generations.length
						? `The grouping tree has ${report.generations.length} generation(s): ${report.generations.map((g) => `${g.count} ${g.labelPlural}`).join(' over ')} over ${report.topics} topics. Ids of every generation work with topics_in_supercluster.`
						: NO_TREE,
					...(ctx.host.notes ? [ctx.host.notes] : []),
				],
			}
		},
	})

	const search_passages = define({
		name: 'search_passages',
		summary: 'Passage search',
		description: `Search over the ${t.overview.chunks} verbatim passages of every ${nouns.document}: the most relevant passages with their ${nouns.document}, ${nouns.entity}${lens ? `, its ${lens}` : ''} and the topics each strongly belongs to. Narrow to one ${nouns.document}, one lens value, one value of any facet, or one topic. A passage is cut at ${PASSAGE_CHARS} characters; document_text has the whole.`,
		...grouped(GROUP.orientation),
		input: z
			.object({
				query: ex(z.string().describe('What you are after, in plain words'), t.examples.query),
				top_k: limitOf(50, 8),
				document_id: z.string().optional().describe('Only passages of this document'),
				lens_value: lensValueInput,
				...facetFilterInput,
				topic_id: z.coerce
					.number()
					.int()
					.optional()
					.describe(`Only passages strongly in this topic. ${TOPIC_ID}`),
			})
			.refine(bothOrNeither, BOTH_OR_NEITHER),
		output: z.object({
			query: z.string(),
			/** `semantic` when the host ranked by its vector index; `text` when the passages were matched by their words, unscored. */
			mode: z.enum(['semantic', 'text']),
			returned: z.number().int(),
			passages: z.array(passageSchema),
		}),
		rest: { method: 'GET', path: '/passages/search' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const filtered = !!(a.document_id || a.lens_value || a.facet || a.topic_id)
			const topK = Math.min(150, a.top_k * (filtered ? 5 : 1))
			const nearest = ctx.nearest ? [...(await ctx.nearest(a.query, topK))] : undefined
			const [ranked, kept] = await Promise.all([
				rankedPassages(c, a.query, topK, nearest),
				facetFilter(c, a),
			])
			const passages = (await passagesOf(c, ranked))
				.filter((p) => !a.document_id || p.document_id === a.document_id)
				.filter((p) => !a.lens_value || p.lensValue === a.lens_value)
				.filter((p) => !kept || kept.documents.has(p.document_id))
				.filter((p) => !a.topic_id || p.topics.some((tp) => tp.topic_id === a.topic_id))
				.slice(0, a.top_k)
				.map(passageOf)
			return { query: a.query, mode: searchMode(nearest), returned: passages.length, passages }
		},
	})

	const find_topics = define({
		name: 'find_topics',
		summary: 'Find topics',
		description: `Describe what you are after; returns the topics whose passages best match, ranked by relevance, each with its topic_id, ${nouns.entity} reach, position mix and lineage in the grouping tree. ${notPrevalence(t.words, t.overview.entities)}`,
		...grouped(GROUP.orientation),
		input: z.object({
			query: ex(z.string(), t.examples.query),
			limit: limitOf(40, 15),
		}),
		output: z.object({
			query: z.string(),
			mode: z.enum(['semantic', 'text']),
			returned: z.number().int(),
			topics: z.array(topicRowSchema),
		}),
		rest: { method: 'GET', path: '/topics/search' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const w = words(ctx)
			if (ctx.nearest) {
				const nearest = await ctx.nearest(a.query, 100)
				const hits = await pages.topicSearch(c.db, w, nearest, a.limit, c.scope)
				return {
					query: a.query,
					mode: searchMode(nearest),
					returned: hits.length,
					topics: hits.map((h) => topicRowOf(h, ctx.origin, w, { relevance: h.relevance })),
				}
			}
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
			const topics = land.topics
				.filter((tp) => ids.has(tp.topicClusterId))
				.slice(0, a.limit)
				.map((tp) => topicRowOf(tp, ctx.origin, w))
			return { query: a.query, mode: searchMode(undefined), returned: topics.length, topics }
		},
	})

	const list_topics = define({
		name: 'list_topics',
		summary: 'List all topics',
		description: `Every topic (${t.overview.clusters - t.overview.junkConfirmedClusters}), widest reach first, a page at a time: each with its topic_id, ${nouns.entity} and ${nouns.document} counts, position mix and lineage. Prefer find_topics when you know what you are looking for.`,
		...grouped(GROUP.orientation),
		input: z.object({ offset, limit: limitOf(PAGE_MAX, PAGE) }),
		output: z.object({ ...pageShape, topics: z.array(topicRowSchema) }),
		rest: { method: 'GET', path: '/topics' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const { land } = await profiles(c)
			const page = pageOf(land.topics, a.offset, a.limit)
			return {
				total: page.total,
				offset: page.offset,
				returned: page.returned,
				topics: page.rows.map((tp) => topicRowOf(tp, ctx.origin, words(ctx))),
			}
		},
	})

	const search = define({
		name: 'search',
		summary: 'Search (passages, for fetch)',
		description:
			'Passage search for a host that expects `search` and `fetch`: the most relevant passages as results whose ids `fetch` takes (a passage id fetches its document). search_passages is the fuller read.',
		...grouped(GROUP.orientation),
		input: z.object({ query: ex(z.string(), t.examples.query), limit: limitOf(25, 10) }),
		output: z.object({
			results: z.array(
				z.object({ id: z.string(), title: z.string(), url: z.string(), text: z.string() }),
			),
		}),
		rest: { method: 'GET', path: '/search' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const nearest = ctx.nearest ? [...(await ctx.nearest(a.query, a.limit))] : undefined
			const passages = await passagesOf(c, await rankedPassages(c, a.query, a.limit, nearest))
			return {
				results: passages.slice(0, a.limit).map((p) => ({
					id: p.passage_id,
					title: `${p.documentTitle} — ${p.source}`,
					url: p.source_id
						? documentUrl(ctx.origin, words(ctx), p.source_id, p.document_id)
						: ctx.origin,
					text: clip(p.text, PASSAGE_CHARS),
				})),
			}
		},
	})

	/* ── the grouping tree ── */

	const list_families = define({
		name: 'list_families',
		summary: 'List families (the root generation)',
		description: `The top-level FAMILIES — the root generation of the grouping tree — each with its topics, ${nouns.entity} reach and position mix. With one generation built, the families are the themes and list_superclusters returns the same nodes. ${notPrevalence(t.words, t.overview.entities)}`,
		...grouped(GROUP.tree),
		input: z.object({}),
		output: z.object({
			total: z.number().int(),
			families: z.array(groupRowSchema),
			note: z.string().nullable(),
		}),
		rest: { method: 'GET', path: '/families' },
		handler: async (_input, ctx) => {
			const c = readContext(ctx)
			const { land } = await profiles(c)
			if (!land.top) return { total: 0, families: [], note: NO_TREE }
			const families = land.groups
				.filter((g) => g.generation === land.top)
				.map((g) => groupRowOf(g, ctx.origin, words(ctx)))
			return { total: families.length, families, note: null }
		},
	})

	const list_superclusters = define({
		name: 'list_superclusters',
		summary: 'List themes (the generation below the roots)',
		description: `The named THEMES one generation below the families (with one generation built, the same nodes as list_families). Pass family_id to list only the themes under one family. ${notPrevalence(t.words, t.overview.entities)}`,
		...grouped(GROUP.tree),
		input: z.object({
			family_id: z.coerce.number().int().optional().describe('Only the themes under this family'),
		}),
		output: z.object({
			total: z.number().int(),
			superclusters: z.array(groupRowSchema),
			note: z.string().nullable(),
		}),
		rest: { method: 'GET', path: '/themes' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const { land } = await profiles(c)
			if (!land.top) return { total: 0, superclusters: [], note: NO_TREE }
			const generation = land.top > 1 ? land.top - 1 : land.top
			const superclusters = land.groups
				.filter((g) => g.generation === generation)
				.filter((g) => a.family_id === undefined || g.parentId === a.family_id)
				.map((g) => groupRowOf(g, ctx.origin, words(ctx)))
			return {
				total: superclusters.length,
				superclusters,
				note:
					land.top === 1
						? 'This run built ONE grouping generation: these themes sit directly on the topics, and list_families returns the same nodes.'
						: null,
			}
		},
	})

	const topics_in_supercluster = define({
		name: 'topics_in_supercluster',
		summary: 'Topics in a theme or family',
		description: `Every topic beneath a grouping node of ANY generation, a page at a time, each with ${nouns.entity} reach, position mix and its own lineage. ${notPrevalence(t.words, t.overview.entities)}`,
		...grouped(GROUP.tree),
		input: z.object({
			supercluster_id: ex(
				z.coerce.number().int().describe('A family, theme or group id — any generation'),
				t.examples.groupId,
			),
			offset,
			limit: limitOf(PAGE_MAX, PAGE),
		}),
		output: z.object({
			supercluster_id: z.number().int(),
			title: z.string().nullable(),
			...pageShape,
			topics: z.array(topicRowSchema),
		}),
		rest: { method: 'GET', path: '/groups/{supercluster_id}/topics' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const [{ land, byId }, h] = await Promise.all([profiles(c), x.hierarchy(c.db)])
			if (!land.top) throw new NotFound(NO_TREE)
			const tree = treeOf(h)
			const node = tree.byId.get(a.supercluster_id)
			if (!node || node.generation === 0)
				throw new NotFound(
					`No grouping node with id ${a.supercluster_id}. list_families and list_superclusters name them.`,
				)
			const under = tree
				.topicsUnder(a.supercluster_id)
				.flatMap((id) => {
					const tp = byId.get(id)
					return tp ? [tp] : []
				})
				.sort((p, q) => q.sources - p.sources || p.topicClusterId - q.topicClusterId)
			const page = pageOf(under, a.offset, a.limit)
			return {
				supercluster_id: a.supercluster_id,
				title: node.title,
				total: page.total,
				offset: page.offset,
				returned: page.returned,
				topics: page.rows.map((tp) => topicRowOf(tp, ctx.origin, words(ctx))),
			}
		},
	})

	/* ── a topic ── */

	const get_topic = define({
		name: 'get_topic',
		summary: 'Get a topic',
		description: `Full profile of one topic: its proposition and description, cross-cutting key findings with a quote or two each, lineage in the tree, ${nouns.entity} reach by membership tier, the position mix overall${lens ? ` and by ${lens}` : ''}, a contestation summary, and the first ${TOPIC_STANCES_SHOWN} ${nouns.entities} holding a stance with its framing (dissent first; source_perspectives pages them all). Positions are relative to THIS topic's own proposition. Also the resource report://topics/{topic_id} (Markdown). ${notPrevalence(t.words, t.overview.entities)}`,
		...grouped(GROUP.topics),
		input: z.object({ topic_id: ex(topicId, t.examples.topicId) }),
		output: topicOutputSchema,
		rest: { method: 'GET', path: '/topics/{topic_id}' },
		resource: {
			uri: 'report://topics/{topic_id}',
			mimeType: 'text/markdown',
			list: listing(list_topics, ({ topics }) =>
				topics.map((tp) => ({
					variables: { topic_id: String(tp.topic_id) },
					name: tp.title,
					description: `${tp.sources} ${nouns.entities} · ${tp.stances} stances`,
				})),
			),
			text: (out) => topicMarkdown(out, t.words),
		},
		handler: async (a, ctx) => topicOutput(ctx, a.topic_id),
	})

	const topic_quotes = define({
		name: 'topic_quotes',
		summary: 'Topic quotes',
		description: `Verbatim cross-cutting quotes for a topic, each attributed to the ${nouns.entity}${lens ? ` (with its ${lens})` : ''} that wrote it and the finding it supports.`,
		...grouped(GROUP.topics),
		input: z.object({ topic_id: ex(topicId, t.examples.topicId), limit: limitOf(60, 12) }),
		output: z.object({
			topic_id: z.number().int(),
			total: z.number().int(),
			returned: z.number().int(),
			quotes: z.array(quoteSchema.extend({ finding: z.string() })),
		}),
		rest: { method: 'GET', path: '/topics/{topic_id}/quotes' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const detail = await x.topicSynthesis(c.db, a.topic_id, c.scope)
			if (!detail) throw noTopic(a.topic_id)
			const lensOf = await lensValues(
				c,
				detail.keyPointItems.flatMap((kp) =>
					kp.quotes.flatMap((q) => (q.entityUuid ? [q.entityUuid] : [])),
				),
			)
			const slugs = await slugsOf(
				c.db,
				detail.keyPointItems.flatMap((kp) =>
					kp.quotes.flatMap((q) => (q.entityUuid ? [q.entityUuid] : [])),
				),
			)
			const all = detail.keyPointItems.flatMap((kp) =>
				kp.quotes.map((q) => ({
					...quoteOf({
						...q,
						entityId: q.entityUuid ? (slugs.get(q.entityUuid) ?? null) : null,
						lensValue: q.entityUuid ? (lensOf.get(q.entityUuid) ?? null) : null,
					}),
					finding: kp.keyPoint,
				})),
			)
			return {
				topic_id: a.topic_id,
				total: all.length,
				returned: Math.min(all.length, a.limit),
				quotes: all.slice(0, a.limit),
			}
		},
	})

	const topic_perspectives = define({
		name: 'topic_perspectives',
		summary: `Topic perspectives${lens ? ` (the ${lens} lens)` : ''}`,
		description: `How a topic is framed by each value of an analysed facet${lens ? ` (the lens: ${lens})` : ''} — a synthesised position with an analysis and up to two attributed quotes, dissent first. Values absent from the list wrote nothing the pipeline could place on this topic.`,
		...grouped(GROUP.topics),
		input: z.object({
			topic_id: ex(topicId, t.examples.topicId),
			facet: z.string().optional().describe('An analysed facet; the lens when absent'),
		}),
		output: z.object({
			topic_id: z.number().int(),
			facet: z.string().nullable(),
			perspectives: z.array(
				z.object({
					facet: z.string(),
					value: z.string(),
					label: z.string(),
					position: z.string(),
					analysis: z.string(),
					quotes: z.array(quoteSchema),
				}),
			),
		}),
		rest: { method: 'GET', path: '/topics/{topic_id}/perspectives' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const w = words(ctx)
			const detail = await x.topicSynthesis(c.db, a.topic_id, c.scope)
			if (!detail) throw noTopic(a.topic_id)
			const facet = a.facet ?? w.lens
			const dissent = dissentOf(w.scale)
			const rank = pages.lensRank(w)
			return {
				topic_id: a.topic_id,
				facet,
				perspectives: detail.facetPerspectives
					.filter((p) => !facet || p.facet === facet)
					.map((p) => ({
						facet: p.facet,
						value: p.facetValue,
						label: valueWord(w, p.facet, p.facetValue),
						position: p.position,
						analysis: clip(p.positionAnalysis, PASSAGE_CHARS),
						quotes: p.quotes.slice(0, 2).map((q) => quoteOf(q)),
					}))
					.sort(
						(p1, p2) =>
							dissent(p2.position) - dissent(p1.position) || rank(p1.value) - rank(p2.value),
					),
			}
		},
	})

	const source_perspectives = define({
		name: 'source_perspectives',
		summary: `${cap(nouns.entity)} perspectives on a topic`,
		description: `Every ${nouns.entity} that took a stance on a topic — its position, its framing and its OWN extracted points with a verbatim quote each. Slice by ${lens ?? 'lens value'} and/or position; every answer also returns \`available\`, the distribution across ALL stances on the topic, so you can see what there is to ask for. Dissent first, a page at a time; \`total\` / \`matching\` / \`returned\` say exactly what you are looking at.`,
		...grouped(GROUP.topics),
		input: z.object({
			topic_id: ex(topicId, t.examples.topicId),
			lens_value: lensValueInput,
			position: z.string().optional().describe('Only this position — see `available.positions`'),
			offset,
			limit: limitOf(50, 10),
		}),
		output: z.object({
			topic_id: z.number().int(),
			total: z.number().int(),
			matching: z.number().int(),
			offset: z.number().int(),
			returned: z.number().int(),
			filters: z.object({ lens_value: z.string().nullable(), position: z.string().nullable() }),
			available: z.object({
				lensValues: z.array(z.object({ value: z.string(), stances: z.number().int() })),
				positions: z.record(z.string(), z.number().int()),
			}),
			perspectives: z.array(
				stanceRowSchema.extend({
					summary: z.string(),
					/** Up to five of the source's own points on this topic, each with its first quote. */
					findings: z.array(z.object({ keyPoint: z.string(), quote: z.string().nullable() })),
					findingsTotal: z.number().int(),
					url: z.string(),
				}),
			),
			note: z.string(),
		}),
		rest: { method: 'GET', path: '/topics/{topic_id}/stances' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const w = words(ctx)
			const detail = await x.topicById(c.db, a.topic_id, c.scope)
			if (!detail) throw noTopic(a.topic_id)
			const dissent = dissentOf(w.scale)
			const all = detail.entityPerspectives.map((p) => ({
				...p,
				lensValue: lensValueOf(w, p.facets),
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
			const page = pageOf(matching, a.offset, a.limit)
			const further = matching.length - page.offset - page.returned
			return {
				topic_id: a.topic_id,
				total: all.length,
				matching: matching.length,
				offset: page.offset,
				returned: page.returned,
				filters: { lens_value: a.lens_value ?? null, position: a.position ?? null },
				available: {
					lensValues: [...tally((p) => p.lensValue ?? 'Unclassified')]
						.map(([value, stances]) => ({ value, stances }))
						.sort((p1, p2) => p2.stances - p1.stances),
					positions: Object.fromEntries(
						[...tally((p) => p.position)].sort((p1, p2) => dissent(p2[0]) - dissent(p1[0])),
					),
				},
				perspectives: page.rows.map((p) => ({
					source: p.entityName,
					source_id: p.entityId,
					lensValue: p.lensValue,
					position: p.position,
					framing: p.title,
					summary: clip(p.description, PASSAGE_CHARS),
					findings: p.keyPoints.slice(0, 5).map((k) => ({
						keyPoint: k.keyPoint,
						quote: k.quotes[0] === undefined ? null : clip(k.quotes[0], QUOTE_CHARS),
					})),
					findingsTotal: p.keyPoints.length,
					url: sourceUrl(ctx.origin, w, p.entityId),
					...(p.withheld ? { withheld: true } : {}),
					...(p.notice === undefined ? {} : { notice: p.notice }),
				})),
				note:
					notPrevalence(w, await sourceCount(c)) +
					(further > 0
						? ` Dissent first; ${further} further matching stances follow — raise \`offset\` or narrow (see \`available\`).`
						: '') +
					(matching.length === 0 && all.length > 0
						? ' No stance matches those filters on this topic — see `available`.'
						: ''),
			}
		},
	})

	const related_topics = define({
		name: 'related_topics',
		summary: 'Related topics',
		description: t.tree
			? 'Topics related to a topic — those sharing a nearest-generation group with it (strong edges), ranked by how many of those groups they share. Pass supercluster_ids to choose the basis yourself.'
			: `Topics whose ${nouns.entities} overlap a topic's, ranked by shared ${nouns.entities}.`,
		...grouped(GROUP.topics),
		input: z.object({
			topic_id: ex(topicId, t.examples.topicId),
			supercluster_ids: z
				.array(z.coerce.number().int())
				.optional()
				.describe('Use these groups as the basis instead of the topic’s own'),
			limit: limitOf(40, 10),
		}),
		output: z.object({
			topic_id: z.number().int(),
			/** The grouping nodes the relation was read through, or `shared sources` where the topic has no tree above it. */
			basis: z.union([z.literal('shared sources'), z.array(z.number().int())]),
			topics: z.array(topicRowSchema),
		}),
		rest: { method: 'GET', path: '/topics/{topic_id}/related' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const w = words(ctx)
			const [h, { byId }] = await Promise.all([x.hierarchy(c.db), profiles(c)])
			if (!byId.has(a.topic_id)) throw noTopic(a.topic_id)
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
				const related = await x.relatedTopics(c.db, a.topic_id, a.limit, c.scope)
				const sharedSources: 'shared sources' = 'shared sources'
				return {
					topic_id: a.topic_id,
					basis: sharedSources,
					topics: related.flatMap((r) => {
						const tp = byId.get(r.topicClusterId)
						return tp ? [topicRowOf(tp, ctx.origin, w, { sharedSources: r.sharedEntities })] : []
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
					const tp = topicOfNode.get(e.child)
					if (tp === undefined || tp === a.topic_id) continue
					shared.set(tp, (shared.get(tp) ?? 0) + 1)
				}
			return {
				topic_id: a.topic_id,
				basis,
				topics: [...shared]
					.flatMap(([id, n]) => {
						const tp = byId.get(id)
						return tp ? [topicRowOf(tp, ctx.origin, w, { sharedGroups: n })] : []
					})
					.sort(
						(t1, t2) => (t2.sharedGroups ?? 0) - (t1.sharedGroups ?? 0) || t2.sources - t1.sources,
					)
					.slice(0, a.limit),
			}
		},
	})

	const contested_topics = define({
		name: 'contested_topics',
		summary: `Contested topics${lens ? ` (${lens} divergence)` : ''}`,
		description: `The record's disagreements: topics where some stances push back on the topic's proposition (${t.words.scale.contesting.join(' / ')}) while others support it, ranked by contesting stances. Each names up to five dissenting ${nouns.entities}${lens ? `, their ${lens}` : ''} and their framing (source_perspectives has them all). Set cross_lens_only for the sharpest cases: a contesting ${lens ?? 'lens value'} absent from the supporters. ${notPrevalence(t.words, t.overview.entities)}`,
		...grouped(GROUP.topics),
		input: z.object({
			limit: limitOf(50, 10),
			min_contesting: z.coerce
				.number()
				.int()
				.min(1)
				.default(1)
				.describe('At least this many contesting stances'),
			cross_lens_only: z
				.boolean()
				.optional()
				.describe('Only topics where a contesting lens value is absent from the supporting ones'),
		}),
		output: z.object({
			total: z.number().int(),
			returned: z.number().int(),
			topics: z.array(
				z.object({
					topic_id: z.number().int(),
					title: z.string(),
					url: z.string(),
					lineage: topicRowSchema.shape.lineage,
					supportingStances: z.number().int(),
					contestingStances: z.number().int(),
					unclearStances: z.number().int(),
					distinctLensValues: z.number().int(),
					crossLens: z.boolean(),
					supportingLensValues: z.array(z.string()),
					contestingLensValues: z.array(z.string()),
					/** Up to five contesters, dissent first. */
					contesters: z.array(stanceRowSchema),
					contestersTruncated: z.number().int(),
					/** The lens values whose synthesised perspective on this topic contests or is unclear. */
					lensDivergence: z.array(z.object({ value: z.string(), position: z.string() })),
				}),
			),
		}),
		rest: { method: 'GET', path: '/contested' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const w = words(ctx)
			const scale = w.scale
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
				w.lens
					? c.db
							.select({
								topicClusterId: s.clusterKeyPerspective.topicClusterId,
								value: s.clusterKeyPerspective.facetValue,
								position: s.clusterKeyPerspective.position,
							})
							.from(s.clusterKeyPerspective)
							.where(eq(s.clusterKeyPerspective.facet, w.lens))
					: Promise.resolve([]),
			])
			const dissent = dissentOf(scale)
			const byTopic = new Map<number, ((typeof rows)[number] & { lensValue: string })[]>()
			for (const r of rows)
				byTopic.set(r.topicClusterId, [
					...(byTopic.get(r.topicClusterId) ?? []),
					{ ...r, lensValue: lensValueOf(w, entityFacets.get(r.entityUuid)) ?? 'Unclassified' },
				])
			const out = []
			for (const [id, stances] of byTopic) {
				const contesters = stances.filter((p) => scale.contesting.includes(p.position))
				const supporters = stances.filter((p) => scale.supportive.includes(p.position))
				if (contesters.length < a.min_contesting || !supporters.length) continue
				const supporting = [...new Set(supporters.map((p) => p.lensValue))]
				const contestingValues = [...new Set(contesters.map((p) => p.lensValue))]
				const crossLens = contestingValues.some((v) => !supporting.includes(v))
				if (a.cross_lens_only && !crossLens) continue
				const topic = byId.get(id)
				const sorted = contesters
					.map((p) => ({
						source: p.entityName,
						source_id: p.entityId,
						lensValue: p.lensValue,
						position: p.position,
						framing: textOf(c.scope, p.entityUuid, p.title),
						...wordsOf(c.scope, p.entityUuid),
					}))
					.sort((p1, p2) => dissent(p2.position) - dissent(p1.position))
				out.push({
					topic_id: id,
					title: topic?.title ?? '',
					url: topicUrl(ctx.origin, w, id),
					lineage: topic?.lineage ?? [],
					supportingStances: supporters.length,
					contestingStances: contesters.length,
					unclearStances: stances.filter((p) => p.position === scale.unclear).length,
					distinctLensValues: new Set(stances.map((p) => p.lensValue)).size,
					crossLens,
					supportingLensValues: supporting,
					contestingLensValues: contestingValues,
					contesters: sorted.slice(0, 5),
					contestersTruncated: Math.max(0, sorted.length - 5),
					lensDivergence: lensRows
						.filter(
							(l) =>
								l.topicClusterId === id &&
								(scale.contesting.includes(l.position) || l.position === scale.unclear),
						)
						.map((l) => ({ value: l.value, position: l.position })),
				})
			}
			const ranked = out.sort(
				(t1, t2) =>
					t2.contestingStances - t1.contestingStances ||
					t2.contestingLensValues.length - t1.contestingLensValues.length ||
					t2.supportingStances - t1.supportingStances,
			)
			return {
				total: ranked.length,
				returned: Math.min(ranked.length, a.limit),
				topics: ranked.slice(0, a.limit),
			}
		},
	})

	/* ── who ── */

	const lens_profile = define({
		name: 'lens_profile',
		summary: `Profile ${withArticle(lens ?? 'lens value')}`,
		description: `Everything one ${lens} value does across the record: which ${nouns.entities} it holds (the first 40), its position mix and how often it contests, the topics it engages most, and the topics it DOMINATES (60% or more of all stances on them) — where one ${lens} speaks effectively unopposed. ${notPrevalence(t.words, t.overview.entities)}`,
		...grouped(GROUP.topics),
		input: z.object({
			lens_value: ex(
				z.string().describe('One value of the run’s lens (see corpus_overview `lens.values`)'),
				t.lensValues[0],
			),
		}),
		output: z.object({
			lens: z.string(),
			value: z.string(),
			label: z.string(),
			reading: z.string().nullable(),
			sources: z.number().int(),
			documents: z.number().int(),
			stances: z.number().int(),
			positionMix: z.record(z.string(), z.number().int()),
			contestingStances: z.number().int(),
			members: z.array(z.object({ source: z.string(), source_id: z.string() })),
			membersTruncated: z.number().int(),
			topTopics: z.array(
				z.object({
					topic_id: z.number().int(),
					title: z.string(),
					stances: z.number().int(),
					shareOfTopic: z.number(),
				}),
			),
			dominatedTopics: z.array(
				z.object({
					topic_id: z.number().int(),
					title: z.string(),
					stances: z.number().int(),
					shareOfTopic: z.number(),
				}),
			),
			note: z.string(),
		}),
		rest: { method: 'GET', path: '/lens/{lens_value}' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const w = words(ctx)
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
				(e) => lensValueOf(w, entityFacets.get(e.entityUuid)) === a.lens_value,
			)
			if (!members.length)
				throw new NotFound(
					`No ${nouns.entity} with ${lensKey(w)} "${a.lens_value}". corpus_overview lists the lens's values.`,
				)
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
			const key = lensKey(w)
			const named = members
				.map((e) => ({ source: e.entityName, source_id: e.entityId }))
				.sort((e1, e2) => e1.source.localeCompare(e2.source))
			return {
				lens: key,
				value: a.lens_value,
				label: valueWord(w, key, a.lens_value),
				reading: w.facets[key]?.descriptions[a.lens_value] ?? null,
				sources: members.length,
				documents: members.reduce((n, e) => n + e.documents, 0),
				stances: mine.length,
				positionMix: mix,
				contestingStances: mine.filter((p) => w.scale.contesting.includes(p.position)).length,
				members: named.slice(0, PAGE),
				membersTruncated: Math.max(0, named.length - PAGE),
				topTopics: [...onTopic]
					.sort((t1, t2) => t2[1] - t1[1])
					.slice(0, 12)
					.map(row),
				dominatedTopics: [...onTopic]
					.filter(([id, n]) => (totalOn.get(id) ?? n) >= 2 && n / (totalOn.get(id) ?? n) >= 0.6)
					.sort((t1, t2) => t2[1] - t1[1])
					.slice(0, 12)
					.map(row),
				note: notPrevalence(w, entities.length),
			}
		},
	})

	const list_sources = define({
		name: 'list_sources',
		summary: `List ${nouns.entities}`,
		description: `The ${t.overview.entities} ${nouns.entities} behind the ${nouns.documents}, a page at a time: each with its stable id (source_id, for get_source), its facets, its ${nouns.document} count, how many stances it holds and how many topics it strongly represents. Filter by ${lens ?? 'lens value'}, by a value of any facet, or by a fragment of the name. ${notPrevalence(t.words, t.overview.entities)}`,
		...grouped(GROUP.topics),
		input: z
			.object({
				lens_value: lensValueInput,
				...facetFilterInput,
				query: z.string().optional().describe('A fragment of the name or id'),
				offset,
				limit: limitOf(200, 25),
			})
			.refine(bothOrNeither, BOTH_OR_NEITHER),
		output: z.object({
			...pageShape,
			sources: z.array(
				z.object({
					source: z.string(),
					source_id: z.string(),
					lensValue: z.string().nullable(),
					facets: z.record(z.string(), z.array(z.string())),
					documents: z.number().int(),
					stances: z.number().int(),
					strongTopics: z.number().int(),
					url: z.string(),
				}),
			),
		}),
		rest: { method: 'GET', path: '/sources' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const w = words(ctx)
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
			const matched = entities
				.map((e) => ({ e, lens: lensValueOf(w, e.facets) }))
				.filter(({ lens: value }) => !a.lens_value || value === a.lens_value)
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
				.sort((e1, e2) => e1.e.entityName.localeCompare(e2.e.entityName))
			const page = pageOf(matched, a.offset, a.limit)
			return {
				total: page.total,
				offset: page.offset,
				returned: page.returned,
				sources: page.rows.map(({ e, lens: value }) => ({
					source: e.entityName,
					source_id: e.entityId,
					lensValue: value,
					facets: readerFacetValues(e.facets),
					documents: e.documents,
					stances: stancesOf.get(e.entityUuid) ?? 0,
					strongTopics: reachOf.get(e.entityUuid) ?? 0,
					url: sourceUrl(ctx.origin, w, e.entityId),
				})),
			}
		},
	})

	const get_source = define({
		name: 'get_source',
		summary: `Profile ${withArticle(nouns.entity)}`,
		description: `Profile of one ${nouns.entity} — by its source_id, its uuid or a fragment of its name: its facets, its ${nouns.documents} (the first ${SOURCE_DOCUMENTS_SHOWN}), and the topics it is strongly linked to with its position and framing there (dissent first, the first ${SOURCE_TOPICS_SHOWN}). Also the resource report://sources/{source} (Markdown).`,
		...grouped(GROUP.topics),
		input: z.object({
			source: ex(
				z.string().describe('A source_id, uuid or a fragment of the name'),
				t.examples.sourceId,
			),
		}),
		output: sourceOutputSchema,
		rest: { method: 'GET', path: '/sources/{source}' },
		resource: {
			uri: 'report://sources/{source}',
			mimeType: 'text/markdown',
			list: listing(list_sources, ({ sources }) =>
				sources.map((e) => ({
					variables: { source: e.source_id },
					name: e.source,
					description: `${e.documents} ${e.documents === 1 ? nouns.document : nouns.documents} · ${e.stances} stances`,
				})),
			),
			text: (out) => sourceMarkdown(out, t.words),
		},
		handler: async (a, ctx) => sourceOutput(ctx, a.source),
	})

	/* ── documents ── */

	const find_documents = define({
		name: 'find_documents',
		summary: `Find ${nouns.documents}`,
		description: `Search the ${nouns.documents} by words in their title, file name or the ${nouns.entity}'s name; each with its document_id (for get_document), its facets and whether the pipeline could analyse it.`,
		...grouped(GROUP.topics),
		input: z.object({ query: ex(z.string(), t.examples.query), limit: limitOf(50, 20) }),
		output: z.object({
			query: z.string(),
			returned: z.number().int(),
			documents: z.array(
				z.object({
					document_id: z.string(),
					title: z.string(),
					source: z.string(),
					source_id: z.string().nullable(),
					facets: z.record(z.string(), z.array(z.string())),
					analysed: z.boolean(),
					url: z.string(),
				}),
			),
		}),
		rest: { method: 'GET', path: '/documents/search' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const w = words(ctx)
			const [found, documentFacets, analysed, { ownerOf }] = await Promise.all([
				x.findDocuments(c.db, a.query, a.limit, c.scope),
				loadFacetCache(c.db, 'document'),
				c.db
					.selectDistinct({ documentId: s.publishedKeyPoint.documentId })
					.from(s.publishedKeyPoint),
				documentOwners(c),
			])
			const done = new Set(analysed.map((d) => d.documentId))
			const slugs = await slugsOf(
				c.db,
				found.flatMap((d) => {
					const owner = ownerOf.get(d.documentId)
					return owner ? [owner] : []
				}),
			)
			return {
				query: a.query,
				returned: found.length,
				documents: found.map((d) => {
					const owner = ownerOf.get(d.documentId)
					const slug = owner ? (slugs.get(owner) ?? null) : null
					return {
						document_id: d.documentId,
						title: d.title ?? d.fileName,
						source: d.entityName,
						source_id: slug,
						facets: readerFacetValues(documentFacets.get(d.documentId)),
						analysed: done.has(d.documentId),
						url: slug ? documentUrl(ctx.origin, w, slug, d.documentId) : ctx.origin,
					}
				}),
			}
		},
	})

	const get_document = define({
		name: 'get_document',
		summary: `Get ${withArticle(nouns.document)}`,
		description: `Full analysis of one ${nouns.document} by document_id (or a source_id, which returns its first ${nouns.document}): its facets, the first ${DOCUMENT_KEY_POINTS_SHOWN} key points with their verified quotes, tags, question answers, findings, metrics, the topics its passages fell into and the opening of its text (with include_text, up to ${(TEXT_CHARS_MAX / 1000).toFixed(0)}k characters; document_text pages the whole). Also the resource report://documents/{document_id} (Markdown).`,
		...grouped(GROUP.topics),
		input: z.object({
			document_id: ex(z.string(), t.examples.documentId),
			include_text: z
				.boolean()
				.optional()
				.describe(`The extracted text, up to ${TEXT_CHARS_MAX} characters`),
		}),
		output: documentOutputSchema,
		rest: { method: 'GET', path: '/documents/{document_id}' },
		resource: {
			uri: 'report://documents/{document_id}',
			mimeType: 'text/markdown',
			text: (out) => documentMarkdown(out, t.words),
		},
		handler: async (a, ctx) => documentOutput(ctx, a.document_id, a.include_text === true),
	})

	const document_text = define({
		name: 'document_text',
		summary: `${cap(withArticle(nouns.document))}'s text, a page of passages at a time`,
		description: `The extracted text of one ${nouns.document}, as its passages in order, a page at a time (the resource report://documents/{document_id}/text reads the first page). A passage id is what search_passages returns. ${cap(withArticle(nouns.entity))} whose passages are not served reads a notice and no text.`,
		...grouped(GROUP.topics),
		input: z.object({
			document_id: ex(z.string(), t.examples.documentId),
			offset,
			limit: limitOf(PAGE_MAX, 10),
		}),
		output: z.object({
			document_id: z.string(),
			title: z.string(),
			source: z.string(),
			...pageShape,
			passages: z.array(
				z.object({ passage_id: z.string(), index: z.number().int(), text: z.string() }),
			),
			notice: z.string().nullable(),
		}),
		rest: { method: 'GET', path: '/documents/{document_id}/text' },
		tool: false,
		resource: { uri: 'report://documents/{document_id}/text', mimeType: 'application/json' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const [summary] = await x.documents(c.db, c.scope, a.document_id)
			if (!summary)
				throw new NotFound(`No ${nouns.document} ${a.document_id}. find_documents names them.`)
			const owner = summary.entityUuid
			const served = passagesServed(c.scope, owner)
			const scoped = wordsOf(c.scope, owner)
			const rows =
				served && !scoped.withheld
					? await c.db
							.select({
								id: s.publishedChunk.id,
								index: s.publishedChunk.chunkIndex,
								text: s.publishedChunk.text,
							})
							.from(s.publishedChunk)
							.where(eq(s.publishedChunk.documentId, a.document_id))
							.orderBy(asc(s.publishedChunk.chunkIndex))
							.offset(a.offset)
							.limit(a.limit)
					: []
			const total = await c.db.$count(
				s.publishedChunk,
				eq(s.publishedChunk.documentId, a.document_id),
			)
			return {
				document_id: a.document_id,
				title: summary.title ?? summary.fileName,
				source: summary.entityName,
				total,
				offset: a.offset,
				returned: rows.length,
				passages: rows.map((r) => ({ passage_id: r.id, index: r.index, text: r.text })),
				notice: scoped.withheld
					? (scoped.notice ?? null)
					: served
						? (scoped.notice ?? null)
						: (c.scope?.unserved?.notice ?? null),
			}
		},
	})

	const fetch = define({
		name: 'fetch',
		summary: 'Fetch (a search result in full)',
		description: `A full record by id from search results: a document_id or a passage id returns the ${nouns.document}'s analysis as Markdown (its key points and quotes, answers, findings, tags and the opening of its text).`,
		...grouped(GROUP.orientation),
		input: z.object({ id: ex(z.string(), t.examples.documentId) }),
		output: z.object({
			id: z.string(),
			title: z.string(),
			text: z.string(),
			url: z.string(),
			metadata: z.object({
				kind: z.literal('document'),
				document_id: z.string(),
				source: z.string(),
				source_id: z.string(),
				facets: z.record(z.string(), z.array(z.string())),
			}),
		}),
		rest: { method: 'GET', path: '/fetch' },
		handler: async ({ id }, ctx) => {
			const c = readContext(ctx)
			const direct = await x.documentById(c.db, id, c.scope)
			const documentId = direct ? id : id.slice(0, id.lastIndexOf('_'))
			const out = await documentOutput(ctx, documentId || id, false, 12_000)
			const kind: 'document' = 'document'
			return {
				id,
				title: out.title,
				text: documentMarkdown(out, words(ctx)),
				url: out.url,
				metadata: {
					kind,
					document_id: out.document_id,
					source: out.source,
					source_id: out.source_id,
					facets: out.facets,
				},
			}
		},
	})

	/* ── facets & vocabularies ── */

	const list_tags = define({
		name: 'list_tags',
		summary: 'List values of a facet',
		description: `One facet of the record with its ${nouns.entity} count per value — ${t.facets.map((f) => f.label).join(', ')}. ${cap(withArticle(nouns.document))} facet counts the ${nouns.entities} who wrote those ${nouns.documents}. ${notPrevalence(t.words, t.overview.entities)}`,
		...grouped(GROUP.facets),
		input: z.object({
			category: ex(
				z.string().describe('A facet, by key or heading (see the description)'),
				t.facets[0]?.label,
			),
			offset,
			limit: limitOf(500, PAGE_MAX),
		}),
		output: z.object({
			category: z.string(),
			facet: z.string(),
			...pageShape,
			tags: z.array(z.object({ tag: z.string(), label: z.string(), sources: z.number().int() })),
			note: z.string(),
		}),
		rest: { method: 'GET', path: '/facets/{category}' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const w = words(ctx)
			const facets = await readerFacets(c.db, w)
			const facet = facets.find(
				(f) => f.key === a.category || f.label.toLowerCase() === a.category.toLowerCase(),
			)
			if (!facet)
				throw new NotFound(
					`No facet "${a.category}" — one of ${facets.map((f) => f.label).join(', ')}`,
				)
			const held = new Map<string, Set<string>>()
			for (const r of await facetHolders(c, facet.key))
				held.set(r.value, (held.get(r.value) ?? new Set()).add(r.entityUuid))
			const tags = [...held]
				.map(([tag, who]) => ({ tag, label: valueWord(w, facet.key, tag), sources: who.size }))
				.sort((t1, t2) => t2.sources - t1.sources || t1.tag.localeCompare(t2.tag))
			const page = pageOf(tags, a.offset, a.limit)
			return {
				category: facet.label,
				facet: facet.key,
				total: page.total,
				offset: page.offset,
				returned: page.returned,
				tags: page.rows,
				note: notPrevalence(w, await sourceCount(c)),
			}
		},
	})

	const tag_pivot = define({
		name: 'tag_pivot',
		summary: 'Facet pivot',
		description: `The analyst's pivot table: ${nouns.entity} counts per value of one facet, optionally cross-tabbed by another (by = ${t.facets.map((f) => f.key).join(' | ')}), and filterable to one lens value, one value, or one grouping node (the ${nouns.entities} strongly linked to a topic beneath it). ${notPrevalence(t.words, t.overview.entities)}`,
		...grouped(GROUP.facets),
		input: z.object({
			category: ex(
				z.string().describe('The facet counted, by key or heading'),
				t.facets[1]?.label ?? t.facets[0]?.label,
			),
			by: ex(
				z.string().optional().describe('The cross-tab facet, by key or heading'),
				t.words.lens,
			),
			lens_value: lensValueInput,
			tag: z.string().optional().describe('Only this value of the counted facet'),
			group_id: z.coerce
				.number()
				.int()
				.optional()
				.describe('Only sources beneath this family, theme or group'),
			limit: limitOf(500, PAGE_MAX),
		}),
		output: z.object({
			category: z.string(),
			facet: z.string(),
			by: z.string().nullable(),
			total: z.number().int(),
			returned: z.number().int(),
			rows: z.array(
				z.object({
					tag: z.string(),
					label: z.string(),
					sources: z.number().int(),
					/** With `by`: the sources per value of the cross-tab facet, largest first. */
					byValue: z.record(z.string(), z.number().int()).nullable(),
				}),
			),
			note: z.string(),
		}),
		rest: { method: 'GET', path: '/pivot' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const w = words(ctx)
			const facets = await readerFacets(c.db, w)
			const find = (name: string) =>
				facets.find((f) => f.key === name || f.label.toLowerCase() === name.toLowerCase())
			const facet = find(a.category)
			if (!facet)
				throw new NotFound(
					`No facet "${a.category}" — one of ${facets.map((f) => f.label).join(', ')}`,
				)
			const by = a.by ? find(a.by) : undefined
			if (a.by && !by)
				throw new NotFound(
					`No cross-tab facet "${a.by}" — one of ${facets.map((f) => f.key).join(', ')}`,
				)
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
				if (a.lens_value && lensValueOf(w, entityFacets.get(p.entityUuid)) !== a.lens_value)
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
			const all = [...rows]
				.map(([tag, row]) => ({
					tag,
					label: valueWord(w, facet.key, tag),
					sources: row.who.size,
					byValue: by
						? Object.fromEntries(
								[...row.byAxis]
									.map(([v, who]): [string, number] => [valueWord(w, by.key, v), who.size])
									.sort((v1, v2) => v2[1] - v1[1]),
							)
						: null,
				}))
				.sort((r1, r2) => r2.sources - r1.sources || r1.tag.localeCompare(r2.tag))
			return {
				category: facet.label,
				facet: facet.key,
				by: by?.key ?? null,
				total: all.length,
				returned: Math.min(all.length, a.limit),
				rows: all.slice(0, a.limit),
				note: notPrevalence(w, await sourceCount(c)),
			}
		},
	})

	const conceptRow = z.object({
		tagId: z.number().int(),
		externalId: z.string(),
		notation: z.string().nullable(),
		path: z.string(),
		name: z.string(),
		level: z.number().int(),
		parentPath: z.string().nullable(),
		/** Subjects (sources or documents, by the facet's granularity) carrying the concept, descendants included. */
		subjects: z.number().int(),
		primary: z.number().int(),
		relevance: z.record(z.string(), z.number().int()),
	})

	const list_vocabularies = define({
		name: 'list_vocabularies',
		summary: 'Vocabularies',
		description: `Every vocabulary-backed facet (${vocabularies.join(', ')}) with its scheme, its levels, how many concepts it holds and its ten most-carried top-level concepts; pass facet for one vocabulary's whole concept tree, a page at a time, with the stable external id and notation each concept carries in its source scheme and how many ${nouns.entities} or ${nouns.documents} carry each concept, ancestors included.`,
		...grouped(GROUP.facets),
		input: z.object({
			facet: ex(z.string().optional(), vocabularies[0]),
			offset,
			limit: limitOf(PAGE_MAX, 50),
		}),
		output: z.object({
			vocabularies: z.array(
				z.object({
					facet: z.string(),
					vocabulary: z
						.object({ key: z.string(), version: z.string(), title: z.string() })
						.nullable(),
					granularity: z.enum(['entity', 'document']),
					hierarchical: z.boolean(),
					levels: z.array(z.string()),
					concepts: z.number().int(),
					/** The scheme's top-level concepts, most carried first (the first ten). */
					top: z.array(conceptRow),
				}),
			),
			/** With `facet`: that vocabulary's concepts in path order, a page at a time. */
			concepts: z.object({ facet: z.string(), ...pageShape, rows: z.array(conceptRow) }).nullable(),
		}),
		rest: { method: 'GET', path: '/vocabularies' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const all = await x.vocabularySummary(c.db, {}, c.scope)
			const rowOf = (tag: (typeof all)[number]['tags'][number]) => ({
				tagId: tag.tagId,
				externalId: tag.externalId,
				notation: tag.notation,
				path: tag.path,
				name: tag.name,
				level: tag.level,
				parentPath: tag.parentPath,
				subjects: tag.documents,
				primary: tag.primaryDocuments,
				relevance: tag.relevance,
			})
			const one = a.facet ? all.find((v) => v.category === a.facet) : undefined
			if (a.facet && !one)
				throw new NotFound(
					`No vocabulary facet "${a.facet}" — one of ${all.map((v) => v.category).join(', ')}`,
				)
			const page = one ? pageOf(one.tags, a.offset, a.limit) : null
			return {
				// asked for one vocabulary, its summary alone stands beside its page
				vocabularies: (one ? [one] : all).map((v) => ({
					facet: v.category,
					vocabulary: v.vocabulary,
					granularity: v.granularity,
					hierarchical: v.hierarchical,
					levels: v.levelNames,
					concepts: v.tags.length,
					top: v.tags
						.filter((tag) => tag.level === 1)
						.sort((t1, t2) => t2.documents - t1.documents || t1.path.localeCompare(t2.path))
						.slice(0, 10)
						.map(rowOf),
				})),
				concepts:
					one && page
						? {
								facet: one.category,
								total: page.total,
								offset: page.offset,
								returned: page.returned,
								rows: page.rows.map(rowOf),
							}
						: null,
			}
		},
	})

	const get_concept = define({
		name: 'get_concept',
		summary: 'Get a concept',
		description:
			"One concept of a vocabulary facet by path (levels joined by ' › '), external id or notation: its labels (preferred, alternate), definitions, broader / narrower / related concepts and its matches into other schemes.",
		...grouped(GROUP.facets),
		input: z.object({ facet: ex(z.string(), vocabularies[0]), concept: z.string() }),
		output: conceptDetailSchema,
		rest: { method: 'GET', path: '/concept' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const found = await x.conceptDetail(c.db, a.facet, a.concept)
			if (!found)
				throw new NotFound(
					`No concept ${a.concept} in ${a.facet}. list_vocabularies lists the concepts.`,
				)
			return found
		},
	})

	const subjectsFor =
		(kind: 'entity' | 'document') =>
		async (
			a: { concept: string; facet?: string; offset: number; limit: number },
			ctx: ReportCtx,
		) => {
			const c = readContext(ctx)
			const rows = (await x.subjectsForConcept(c.db, a.concept, a.facet ?? null, c.scope)).filter(
				(r) => r.subjectType === kind,
			)
			const page = pageOf(rows, a.offset, a.limit)
			return {
				concept: a.concept,
				facet: a.facet ?? null,
				total: page.total,
				offset: page.offset,
				returned: page.returned,
				rows: page.rows,
			}
		}

	const entities_for_concept = define({
		name: 'entities_for_concept',
		summary: `${cap(nouns.entities)} for a concept`,
		description: `The ${nouns.entities} whose facet carries a concept directly or through a descendant (marked derived), by path, external id or notation, a page at a time. Ids round-trip to get_source.`,
		...grouped(GROUP.facets),
		input: z.object({
			concept: z.string(),
			facet: ex(z.string().optional(), vocabularies[0]),
			offset,
			limit: limitOf(PAGE_MAX, 25),
		}),
		output: z.object({
			concept: z.string(),
			facet: z.string().nullable(),
			...pageShape,
			rows: z.array(tagDocumentSchema),
		}),
		rest: { method: 'GET', path: '/concept/sources' },
		handler: subjectsFor('entity'),
	})

	const documents_for_concept = define({
		name: 'documents_for_concept',
		summary: `${cap(nouns.documents)} for a concept`,
		description: `The ${nouns.documents} tagged with a concept directly or through a descendant (marked derived), with relevance, primary flag and the evidencing context where a model assigned it, a page at a time. Ids round-trip to get_document.`,
		...grouped(GROUP.facets),
		input: z.object({
			concept: z.string(),
			facet: ex(z.string().optional(), vocabularies[0]),
			offset,
			limit: limitOf(PAGE_MAX, 25),
		}),
		output: z.object({
			concept: z.string(),
			facet: z.string().nullable(),
			...pageShape,
			rows: z.array(tagDocumentSchema),
		}),
		rest: { method: 'GET', path: '/concept/documents' },
		handler: subjectsFor('document'),
	})

	/* ── custom analysis ── */

	const list_questions = define({
		name: 'list_questions',
		summary: 'Questions put to every document',
		description: `The ${t.overview.questions} questions the run put to every ${nouns.document}, by task, each with how many ${nouns.documents} and ${nouns.entities} answered it. An answer was recorded only where one was located in the text: an unanswered question is absence of evidence, not a view. Use a question's key or clause with question_answers. ${notPrevalence(t.words, t.overview.entities)}`,
		...grouped(GROUP.analysis),
		input: z.object({
			task_id: z.string().optional().describe('Only this question task’s questions'),
		}),
		output: z.object({
			total: z.number().int(),
			questions: z.array(
				z.object({
					task: z.string(),
					task_id: z.string(),
					key: z.string(),
					clause: z.string(),
					text: z.string(),
					documentsPutTo: z.number().int(),
					documentsAnswering: z.number().int(),
					sourcesAnswering: z.number().int(),
				}),
			),
		}),
		rest: { method: 'GET', path: '/questions' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const w = words(ctx)
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
			const listed = questions.map((q) => {
				const mine = rows.filter((r) => r.questionId === q.questionId && ownerOf.has(r.documentId))
				const answered = mine.filter((r) => r.addressed === 1)
				return {
					task: w.tasks[q.taskId]?.title ?? q.taskId,
					task_id: q.taskId,
					key: q.questionKey,
					clause: questionClause(q.questionKey, q.questionText),
					text: q.questionText,
					documentsPutTo: mine.length,
					documentsAnswering: answered.length,
					sourcesAnswering: new Set(answered.map((r) => ownerOf.get(r.documentId))).size,
				}
			})
			return { total: listed.length, questions: listed }
		},
	})

	const question_answers = define({
		name: 'question_answers',
		summary: 'Answers to one question',
		description: `Every answer to one question — the ${nouns.entity}${lens ? `, its ${lens}` : ''}, the ${nouns.document}, the position it took and up to three key points with a verbatim quote each — a page at a time, sliceable by lens value. Returns \`available\`, the lens distribution of all answers. ${notPrevalence(t.words, t.overview.entities)}`,
		...grouped(GROUP.analysis),
		input: z.object({
			question: ex(
				z.string().describe('The question key, or its clause ("a", "(a)")'),
				t.examples.questionKey,
			),
			task_id: z.string().optional().describe('The question task, when several use the same keys'),
			lens_value: lensValueInput,
			offset,
			limit: limitOf(PAGE_MAX, 12),
		}),
		output: z.object({
			task: z.string(),
			key: z.string(),
			clause: z.string(),
			text: z.string(),
			total: z.number().int(),
			matching: z.number().int(),
			offset: z.number().int(),
			returned: z.number().int(),
			available: z.object({
				lensValues: z.array(z.object({ value: z.string(), answers: z.number().int() })),
			}),
			answers: z.array(
				z.object({
					source: z.string(),
					source_id: z.string(),
					lensValue: z.string().nullable(),
					document_id: z.string(),
					position: z.string(),
					keyPoints: z.array(
						z.object({ keyPoint: z.string(), details: z.string(), quote: z.string().nullable() }),
					),
					keyPointsTotal: z.number().int(),
					url: z.string(),
					withheld: z.boolean().optional(),
					notice: z.string().optional(),
				}),
			),
			note: z.string(),
		}),
		rest: { method: 'GET', path: '/questions/{question}' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const w = words(ctx)
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
				throw new NotFound(
					`No question "${a.question}" — one of ${questions.map((row) => row.questionKey).join(', ')}`,
				)
			const detail = await pages.questionDetail(c.db, w, q.questionId, c.scope)
			if (!detail) throw new NotFound(`No question "${a.question}"`)
			const all = detail.byLensValue.flatMap((v) => v.answers)
			const matching = all.filter((r) => !a.lens_value || r.lensValue === a.lens_value)
			const page = pageOf(matching, a.offset, a.limit)
			const further = matching.length - page.offset - page.returned
			return {
				task: w.tasks[q.taskId]?.title ?? q.taskId,
				key: q.questionKey,
				clause: detail.question.clause,
				text: q.questionText,
				total: all.length,
				matching: matching.length,
				offset: page.offset,
				returned: page.returned,
				available: {
					lensValues: detail.byLensValue.map((v) => ({
						value: v.value ?? 'Unclassified',
						answers: v.answers.length,
					})),
				},
				answers: page.rows.map((r) => ({
					source: r.name,
					source_id: r.entityId,
					lensValue: r.lensValue,
					document_id: r.documentId,
					position: clip(r.position, PASSAGE_CHARS),
					keyPoints: r.keyPoints.slice(0, 3).map((k) => ({
						keyPoint: k.keyPoint,
						details: clip(k.details, QUOTE_CHARS),
						quote: k.quotes[0] === undefined ? null : clip(k.quotes[0], QUOTE_CHARS),
					})),
					keyPointsTotal: r.keyPoints.length,
					url: documentUrl(ctx.origin, w, r.entityId, r.documentId),
					...(r.withheld ? { withheld: true } : {}),
					...(r.notice === undefined ? {} : { notice: r.notice }),
				})),
				note: `An answer is per ${nouns.document}; ${withArticle(nouns.entity)} with several may answer more than once.${further > 0 ? ` ${further} further answers follow — raise \`offset\` or narrow by lens value.` : ''}`,
			}
		},
	})

	const task_results = define({
		name: 'task_results',
		summary: 'Custom analysis results',
		description: `The run's ${Object.keys(t.words.tasks).length} custom analysis task(s) — ${Object.values(
			t.words.tasks,
		)
			.map((task) => task.title)
			.join(
				', ',
			)} — each with its corpus-wide results: tag assignment counts, question coverage, findings by category, or metrics (each list cut at 50; the analysis read has a task's whole page). A task with documentsAnalysed 0 produced nothing. Per-${nouns.document} detail rides on get_document.`,
		...grouped(GROUP.analysis),
		input: z.object({}),
		output: z.object({ tasks: z.array(taskResultSchema), notes: z.array(z.string()) }),
		rest: { method: 'GET', path: '/task-results' },
		handler: async (_input, ctx) => {
			const c = readContext(ctx)
			const CUT = 50
			const notes: string[] = []
			const tasks = (await x.taskResults(c.db, c.scope)).map((task) => {
				const cutTags = task.tagCategories?.map((category) => {
					if (category.tags.length > CUT)
						notes.push(
							`${task.taskId}: ${category.category} lists ${CUT} of ${category.tags.length} values; analysis has them all.`,
						)
					return { ...category, tags: category.tags.slice(0, CUT) }
				})
				if (task.metrics && task.metrics.length > CUT)
					notes.push(
						`${task.taskId}: ${CUT} of ${task.metrics.length} metrics listed; analysis has them all.`,
					)
				return {
					...task,
					tagCategories: cutTags ?? null,
					metrics: task.metrics ? task.metrics.slice(0, CUT) : null,
				}
			})
			return { tasks, notes }
		},
	})

	/* ── what this run serves, in the surfaces' order ── */

	const served = [
		corpus_overview,
		search_passages,
		find_topics,
		list_topics,
		search,
		fetch,
		...(t.tree ? [list_families, list_superclusters, topics_in_supercluster] : []),
		get_topic,
		topic_quotes,
		topic_perspectives,
		source_perspectives,
		related_topics,
		...(t.words.scale.contesting.length ? [contested_topics] : []),
		...(t.words.lens ? [lens_profile] : []),
		list_sources,
		get_source,
		find_documents,
		get_document,
		document_text,
		...(t.facets.length ? [list_tags, tag_pivot] : []),
		...(vocabularies.length
			? [list_vocabularies, get_concept, entities_for_concept, documents_for_concept]
			: []),
		...(t.overview.questions > 0 ? [list_questions, question_answers] : []),
		...(Object.keys(t.words.tasks).length ? [task_results] : []),
	]

	return {
		served,
		corpus_overview,
		search_passages,
		find_topics,
		list_topics,
		search,
		fetch,
		list_families,
		list_superclusters,
		topics_in_supercluster,
		get_topic,
		topic_quotes,
		topic_perspectives,
		source_perspectives,
		related_topics,
		contested_topics,
		lens_profile,
		list_sources,
		get_source,
		find_documents,
		get_document,
		document_text,
		list_tags,
		tag_pivot,
		list_vocabularies,
		get_concept,
		entities_for_concept,
		documents_for_concept,
		list_questions,
		question_answers,
		task_results,
	}
}

/* ───────────────────────── the three details ───────────────────────── */

async function topicOutput(ctx: ReportCtx, topicId: number): Promise<TopicOutput> {
	const c = readContext(ctx)
	const w = words(ctx)
	// the synthesis: every stance's words, none of its own key points and quotes (source_perspectives reads those)
	const detail = await x.topicSynthesis(c.db, topicId, c.scope)
	if (!detail) throw noTopic(topicId)
	const dissent = dissentOf(w.scale)
	const stances = detail.stances.map((p) => ({ ...p, lensValue: lensValueOf(w, p.facets) }))
	const byLens = new Map<string, Record<string, number>>()
	for (const p of stances) {
		const key = p.lensValue ?? 'Unclassified'
		const mix = byLens.get(key) ?? {}
		mix[p.position] = (mix[p.position] ?? 0) + 1
		byLens.set(key, mix)
	}
	const contesting = stances.filter((p) => w.scale.contesting.includes(p.position))
	const tiers: Record<string, number> = {}
	for (const m of detail.members) tiers[m.membershipType] = (tiers[m.membershipType] ?? 0) + 1
	const quoted = detail.keyPointItems.flatMap((kp) =>
		kp.quotes.flatMap((q) => (q.entityUuid ? [q.entityUuid] : [])),
	)
	const [lensOf, slugs] = await Promise.all([lensValues(c, quoted), slugsOf(c.db, quoted)])
	const rank = pages.lensRank(w)
	const sorted = stances
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
			(p1, p2) => dissent(p2.position) - dissent(p1.position) || p1.source.localeCompare(p2.source),
		)
	return {
		topic_id: detail.topicClusterId,
		title: detail.title,
		description: detail.description,
		url: topicUrl(ctx.origin, w, detail.topicClusterId),
		junk: detail.junkStatus === 'confirmed',
		junkReason: detail.junkStatus === 'confirmed' ? detail.junkAiReason : null,
		lineage: detail.lineage,
		documents: detail.documents,
		reach: { sources: detail.members.length, byTier: tiers },
		positionMix: detail.positions,
		positionsByLens: w.lens
			? Object.fromEntries(
					[...byLens].sort(
						(x1, x2) =>
							rank(x1[0] === 'Unclassified' ? null : x1[0]) -
							rank(x2[0] === 'Unclassified' ? null : x2[0]),
					),
				)
			: null,
		contestation: {
			contestingStances: contesting.length,
			contestingLensValues: [...new Set(contesting.map((p) => p.lensValue ?? 'Unclassified'))],
			distinctLensValues: byLens.size,
			singleLensValue: byLens.size === 1,
		},
		keyFindings: detail.keyPointItems.map((kp) => ({
			finding: kp.keyPoint,
			details: clip(kp.details, PASSAGE_CHARS),
			quotes: kp.quotes.slice(0, 2).map((q) =>
				quoteOf({
					...q,
					entityId: q.entityUuid ? (slugs.get(q.entityUuid) ?? null) : null,
					lensValue: q.entityUuid ? (lensOf.get(q.entityUuid) ?? null) : null,
				}),
			),
		})),
		stancesHeld: stances.length,
		stances: sorted.slice(0, TOPIC_STANCES_SHOWN),
		stancesTruncated: Math.max(0, sorted.length - TOPIC_STANCES_SHOWN),
		note: notPrevalence(w, await sourceCount(c)),
	}
}

async function sourceOutput(ctx: ReportCtx, key: string): Promise<SourceOutput> {
	const c = readContext(ctx)
	const w = words(ctx)
	const direct = await x.entityByKey(c.db, key, c.scope)
	const found =
		direct ??
		(await (async () => {
			const needle = key.trim().toLowerCase()
			const hit = (await x.entities(c.db, c.scope)).find((e) =>
				[e.entityName, e.entityId].some((v) => v.toLowerCase().includes(needle)),
			)
			return hit ? x.entityByKey(c.db, hit.entityId, c.scope) : null
		})())
	if (!found) throw new NotFound(`No ${w.nouns.entity} matching "${key}". list_sources names them.`)
	const dissent = dissentOf(w.scale)
	const topics = [...found.topicItems]
		.sort(
			(t1, t2) =>
				(t2.position === null ? -1 : dissent(t2.position)) -
					(t1.position === null ? -1 : dissent(t1.position)) || t1.title.localeCompare(t2.title),
		)
		.map((tp) => ({
			topic_id: tp.topicClusterId,
			title: tp.title,
			membershipType: tp.membershipType,
			position: tp.position,
			framing: tp.perspectiveTitle,
			analysis: tp.positionAnalysis === null ? null : clip(tp.positionAnalysis, PASSAGE_CHARS),
			quotes: tp.quotes
				.map((q) => q.trim())
				.filter((q) => looksLikeQuote(q, 40))
				.slice(0, 2)
				.map((q) => clip(q, QUOTE_CHARS)),
			url: topicUrl(ctx.origin, w, tp.topicClusterId),
		}))
	const documents = found.documentItems.map((d) => ({
		document_id: d.documentId,
		title: d.title ?? d.fileName,
		keyPoints: d.keyPoints,
		answers: d.answers,
		facets: readerFacetValues(d.facets),
		url: documentUrl(ctx.origin, w, found.entityId, d.documentId),
	}))
	return {
		source: found.entityName,
		source_id: found.entityId,
		url: sourceUrl(ctx.origin, w, found.entityId),
		lensValue: lensValueOf(w, found.facets),
		facets: readerFacetValues(found.facets),
		inferredName: found.inferredName,
		counts: {
			documents: found.documents,
			topics: found.topics,
			stances: found.topicItems.filter((tp) => tp.position !== null).length,
			keyPoints: found.keyPoints,
			questionsAnswered: found.questionsAnswered,
		},
		documents: documents.slice(0, SOURCE_DOCUMENTS_SHOWN),
		documentsTruncated: Math.max(0, documents.length - SOURCE_DOCUMENTS_SHOWN),
		topics: topics.slice(0, SOURCE_TOPICS_SHOWN),
		topicsTruncated: Math.max(0, topics.length - SOURCE_TOPICS_SHOWN),
		...(found.withheld ? { withheld: true } : {}),
		...(found.notice === undefined ? {} : { notice: found.notice }),
		note: notPrevalence(w, await sourceCount(c)),
	}
}

async function documentOutput(
	ctx: ReportCtx,
	key: string,
	includeText: boolean,
	textChars = includeText ? TEXT_CHARS_MAX : TEXT_PREVIEW_CHARS,
): Promise<DocumentOutput> {
	const c = readContext(ctx)
	const w = words(ctx)
	const direct = await x.documentById(c.db, key, c.scope)
	const d =
		direct ??
		(await (async () => {
			const owner = await x.entityByKey(c.db, key, c.scope)
			const first = owner?.documentItems[0]
			return first ? x.documentById(c.db, first.documentId, c.scope) : null
		})())
	if (!d)
		throw new NotFound(
			`No ${w.nouns.document} or ${w.nouns.entity} ${key}. find_documents and list_sources name them.`,
		)
	const [facets, slugs] = await Promise.all([
		loadFacetCache(c.db, 'document', undefined, [d.documentId]),
		slugsOf(c.db, [d.entityUuid]),
	])
	const sourceId = slugs.get(d.entityUuid) ?? d.entityUuid
	const keyPointOf = (k: { keyPoint: string; details: string; quotes: readonly string[] }) => ({
		keyPoint: k.keyPoint,
		details: clip(k.details, PASSAGE_CHARS),
		quotes: k.quotes.slice(0, 2).map((q) => clip(q, QUOTE_CHARS)),
	})
	const answered = d.questionResponses.filter((r) => r.addressed)
	const analysed = d.keyPointItems.length > 0
	return {
		document_id: d.documentId,
		title: d.title ?? d.fileName,
		fileName: d.fileName,
		source: d.entityName,
		source_id: sourceId,
		url: documentUrl(ctx.origin, w, sourceId, d.documentId),
		facets: readerFacetValues(facets.get(d.documentId)),
		counts: { keyPoints: d.keyPoints, quotes: d.quotes, passages: d.chunks },
		keyPoints: d.keyPointItems
			.slice(0, DOCUMENT_KEY_POINTS_SHOWN)
			.map((k) =>
				keyPointOf({ ...k, quotes: k.quotes.filter((q) => q.verified).map((q) => q.text) }),
			),
		keyPointsTruncated: Math.max(0, d.keyPointItems.length - DOCUMENT_KEY_POINTS_SHOWN),
		tags: d.tags.map((tag) => ({
			category: tag.category,
			path: tag.path,
			name: tag.name,
			relevance: tag.relevance,
			isPrimary: tag.isPrimary,
			context: clip(tag.context, QUOTE_CHARS),
		})),
		answers: answered.map((r) => ({
			question: r.questionKey,
			clause: questionClause(r.questionKey, r.questionText),
			text: r.questionText,
			position: clip(r.position, PASSAGE_CHARS),
			// two points with one quote each: the answers in full are question_answers' and document_reading's
			keyPoints: r.keyPoints
				.slice(0, 2)
				.map((k) => keyPointOf({ ...k, quotes: k.quotes.slice(0, 1) })),
		})),
		questionsPutTo: d.questionResponses.length,
		findings: d.criteria.slice(0, DOCUMENT_FINDINGS_SHOWN).map((f) => ({
			topic: f.topic,
			subtopic: f.subtopic,
			keyPoint: f.keyPoint,
			details: clip(f.details, PASSAGE_CHARS),
			quotes: f.quotes.slice(0, 2).map((q) => clip(q, QUOTE_CHARS)),
		})),
		findingsTruncated: Math.max(0, d.criteria.length - DOCUMENT_FINDINGS_SHOWN),
		metrics: d.metrics.slice(0, DOCUMENT_FINDINGS_SHOWN).map((m) => ({
			metricType: m.metricType,
			metricName: m.metricName,
			explicitness: m.explicitness,
			description: clip(m.metricDescription, PASSAGE_CHARS),
			requirements: m.requirements,
			northStars: m.northStars,
		})),
		topics: d.topics.map((tp) => ({
			topic_id: tp.topicClusterId,
			title: tp.title,
			passages: tp.chunks,
		})),
		text: clip(d.text, textChars),
		textChars: d.text.length,
		textTruncated: d.text.length > textChars,
		analysed,
		...(d.withheld ? { withheld: true } : {}),
		...(d.notice === undefined ? {} : { notice: d.notice }),
		note:
			analysed || d.withheld
				? notPrevalence(w, await sourceCount(c))
				: `Step 1 could not analyse this ${w.nouns.document}; it has no key points. It still holds topic memberships. ${notPrevalence(w, await sourceCount(c))}`,
	}
}
