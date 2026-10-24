/**
 * The report's pages and drawers as operations (settled 2026-10-24: every reader is
 * also a tool). The Brief read in parts, a chapter's reading, the record of sources, the
 * galaxy, the Method page, the landing page's figures, a custom analysis page and its
 * drill-downs, and the four readings a drawer opens — each over the same core read the
 * page renders from, so a tool, a route, the hub's door and the page say one thing.
 * The world record is not here: a route and a door method (3–31 MB), never a tool.
 */
import { NotFound, operationsFor } from '@aicolab/app-kit/api/define'
import {
	assessedDocumentsSchema,
	assessmentOverviewSchema,
	galaxyDataSchema,
	methodDataSchema,
	metricEntriesSchema,
	metricsOverviewSchema,
	perspectiveDocumentsSchema,
	perspectiveGroupsSchema,
	perspectiveOverviewSchema,
	questionsOverviewSchema,
	type RunWords,
	reportOverviewSchema,
	reportTaskSchema,
	runMethodSchema,
	tagDocumentsSchema,
	taggingOverviewSchema,
} from '@aicolab/insight-bridge-contracts/explorer'
import * as s from '@aicolab/insight-bridge-contracts/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { type BriefConfig, briefData, chapterReading } from '../../brief/data.ts'
import {
	type BriefData,
	type BriefNode,
	chapterReadingSchema,
	facetSpecSchema,
} from '../../brief/types.ts'
import type { IBContentSection, IBQuote } from '../../galaxy/types.ts'
import { buildMethod } from '../../method.ts'
import { type ReadingView, readingViewSchema } from '../../reader/reading-view.ts'
import { positionColors } from '../../site/palette.ts'
import { sourcesData } from '../../sources/data.ts'
import { type SourcesConfig, sourceRowSchema, sourcesResultSchema } from '../../sources/types.ts'
import { treeOf } from '../../tree.ts'
import * as analysis from '../analysis.ts'
import * as x from '../data.ts'
import * as pages from '../pages.ts'
import {
	documentReading,
	groupReading,
	type ReadingContext,
	sourceReading,
	topicReading,
} from '../readings.ts'
import { type ReportCtx, readContext, siteOf } from './context.ts'
import { GROUP } from './reads.ts'
import {
	clip,
	groupUrl,
	PAGE,
	PAGE_MAX,
	PASSAGE_CHARS,
	pageOf,
	pageShape,
	QUOTE_CHARS,
	topicUrl,
} from './shapes.ts'
import { profiles, readerFacetValues, TOPIC_ID, type ToolContext } from './support.ts'

const define = operationsFor<ReportCtx>()
const grouped = (group: string) => ({ tags: [group], meta: { 'aicolab.org/group': group } })
/** A pin's or a pushback's analysis in a chapter reading is cut here: a chapter holds dozens. */
const PIN_CHARS = 400
/** How many contributors a topic's reading lists per grade; get_topic and source_perspectives name them all. */
const CONTRIBUTORS_SHOWN = 30
/** How many points a reading's section lists, and how many rows a lens or topics section has, as a tool. */
const POINTS_SHOWN = 12
const ROWS_SHOWN = 30
/** How many documents a row of the record lists as a tool (an audit office holds hundreds); get_source pages the rest. */
const RECORD_DOCUMENTS_SHOWN = 8

/**
 * A reading cut to a model's measure: every points section its first POINTS_SHOWN points
 * (details and quotes clipped), every rows section its first ROWS_SHOWN rows (analyses
 * and quotes clipped), the contributors their first CONTRIBUTORS_SHOWN per grade — and a
 * stat saying what was cut, so the whole is known to be a page away (the drawer reads it).
 */
