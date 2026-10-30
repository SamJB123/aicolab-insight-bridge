/**
 * A report's pages as reads (settled 2026-10-25): what each of core's pages draws, read
 * whole over one request's `ReportCtx`, with what the report says on it beyond the run's
 * words (its host's `pages` hooks: additions, the record's words and rows, the Brief's
 * title, the poster, the search's example). The site's loaders call these, and the
 * report's door (`ReportCap`'s page methods) hands them to the hub, so a page has one
 * body wherever it is drawn. The catalogue's reader operations are the agent-sized cuts
 * of the same reads; these are the page's own.
 */
import { NotFound } from '@aicolab/app-kit/api/define'
import type { HexSpaceSpecInput } from '@aicolab/atlas/chessboard/content/space/hex-space-spec.ts'
import type {
	AnalysisPage,
	GalaxyData,
	Landscape,
	MethodData,
	ReportOverview,
	RunMethod,
	RunWords,
	TopicHit,
} from '@aicolab/insight-bridge-contracts/explorer'
import {
	assessedDocumentsSchema,
	metricEntriesSchema,
	perspectiveDocumentsSchema,
	questionDetailSchema,
	tagDocumentsSchema,
} from '@aicolab/insight-bridge-contracts/explorer'
import { z } from 'zod'
import { briefData, chapterReading } from '../../brief/data.ts'
import type { BriefData, ChapterReading } from '../../brief/types.ts'
import type { ReadingView } from '../../reader/reading-view.ts'
import type {
	ConnectAdditions,
	MethodAdditions,
	OverviewAdditions,
} from '../../report/additions.ts'
import type { HostNavItem } from '../../report/own-pages.ts'
import { sourcesData, sourcesSearchOf } from '../../sources/data.ts'
import type {
	SourceRow,
	SourceRowView,
	SourcesResult,
	SourcesSearch,
	SourcesVocabulary,
} from '../../sources/types.ts'
import { CANONICAL_RUN_SHAPE, worldReading, worldRecord, worldText } from '../../world/record.ts'
import {
	type WorldReading,
	type WorldReadingRef,
	type WorldRecord,
	type WorldText,
	type WorldTextRef,
	worldReadingRefSchema,
	worldReadingSchema,
	worldRecordSchema,
	worldTextRefSchema,
	worldTextSchema,
} from '../../world/schema.ts'
import {
	type AnalysisDrill,
	analysisDrill,
	analysisDrillSchema,
	analysisPage,
} from '../analysis.ts'
import { loadFacetCache } from '../facets.ts'
import * as pages from '../pages.ts'
import { perRecord, recordVersion } from '../reader.ts'
import { documentName } from '../readings.ts'
import { scopeKey } from '../scope.ts'
import type { ReportCtx } from './context.ts'
import { briefConfigOf, galaxyOptionsOf, sourcesConfigOf } from './readers.ts'
import { readingOf, readingTargetSchema } from './reading-of.ts'
import { runAccount } from './run-account.ts'

const fmt = (v: number) => v.toLocaleString('en-AU')

/** A path on the report's site, as a whole URL: a host on another origin draws it from there. */
const onSite = (ctx: ReportCtx, path: string) => new URL(path, ctx.origin).href

export type NavPageData = {
	words: RunWords
	/** The report's own pages, in the header after the sections they name. */
	pages: HostNavItem[]
	/** What the report says of its island, as its host declares it; none for the default. */
	island?: HexSpaceSpecInput
}

/**
 * The report's navigation: the run's words (its sections and its analysis tasks name
 * the header's entries) and the report's own pages. What a host needs to list a
 * report's places before any page is read (the hub's ring for a report).
 */
export function navPage(ctx: ReportCtx): NavPageData {
	return {
		words: ctx.run.words,
		pages: [...(ctx.host.ownPages ?? [])],
		...(ctx.host.island ? { island: ctx.host.island } : {}),
	}
}

export type OverviewPageData = {
	words: RunWords
	overview: ReportOverview
	landscape: Landscape
	additions: OverviewAdditions
}

/** The landing page: the record's figures and landscape, with what the report adds. */
export async function overviewPage(ctx: ReportCtx): Promise<OverviewPageData> {
	const words = ctx.run.words
	const documentFacet = ctx.host.documentFacet
	const [overview, landscape] = await Promise.all([
		pages.reportOverview(ctx.db, words, documentFacet ? { documentFacet } : {}, ctx.scope),
		pages.landscape(ctx.db, words, ctx.scope),
	])
	const own = (await ctx.host.pages?.overview?.(ctx, { overview, landscape })) ?? {}
	const poster = ctx.host.pages?.poster
	return {
		words,
		overview,
		landscape,
		additions: {
			...(documentFacet ? { documentFacet } : {}),
			...(poster ? { poster: onSite(ctx, poster) } : {}),
			...own,
		},
	}
}

