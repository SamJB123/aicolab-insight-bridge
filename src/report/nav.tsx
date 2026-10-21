/**
 * A report's header sections, for every Insight Bridge report: the site's own
 * list (`RunSite.sections`, else every section), each custom analysis task
 * listed by its title where `analysis` stands, and Connect last as the call
 * to action. A host adds pages of its own (High Water's Top 30, Fault lines,
 * Campaigns), each placed after a section it names. As data (`reportNav`, for
 * a host's phone menu) and as links (`ReportSections`, rendered through the
 * host's own Link, so the router marks the current one).
 */
import type { RunWords } from '@aicolab/insight-bridge-contracts/explorer'
import type { JSX } from '@solidjs/web'
import { For } from 'solid-js'
import { type ReportSection, type ReportSurface, tasksOf } from './surface.tsx'

/** A page of the host's own in the header, after the section it names. */
export interface HostNavItem {
	/** The host's path for it. */
	to: string
	label: string
	/** The section it follows; after the last task's entry when `analysis`. */
	after: ReportSection
}

export type NavItem =
	| {
			section: ReportSection
			/** The custom analysis task an `analysis` entry opens. */
			taskId?: string
			label: string
	  }
	| { section: null; to: string; label: string }

const LABEL: Record<Exclude<ReportSection, 'sources'>, string> = {
	overview: 'Overview',
	galaxy: 'Galaxy',
	topics: 'Topics',
	analysis: 'Analysis',
	search: 'Search',
	method: 'Method',
	connect: 'MCP',
}

/** The record is named by the run's own noun for a source ("Submissions"), as its landing card and page are. */
const labelOf = (section: ReportSection, words: RunWords) =>
	section === 'sources'
		? words.nouns.entities.charAt(0).toUpperCase() + words.nouns.entities.slice(1)
		: LABEL[section]

/** The header's entries, in the site's order; `analysis` expands to one entry per task the run performed; the host's own pages follow the sections they name. */
export function reportNav(words: RunWords, host: readonly HostNavItem[] = []): NavItem[] {
	return words.sections.flatMap((section): NavItem[] => [
		...(section === 'analysis'
			? tasksOf(words).map((t) => ({ section, taskId: t.taskId, label: t.title }))
			: [{ section, label: labelOf(section, words) }]),
		...host
			.filter((item) => item.after === section)
			.map((item) => ({ section: null, to: item.to, label: item.label })),
	])
}

/** The header's links, through the host's Link; Connect carries the call-to-action class. */
export function ReportSections(props: {
	surface: ReportSurface
	ctaClass?: string
	/** The host's own pages, and how it renders a link to one (through its router). */
	host?: {
		items: readonly HostNavItem[]
		link: (item: { to: string; label: string }) => JSX.Element
	}
}) {
	return (
		<For each={reportNav(props.surface.words, props.host?.items)}>
			{(item) =>
				item.section === null ? (
					props.host?.link(item)
				) : (
					<props.surface.Link
						section={item.section}
						taskId={item.taskId}
						class={item.section === 'connect' ? props.ctaClass : undefined}
					>
						{item.label}
					</props.surface.Link>
				)
			}
		</For>
	)
}
