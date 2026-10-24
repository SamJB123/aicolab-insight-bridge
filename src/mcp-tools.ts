/**
 * @aicolab/insight-bridge/mcp-tools — what a report's MCP server says about
 * its own tools, and what the Connect page's console does with it. One
 * definition for both ends: a server marks each tool's group with
 * `toolGroup(...)` and each input's example with zod's `.meta({ examples })`;
 * the console reads them back from the live `tools/list`, so a report's tool
 * list exists once, in the server that answers it.
 *
 * Plain TypeScript, no Solid: a server imports it beside the MCP SDK.
 */

/** The `_meta` key a tool's group rides in (MCP reserves only `modelcontextprotocol`/`mcp` prefixes). */
export const TOOL_GROUP_KEY = 'aicolab.org/group'

/** A tool's `_meta`, naming the group the Connect page lists it under: `{ _meta: toolGroup('Documents') }`. */
export const toolGroup = (title: string): Record<string, string> => ({ [TOOL_GROUP_KEY]: title })

/** An input's JSON Schema, as far as the console reads it. */
export interface InputSchema {
	type?: string
	description?: string
	enum?: Array<string | number | boolean>
	default?: unknown
	examples?: unknown[]
	minimum?: number
	maximum?: number
	minLength?: number
	items?: InputSchema
	properties?: Record<string, InputSchema>
	required?: string[]
}

/** A tool as `tools/list` returns it. */
export interface ConsoleTool {
	name: string
	title?: string
	description?: string
	inputSchema: InputSchema
	_meta?: Record<string, unknown>
}

export interface ToolResult {
	content?: Array<{ type: string; text?: string }>
	structuredContent?: unknown
	isError?: boolean
}

