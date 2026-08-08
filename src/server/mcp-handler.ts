// This file has no runtime-specific imports and would survive a client bundle,
// but it is server-side by intent — marking it keeps the boundary honest and
// makes an accidental client import a named diagnostic rather than dead weight.
import '@tanstack/solid-start/server-only'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

/**
 * Bridge a single JSON-RPC request into an `McpServer` and return its reply.
 *
 * The MCP SDK talks over a transport, not request/response, so we wire an
 * in-memory linked transport pair: the server handles the message on one end and
 * we capture its reply on the other, then serialize it back as JSON. This is the
 * minimal, stateless "one POST = one JSON-RPC round trip" adapter for the Workers
 * runtime (no long-lived transport).
 */
export async function handleMcpRequest(request: Request, server: McpServer): Promise<Response> {
	try {
		const jsonRpcRequest = (await request.json()) as JSONRPCMessage

		// JSON-RPC notifications (and responses) have no `id` and get NO reply.
		// Critically, the client sends `notifications/initialized` right after the
		// initialize handshake and expects an immediate 202 — waiting for a reply
		// that never comes hangs the handshake and the client reports "no tools".
		const isRequest = typeof jsonRpcRequest === 'object' && jsonRpcRequest !== null && 'id' in jsonRpcRequest

		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

		let settle: (m: JSONRPCMessage | null) => void = () => {}
		const reply = new Promise<JSONRPCMessage | null>((resolve) => {
			settle = resolve
		})
		clientTransport.onmessage = (message: JSONRPCMessage) => settle(message)
		const fallback = setTimeout(() => settle(null), 30_000)

		await server.connect(serverTransport)
		await clientTransport.start()
		await serverTransport.start()
		await clientTransport.send(jsonRpcRequest)

		if (!isRequest) {
			// notification / response: acknowledge immediately, don't wait for a reply
			clearTimeout(fallback)
			await clientTransport.close()
			await serverTransport.close()
			return new Response(null, { status: 202 })
		}

		const responseData = await reply
		clearTimeout(fallback)
		await clientTransport.close()
		await serverTransport.close()

		if (responseData === null) return new Response(null, { status: 204 })
		return Response.json(responseData, { headers: { 'Content-Type': 'application/json' } })
	} catch (error) {
		console.error('MCP handler error:', error)
		return Response.json(
			{
				jsonrpc: '2.0',
				error: {
					code: -32603,
					message: 'Internal server error',
					data: error instanceof Error ? error.message : String(error),
				},
				id: null,
			},
			{ status: 500, headers: { 'Content-Type': 'application/json' } },
		)
	}
}