function trimReading(view: ReadingView): ReadingView {
	let cut = 0
	let of = 0
	const quotes = (rows: readonly IBQuote[] | undefined) =>
		rows?.map((q) => ({ ...q, text: clip(q.text, QUOTE_CHARS) }))
	const sections = view.content.sections.map((section): IBContentSection => {
		switch (section.kind) {
			case 'points': {
				of += section.points.length
				cut += Math.max(0, section.points.length - POINTS_SHOWN)
				return {
					...section,
					points: section.points.slice(0, POINTS_SHOWN).map((p) => ({
						...p,
						...(p.detail === undefined ? {} : { detail: clip(p.detail, PASSAGE_CHARS) }),
						...(p.quotes === undefined ? {} : { quotes: quotes(p.quotes) }),
					})),
				}
			}
			case 'facets': {
				of += section.rows.length
				cut += Math.max(0, section.rows.length - ROWS_SHOWN)
				return {
					...section,
					rows: section.rows.slice(0, ROWS_SHOWN).map((r) => ({
						...r,
						...(r.analysis === undefined ? {} : { analysis: clip(r.analysis, PASSAGE_CHARS) }),
						...(r.quotes === undefined ? {} : { quotes: quotes(r.quotes) }),
					})),
				}
			}
			case 'nodes': {
				of += section.rows.length
				cut += Math.max(0, section.rows.length - ROWS_SHOWN)
				return { ...section, rows: section.rows.slice(0, ROWS_SHOWN) }
			}
			case 'entities': {
				of += section.rows.length
				cut += Math.max(0, section.rows.length - ROWS_SHOWN)
				return { ...section, rows: section.rows.slice(0, ROWS_SHOWN) }
			}
			case 'documents': {
				of += section.rows.length
				cut += Math.max(0, section.rows.length - ROWS_SHOWN)
				return { ...section, rows: section.rows.slice(0, ROWS_SHOWN) }
			}
			default:
				// a notice: shown whole
				return section
		}
	})
	const groups = view.content.contributors ?? []
	for (const g of groups) {
		of += g.rows.length
		cut += Math.max(0, g.rows.length - CONTRIBUTORS_SHOWN)
	}
	if (cut === 0) return view
	return {
		...view,
		content: {
			...view.content,
			stats: [
				...(view.content.stats ?? []),
				{ label: 'rows listed', value: `${of - cut} of ${of}` },
			],
			sections,
			...(view.content.contributors
				? { contributors: groups.map((g) => ({ ...g, rows: g.rows.slice(0, CONTRIBUTORS_SHOWN) })) }
				: {}),
		},
	}
}
const words = (ctx: ReportCtx) => ctx.run.words
const offset = z.coerce.number().int().min(0).default(0)

/** A reading with its scale: the mix's order and colours, so a view with no run words draws the bar as the site does. */
const withScale = (view: ReadingView, w: RunWords): ReadingView => ({
	...view,
	mixOrder: w.scale.order,
	mixColors: positionColors(w.scale),
})
const limitOf = (max: number, fallback: number) =>
	z.coerce.number().int().min(1).max(max).default(fallback)

/* ───────────────────────── what the pages read with, from the run ───────────────────────── */

/**
 * Whether a facet's values are ordered: the profile derived it into buckets of another
 * facet (an era or a period from the year), and buckets are ranges in order. A facet the
 * profile lists as values is a vocabulary, which is no guarantee of order.
 */
const isOrdinal = (w: RunWords, key: string): boolean => w.facets[key]?.derivedFrom != null

/**
 * The Brief's configuration from the run's own words: how every facet the run names
 * reads (its heading, its value order and words, and whether it is ordinal), and the
 * scale. Which facets the Brief surfaces is the analysis's (../../brief/data).
 */
export const briefConfigOf = (ctx: ReportCtx): BriefConfig => {
	const w = words(ctx)
	return {
		facets: Object.fromEntries(
			Object.entries(w.facets).map(([key, said]) => [
				key,
				{
					label: said.heading,
					order: [...said.order],
					labels: said.values,
					...(isOrdinal(w, key) ? { ordinal: true } : {}),
				},
			]),
		),
		positions: {
			order: w.scale.order,
			supportive: w.scale.supportive,
			contesting: w.scale.contesting,
			unclear: w.scale.unclear ?? undefined,
		},
		...(ctx.scope ? { scope: ctx.scope } : {}),
	}
}

/**
 * The record's filters, headed and ordered by the run's words: the site declares which
 * and what it groups by, the host's own say where the site is silent, the lens otherwise.
 */
export async function sourcesConfigOf(ctx: ReportCtx): Promise<SourcesConfig> {
	const w = words(ctx)
	const [meta] = await ctx.db
		.select({ site: s.runMeta.site })
		.from(s.runMeta)
		.where(eq(s.runMeta.singleton, 1))
		.limit(1)
	const site = meta?.site ?? null
	const own = ctx.host.sources ?? {}
	const declared = site?.filters ?? own.filters ?? (w.lens ? [w.lens] : [])
	// a facet the host derives itself is always a filter: the site's words cannot name it
	const filters = [
		...declared,
		...(own.derived ?? []).map((facet) => facet.key).filter((key) => !declared.includes(key)),
	]
	// the host's null says "no grouping"; absent, the lens groups
	const groupBy = site?.groupBy ?? (own.groupBy === undefined ? w.lens : own.groupBy)
	return {
		filters: filters.map((key) => {
			const said = w.facets[key]
			const order = own.order?.[key] ?? (said?.order.length ? [...said.order] : null)
			const labels =
				said && Object.keys(said.values).length ? said.values : (own.labels?.[key] ?? null)
			const label = said?.heading ?? own.headings?.[key]
			return {
				key,
				...(label ? { label } : {}),
				...(isOrdinal(w, key) ? { ordinal: true } : {}),
				...(order ? { order } : {}),
				...(labels ? { labels } : {}),
			}
		}),
		...(groupBy || own.sort
			? {
					...(groupBy ? { groupBy } : {}),
					// the grouping facet first, in the host's direction where it names one
					sort: [
						...(groupBy
							? [own.sort?.find((by) => by.facet === groupBy) ?? { facet: groupBy }]
							: []),
						...(own.sort ?? []).filter((by) => by.facet !== groupBy),
					],
				}
			: {}),
		...(ctx.scope ? { scope: ctx.scope } : {}),
		...(own.derived ? { derived: own.derived } : {}),
	}
}