/** An input's starting value in the console: its default, else its first example, else empty. */
export function initialValue(schema: InputSchema): string {
	const value = schema.default !== undefined ? schema.default : schema.examples?.[0]
	if (value === undefined || value === null) return ''
	return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** The console's text fields, parsed and checked against the tool's own schema. Throws a reader-facing message. */
export function toolArguments(
	tool: ConsoleTool,
	values: Record<string, string>,
): Record<string, unknown> {
	const args: Record<string, unknown> = {}
	for (const [name, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
		const value = (values[name] ?? '').trim()
		if (!value) {
			if (tool.inputSchema.required?.includes(name)) throw new Error(`${name} is required.`)
			continue
		}
		let parsed: unknown = value
		if (schema.type === 'integer' || schema.type === 'number') {
			parsed = Number(value)
			if (!Number.isFinite(parsed) || (schema.type === 'integer' && !Number.isInteger(parsed)))
				throw new Error(`${name} must be ${schema.type === 'integer' ? 'an integer' : 'a number'}.`)
			if (schema.minimum !== undefined && Number(parsed) < schema.minimum)
				throw new Error(`${name} must be at least ${schema.minimum}.`)
			if (schema.maximum !== undefined && Number(parsed) > schema.maximum)
				throw new Error(`${name} must be at most ${schema.maximum}.`)
		} else if (schema.type === 'boolean') {
			if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false.`)
			parsed = value === 'true'
		} else if (schema.type === 'object' || schema.type === 'array') {
			try {
				parsed = JSON.parse(value)
			} catch {
				throw new Error(`${name} must be valid JSON.`)
			}
			if (
				schema.type === 'array'
					? !Array.isArray(parsed)
					: !parsed || typeof parsed !== 'object' || Array.isArray(parsed)
			)
				throw new Error(`${name} must be a JSON ${schema.type}.`)
		}
		if (schema.enum && !schema.enum.some((option) => option === parsed))
			throw new Error(`${name} must be one of the listed values.`)
		if (
			schema.minLength !== undefined &&
			typeof parsed === 'string' &&
			parsed.length < schema.minLength
		)
			throw new Error(`${name} is too short.`)
		args[name] = parsed
	}
	return args
}

/** A tool result's text, as an agent would read it. */
export function resultText(result: ToolResult): string {
	return (
		result.content
			?.filter((c) => c.type === 'text')
			.map((c) => c.text ?? '')
			.join('\n') || JSON.stringify(result.structuredContent ?? result, null, 2)
	)
}

/** The protocol revision the console speaks: every request carries the `_meta` envelope
 *  (revision, capabilities, client) and the headers that must agree with the body. A
 *  server of the earlier revision ignores both. */
export const PROTOCOL_VERSION = '2026-07-28'

/** What the console declares about itself on every request. It can answer no ask. */
export const CONSOLE_ENVELOPE = {
	'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
	'io.modelcontextprotocol/clientCapabilities': {},
	'io.modelcontextprotocol/clientInfo': { name: 'insight-bridge-connect-console', version: '1' },
}

/** A request's params as the console sends them: the envelope first, then the call's own. */
export const consoleParams = (params: Record<string, unknown>): Record<string, unknown> => ({
	_meta: CONSOLE_ENVELOPE,
	...params,
})

/** The last `data:` line of a server-sent event stream: a server that answers a request as
 *  a stream ends it with the response. */
function lastEvent(text: string): string | null {
	const lines = text.split('\n').filter((line) => line.startsWith('data:'))
	const last = lines.at(-1)
	return last ? last.slice(5).trim() : null
}

/** One JSON-RPC round trip to the report's own endpoint, as an agent makes it. */
export async function mcpRequest<T>(
	endpoint: string,
	id: number,
	method: string,
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<T> {
	const name = params.name ?? params.uri
	const response = await fetch(endpoint, {
		method: 'POST',
		// the hub calls a report's endpoint on the report's origin (core's server/report-cors)
		credentials: 'include',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			'mcp-protocol-version': PROTOCOL_VERSION,
			'mcp-method': method,
			...(typeof name === 'string' ? { 'mcp-name': name } : {}),
		},
		body: JSON.stringify({ jsonrpc: '2.0', id, method, params: consoleParams(params) }),
		signal,
	})
	const text = await response.text()
	const streamed = (response.headers.get('content-type') ?? '').includes('text/event-stream')
	let body: { error?: { message?: string; data?: unknown }; result?: T }
	try {
		body = JSON.parse((streamed ? lastEvent(text) : null) ?? text)
	} catch {
		throw new Error(`The server returned HTTP ${response.status} without a JSON-RPC response.`)
	}
	if (body.error) {
		const data = typeof body.error.data === 'string' ? `: ${body.error.data}` : ''
		throw new Error(
			`${body.error.message ?? `MCP request failed (HTTP ${response.status})`}${data}`,
		)
	}
	if (!response.ok) throw new Error(`MCP request failed (HTTP ${response.status}).`)
	if (body.result === undefined) throw new Error('The server returned no MCP result.')
	return body.result
}

/** Every tool the server lists, following its cursor. */
export async function listTools(
	endpoint: string,
	nextId: () => number,
	signal?: AbortSignal,
): Promise<ConsoleTool[]> {
	const tools: ConsoleTool[] = []
	let cursor: string | undefined
	do {
		const page = await mcpRequest<{ tools: ConsoleTool[]; nextCursor?: string }>(
			endpoint,
			nextId(),
			'tools/list',
			cursor ? { cursor } : {},
			signal,
		)
		tools.push(...page.tools)
		cursor = page.nextCursor
	} while (cursor)
	return tools
}

/** The group a tool's server put it in, if any. */
export const groupOf = (tool: ConsoleTool): string | null => {
	const group = tool._meta?.[TOOL_GROUP_KEY]
	return typeof group === 'string' && group ? group : null
}

/**
 * The tools by their server's groups, in the order the server lists them; a
 * tool with no group closes the list under "Other tools" (a null title when
 * no tool has a group at all).
 */
export function groupTools(tools: readonly ConsoleTool[]) {
	const groups = new Map<string, ConsoleTool[]>()
	const loose: ConsoleTool[] = []
	for (const tool of tools) {
		const group = groupOf(tool)
		if (group) groups.set(group, [...(groups.get(group) ?? []), tool])
		else loose.push(tool)
	}
	return [
		...[...groups].map(([title, members]): { title: string | null; tools: ConsoleTool[] } => ({
			title,
			tools: members,
		})),
		...(loose.length ? [{ title: groups.size ? 'Other tools' : null, tools: loose }] : []),
	]
}
