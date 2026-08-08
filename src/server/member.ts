/**
 * Viewer + Alliance-membership resolution for an Insight Bridge MCP server.
 * Public by default; a signed-in Alliance member unlocks any member-tier tools.
 * Delegates to the canonical `resolveAuthSession`: `verifySession` maps the
 * session cookie → verified user, then `getOrgMembership` decides membership
 * (with lazy @aicolab.org auto-enrolment). Fails open to anonymous/public on
 * anything missing or thrown — public is the baseline tier for these corpora,
 * so anonymous and failure look the same.
 *
 * The caller passes `env`. A shared package must not reach for a platform
 * global like `cloudflare:workers` — the bundler cannot resolve it from inside
 * a package, and it would pin this code to one runtime. The consumer already
 * holds `env` in its request handler, so injecting it costs nothing and keeps
 * this function testable with a plain object.
 */

// Marks this module server-only. If a client-reachable file ever imports it —
// the mistake that broke the build once already, via a mixed barrel — Start's
// import protection reports it by name instead of failing later as an
// unresolvable module deep in the bundler.
import '@tanstack/solid-start/server-only'
import {
	type AuthSessionService,
	resolveAuthSession,
} from '@aicolab/better-auth/cloudflare/shared/auth-session'

export type Viewer = { userId: string | null; isMember: boolean }

/** The slice of a consumer's env this needs. Structural, so any app whose
 *  bindings match satisfies it without importing generated Worker types. */
export type ViewerEnv = {
	AUTH?: AuthSessionService
	ALLIANCE_ORG_SLUG?: string
	ALLIANCE_EMAIL_DOMAIN?: string
}

export async function resolveViewer(request: Request, env: ViewerEnv): Promise<Viewer> {
	try {
		const authSession = await resolveAuthSession({
			auth: env.AUTH,
			cookieHeader: request.headers.get('cookie') ?? '',
			orgSlug: env.ALLIANCE_ORG_SLUG,
			autoEnrollEmailDomain: env.ALLIANCE_EMAIL_DOMAIN,
		})
		return { userId: authSession.user?.id ?? null, isMember: authSession.member }
	} catch {
		return { userId: null, isMember: false }
	}
}