/** The sky's options: the host's seed and facets, else a fixed seed and the lens. */
export const galaxyOptionsOf = (ctx: ReportCtx) => {
	const w = words(ctx)
	return {
		seed: ctx.host.galaxy?.seed ?? 1,
		facets:
			ctx.host.galaxy?.facets ??
			(w.lens ? [{ key: w.lens, label: w.facets[w.lens]?.heading ?? w.lens }] : []),
	}
}

/** What every reading is written with: the run's words and scale colours, and the host's own words for the reader. */
export const readingContextOf = (ctx: ReportCtx): ReadingContext => {
	const w = words(ctx)
	const own = ctx.host.readings
	return {
		words: w,
		positionColors: positionColors(w.scale),
		...(own?.vocabulary ? { vocabulary: own.vocabulary } : {}),
		...(own?.documentLabel ? { documentLabel: own.documentLabel } : {}),
		...(own?.documentOrder ? { documentOrder: own.documentOrder } : {}),
	}
}

/* ───────────────────────── the Brief's shapes ───────────────────────── */

const briefNodeSchema = z.object({
	id: z.number().int(),
	/** The tree's own word for this generation: family, theme, group, topic. */
	kind: z.string(),
	title: z.string(),
	subject: z.string(),
	claim: z.string(),
	description: z.string().nullable(),
	topics: z.number().int(),
	sources: z.number().int(),
	stances: z.number().int(),
	positionMix: z.record(z.string(), z.number().int()),
	contesting: z.number().int(),
	unclear: z.number().int(),
	supportivePct: z.number(),
	/** Every declared facet's mix over this node's stances. */
	facets: z.array(
		z.object({ facet: z.string(), value: z.string(), stances: z.number().int(), pct: z.number() }),
	),
	/** The contributors cited most on this node (up to five), and how many there are. */
	contributors: z.array(
		z.object({
			source_id: z.string(),
			name: z.string(),
			detail: z.string().nullable(),
			count: z.number().int(),
		}),
	),
	contributorTotal: z.number().int(),
	url: z.string(),
})

/** A theme as the structure lists it: where it sits and its reach; its facts are `brief` with `node`. */
const briefRowSchema = briefNodeSchema.pick({
	id: true,
	kind: true,
	title: true,
	claim: true,
	topics: true,
	sources: true,
	stances: true,
	positionMix: true,
	contesting: true,
	supportivePct: true,
	url: true,
})

const briefTopicSchema = z.object({
	id: z.number().int(),
	title: z.string(),
	subject: z.string(),
	claim: z.string(),
	parent_id: z.number().int().nullable(),
	sources: z.number().int(),
	stances: z.number().int(),
	positionMix: z.record(z.string(), z.number().int()),
	contesting: z.number().int(),
	/** Distinct values this topic's contributors hold, per declared facet. */
	facetCounts: z.record(z.string(), z.number().int()),
	/** Facets on which every contributor holds the SAME value — a one-sided topic. */
	singleValue: z.record(z.string(), z.string()),
	url: z.string(),
})

const briefNodeOf = (n: BriefNode, ctx: ReportCtx, w: RunWords) => ({
	id: n.id,
	kind: n.kind,
	title: n.title,
	subject: n.subject,
	claim: n.claim,
	description: n.description,
	topics: n.topics,
	sources: n.sources,
	stances: n.stances,
	positionMix: n.positions,
	contesting: n.contesting,
	unclear: n.unclear,
	supportivePct: n.supportivePct,
	facets: n.facets,
	contributors: n.contributors.map((c) => ({
		source_id: c.entityId,
		name: c.name,
		detail: c.detail,
		count: c.count,
	})),
	contributorTotal: n.contributorTotal,
	url: n.kind === 'topic' ? topicUrl(siteOf(ctx), w, n.id) : groupUrl(siteOf(ctx), w, n.id),
})

const briefTopicOf = (d: BriefData, id: number, ctx: ReportCtx, w: RunWords) => {
	const t = d.topics[id]
	return t
		? [
				{
					id: t.id,
					title: t.title,
					subject: t.subject,
					claim: t.claim,
					parent_id: t.parentId,
					sources: t.sources,
					stances: t.stances,
					positionMix: t.positions,
					contesting: t.contesting,
					facetCounts: t.facetCounts,
					singleValue: t.singleValue,
					url: topicUrl(siteOf(ctx), w, t.id),
				},
			]
		: []
}

