/**
 * Who is asking, for a report's agent surfaces (MCP, REST). Two credentials, one answer:
 *
 *  • Agents: an OAuth 2.1 access token (issued by the platform auth worker for this
 *    report as a resource), checked by better-auth's own resource-server check over the
 *    AUTH binding (@aicolab/better-auth/cloudflare/shared/access-token): the auth
 *    worker's signing keys and its proof replay store are reached through the binding,
 *    never over the public internet. A verified token is also handed on as the MCP SDK's
 *    `AuthInfo` (the token, its client, its scopes).
 *  • Browsers: the better-auth session cookie, verified through the AUTH binding.
 *
 * No credential is a reader: the six public reports are read by everyone, so identity
 * decides only who may own tasks (a signed-in caller has a task room). A token that does
 * not verify is refused, so an MCP client holding a stale token is told to sign in again
 * rather than quietly demoted; the 401 carries the challenge an MCP client needs in order
 * to start OAuth (RFC 9728 §5.1). A report with a gate of its own (High Water's hive)
 * decides its scope from the same viewer.
 *
 * The consumer passes `env`: a shared package never reaches for `cloudflare:workers`.
 */
import {
	type AccessTokenAuthService,
	type AccessTokenCheck,
	authIssuer,
	checkAccessToken,
} from '@aicolab/better-auth/cloudflare/shared/access-token'
import type { AuthSessionService } from '@aicolab/better-auth/cloudflare/shared/auth-session'
import type { AuthInfo } from '@modelcontextprotocol/server'

/** The slice of a report Worker's env this reads: structural, so any app whose bindings match satisfies it. */
export interface ReportAuthEnv {
	AUTH?: AccessTokenAuthService & AuthSessionService
	/** The auth worker's origin: the issuer is `${AUTH_URL}/api/auth`, the keys at `${AUTH_URL}/api/auth/jwks`. */
	AUTH_URL?: string
	/** This report's public origin: the OAuth resource MCP clients name is `${APP_ORIGIN}/mcp`. */
	APP_ORIGIN?: string
}

export interface ReportViewer {
	userId: string | null
	email: string | null
	/** The verified access token, for a request that presented one. */
	authInfo?: AuthInfo
}

export type ResolvedReportViewer =
	| { ok: true; viewer: ReportViewer }
	| { ok: false; reason: 'invalid bearer' }

/** The request's access token, checked for this report. Throws when a token was presented
 *  and the Worker lacks the binding or the URLs the check runs over. */
async function accessTokenOf(request: Request, env: ReportAuthEnv): Promise<AccessTokenCheck> {
	if (!request.headers.has('authorization')) return { presented: false }
	if (!env.AUTH || !env.AUTH_URL || !env.APP_ORIGIN) {
		throw new Error('AUTH, AUTH_URL and APP_ORIGIN are needed to check access tokens')
	}
	return checkAccessToken(request, {
		auth: env.AUTH,
		authUrl: env.AUTH_URL,
		// MCP clients use the canonical MCP endpoint URL as their RFC 8707 resource
		// indicator, so the token's `aud` is `<APP_ORIGIN>/mcp`; direct REST callers use the origin.
		audience: [`${env.APP_ORIGIN}/mcp`, env.APP_ORIGIN],
	})
}

/** What the SDK needs of a verified token: who it was issued to and what it may do. */
function authInfoOf(verified: Extract<AccessTokenCheck, { verified: true }>): AuthInfo {
	const { claims, token } = verified
	const client = claims.client_id ?? claims.azp
	return {
		token,
		clientId: typeof client === 'string' ? client : 'unknown',
		scopes: typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : [],
		...(typeof claims.exp === 'number' ? { expiresAt: claims.exp } : {}),
	}
}

/** The request's viewer: an access token first, then the session cookie, else a reader with no identity. */
export async function resolveReportViewer(
	request: Request,
	env: ReportAuthEnv,
): Promise<ResolvedReportViewer> {
	const token = await accessTokenOf(request, env)
	if (token.presented) {
		if (!token.verified) return { ok: false, reason: 'invalid bearer' }
		return {
			ok: true,
			viewer: {
				userId: token.userId,
				email: typeof token.claims.email === 'string' ? token.claims.email : null,
				authInfo: authInfoOf(token),
			},
		}
	}
	const cookie = request.headers.get('cookie') ?? ''
	const user =
		cookie && env.AUTH?.verifySession ? (await env.AUTH.verifySession(cookie)).user : null
	return { ok: true, viewer: { userId: user?.id ?? null, email: user?.email ?? null } }
}

/**
 * The 401 an MCP client needs in order to start OAuth: a JSON-RPC error with the
 * protected-resource metadata named in `WWW-Authenticate`. Sent for a token that did not
 * verify.
 */
export function oauthChallenge(request: Request, id: unknown = null): Response {
	const origin = new URL(request.url).origin
	return Response.json(
		{ jsonrpc: '2.0', id, error: { code: -32001, message: 'Authentication required' } },
		{
			status: 401,
			headers: {
				'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
			},
		},
	)
}

/**
 * Protected-resource metadata (RFC 9728) so MCP clients can discover the auth server.
 * `resource` MUST match the MCP server URL the user enters in a client exactly (including
 * the `/mcp` path): it is also the token `aud` clients request and the check validates.
 */
export function protectedResourceMetadata(env: ReportAuthEnv): Response {
	if (!env.AUTH_URL || !env.APP_ORIGIN) {
		return Response.json({ error: 'AUTH_URL and APP_ORIGIN are not set' }, { status: 503 })
	}
	return Response.json(
		{
			resource: `${env.APP_ORIGIN}/mcp`,
			authorization_servers: [authIssuer(env.AUTH_URL)],
			bearer_methods_supported: ['header'],
			scopes_supported: ['openid', 'profile', 'email'],
		},
		{ headers: { 'cache-control': 'public, max-age=3600' } },
	)
}
