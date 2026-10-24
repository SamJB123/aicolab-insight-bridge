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
	TopicDetail,
} from '@aicolab/insight-bridge-contracts/explorer'
import type { CorpusDb } from '@aicolab/insight-bridge-contracts/schema'
import type { MethodAuthored } from '../../method.ts'
import type { DerivedFacet } from '../../sources/types.ts'
import type { ReadingAdditions, ReadingContext } from '../readings.ts'
import type { ReadScope } from '../scope.ts'
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
	}
	/** How this report's readings read: its fixed words, how it names and orders documents, what it adds. */
	readings?: Pick<ReadingContext, 'vocabulary' | 'documentLabel' | 'documentOrder'> & {
		additions?: ReadingAdditionsFor
	}
	/** The host's own standing caveats, after the run's, in the connector's instructions. */
	notes?: string
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

/** The context the explorer reads take, from a report's. */
export const readContext = (ctx: ReportCtx): ToolReadContext => ({
	db: ctx.db,
	words: ctx.run.words,
	...(ctx.scope ? { scope: ctx.scope } : {}),
})