/* ───────────────────────── the analysis pages' shapes ───────────────────────── */

const analysisPageSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('metadata_tagging'), overview: taggingOverviewSchema }),
	z.object({ kind: z.literal('question_response'), overview: questionsOverviewSchema }),
	z.object({ kind: z.literal('perspective_analysis'), overview: perspectiveOverviewSchema }),
	z.object({ kind: z.literal('criteria_assessment'), overview: assessmentOverviewSchema }),
	z.object({ kind: z.literal('metrics_evaluation'), overview: metricsOverviewSchema }),
])

/** A drill-down's answer: the request's kind, and the result in that kind's shape. */
const analysisDrillResultSchema = z.object({
	kind: z.enum([
		'tagDocuments',
		'perspectiveDocuments',
		'perspectiveGroups',
		'assessedDocuments',
		'metricEntries',
	]),
	result: z.union([
		tagDocumentsSchema,
		perspectiveDocumentsSchema,
		perspectiveGroupsSchema,
		assessedDocumentsSchema,
		metricEntriesSchema,
	]),
})

/** The drill-down that pages nothing: a question's every answer (1.5 MB on Training Data) is question_answers', a page at a time.
 *  Refusing it in the input narrows the request's type too (an inferred type predicate), so the handler never meets it. */
const UNPAGED_DRILL = 'questionDetail'
/** How many documents or entries a drill-down's page holds as a tool (the page itself reads 25). */
const DRILL_PAGE = 8
/** How many findings a perspective document carries in a drill-down's page (every one on the page itself). */
const DRILL_ENTRIES = 6

/** A drill-down's result with every text cut at PIN_CHARS: findings, evidence and descriptions read whole on the page. */
function clipped(value: unknown): unknown {
	if (typeof value === 'string') return clip(value, PIN_CHARS)
	if (Array.isArray(value)) return value.map(clipped)
	if (typeof value === 'object' && value !== null)
		return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, clipped(inner)]))
	return value
}

/* ───────────────────────── the readers, for one run ───────────────────────── */