export type MethodPageData = {
	words: RunWords
	data: MethodData
	method: RunMethod
	additions: MethodAdditions
}

/** The Method page: the run's account of itself, with what the report adds from it. */
export async function methodPage(ctx: ReportCtx): Promise<MethodPageData> {
	const account = await runAccount(ctx)
	const additions = (await ctx.host.pages?.method?.(ctx, account)) ?? {}
	return { words: ctx.run.words, data: account.data, method: account.method, additions }
}

export type ConnectPageData = {
	words: RunWords
	/** The report's MCP endpoint, a whole URL on its own origin: the hub's console calls it there. */
	endpoint: string
	/** The name the server calls itself, as an assistant lists it. */
	serverName: string
	additions: ConnectAdditions
}

/** The Connect page's words: the run's, with the report's MCP endpoint, its server's name and its reading notes. */
export async function connectPage(ctx: ReportCtx): Promise<ConnectPageData> {
	return {
		words: ctx.run.words,
		endpoint: onSite(ctx, ctx.host.mcpPath ?? '/mcp'),
		serverName: ctx.host.serverName,
		additions: (await ctx.host.pages?.connect?.(ctx)) ?? {},
	}
}

export type BriefPageData = BriefData & { words: RunWords; title: string }

/** The Brief (the topics page), whole, with its title. */
export async function briefPage(ctx: ReportCtx): Promise<BriefPageData> {
	const words = ctx.run.words
	const d = await briefData(ctx.db, briefConfigOf(ctx))
	const title =
		ctx.host.pages?.briefTitle?.(d.scale, ctx) ??
		`What ${fmt(d.scale.sources)} ${words.nouns.entities} said`
	return { ...d, words, title }
}

/** A Brief chapter's reading, opened when a reader opens it. */
export function chapterPage(
	ctx: ReportCtx,
	request: { chapterId: number; topicIds: number[]; full: boolean },
): Promise<ChapterReading | null> {
	return chapterReading(
		ctx.db,
		briefConfigOf(ctx),
		request.chapterId,
		request.topicIds,
		request.full,
	)
}

/** A row as core reads it where the report says nothing: the lens's values under the name, a chip per document. */
export function defaultRowView(row: SourceRow, words: RunWords): SourceRowView {
	const lens = words.lens
	const values = lens ? (row.facets[lens] ?? []) : []
	return {
		flags: [],
		sub: values.length
			? values.map((v) => (lens ? (words.facets[lens]?.values[v] ?? v) : v)).join(' · ')
			: null,
		chips: [
			{
				text: `${fmt(row.documents.length)} ${row.documents.length === 1 ? words.nouns.document : words.nouns.documents}`,
				tone: 'faint',
			},
		],
	}
}

export type SourcesPageData = SourcesResult & { words: RunWords; vocabulary: SourcesVocabulary }

/** The record of sources, a page at a time, each row with its view, and the page's words. */
export async function sourcesPage(ctx: ReportCtx, search: SourcesSearch): Promise<SourcesPageData> {
	const words = ctx.run.words
	const result = await sourcesData(ctx.db, await sourcesConfigOf(ctx), search)
	const hook = ctx.host.pages?.sources
	const views = hook?.view
		? await hook.view(result.rows, ctx)
		: result.rows.map((row) => defaultRowView(row, words))
	const viewOf = new Map(result.rows.map((row, i) => [row.entityId, views[i]]))
	const withView = (row: SourceRow): SourceRow => {
		const view = viewOf.get(row.entityId)
		return view ? { ...row, view } : row
	}
	const viewed: SourcesResult = {
		...result,
		rows: result.rows.map(withView),
		groups: result.groups.map((g) => ({ ...g, rows: g.rows.map(withView) })),
	}
	const vocabulary = hook?.vocabulary(viewed, ctx) ?? {
		source: words.nouns.entity,
		sources: words.nouns.entities,
		title: `All ${fmt(result.grandTotal)} ${words.nouns.entities}`,
		...(words.standfirst ? { standfirst: words.standfirst } : {}),
	}
	return { ...viewed, words, vocabulary }
}

export type GalaxyPageData = { words: RunWords; data: GalaxyData; poster: string | null }

/** The record as a sky, whole, with the poster that stands in while it loads. */
export async function galaxyPage(ctx: ReportCtx): Promise<GalaxyPageData> {
	const poster = ctx.host.pages?.poster
	return {
		words: ctx.run.words,
		data: await pages.galaxy(ctx.db, ctx.run.words, galaxyOptionsOf(ctx), ctx.scope),
		poster: poster ? onSite(ctx, poster) : null,
	}
}

export type SearchPageData = { words: RunWords; placeholder: string; semantic: boolean }

