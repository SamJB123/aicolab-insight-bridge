/**
 * @aicolab/insight-bridge — the layer every Insight Bridge corpus explorer
 * shares. CLIENT/UI entry point.
 *
 *   • BRAND — the attribution mark that sits under a consumer app's wordmark.
 *   • THE SHARED PAGE — `InsightBridgeAbout`, mounted at a consumer's own
 *     `/insight-bridge` route: the pipeline, the other corpora, and what agents
 *     can do with any of them.
 *   • THE READING RULES — `InsightBridgeReading`, mounted on the consumer's
 *     method page beside its own account of its run.
 *
 * Both render inside the host, so they inherit the host's theme.
 *
 * Server-side helpers live behind `@aicolab/insight-bridge/server` and are
 * deliberately NOT re-exported here, so rendering the mark never pulls MCP
 * transport or auth code into a client bundle.
 *
 * A package cannot ship a route: `createFileRoute` is keyed off a generated
 * augmentation that is empty outside an app, so each consumer writes a thin
 * route file that renders these components. That is TanStack's intended
 * pattern, not a workaround.
 *
 * Anything corpus-specific belongs in the consumer app. The test is whether a
 * sentence stays true when the corpus changes.
 */

export {
	type AboutProps,
	INSIGHT_BRIDGE_TAGLINE,
	INSIGHT_BRIDGE_TITLE,
	InsightBridgeAbout,
	InsightBridgeFamily,
	InsightBridgeLede,
	InsightBridgeMcp,
	InsightBridgePipeline,
	InsightBridgeReading,
	InsightBridgeRespect,
	InsightBridgeSteps,
	type ReadingProps,
} from './about.tsx'
export {
	InsightBridgeGlyph,
	PoweredByInsightBridge,
	type PoweredByInsightBridgeProps,
} from './brand.tsx'
export { type Corpus, CORPORA, siblings } from './corpora.ts'
