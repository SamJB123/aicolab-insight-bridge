/**
 * A report's header sections, for every Insight Bridge report: the site's own
 * list (`RunSite.sections`, else every section), each custom analysis task
 * listed by its title where `analysis` stands, and Connect last as the call
 * to action. As data (`reportNav`, for a host's phone menu) and as links
 * (`ReportSections`, rendered through the host's own Link, so the router
 * marks the current one).
 */
import type { RunWords } from '@aicolab/insight-bridge-contracts/explorer'
import { For } from 'solid-js'
import { type ReportSection, type ReportSurface, tasksOf } from './surface.tsx'

export interface NavItem {
	section: ReportSection
	/** The custom analysis task an `analysis` entry opens. */
	taskId?: string
	label: string
}

const LABEL: Record<ReportSection, string> = {
	overview: 'Overview',
	galaxy: 'Galaxy',
	topics: 'Topics',
	analysis: 'Analysis',
	sources: 'Sources',
	search: 'Search',
	method: 'Method',
	connect: 'MCP',
}

/** The header's entries, in the site's order; `analysis` expands to one entry per task the run performed. */
export function reportNav(words: RunWords): NavItem[] {
	return words.sections.flatMap((section): NavItem[] =>
		section === 'analysis'
			? tasksOf(words).map((t) => ({ section, taskId: t.taskId, label: t.title }))
			: [{ section, label: LABEL[section] }],
	)
}

/** The header's links, through the host's Link; Connect carries the call-to-action class. */
export function ReportSections(props: { surface: ReportSurface; ctaClass?: string }) {
	return (
		<For each={reportNav(props.surface.words)}>
			{(item) => (
				<props.surface.Link
					section={item.section}
					taskId={item.taskId}
					class={item.section === 'connect' ? props.ctaClass : undefined}
				>
					{item.label}
				</props.surface.Link>
			)}
		</For>
	)
}
