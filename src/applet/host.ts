/**
 * What a HOST hands a report's views (the hive's `HiveHost`, for reports). A view owns
 * no socket, no identity and no router of its own:
 *
 *  - it reaches the report's object — core's `ReportCap`, every read and every page —
 *    through app-kit's `ViewHost` (`call(name, input)`): on a host's page that is the
 *    socket's capability object (`capabilityViewHost` over the host's applet session);
 *    in a model host it is the MCP App's proxy to the server's tools. The view holds a
 *    result to its contract schema, since the seam carries no type;
 *  - the places it sends the reader to are the host's URLs: a navigator the host binds
 *    (the hive's `HiveNavigator`), spoken in the report's own address vocabulary
 *    (./address.ts); a view calls it, never a router.
 *
 * Types only: nothing here runs, so a browser bundle and a worker bundle read it alike.
 */
import type { ViewHost } from '@aicolab/app-kit/solid/view-host'
import type { ReportTarget } from './address.ts'

/** The host's router adapter: where a target is, and the move there. */
export interface ReportNavigator {
	go(target: ReportTarget, options?: { replace?: boolean; hash?: string }): void
	href(target: ReportTarget): string
}

export interface ReportAppletHost {
	/** The report's object, as this host reaches it. */
	door: ViewHost
	/** The host's own URLs for the report's places. */
	navigator: ReportNavigator
}
