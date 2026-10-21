/**
 * @aicolab/insight-bridge/explorer/mcp — a report's MCP baseline: core's tool
 * table (tools.ts) registered on a server. One definition: the pipeline's
 * per-run connector serves the table from its run store, an app from its own
 * D1 in the reader's scope (`explorerToolHost(db, scope)`), and each app then
 * adds the tools only its own tables can answer.
 *
 * What a server says about each tool is the run's own, read once per request
 * (`explorerToolContext`): the descriptions in the run's nouns and lens, each
 * tool in its Connect-page group (`toolGroup`), each input's example a real
 * value of this run. A search tool asks the host's vector index for its
 * passages first, when the host has one.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'
import { toolGroup } from '../mcp-tools.ts'
import {
	EXPLORER_TOOLS,
	type ExplorerToolHost,
	type NearestPassages,
	notPrevalence,
	type ToolContext,
} from './tools.ts'

export type { ExplorerToolHost, NearestPassages, ToolContext }

export interface ExplorerServerOptions {
	host: ExplorerToolHost
	/** The host's vector search; absent, the search tools read passages by text. */
	nearest?: NearestPassages
	/** What the host's own rules add to the connector's instructions (a gate's notice, a caveat). */
	instructions?: string
}

/** A tool's answer as MCP text content: the data as indented JSON. Every report's own tools answer with it too. */
export const toolText = (data: unknown): { content: { type: 'text'; text: string }[] } => ({
	content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
})
const fmt = (n: number) => n.toLocaleString('en-US')

/** An input schema with this run's examples on it. */
const withExamples = (
	input: Record<string, z.ZodType>,
	examples: Record<string, unknown> | undefined,
) =>
	Object.fromEntries(
		Object.entries(input).map(([key, schema]) => {
			const example = examples?.[key]
			return [
				key,
				example === undefined || example === null ? schema : schema.meta({ examples: [example] }),
			]
		}),
	)

/** Register every tool this run serves on `server`, over the host. */
export function registerExplorerTools(
	server: McpServer,
	context: ToolContext,
	options: ExplorerServerOptions,
): void {
	for (const [name, t] of Object.entries(EXPLORER_TOOLS)) {
		if (t.when && !t.when(context)) continue
		server.registerTool(
			name,
			{
				title: t.title(context),
				description: t.description(context),
				_meta: toolGroup(t.group(context)),
				inputSchema: withExamples(t.input, t.examples?.(context)),
			},
			async (args) => {
				const search = t.searches
				const query = search ? args[search.query] : undefined
				const nearest =
					search && options.nearest && typeof query === 'string'
						? [...(await options.nearest(query, search.topK(args)))]
						: undefined
				return toolText(await options.host.explorerTool(name, args, nearest))
			},
		)
	}
}

/**
 * The connector's instructions: what the record is, its scale and the usual
 * path through the tools, then whatever the host's own rules add. The SDK
 * takes them when the host constructs its server, before the tools register.
 */
export function explorerInstructions(context: ToolContext, extra?: string): string {
	const { words, overview } = context
	const { entity, entities, documents } = words.nouns
	const lens = words.lens ? (words.facets[words.lens]?.heading ?? words.lens).toLowerCase() : null
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
		'. Typical flow: corpus_overview → find_topics / list_topics → get_topic, topic_quotes, source_perspectives → get_source / get_document for source-level detail; contested_topics for the disagreements. Ids round-trip between tools. ' +
		notPrevalence(words, overview.entities) +
		(extra ? ` ${extra}` : '')
	)
}