/** The topic search page's words: its example question, and whether it searches by meaning. */
export function searchPage(ctx: ReportCtx): SearchPageData {
	return {
		words: ctx.run.words,
		placeholder: ctx.host.pages?.searchPlaceholder ?? 'Ask the record a question…',
		semantic: ctx.nearest !== undefined,
	}
}

/** The topics nearest a reader's question, by meaning (the report's vector index), ranked by core. */
export async function topicSearchOf(ctx: ReportCtx, query: string): Promise<TopicHit[]> {
	const q = query.trim()
	if (!q) return []
	if (!ctx.nearest) throw new Error('This report has no vector index to search by meaning.')
	return pages.topicSearch(ctx.db, ctx.run.words, await ctx.nearest(q, 100), 24, ctx.scope)
}

export type AnalysisPageData = { words: RunWords; page: AnalysisPage | null }

/** A custom analysis task's page, by its kind; null when the run performed no task by that id. */
export async function analysisPageOf(ctx: ReportCtx, taskId: string): Promise<AnalysisPageData> {
	return {
		words: ctx.run.words,
		page: await analysisPage(ctx.db, ctx.run.words, taskId, ctx.scope),
	}
}

/** A document a drill-down lists: its id, the record's title and its file name. */
type Listed = { documentId: string; documentTitle: string | null; fileName: string }

/** The documents a drill-down's answer lists, by the request's kind. */
function listedIn(kind: AnalysisDrill['kind'], data: unknown): Listed[] {
	switch (kind) {
		case 'tagDocuments':
			return tagDocumentsSchema.nullable().parse(data)?.documents ?? []
		case 'perspectiveDocuments':
			return perspectiveDocumentsSchema.nullable().parse(data)?.documents ?? []
		case 'assessedDocuments':
			return assessedDocumentsSchema.nullable().parse(data)?.documents ?? []
		case 'metricEntries':
			return metricEntriesSchema.nullable().parse(data)?.entries ?? []
		case 'questionDetail':
			return (
				questionDetailSchema
					.nullable()
					.parse(data)
					?.byLensValue.flatMap((group) => group.answers) ?? []
			)
		case 'perspectiveGroups':
			return []
	}
}

/** Each listed document's name, by the report's naming (its readings' `documentLabel`) or core's. */
async function namesOf(ctx: ReportCtx, listed: readonly Listed[]): Promise<Record<string, string>> {
	const label = ctx.host.readings?.documentLabel
	const facets = label && listed.length ? await loadFacetCache(ctx.db, 'document') : null
	return Object.fromEntries(
		listed.map((d) => [
			d.documentId,
			documentName(
				{
					documentId: d.documentId,
					title: d.documentTitle,
					fileName: d.fileName,
					facets: facets?.get(d.documentId) ?? {},
				},
				label,
			),
		]),
	)
}

/** A drill-down's answer, and the name of every document it lists. */
export type AnalysisDrillData = {
	data: Awaited<ReturnType<typeof analysisDrill>>
	names: Record<string, string>
}

/**
 * A drill-down an analysis page opens, with every document it lists named on the server
 * by the report's naming (settled 2026-10-25), so any host shows the same names.
 */
export async function analysisDrillOf(
	ctx: ReportCtx,
	request: AnalysisDrill,
): Promise<AnalysisDrillData> {
	const data = await analysisDrill(ctx.db, ctx.run.words, request, ctx.scope)
	return { data, names: await namesOf(ctx, listedIn(request.kind, data)) }
}

/*
 * An island's three reads, each kept per record (../reader) while its version
 * holds, in the isolate and in the data centre's cache every server there
 * shares: building the island record read the whole record from D1 on every
 * call (Second Chair's 3.9 MB took 1.4–2.5 s, a second call no faster,
 * 2026-10-28). Kept whichever way they are asked: the door (`ReportCap`) and
 * the site's routes read through these. A record's version names its run, and
 * a run's shape is its app's own, so the shape is no part of a key.
 */
const keptWorld = perRecord(
	worldRecord,
	(config) => JSON.stringify([config.slug, config.words ?? null, scopeKey(config.scope)]),
	{ name: 'world', schema: worldRecordSchema },
)
const keptWorldText = perRecord(
	worldText,
	(ref, _shape, scope) => JSON.stringify([ref, scopeKey(scope)]),
	{ name: 'world-text', schema: worldTextSchema.nullable() },
)
const keptWorldReading = perRecord(
	worldReading,
	(ref, _shape, scope) => JSON.stringify([ref, scopeKey(scope)]),
	{ name: 'world-reading', schema: worldReadingSchema.nullable() },
)

