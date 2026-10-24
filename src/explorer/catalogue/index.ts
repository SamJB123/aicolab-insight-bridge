/**
 * @aicolab/insight-bridge/explorer/catalogue — every read of a report, defined once with
 * app-kit's `Operation` and served three ways by whoever hosts the record: MCP (a tool
 * per read, a resource for a topic, a source or a document, the readings as structured
 * results), REST with OpenAPI (a route per read), and the capability object the hub's
 * door hands over (a method per read). One table replaces the tool table every report
 * served (../tools) and the pages' server functions, report by report (2026-10-24).
 *
 * The catalogue is a function of the run: descriptions and examples are written in the
 * run's own words and from its own facts (./support `toolContext`), so a host builds it
 * once per record version — `reportCatalogue(run)` is kept per `ToolContext` object —
 * and each read runs with a `ReportCtx` (./context) the host builds per request.
 *
 * What a report adds of its own (a tool only its tables can answer) is its own file of
 * operations beside this catalogue; the scope it reads the record in is its own too.
 */
import type { AnyOperation } from '@aicolab/app-kit/api/define'
import type { ReportCtx } from './context.ts'
import { readersFor } from './readers.ts'
import { GROUP, readsFor } from './reads.ts'
import type { ToolContext } from './support.ts'

export type { ReadingAdditionsFor, ReportCtx, ReportHost } from './context.ts'
export { readContext } from './context.ts'
export { briefConfigOf, galaxyOptionsOf, readingContextOf, sourcesConfigOf } from './readers.ts'
export { GROUP } from './reads.ts'
export {
	documentMarkdown,
	documentUrl,
	groupUrl,
	sourceMarkdown,
	sourceUrl,
	topicMarkdown,
	topicUrl,
} from './shapes.ts'
export {
	type NearestPassages,
	notPrevalence,
	type ToolContext,
	toolContext,
} from './support.ts'

/** The catalogue for one run: what it serves, in the surfaces' order, and each read by name. */
export interface ReportCatalogue {
	/** Every operation this run serves, in the order the surfaces list them. */
	operations: AnyOperation<ReportCtx>[]
	/** The run's reads by name (every read, served or not), for a host that calls one directly. */
	reads: ReturnType<typeof readsFor>
	readers: ReturnType<typeof readersFor>
	/** The Connect page's groups, in the order they read. */
	groups: readonly string[]
}

const built = new WeakMap<ToolContext, ReportCatalogue>()

/** The catalogue for a run's facts, built once per `ToolContext` object (which ./support keeps per record version). */
export function reportCatalogue(run: ToolContext): ReportCatalogue {
	const kept = built.get(run)
	if (kept) return kept
	const reads = readsFor(run)
	const readers = readersFor(run)
	const catalogue: ReportCatalogue = {
		operations: [...reads.served, ...readers.served],
		reads,
		readers,
		groups: Object.values(GROUP),
	}
	built.set(run, catalogue)
	return catalogue
}

/**
 * The connector's instructions: what the record is, its scale and the usual path through
 * the tools, then whatever the host's own rules add. The SDK takes them when the host
 * constructs its server, before the tools register.
 */
export function reportInstructions(run: ToolContext, extra?: string): string {
	const { words, overview } = run
	const { entity, entities, documents } = words.nouns
	const lens = words.lens ? (words.facets[words.lens]?.heading ?? words.lens).toLowerCase() : null
	const fmt = (n: number) => n.toLocaleString('en-US')
	// the standfirst runs on into the counts: its own closing stop would read "record.: 150"
	const standfirst = words.standfirst?.trim().replace(/[.;:]+$/, '')
	return (
		`This connector serves "${words.title}"${standfirst ? ` — ${standfirst}` : ''}: ${fmt(overview.documents)} ${documents} from ${fmt(overview.entities)} ${entities}, ` +
		`split into ${fmt(overview.chunks)} passages and clustered into ${fmt(overview.clusters - overview.junkConfirmedClusters)} cross-document topics, each synthesised with key points, verbatim quotes, ` +
		`per-${entity} perspectives and comparative perspectives${lens ? ` by ${lens}` : ''}` +
		(overview.tagCategories.length
			? `; ${entities} and ${documents} carry controlled vocabularies (${overview.tagCategories.map((t) => t.category).join(', ')})`
			: '') +
		(overview.questions ? `; answers to ${overview.questions} questions are recorded` : '') +
		'. Typical flow: corpus_overview → find_topics / list_topics → get_topic, topic_quotes, source_perspectives → get_source / get_document for source-level detail; contested_topics for the disagreements. Every listing is a page (offset, limit) with its total; a detail says where the rest is. Ids round-trip between tools, and a topic, a source or a document is also a Markdown resource (report://topics/{topic_id}, report://sources/{source}, report://documents/{document_id}). ' +
		`${entity.charAt(0).toUpperCase()}${entity.slice(1)} counts are NOT prevalence: these are the ${entities} in this record, not a sample of any population. ` +
		(extra ? ` ${extra}` : '')
	).trimEnd()
}
