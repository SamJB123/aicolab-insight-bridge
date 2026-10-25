/**
 * `@aicolab/insight-bridge/applet` — a report as a HOST embeds it (settled 2026-10-25,
 * "the view is the page"): the vocabulary of a reader's place in a report and how it is
 * addressed (./address.ts), what a host reads of a report through its door to list its
 * sections and draw a section's page (./reads.ts), what a host hands the views
 * (./host.ts), and the views themselves (./views.tsx) — the same components the
 * report's own site renders, over the host's seam alone. The hub's page face is one
 * host; a report's own routes are another; a report adds views of its own pages beside
 * these from its own package.
 *
 * Everything reachable from here uses RELATIVE imports: a package-local alias would
 * collide with the host app's own when it compiles these sources (the hive's note).
 */

export {
	addressOf,
	nodeIdOf,
	pageSearchOf,
	type ReportAddress,
	type ReportTarget,
	roomOfSection,
	type SectionRef,
	sectionId,
	sectionOfId,
	sectionOfRoom,
	targetOf,
} from './address.ts'
export type { ReportAppletHost, ReportNavigator } from './host.ts'
export {
	type PageReads,
	type ReportAsk,
	type ReportPage,
	type SectionEntry,
	sectionPage,
	sectionsOf,
} from './reads.ts'
export { ReportProblem, ReportSectionView, type ReportSectionViewProps } from './views.tsx'
