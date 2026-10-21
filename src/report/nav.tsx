/**
 * A report's header sections, for every Insight Bridge report: the site's own
 * list (`RunSite.sections`, else every section), each custom analysis task
 * listed by its title where `analysis` stands (several fold into one menu in
 * the header row), and Connect last as the call to action. A host adds pages
 * of its own (High Water's Top 30, Fault lines, Campaigns), each placed after
 * a section it names. As data (`reportNav`, for a host's phone menu) and as
 * links (`ReportSections`, rendered through the host's own Link, so the
 * router marks the current one).
 */
import type { RunWords } from '@aicolab/insight-bridge-contracts/explorer'
import { Menu, MenuItem } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { For, Show } from 'solid-js'
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

/** Several analysis tasks as one header entry: a menu of their pages. */
export interface AnalysisMenuEntry {
	menu: 'analysis'
	label: string
	tasks: { taskId: string; label: string }[]
}

export type HeaderEntry = NavItem | AnalysisMenuEntry

const analysisMenu = (tasks: ReturnType<typeof tasksOf>): AnalysisMenuEntry => ({
	menu: 'analysis',
	label: LABEL.analysis,
	tasks: tasks.map((t) => ({ taskId: t.taskId, label: t.title })),
})

/** The entries in the site's order, the host's own pages after the sections they name; the tasks folded into one menu entry when `fold` and there are several. */
function entriesOf(words: RunWords, host: readonly HostNavItem[], fold: boolean): HeaderEntry[] {
	const tasks = tasksOf(words)
	return words.sections.flatMap((section): HeaderEntry[] => [
		...(section !== 'analysis'
			? [{ section, label: labelOf(section, words) }]
			: fold && tasks.length > 1
				? [analysisMenu(tasks)]
				: tasks.map((t) => ({ section, taskId: t.taskId, label: t.title }))),
		...host
			.filter((item) => item.after === section)
			.map((item) => ({ section: null, to: item.to, label: item.label })),
	])
}

const isMenu = (entry: HeaderEntry): entry is AnalysisMenuEntry => 'menu' in entry

/** What a header entry is, across reloads of the run's words: the menu, a host page, or a section (and its task). */
const entryKey = (entry: HeaderEntry): string =>
	isMenu(entry)
		? 'menu:analysis'
		: entry.section === null
			? `page:${entry.to}`
			: `section:${entry.section}:${entry.taskId ?? ''}`

/** Every entry as a link, each analysis task its own, in the site's order: the phone menu's list. */
export const reportNav = (words: RunWords, host: readonly HostNavItem[] = []): NavItem[] =>
	entriesOf(words, host, false).flatMap((entry) => (isMenu(entry) ? [] : [entry]))

/** The header row's entries: as `reportNav`, with several analysis tasks folded into one "Analysis" menu so the row fits (settled 2026-10-21); a single task stays a link. */
export const headerEntries = (words: RunWords, host: readonly HostNavItem[] = []) =>
	entriesOf(words, host, true)

/** Several tasks' pages behind one header entry: ui-solid's Menu, each item the host's own Link (MenuItem `linkComponent`), so choosing one navigates in the app and the router marks it. The trigger reads as current when one of its pages is. */
function AnalysisMenu(props: { surface: ReportSurface; entry: AnalysisMenuEntry }) {
	return (
		<Menu
			label={props.entry.label}
			class="ib-report-nav-menu"
			trigger={(wiring) => (
				<button
					type="button"
					class="ib-report-nav-trigger"
					aria-haspopup="menu"
					popovertarget={wiring.popoverTarget}
					style={wiring.style}
				>
					{props.entry.label}
				</button>
			)}
		>
			<For each={props.entry.tasks} keyed={(task) => task.taskId}>
				{(task) => (
					<MenuItem
						linkComponent={(attributes) => (
							<props.surface.Link section="analysis" taskId={task().taskId} {...attributes} />
						)}
					>
						{task().label}
					</MenuItem>
				)}
			</For>
		</Menu>
	)
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
		// Keyed by what each entry IS, so a reload of the run's words (a route's
		// loader runs again) updates a row in place rather than building it anew:
		// a rebuilt menu or link re-reads its attributes outside any tracking scope.
		<For each={headerEntries(props.surface.words, props.host?.items)} keyed={entryKey}>
			{(entry) => {
				const menu = () => {
					const e = entry()
					return isMenu(e) ? e : null
				}
				const page = () => {
					const e = entry()
					return !isMenu(e) && e.section === null ? e : null
				}
				const section = () => {
					const e = entry()
					return !isMenu(e) && e.section !== null ? e : null
				}
				return (
					<>
						<Show when={menu()}>{(m) => <AnalysisMenu surface={props.surface} entry={m()} />}</Show>
						<Show when={page()}>{(p) => <>{props.host?.link(p())}</>}</Show>
						<Show when={section()}>
							{(s) => (
								<props.surface.Link
									section={s().section}
									taskId={s().taskId}
									class={s().section === 'connect' ? props.ctaClass : undefined}
								>
									{s().label}
								</props.surface.Link>
							)}
						</Show>
					</>
				)
			}}
		</For>
	)
}
