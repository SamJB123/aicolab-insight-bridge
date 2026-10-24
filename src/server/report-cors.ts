/**
 * Which pages on other origins may call a report's MCP endpoint from a browser: the
 * hub's (settled 2026-10-25), so the Connect console the hub draws calls the report's
 * real endpoint, as it does on the report's own site. Only the origins the report's
 * Worker names in `HUB_ORIGINS`; a request from any other origin is served exactly as
 * before, with no CORS headers, so a browser keeps refusing it. Credentials are allowed
 * for those origins: a reader signed in to a gated report reaches it from the hub too.
 *
 * The consumer passes `env`: a shared package never reaches for `cloudflare:workers`.
 */

/** The slice of a report Worker's env this reads. */
export interface ReportCorsEnv {
	/** The hub's origins, separated by commas or spaces: 'https://hub.aicolab.org'. */
	HUB_ORIGINS?: string
}

/** The request headers the MCP console sends (core's mcp-tools), and a bearer token. */
const ALLOWED_HEADERS =
	'content-type, accept, authorization, mcp-protocol-version, mcp-method, mcp-name'

/** The request's origin, where it is one of the hub's; else null. */
function hubOriginOf(request: Request, env: ReportCorsEnv): string | null {
	const origin = request.headers.get('origin')
	if (!origin) return null
	const allowed = (env.HUB_ORIGINS ?? '').split(/[\s,]+/).filter(Boolean)
	return allowed.includes(origin) ? origin : null
}

/** The response, answering the hub's origin: its headers copied, the CORS ones set. */
function forHub(response: Response, origin: string): Response {
	const answered = new Response(response.body, response)
	answered.headers.set('access-control-allow-origin', origin)
	answered.headers.set('access-control-allow-credentials', 'true')
	answered.headers.append('vary', 'origin')
	return answered
}

/**
 * Serve a request to the report's MCP endpoint, open to the hub: a preflight from one of
 * its origins is answered here, and every answer to one of its origins (a 401 challenge
 * included) carries the CORS headers. Any other request is `serve`'s alone.
 */
export async function servedToHub(
	request: Request,
	env: ReportCorsEnv,
	serve: () => Promise<Response>,
): Promise<Response> {
	const origin = hubOriginOf(request, env)
	if (!origin) return serve()
	if (request.method === 'OPTIONS') {
		return forHub(
			new Response(null, {
				status: 204,
				headers: {
					'access-control-allow-methods': 'POST, GET, OPTIONS',
					'access-control-allow-headers': ALLOWED_HEADERS,
					'access-control-max-age': '86400',
				},
			}),
			origin,
		)
	}
	return forHub(await serve(), origin)
}
