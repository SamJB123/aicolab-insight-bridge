/**
 * A report's header sections, for every Insight Bridge report: the site's own
 * list (`RunSite.sections`, else every section), each custom analysis task
 * listed by its title where `analysis` stands (several fold into one menu in
 * the header row), and Connect last as the call to action. A host adds pages
 * of its own (High Water's Top 30, Fault lines, Campaigns), each placed after
 * a section it names, and may fold them into a menu of its own naming. As data (`reportNav`, for a host's phone menu) and as
 * links (`ReportSections`, rendered through the host's own Link, so the
 * router marks the current one).
 */
import type { RunWords } from '@aicolab/insight-bridge-contracts/explorer'
import { Menu, MenuItem, type MenuItemLinkProps } from '@aicolab/ui-solid'
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
	/**
	 * A header menu to fold it into, by that menu's label: the pages naming the
	 * same menu become one entry, where the first of them stands, so a host with
	 * many pages of its own keeps the row to one line (the audit corpus's
	 * eleven, the user's choice 2026-10-22). The phone menu lists each page.
	 */
	menu?: string
}

/** How the host renders a link to one of its pages, through its router: as a header link, or — given a menu item's attributes — as that item's anchor. */
export type HostLink = (
	item: { to: string; label: string },
	attributes?: MenuItemLinkProps,
) => JSX.Element

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

/** Several entries as one header entry: a menu of their pages, named by its label. */
export interface MenuEntry {
	menu: string
	items: NavItem[]
}

export type HeaderEntry = NavItem | MenuEntry

/** Every entry in the site's order, the host's own pages after the sections they name, each with the menu it folds into in the header row (several analysis tasks fold into "Analysis", settled 2026-10-21). */
function placedOf(
	words: RunWords,
	host: readonly HostNavItem[],
): { item: NavItem; menu: string | null }[] {
	const tasks = tasksOf(words)
	return words.sections.flatMap((section) => [
		...(section !== 'analysis'
			? [{ item: { section, label: labelOf(section, words) }, menu: null }]
			: tasks.map((t) => ({
					item: { section, taskId: t.taskId, label: t.title },
					menu: tasks.length > 1 ? LABEL.analysis : null,
				}))),
		...host
			.filter((page) => page.after === section)
			.map((page) => ({
				item: { section: null, to: page.to, label: page.label },
				menu: page.menu ?? null,
			})),
	])
}

const isMenu = (entry: HeaderEntry): entry is MenuEntry => 'menu' in entry

/** What a link is, across reloads of the run's words: a host page, or a section (and its task). */
const navKey = (item: NavItem): string =>
	item.section === null ? `page:${item.to}` : `section:${item.section}:${item.taskId ?? ''}`

/** What a header entry is: a menu by its label, else its link. */
const entryKey = (entry: HeaderEntry): string =>
	isMenu(entry) ? `menu:${entry.menu}` : navKey(entry)

/** Every entry as a link, each analysis task and each host page its own, in the site's order: the phone menu's list. */
export const reportNav = (words: RunWords, host: readonly HostNavItem[] = []): NavItem[] =>
	placedOf(words, host).map((p) => p.item)

/** The header row's entries: as `reportNav`, with the entries that name a menu folded into it where the first of them stands, so the row fits; a menu of one stays a link. */
export function headerEntries(words: RunWords, host: readonly HostNavItem[] = []): HeaderEntry[] {
	const menus = new Map<string, MenuEntry>()
	const entries: HeaderEntry[] = []
	for (const { item, menu } of placedOf(words, host)) {
		if (menu === null) {
			entries.push(item)
			continue
		}
		const open = menus.get(menu)
		if (open) open.items.push(item)
		else {
			const entry: MenuEntry = { menu, items: [item] }
			menus.set(menu, entry)
			entries.push(entry)
		}
	}
	return entries.flatMap((entry) =>
		isMenu(entry) && entry.items.length === 1 ? entry.items : [entry],
	)
}

/**
 * A host page's link, made ONCE: the host's link function is called with its
 * path and label as getters, so a reload of the run's words (new objects, the
 * same values) updates the link in place. Called again, the host's router Link
 * would be rebuilt and re-read a menu item's attributes outside any tracking
 * scope.
 */
function HostPageLink(props: {
	link: HostLink | undefined
	to: string
	label: string
	attributes?: MenuItemLinkProps
}) {
	const item = {
		get to() {
			return props.to
		},
		get label() {
			return props.label
		},
	}
	return <>{props.link?.(item, props.attributes)}</>
}

/** Several pages behind one header entry: ui-solid's Menu, each item the host's own Link (MenuItem `linkComponent`), so choosing one navigates in the app and the router marks it. The trigger reads as current when one of its pages is. */
function HeaderMenu(props: { surface: ReportSurface; entry: MenuEntry; hostLink?: HostLink }) {
	return (
		<Menu
			label={props.entry.menu}
			class="ib-report-nav-menu"
			trigger={(wiring) => (
				<button
					type="button"
					class="ib-report-nav-trigger"
					aria-haspopup="menu"
					popovertarget={wiring.popoverTarget}
					style={wiring.style}
				>
					{props.entry.menu}
				</button>
			)}
		>
			<For each={props.entry.items} keyed={navKey}>
				{(item) => {
					const page = () => {
						const i = item()
						return i.section === null ? i : null
					}
					const section = () => {
						const i = item()
						return i.section === null ? null : i
					}
					return (
						<MenuItem
							linkComponent={(attributes) => (
								<>
									<Show when={section()}>
										{(s) => (
											<props.surface.Link
												section={s().section}
												taskId={s().taskId}
												{...attributes}
											/>
										)}
									</Show>
									<Show when={page()}>
										{(p) => (
											<HostPageLink
												link={props.hostLink}
												to={p().to}
												label={p().label}
												attributes={attributes}
											/>
										)}
									</Show>
								</>
							)}
						>
							{item().label}
						</MenuItem>
					)
				}}
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
		link: HostLink
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
						<Show when={menu()}>
							{(m) => (
								<HeaderMenu surface={props.surface} entry={m()} hostLink={props.host?.link} />
							)}
						</Show>
						<Show when={page()}>
							{(p) => <HostPageLink link={props.host?.link} to={p().to} label={p().label} />}
						</Show>
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
