// What every report SERVES, read as the hub's view reads it, for the checks
// that judge the world on the inputs the hub is given (never a
// reconstruction of them): each report's record, and its OUTLINE — the
// sections as its door lists them and its island's specification. The door
// answers only a host, so the sections are read off the site's header, which
// is rendered from the same list (nav-items.ts placedOf: `words.sections`,
// each analysis task where `analysis` stands, the sources section named by
// the run's own noun for them); the specification is the app's own
// (`src/report/island.ts`), where it declares one. A report whose inputs
// cannot be read is an error: nothing is judged without them.
//
// For the tests only, under Vite (its glob finds the apps' files, in Node or
// in the Workers runtime alike); fetches the sites.

import { hexSpaceSpecSchema } from '@aicolab/atlas/chessboard/content/space/hex-space-spec.ts'
import type { WorldRecord } from '../world/index.ts'
import type { ReportContent } from './program.ts'
import { isReportSlug, REPORT_ISLANDS, type ReportSlug, reportIsland } from './registry.ts'
import { DEFAULT_SECTIONS, type ReportSectionEntry } from './sections.ts'
import { worldRecordSchema } from './world.ts'

/** Each app's report context, as text (its SLUG read off it, nothing run). */
const CONTEXTS = import.meta.glob<string>('../../../apps/*/src/report/ctx.ts', {
	query: '?raw',
	import: 'default',
	eager: true,
})
/** Each app's island specification module, where it declares one. */
const ISLANDS = import.meta.glob<unknown>('../../../apps/*/src/report/island.ts', {
	import: 'ISLAND',
	eager: true,
})

/** A report as it serves itself: its record, and its outline. */
export interface ServedReport {
	record: WorldRecord
	outline: ReportContent
}

/** Each app that declares an island specification: its slug (as its report
 *  context names it) and the specification it declares. */
export function appsWithIslands(): { slug: ReportSlug; island: unknown }[] {
	return Object.entries(ISLANDS).flatMap(([path, island]) => {
		const context = CONTEXTS[path.replace(/island\.ts$/, 'ctx.ts')] ?? ''
		const slug = /export const SLUG = '([^']+)'/.exec(context)?.[1]
		return slug && isReportSlug(slug) ? [{ slug, island }] : []
	})
}

/** Every report of the family as it serves itself, by slug. */
export async function servedReports(): Promise<Map<ReportSlug, ServedReport>> {
	const apps = appsWithIslands()
	const served = new Map<ReportSlug, ServedReport>()
	for (const { slug } of REPORT_ISLANDS) served.set(slug, await servedOf(slug, apps))
	return served
}

async function servedOf(
	slug: ReportSlug,
	apps: readonly { slug: ReportSlug; island: unknown }[],
): Promise<ServedReport> {
	const island = reportIsland(slug)
	const response = await fetch(`${island.corpus.url}/api/world`)
	if (!response.ok) throw new Error(`${island.corpus.name}'s record answered ${response.status}`)
	const record = worldRecordSchema.parse(await response.json())
	const own = apps.find((app) => app.slug === slug)
	const spec = own ? hexSpaceSpecSchema.parse(own.island) : null
	const sections = await servedSectionsOf(island.corpus.url, record)
	return { record, outline: { record: null, sections, spec } }
}

/** A section's entry for a header link, as the door lists it. */
const SECTION_OF_LINK: Readonly<Record<string, ReportSectionEntry['section']>> = {
	galaxy: 'galaxy',
	topics: 'topics',
	sources: 'sources',
	'topic-search': 'search',
	search: 'search',
	method: 'method',
	connect: 'connect',
}

/** The report's sections in its header's order, read off its site. */
async function servedSectionsOf(url: string, record: WorldRecord): Promise<ReportSectionEntry[]> {
	const response = await fetch(`${url}/`)
	if (!response.ok) throw new Error(`${url}'s header answered ${response.status}`)
	const html = await response.text()
	const seen = new Set<string>()
	const entries: ReportSectionEntry[] = []
	const defaults = new Map(DEFAULT_SECTIONS(record).map((entry) => [entry.id, entry]))
	// The sources section's link is named by the run's own noun for them
	// (One Basin's "/submissions"), as its header names the section.
	const sourcesLink = record.site.nouns?.entities.toLowerCase().replaceAll(' ', '-')
	for (const match of html.matchAll(/href="\/([a-z-]+)(?:\/([a-z0-9-]+))?"/g)) {
		const [, first = '', second] = match
		const key = second ? `${first}/${second}` : first
		if (seen.has(key)) continue
		seen.add(key)
		if (first === 'analysis' && second) {
			const task = record.tasks.find((t) => t.id === second)
			entries.push({
				id: `analysis:${second}`,
				label: task?.title ?? second,
				section: 'analysis',
				taskId: second,
			})
			continue
		}
		const section = first === sourcesLink ? 'sources' : SECTION_OF_LINK[first]
		if (!section || second) continue
		const known = defaults.get(section)
		entries.push(known ?? { id: section, label: section, section })
	}
	if (entries.length === 0) throw new Error(`${url}'s header lists no section`)
	return entries
}
