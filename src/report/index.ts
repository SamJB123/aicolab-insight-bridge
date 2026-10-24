/**
 * @aicolab/insight-bridge/report — a report's pages, for every Insight Bridge
 * report: each page is a component fed by the explorer's reads (the contract
 * shapes) and a surface the host supplies — the run's words, its palette, what
 * opening a reading means, and its own link to each section. An app, the
 * pipeline's run site and the hub all render the same pages; an app adds only
 * what its own facets and tables can say.
 *
 *   import { OverviewPage } from '@aicolab/insight-bridge/report'
 *
 * The pages draw with the site frame's classes (import
 * '@aicolab/insight-bridge/site.css' inside the host's `.ib-site`).
 */

export type { ScoreBand } from '../explorer/bands.ts'
export {
	type Block,
	blockSchema,
	type ConnectAdditions,
	connectAdditionsSchema,
	type LinkTarget,
	linkTargetSchema,
	type MethodAdditions,
	methodAdditionsSchema,
	type OverviewAdditions,
	overviewAdditionsSchema,
	type Prose,
	type ProseSegment,
	proseSchema,
	proseSegmentSchema,
} from './additions.ts'
export type { ScoreBandsOf } from './analysis/assessment-view.tsx'
export { KIND_LABEL } from './analysis/common.tsx'
export { type AnalysisLoaders, AnalysisPage, analysisLoaders } from './analysis-page.tsx'
export { Blocks } from './blocks.tsx'
export {
	type ConnectAccess,
	type ConnectClients,
	ConnectPage,
	type CopilotClient,
} from './connect-page.tsx'
export { HeatCell, StatRow } from './figures.tsx'
export { GalaxyPage, type GalaxyPageProps } from './galaxy-page.tsx'
export { MethodPage } from './method-page.tsx'
export {
	type HeaderEntry,
	type HostLink,
	type HostNavItem,
	headerEntries,
	type MenuEntry,
	type NavItem,
	ReportSections,
	reportNav,
} from './nav.tsx'
export { OverviewPage } from './overview-page.tsx'
export { ProseText } from './prose.tsx'
export {
	REPORT_SECTIONS,
	type ReportSection,
	type ReportSurface,
	ReportSurfaceContext,
	tasksOf,
	useReportSurface,
} from './surface.tsx'
export { TopicSearchPage } from './topic-search-page.tsx'
