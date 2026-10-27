// A report's DOOR in the browser: one applet session per report per
// shared socket, for the page's life — the report's object (the
// catalogue's `ReportCap`) as the wire delivers it, re-acquired by the
// applet client when the transport breaks under it. Every face of a host
// that reads a report over the socket (its page, its island) reads
// through this one session; a report the host's root has no door for
// rejects at the seam.

import type { CoreRpcRoot } from '@aicolab/room-service/base-worker'
import { type AppletSession, createAppletSession } from '@aicolab/room-service/client/applet'
import type { SharedCapnwebSocket } from '@aicolab/room-service/client/capnweb'
import type { RpcStub } from 'capnweb-experimental-hibernation'
import type { CorpusSlug } from '../corpora.ts'
import type { ReportCap } from '../explorer/catalogue/serve.ts'

/** A report's object as the wire delivers it: the class itself, as a stub. */
export type ReportSession = AppletSession<RpcStub<ReportCap>>

const sessions = new WeakMap<SharedCapnwebSocket<CoreRpcRoot>, Map<CorpusSlug, ReportSession>>()

export function reportSession(
	socket: SharedCapnwebSocket<CoreRpcRoot>,
	slug: CorpusSlug,
): ReportSession {
	let ofSocket = sessions.get(socket)
	if (!ofSocket) {
		ofSocket = new Map()
		sessions.set(socket, ofSocket)
	}
	let session = ofSocket.get(slug)
	if (!session) {
		session = createAppletSession<RpcStub<ReportCap>>(socket, slug)
		ofSocket.set(slug, session)
	}
	return session
}