/** The report as an island is built from it, or null where the report serves no world. */
export async function worldOf(ctx: ReportCtx): Promise<WorldRecord | null> {
	const world = ctx.host.world
	if (world === null) return null
	return keptWorld(ctx.db, {
		slug: ctx.host.slug,
		shape: world?.shape ?? CANONICAL_RUN_SHAPE,
		...(world?.words ? { words: world.words } : {}),
		...(ctx.scope ? { scope: ctx.scope } : {}),
	})
}

/** The version of the record an island is built from, or null where the report serves no
 *  world: what a browser keeps the island's reads under, so a copy it holds is used only
 *  while the record is the same (island/world-cache.ts). The version the reads above are
 *  kept under, read from the data centre's cache. */
export async function worldVersionOf(ctx: ReportCtx): Promise<string | null> {
	if (ctx.host.world === null) return null
	return recordVersion(ctx.db)
}

/** One room's text for an island: the writing its walls carry, read when it is entered. */
export async function worldTextOf(ctx: ReportCtx, ref: WorldTextRef): Promise<WorldText | null> {
	const world = ctx.host.world
	if (world === null) return null
	return keptWorldText(ctx.db, ref, world?.shape ?? CANONICAL_RUN_SHAPE, ctx.scope)
}

/** One item's reading for an island: the key points the record counts but does not carry. */
export async function worldReadingOf(
	ctx: ReportCtx,
	ref: WorldReadingRef,
): Promise<WorldReading | null> {
	const world = ctx.host.world
	if (world === null) return null
	return keptWorldReading(ctx.db, ref, world?.shape ?? CANONICAL_RUN_SHAPE, ctx.scope)
}

/* ───────────────────────── the pages by name ───────────────────────── */

/** A Brief chapter's reading, as the page asks for it. */
const chapterRequestSchema = z.object({
	chapterId: z.number().int(),
	topicIds: z.array(z.number().int()).max(500),
	full: z.boolean(),
})

/** What each page read answers, by name. */
export type PageResults = {
	navPage: NavPageData
	overviewPage: OverviewPageData
	methodPage: MethodPageData
	connectPage: ConnectPageData
	briefPage: BriefPageData
	chapterPage: ChapterReading | null
	sourcesPage: SourcesPageData
	galaxyPage: GalaxyPageData
	searchPage: SearchPageData
	topicSearch: TopicHit[]
	analysisPage: AnalysisPageData
	analysisDrill: AnalysisDrillData
	reading: ReadingView | null
	world: WorldRecord | null
	worldVersion: string | null
	worldText: WorldText | null
	worldReading: WorldReading | null
}
export type PageName = keyof PageResults

/**
 * Every page read by name, each checking its own input: one table for every way a page is
 * read — in this isolate (`ReportCap`'s page methods) or through a door to where the
 * record lives (a pipeline run's store, `answerPage`).
 */
const PAGE_READS: { [N in PageName]: (ctx: ReportCtx, input: unknown) => Promise<PageResults[N]> } =
	{
		navPage: async (ctx) => navPage(ctx),
		overviewPage: (ctx) => overviewPage(ctx),
		methodPage: (ctx) => methodPage(ctx),
		connectPage: (ctx) => connectPage(ctx),
		briefPage: (ctx) => briefPage(ctx),
		chapterPage: (ctx, input) => chapterPage(ctx, chapterRequestSchema.parse(input)),
		sourcesPage: (ctx, input) => sourcesPage(ctx, sourcesSearchOf(input)),
		galaxyPage: (ctx) => galaxyPage(ctx),
		searchPage: async (ctx) => searchPage(ctx),
		topicSearch: (ctx, input) => topicSearchOf(ctx, z.string().max(2000).parse(input)),
		analysisPage: (ctx, input) => analysisPageOf(ctx, z.string().max(200).parse(input)),
		analysisDrill: (ctx, input) => analysisDrillOf(ctx, analysisDrillSchema.parse(input)),
		reading: (ctx, input) => readingOf(ctx, readingTargetSchema.parse(input)),
		world: (ctx) => worldOf(ctx),
		worldVersion: (ctx) => worldVersionOf(ctx),
		worldText: (ctx, input) => worldTextOf(ctx, worldTextRefSchema.parse(input)),
		worldReading: (ctx, input) => worldReadingOf(ctx, worldReadingRefSchema.parse(input)),
	}

const pageNames: ReadonlySet<string> = new Set(Object.keys(PAGE_READS))

/** One page read by name, over a report's context; a name that is no page is not found (a door's caller names it at run time). */
export function readPage<N extends PageName>(
	ctx: ReportCtx,
	name: N,
	input: unknown,
): Promise<PageResults[N]> {
	if (!pageNames.has(name)) return Promise.reject(new NotFound(`No page ${name}.`))
	const read: (ctx: ReportCtx, input: unknown) => Promise<PageResults[N]> = PAGE_READS[name]
	return read(ctx, input)
}
