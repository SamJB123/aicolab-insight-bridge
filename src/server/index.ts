/**
 * Server-only entry point — `@aicolab/insight-bridge/server`.
 *
 * Kept behind its own subpath so a consumer rendering the brand mark or the
 * shared page never pulls MCP transport or auth code into its client bundle.
 * Nothing here may be imported from the root entry, and nothing here may
 * import a platform module directly: the consumer passes `env` in.
 */

export { handleMcpRequest } from './mcp-handler.ts'
export { resolveViewer, type Viewer, type ViewerEnv } from './member.ts'
