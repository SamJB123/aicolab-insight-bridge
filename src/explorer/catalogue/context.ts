/**
 * What every read of the report catalogue runs with, and what a host says of its
 * report beyond the run's own words. The host (a report app, the pipeline's run
 * connector, the hub's door) builds one `ReportCtx` per request: one request's reader
 * over the record, the run's facts, the reader's scope, its vector search where it has
 * one, and the site's origin for whole links. Nothing here reads a request.
 */
import type {
	DocumentDetail,
	EntityDetail,
	GroupDetail,
	Landscape,
	ReportOverview,
	TopicDetail,
} from '@aicolab/insight-bridge-contracts/explorer'
import type { CorpusDb } from '@aicolab/insight-bridge-contracts/schema'
import type { MethodAuthored } from '../../method.ts'
import type {
	ConnectAdditions,
	MethodAdditions,
	OverviewAdditions,
} from '../../report/additions.ts'
import type {
	DerivedFacet,
	SourceRow,
	SourceRowView,
	SourcesResult,
	SourcesVocabulary,
} from '../../sources/types.ts'
import type { WorldShape, WorldWords } from '../../world/record.ts'
import type { ReadingAdditions, ReadingContext } from '../readings.ts'
import type { ReadScope } from '../scope.ts'
import type { RunAccount } from './run-account.ts'
import type { LinkSite, SectionRoutes } from './shapes.ts'
import type { NearestPassages, ToolContext, ToolReadContext } from './support.ts'

/** What an app adds to a reading from its own facets and tables (../readings `ReadingAdditions`), read for one subject. */
export interface ReadingAdditionsFor {
	topic?: (detail: TopicDetail, ctx: ReportCtx) => Promise<ReadingAdditions>
	group?: (detail: GroupDetail, ctx: ReportCtx) => Promise<ReadingAdditions>
	source?: (
		detail: EntityDetail,
		sole: DocumentDetail | null,
		ctx: ReportCtx,
	) => Promise<ReadingAdditions>
	document?: (detail: DocumentDetail, ctx: ReportCtx) => Promise<ReadingAdditions>
}

/**
 * What a report says on core's pages beyond the run's words, computed on the server for
 * one request (settled 2026-10-25): its additions as data, its record page's words and
 * how each row reads, the Brief's title, the galaxy's poster and the search's example.
 * The site's loaders and the hub's door read the pages through core's page reads
 * (./page-reads.ts), which call these, so a page says one thing wherever it is drawn.
 */
export interface PageHooks {
	/** The overview's additions, given the page's own figures and landscape. */
	overview?: (
		ctx: ReportCtx,
		page: { overview: ReportOverview; landscape: Landscape },
	) => Promise<OverviewAdditions>
	/** The Method page's additions, given the run's account (its documents by the document facet among it). */
	method?: (ctx: ReportCtx, account: RunAccount) => Promise<MethodAdditions>
	connect?: (ctx: ReportCtx) => Promise<ConnectAdditions>
	sources?: {
		/** The record page's words, given the page it heads. */
		vocabulary: (result: SourcesResult, ctx: ReportCtx) => SourcesVocabulary
		/** How each row reads; core's default view (the lens, the documents) where absent. */
		view?: (rows: readonly SourceRow[], ctx: ReportCtx) => Promise<SourceRowView[]>
	}
	/** The Brief's title, given the record's scale. */
	briefTitle?: (scale: { sources: number; topics: number }, ctx: ReportCtx) => string
	/** The galaxy's poster, by its path on the report's site. */
	poster?: string
	/** The topic search's example question. */
	searchPlaceholder?: string
}

/**
 * What a host says of its report beyond the run's words: everything optional, and
 * every absence falls back to what the run already knows (the lens, the site's filters,
 * the pipeline's own method account).
 */
export interface ReportHost {
	/** The report's stable key: the app's slug, or a run id. */
	slug: string
	/** The document facet the overview sorts documents by (Training Data: `document_type`). */
	documentFacet?: string
	/** The sky's seed and the contributor facets its dust is read by; the lens alone when absent. */
	galaxy?: { seed: number; facets?: { key: string; label: string }[] }
	/** What the host authored of its own collection and site, around the derived method. */
	method?: MethodAuthored
	/** The record's filters where the site's own say nothing, and the host's derived facets. */
	sources?: {
		filters?: string[]
		groupBy?: string | null
		derived?: DerivedFacet[]
		/** A facet's value order, where the run's words give none. */
		order?: Record<string, string[]>
		/** A facet's short words for its values, where the run's words give none. */
		labels?: Record<string, Record<string, string>>
		/** A facet's heading where the run's words give none (a derived facet's). */
		headings?: Record<string, string>
		/** Row order: the grouping facet always first (an entry here for it sets only its direction:
		 *  Second Chair's eras newest first), then these, then the name (Long Form: each period's
		 *  episodes by date). */
		sort?: { facet: string; desc?: boolean }[]
	}
	/** How this report's readings read: its fixed words, how it names and orders documents, what it adds. */
	readings?: Pick<ReadingContext, 'vocabulary' | 'documentLabel' | 'documentOrder'> & {
		additions?: ReadingAdditionsFor
	}
	/** The host's own standing caveats, after the run's, in the connector's instructions. */
	notes?: string
	/** The routes of the sections a reading opens on, where the site's differ from the section's name. */
	routes?: SectionRoutes
	/** The path of the report's MCP endpoint on its origin, where it is not '/mcp' (a pipeline run's '/mcp/<run>'). */
	mcpPath?: string
	/** What the report says on core's pages beyond the run's words. */
	pages?: PageHooks
	/** How the world record reads this run's tables (the canonical shape where absent) and the words it reads in; null where the report serves no world. */
	world?: { shape?: WorldShape; words?: WorldWords } | null
}

export interface ReportCtx {
	/** One request's reader over the record (../reader `requestReader`). */
	db: CorpusDb
	/** The run's facts the descriptions were written from (./support `toolContext`). */
	run: ToolContext
	/** The reader's scope: what the host's own rules make of the record's sources for this request. */
	scope?: ReadScope
	/** The host's nearest passages over its vector index; absent, a search reads by text. */
	nearest?: NearestPassages
	/** This report's public origin, so every link a result carries is whole. */
	origin: string
	host: ReportHost
}

/** Where every link a result carries starts, from a report's context. */
export const siteOf = (ctx: ReportCtx): LinkSite => ({
	origin: ctx.origin,
	...(ctx.host.routes ? { routes: ctx.host.routes } : {}),
})

/** The context the explorer reads take, from a report's. */
export const readContext = (ctx: ReportCtx): ToolReadContext => ({
	db: ctx.db,
	words: ctx.run.words,
	...(ctx.scope ? { scope: ctx.scope } : {}),
})