export function readersFor(t: ToolContext) {
	const nouns = t.words.nouns

	const report_overview = define({
		name: 'report_overview',
		summary: 'The landing page’s figures',
		description: `What the report's landing page states: the record's scale (${nouns.entities}, ${nouns.documents}, passages, key points and verified quotes), the topics and grouping generations, the stances and their mix overall and along the lens, the friction at the contesting end of the scale, the ${nouns.entities} by lens value, the single-${nouns.entity} topics and the questions answered. corpus_overview is the agent's orientation; this is the page's own figures.`,
		...grouped(GROUP.readers),
		input: z.object({}),
		output: reportOverviewSchema,
		rest: { method: 'GET', path: '/report' },
		handler: async (_input, ctx) =>
			pages.reportOverview(
				ctx.db,
				words(ctx),
				ctx.host.documentFacet ? { documentFacet: ctx.host.documentFacet } : {},
				ctx.scope,
			),
	})

	const brief = define({
		name: 'brief',
		summary: 'The Brief: the record’s structure, in parts',
		description: `The Brief (the /topics page) read in parts: the record's scale and the facets it is read along, then the families (each with its reach, stances, position mix, facet shares and most-cited ${nouns.entities}) and their themes as rows (reach, stances, position mix); pass \`node\` (a family or theme id) for that node's facts and a page of its topics; a run with no tree lists its topics by reach. chapter_reading has a node's key points, pins and pushback.`,
		...grouped(GROUP.readers),
		input: z.object({
			node: z.coerce
				.number()
				.int()
				.optional()
				.describe('A family or theme id, for its facts and its topics'),
			offset,
			limit: limitOf(PAGE_MAX, PAGE),
		}),
		output: z.object({
			scale: z.object({ sources: z.number().int(), topics: z.number().int() }),
			facets: z.array(facetSpecSchema.extend({ label: z.string() })),
			/** Whether this run's positions measure agreement with a node's claim; false where the scale grades something else. */
			agreementAxis: z.boolean(),
			flat: z.boolean(),
			singleGeneration: z.boolean(),
			/** The node asked for, with its facts; null for the whole structure. */
			node: briefNodeSchema.nullable(),
			/** Without `node`: every family with its facts, and its themes as rows (a theme's facts and topics are `node`'s). */
			families: z.array(briefNodeSchema.extend({ themes: z.array(briefRowSchema) })),
			/** The topics listed: the node's, or every topic by reach for a run with no tree. */
			topics: z.object({ ...pageShape, rows: z.array(briefTopicSchema) }),
		}),
		rest: { method: 'GET', path: '/brief' },
		handler: async (a, ctx) => {
			const w = words(ctx)
			const d = await briefData(ctx.db, briefConfigOf(ctx))
			const nodeOf = (n: BriefNode) => briefNodeOf(n, ctx, w)
			const base = {
				scale: d.scale,
				facets: d.facets,
				agreementAxis: d.agreementAxis,
				flat: d.flat,
				singleGeneration: d.singleGeneration,
			}
			if (a.node !== undefined) {
				const family = d.families.find((f) => f.id === a.node)
				const theme = d.themes[a.node]
				const found = family ?? theme
				if (!found)
					throw new NotFound(
						`No family or theme with id ${a.node}. brief without \`node\` lists them.`,
					)
				const topicIds = family
					? [...family.topicIds, ...family.themeIds.flatMap((id) => d.themes[id]?.topicIds ?? [])]
					: (theme?.topicIds ?? [])
				const ordered = [...new Set(topicIds)].sort(
					(p, q) => (d.topics[q]?.sources ?? 0) - (d.topics[p]?.sources ?? 0),
				)
				const page = pageOf(ordered, a.offset, a.limit)
				return {
					...base,
					node: nodeOf(found),
					families: [],
					topics: {
						total: page.total,
						offset: page.offset,
						returned: page.returned,
						rows: page.rows.flatMap((id) => briefTopicOf(d, id, ctx, w)),
					},
				}
			}
			if (d.flat) {
				const page = pageOf(d.topicOrder, a.offset, a.limit)
				return {
					...base,
					node: null,
					families: [],
					topics: {
						total: page.total,
						offset: page.offset,
						returned: page.returned,
						rows: page.rows.flatMap((id) => briefTopicOf(d, id, ctx, w)),
					},
				}
			}
			return {
				...base,
				node: null,
				families: d.families.map((f) => ({
					...nodeOf(f),
					themes: d.singleGeneration
						? []
						: f.themeIds.flatMap((id) => {
								const theme = d.themes[id]
								return theme ? [briefRowSchema.parse(nodeOf(theme))] : []
							}),
				})),
				topics: { total: 0, offset: 0, returned: 0, rows: [] },
			}
		},
	})

	const chapter_reading = define({
		name: 'chapter_reading',
		summary: 'A chapter’s reading: points, pins, pushback',
		description: `What a Brief chapter reads: the key points of its most-read topics (the four widest, or every point of one topic with \`full\`), each with one verbatim quote; every declared facet's position on each topic (the pins of the who-says-what matrix); and the ${nouns.entities} that push back, strongest first. The chapter is a family, a theme or a topic id.`,
		...grouped(GROUP.readers),
		input: z.object({
			chapter_id: z.coerce
				.number()
				.int()
				.describe(`A family or theme id (from brief), or a topic id. ${TOPIC_ID}`),
			full: z
				.boolean()
				.optional()
				.describe('Every key point of the chapter’s topics, not three per topic'),
		}),
		output: chapterReadingSchema,
		rest: { method: 'GET', path: '/brief/{chapter_id}' },
		handler: async (a, ctx) => {
			const c = readContext(ctx)
			const [{ byId }, h] = await Promise.all([profiles(c), x.hierarchy(c.db)])
			const tree = treeOf(h)
			const node = tree.byId.get(a.chapter_id)
			const topicIds =
				node && node.generation > 0
					? tree.topicsUnder(a.chapter_id)
					: byId.has(a.chapter_id)
						? [a.chapter_id]
						: []
			if (!topicIds.length)
				throw new NotFound(
					`No chapter with id ${a.chapter_id}: brief lists the families and themes, list_topics the topics.`,
				)
			const ranked = [...topicIds].sort(
				(p, q) => (byId.get(q)?.sources ?? 0) - (byId.get(p)?.sources ?? 0),
			)
			const read = topicIds.length === 1 ? ranked : ranked.slice(0, 4)
			const reading = await chapterReading(
				ctx.db,
				briefConfigOf(ctx),
				a.chapter_id,
				read,
				a.full === true,
			)
			// the page's reading, each text cut to a model's measure: the whole is a get_topic away
			return {
				...reading,
				points: reading.points.map((p) => ({
					...p,
					details: clip(p.details, PASSAGE_CHARS),
					quote: p.quote ? { ...p.quote, text: clip(p.quote.text, QUOTE_CHARS) } : null,
				})),
				pins: reading.pins.map((pin) => ({ ...pin, analysis: clip(pin.analysis, PIN_CHARS) })),
				pushback: reading.pushback.map((pb) => ({ ...pb, analysis: clip(pb.analysis, PIN_CHARS) })),
			}
		},
	})

	const sources_record = define({
		name: 'sources_record',
		summary: `The record of ${nouns.entities}, a page at a time`,
		description: `The /sources page: every ${nouns.entity} in the record with its facets and its ${nouns.documents}' facets (the first ${RECORD_DOCUMENTS_SHOWN} ${nouns.documents} per row, with how many more; get_source lists them), filtered by the facets the site declares (each with its vocabulary and counts over the whole record) and by free text over names, ${nouns.document} titles, topic titles and facet values; grouped and ordered as the site reads it. list_sources is the flatter listing with stance counts.`,
		...grouped(GROUP.readers),
		input: z.object({
			query: z.string().optional().describe('Free text: a name, a title, a topic, a facet value'),
			page: z.coerce.number().int().min(1).default(1),
			limit: limitOf(PAGE, 12).describe('Rows per page'),
			filters: z
				.record(z.string(), z.string())
				.optional()
				.describe(
					'One chosen value per declared facet, keyed by the facet (see `facets` in the answer)',
				),
		}),
		// the page's result, its groups naming their rows by source_id rather than repeating them
		output: sourcesResultSchema.omit({ groups: true }).extend({
			/** The page's rows, each with its first RECORD_DOCUMENTS_SHOWN documents and how many more it has. */
			rows: z.array(sourceRowSchema.extend({ documentsTruncated: z.number().int() })),
			/** The page's rows under their `groupBy` value, each named by its `entityId`; one group when ungrouped. */
			groups: z.array(z.object({ value: z.string().nullable(), sources: z.array(z.string()) })),
		}),
		rest: { method: 'POST', path: '/record' },
		handler: async (a, ctx) => {
			const result = await sourcesData(
				ctx.db,
				{ ...(await sourcesConfigOf(ctx)), pageSize: a.limit },
				{ ...(a.query ? { q: a.query } : {}), page: a.page, ...a.filters },
			)
			return {
				...result,
				// the rows as a reader meets them: the pipeline's bookkeeping facets left out
				rows: result.rows.map((row) => ({
					...row,
					facets: readerFacetValues(row.facets),
					documents: row.documents
						.slice(0, RECORD_DOCUMENTS_SHOWN)
						.map((d) => ({ ...d, facets: readerFacetValues(d.facets) })),
					documentsTruncated: Math.max(0, row.documents.length - RECORD_DOCUMENTS_SHOWN),
				})),
				groups: result.groups.map((g) => ({
					value: g.value,
					sources: g.rows.map((r) => r.entityId),
				})),
			}
		},
	})

	const galaxy = define({
		name: 'galaxy',
		summary: 'The record as a sky',
		description: `The galaxy the /galaxy page draws: every grouping node as a star, and the topics a page at a time by weight (\`offset\`, \`limit\`), each with its reach and position mix, and the tree's primary edges between the stars returned; with \`all_edges\`, every edge a returned topic has to a group (the cross-links, with their similarity); with \`include_dust\`, every ${nouns.entity} strongly linked to a returned topic as dust bound to it (large: thousands of edges on a wide record). Node ids are the readings' (g:, t:, s:), so a node opens the same reading the drawer does.`,
		...grouped(GROUP.readers),
		input: z.object({
			offset,
			limit: limitOf(PAGE_MAX, PAGE).describe('Topics per page, by weight'),
			include_dust: z
				.boolean()
				.optional()
				.describe(`The ${nouns.entities} and their edges to topics`),
			all_edges: z.boolean().optional().describe('Every edge, not the primary tree alone'),
		}),
		output: galaxyDataSchema.extend({
			/** The page of topics returned (the grouping nodes are always whole). */
			topics: z.object(pageShape),
		}),
		rest: { method: 'GET', path: '/galaxy' },
		handler: async (a, ctx) => {
			const sky = await pages.galaxy(ctx.db, words(ctx), galaxyOptionsOf(ctx), ctx.scope)
			// tier 0 is the topics, above it the grouping generations, below it the dust
			const topics = sky.nodes.filter((n) => n.tier === 0).sort((p, q) => q.weight - p.weight)
			const page = pageOf(topics, a.offset, a.limit)
			const stars = new Set([
				...sky.nodes.filter((n) => n.tier > 0).map((n) => n.id),
				...page.rows.map((n) => n.id),
			])
			const shownTopics = new Set(page.rows.map((n) => n.id))
			// dust is kept only where it is bound to a returned topic
			const dust = new Set(
				a.include_dust
					? sky.edges
							.filter((e) => shownTopics.has(e.parent) && !stars.has(e.child))
							.map((e) => e.child)
					: [],
			)
			const kept = (id: string) => stars.has(id) || dust.has(id)
			return {
				...sky,
				tiers: a.include_dust ? sky.tiers : sky.tiers.filter((tier) => tier.tier >= 0),
				nodes: sky.nodes.filter((n) => kept(n.id)),
				edges: sky.edges.filter(
					(e) =>
						kept(e.child) && kept(e.parent) && (a.all_edges || e.isPrimary || dust.has(e.child)),
				),
				topics: { total: page.total, offset: page.offset, returned: page.returned },
			}
		},
	})

	const method = define({
		name: 'method',
		summary: 'How the run was made',
		description: `The Method page: the stages that ran, in order, each as what it guarantees (never how it was done); the models; the run's declared scale, facets, tasks and glossary; the clustering attempts walked; and the facts the page states — the counts, the topics confirmed as junk, the ${nouns.documents} the pipeline could not analyse, the committed build.`,
		...grouped(GROUP.readers),
		input: z.object({}),
		output: z.object({ data: methodDataSchema, method: runMethodSchema }),
		rest: { method: 'GET', path: '/method' },
		handler: async (_input, ctx) => {
			const w = words(ctx)
			const [[meta], data] = await Promise.all([
				ctx.db
					.select({ profile: s.runMeta.profile, runConfig: s.runMeta.runConfig })
					.from(s.runMeta)
					.where(eq(s.runMeta.singleton, 1))
					.limit(1),
				pages.methodData(ctx.db, w, ctx.scope),
			])
			if (!meta?.profile || !meta.runConfig)
				throw new Error(
					'[catalogue] run_meta.profile / run_config are missing: the run cannot account for itself',
				)
			return {
				data,
				method: buildMethod(meta.profile, meta.runConfig, data, ctx.host.method ?? {}),
			}
		},
	})

	const analysisOp = define({
		name: 'analysis',
		summary: 'A custom analysis page',
		description: `The custom analyses the run performed (${
			Object.values(t.words.tasks)
				.map((task) => task.title)
				.join(', ') || 'none'
		}), and with \`task_id\` one task's page by its kind: a tagging task's categories and values with their documents and lens spread; a question task's questions with who answered each, by lens; a perspective task's criteria; an assessment task's scored criteria and their distributions; a metrics task's metrics and north stars. analysis_drill opens a value's documents, a question's answers, a criterion's findings.`,
		...grouped(GROUP.analysis),
		input: z.object({
			task_id: z
				.string()
				.optional()
				.describe('A task id, from the list this read returns without one'),
		}),
		output: z.object({ tasks: z.array(reportTaskSchema), page: analysisPageSchema.nullable() }),
		rest: { method: 'GET', path: '/analysis' },
		handler: async (a, ctx) => {
			const w = words(ctx)
			const tasks = await analysis.analysisTasks(ctx.db, w, ctx.scope)
			if (a.task_id === undefined) return { tasks, page: null }
			const page = await analysis.analysisPage(ctx.db, w, a.task_id, ctx.scope)
			if (!page)
				throw new NotFound(
					`No analysis task ${a.task_id}: one of ${tasks.map((task) => task.taskId).join(', ')}`,
				)
			return { tasks, page }
		},
	})

	const analysis_drill = define({
		name: 'analysis_drill',
		summary: 'Open part of an analysis page',
		description: `What an analysis page shows when a reader opens something: a tag value’s documents (tagDocuments), a perspective task’s documents or groups (perspectiveDocuments, perspectiveGroups), an assessment’s documents ranked (assessedDocuments), a metric group’s entries (metricEntries). One request shape per drill-down, each a page at a time (offset; ${DRILL_PAGE} a page here, a document’s first ${DRILL_ENTRIES} findings, every text cut at ${PIN_CHARS} characters — get_document has a document’s findings whole). A question’s answers are question_answers’.`,
		...grouped(GROUP.analysis),
		input: z.object({
			request: analysis.analysisDrillSchema.refine((request) => request.kind !== UNPAGED_DRILL, {
				message: 'a question’s answers are read a page at a time with question_answers',
			}),
		}),
		output: analysisDrillResultSchema,
		rest: { method: 'POST', path: '/analysis/drill' },
		handler: async ({ request }, ctx) => {
			const w = words(ctx)
			const noSuch = () => new NotFound('No such analysis task or question in this run.')
			// a page of DRILL_PAGE, every text cut at PIN_CHARS: the page itself reads them whole
			const paged = { ...request, limit: DRILL_PAGE }
			const answer = (result: unknown) => {
				if (!result) throw noSuch()
				return analysisDrillResultSchema.parse({ kind: request.kind, result: clipped(result) })
			}
			switch (request.kind) {
				case 'tagDocuments':
					return answer(
						await analysis.tagDocuments(
							ctx.db,
							w,
							request.taskId,
							request.category,
							request.path,
							paged,
							ctx.scope,
						),
					)
				case 'perspectiveDocuments': {
					const found = await analysis.perspectiveDocuments(
						ctx.db,
						w,
						request.taskId,
						paged,
						ctx.scope,
					)
					// a document's first DRILL_ENTRIES findings: get_document and document_reading have them all
					return answer(
						found && {
							...found,
							documents: found.documents.map((d) => ({
								...d,
								entries: d.entries.slice(0, DRILL_ENTRIES),
							})),
						},
					)
				}
				case 'perspectiveGroups':
					return answer(
						await analysis.perspectiveGroups(ctx.db, w, request.taskId, request, ctx.scope),
					)
				case 'assessedDocuments':
					return answer(
						await analysis.assessedDocuments(ctx.db, w, request.taskId, paged, ctx.scope),
					)
				case 'metricEntries':
					return answer(await analysis.metricEntries(ctx.db, w, request.taskId, paged, ctx.scope))
			}
		},
	})

	/* ── the four readings a drawer opens ── */

	const topic_reading = define({
		name: 'topic_reading',
		summary: 'A topic as the reader shows it',
		description: `One topic as the report's drawer reads it: its key points with a quote or two each, one lens section per analysed facet with each value's position and quotes, its parent groups, and its contributors by grade — the same reading the page, the galaxy and the hub show.`,
		...grouped(GROUP.readers),
		input: z.object({ topic_id: z.coerce.number().int().describe(TOPIC_ID) }),
		output: readingViewSchema,
		rest: { method: 'GET', path: '/readings/topics/{topic_id}' },
		handler: async (a, ctx) => {
			const d = await x.topicById(ctx.db, a.topic_id, ctx.scope)
			if (!d) throw new NotFound(`No topic with id ${a.topic_id}.`)
			const add = await ctx.host.readings?.additions?.topic?.(d, ctx)
			return trimReading(withScale(topicReading(d, readingContextOf(ctx), add), words(ctx)))
		},
	})

	const group_reading = define({
		name: 'group_reading',
		summary: 'A family or theme as the reader shows it',
		description:
			'One grouping node as the report’s drawer reads it: its description and its direct children (sub-groups, or topics) as rows with their reach.',
		...grouped(GROUP.readers),
		input: z.object({
			supercluster_id: z.coerce
				.number()
				.int()
				.describe('A family, theme or group id — any generation'),
		}),
		output: readingViewSchema,
		rest: { method: 'GET', path: '/readings/groups/{supercluster_id}' },
		handler: async (a, ctx) => {
			const d = await x.groupById(ctx.db, a.supercluster_id, ctx.scope)
			if (!d) throw new NotFound(`No grouping node with id ${a.supercluster_id}.`)
			const add = await ctx.host.readings?.additions?.group?.(d, ctx)
			return trimReading(withScale(groupReading(d, readingContextOf(ctx), add), words(ctx)))
		},
	})

	const source_reading = define({
		name: 'source_reading',
		summary: `${nouns.entity.charAt(0).toUpperCase()}${nouns.entity.slice(1)} as the reader shows it`,
		description: `One ${nouns.entity} as the report's drawer reads it: its stances on each topic with analysis and quotes, the topics it engages, its ${nouns.documents} (and, with one ${nouns.document}, that ${nouns.document}'s points and analysis).`,
		...grouped(GROUP.readers),
		input: z.object({
			source: z.string().describe('A source_id, uuid or one of its document ids'),
		}),
		output: readingViewSchema,
		rest: { method: 'GET', path: '/readings/sources/{source}' },
		handler: async (a, ctx) => {
			const e = await x.entityByKey(ctx.db, a.source, ctx.scope)
			if (!e) throw new NotFound(`No ${nouns.entity} ${a.source}.`)
			const [only, ...more] = e.documentItems
			const sole =
				only && !more.length ? await x.documentById(ctx.db, only.documentId, ctx.scope) : null
			const add = await ctx.host.readings?.additions?.source?.(e, sole, ctx)
			return trimReading(withScale(sourceReading(e, sole, readingContextOf(ctx), add), words(ctx)))
		},
	})

	const document_reading = define({
		name: 'document_reading',
		summary: `${nouns.document.charAt(0).toUpperCase()}${nouns.document.slice(1)} as the reader shows it`,
		description: `One ${nouns.document} as the report's drawer reads it: its key points with verified quotes, its answers, findings and metrics, and the topics its passages fell into.`,
		...grouped(GROUP.readers),
		input: z.object({ document_id: z.string() }),
		output: readingViewSchema,
		rest: { method: 'GET', path: '/readings/documents/{document_id}' },
		handler: async (a, ctx) => {
			const d = await x.documentById(ctx.db, a.document_id, ctx.scope)
			if (!d) throw new NotFound(`No ${nouns.document} ${a.document_id}.`)
			const add = await ctx.host.readings?.additions?.document?.(d, ctx)
			return trimReading(withScale(documentReading(d, readingContextOf(ctx), add), words(ctx)))
		},
	})

	const served = [
		report_overview,
		brief,
		chapter_reading,
		sources_record,
		galaxy,
		method,
		...(Object.keys(t.words.tasks).length ? [analysisOp, analysis_drill] : []),
		topic_reading,
		...(t.tree ? [group_reading] : []),
		source_reading,
		document_reading,
	]

	return {
		served,
		report_overview,
		brief,
		chapter_reading,
		sources_record,
		galaxy,
		method,
		analysis: analysisOp,
		analysis_drill,
		topic_reading,
		group_reading,
		source_reading,
		document_reading,
	}
}
