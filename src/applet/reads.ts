/**
 * What a host reads of a report through its door to draw its places and pages: the
 * report's sections, from its navigation (`navPage`: the run's words name the sections
 * and the analysis tasks), and each section's page (the door's page methods), typed as
 * the view that draws it expects. Both ends of the door answer the same reads — the
 * service binding's stub on a host's server, the socket's in its browser — so a host's
 * loader runs these on whichever side it is. Plain TypeScript, no Solid.
 */
import type {
	AnalysisPageData,
	BriefPageData,
	ConnectPageData,
	GalaxyPageData,
	MethodPageData,
	NavPageData,
	OverviewPageData,
	SearchPageData,
	SourcesPageData,
} from '../explorer/catalogue/page-reads.ts'
import { analysisPageSchema } from '../explorer/catalogue/readers.ts'
import { reportNav } from '../report/nav-items.ts'
import { type SectionRef, sectionId } from './address.ts'

/** A section as a host lists it: its segment under the report, its label, which section it is. */
export interface SectionEntry extends SectionRef {
	id: string
	label: string
}

/** The report's sections in its header's order, from its navigation. */
export function sectionsOf(nav: NavPageData): SectionEntry[] {
	return reportNav(nav.words, nav.pages).flatMap((item): SectionEntry[] =>
		item.section === null
			? []
			: [
					{
						id: sectionId(item.section, item.taskId),
						label: item.label,
						section: item.section,
						...(item.taskId === undefined ? {} : { taskId: item.taskId }),
					},
				],
	)
}

/** A section's page, as a host asks for it: which section, and what the page reads from the query. */
export interface ReportAsk extends SectionRef {
	/** The page's own query: the record's filters and page, a search's query. */
	page: Readonly<Record<string, unknown>>
}

/** A section's page, with the section it is for. */
export type ReportPage =
	| { section: 'overview'; data: OverviewPageData }
	| { section: 'galaxy'; data: GalaxyPageData }
	| { section: 'topics'; data: BriefPageData }
	| { section: 'sources'; data: SourcesPageData }
	| { section: 'search'; data: SearchPageData }
	| { section: 'method'; data: MethodPageData }
	| { section: 'connect'; data: ConnectPageData }
	| { section: 'analysis'; taskId: string; data: AnalysisPageData }

/**
 * The page reads as either end of the door answers them. An RPC stub's answer is a
 * promise-like whose shape is the read's, save that a tuple reads as a list across RPC
 * (an analysis page's score ranges), so that page is held to its contract here.
 */
export interface PageReads {
	navPage(): PromiseLike<NavPageData>
	overviewPage(): PromiseLike<OverviewPageData>
	galaxyPage(): PromiseLike<GalaxyPageData>
	briefPage(): PromiseLike<BriefPageData>
	sourcesPage(search: unknown): PromiseLike<SourcesPageData>
	searchPage(): PromiseLike<SearchPageData>
	methodPage(): PromiseLike<MethodPageData>
	connectPage(): PromiseLike<ConnectPageData>
	analysisPage(taskId: unknown): PromiseLike<{ words: AnalysisPageData['words']; page: unknown }>
}

/** One section's page, read through the door the caller holds. */
export async function sectionPage(cap: PageReads, ask: ReportAsk): Promise<ReportPage> {
	switch (ask.section) {
		case 'overview':
			return { section: 'overview', data: await cap.overviewPage() }
		case 'galaxy':
			return { section: 'galaxy', data: await cap.galaxyPage() }
		case 'topics':
			return { section: 'topics', data: await cap.briefPage() }
		case 'sources':
			return { section: 'sources', data: await cap.sourcesPage(ask.page) }
		case 'search':
			return { section: 'search', data: await cap.searchPage() }
		case 'method':
			return { section: 'method', data: await cap.methodPage() }
		case 'connect':
			return { section: 'connect', data: await cap.connectPage() }
		case 'analysis': {
			const taskId = ask.taskId ?? ''
			const answer = await cap.analysisPage(taskId)
			return {
				section: 'analysis',
				taskId,
				data: { words: answer.words, page: analysisPageSchema.nullable().parse(answer.page) },
			}
		}
	}
}
