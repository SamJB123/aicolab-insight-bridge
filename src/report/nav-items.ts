/**
 * A report's header sections AS DATA, for every Insight Bridge report: the
 * site's own list (`RunSite.sections`, else every section), each custom
 * analysis task listed by its title where `analysis` stands (several fold
 * into one menu in the header row), and Connect last as the call to action.
 * A host adds pages of its own (High Water's Top 30, Fault lines, Campaigns),
 * each placed after a section it names, and may fold them into a menu of its
 * own naming. Plain TypeScript, no Solid: what a host reads of a report to
 * list its sections (../applet/reads.ts) and a host's phone menu; the
 * header's links, rendered from these, are ./nav.tsx.
 */
import type { RunWords } from '@aicolab/insight-bridge-contracts/explorer'
import type { HostNavItem } from './own-pages.ts'
import type { ReportSection } from './surface.tsx'

/** A page of the host's own in the header, after the section it names (./own-pages.ts: data, served through the report's door). */
export type { HostNavItem }

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

/** A section's name, wherever the report is shown (its header, the host's tree and map, its island): the record is named by the run's own noun for its sources ("Submissions"), as its landing card and page are. */
export const sectionName = (section: ReportSection, entities: string): string =>
	section === 'sources' ? entities.charAt(0).toUpperCase() + entities.slice(1) : LABEL[section]

/** A section's name in the header. */
export const sectionLabel = (section: ReportSection, words: RunWords) =>
	sectionName(section, words.nouns.entities)

/** The run's custom analysis tasks, in its profile's order, each with its kind and reader-facing title. */
export const tasksOf = (words: RunWords) =>
	Object.entries(words.tasks).map(([taskId, t]) => ({ taskId, kind: t.type, title: t.title }))

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
			? [{ item: { section, label: sectionLabel(section, words) }, menu: null }]
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

export const isMenu = (entry: HeaderEntry): entry is MenuEntry => 'menu' in entry

/** What a link is, across reloads of the run's words: a host page, or a section (and its task). */
export const navKey = (item: NavItem): string =>
	item.section === null ? `page:${item.to}` : `section:${item.section}:${item.taskId ?? ''}`

/** What a header entry is: a menu by its label, else its link. */
export const entryKey = (entry: HeaderEntry): string =>
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
