// Every report's OWN island specification (its app's `src/report/island.ts`,
// served through its door) lays on its REAL record, where the family places
// it — what the hub's view builds when a visitor nears the report. A
// specification the lay refuses there is a world that fails to open: it is
// caught here, before anything is deployed. Skipped for a record that
// cannot be read (the records are public; a site being down fails nothing).

import { readdirSync, readFileSync } from 'node:fs'
import { hexSpaceSpecSchema } from '@aicolab/atlas/chessboard/content/space/hex-space-spec.ts'
import { programKey } from '@aicolab/atlas/chessboard/content/space/programs.ts'
import { programPlacing } from '@aicolab/atlas/chessboard/content/space/realised-spaces.ts'
import { describe, expect, it } from 'vitest'
import type { WorldRecord } from '../world/index.ts'
import { reportHexIsland } from './hex-island.ts'
import { isReportSlug, type ReportSlug, reportIsland } from './registry.ts'
import { DEFAULT_SECTIONS, type ReportSectionEntry } from './sections.ts'
import { worldRecordSchema } from './world.ts'

const APPS = new URL('../../../apps/', import.meta.url)

/** Each app that declares an island specification: its slug (as its report
 *  context names it) and the file its specification is in. */
function appsWithIslands(): { slug: ReportSlug; island: URL }[] {
	return readdirSync(APPS, { withFileTypes: true }).flatMap((entry) => {
		if (!entry.isDirectory()) return []
		const report = new URL(`${entry.name}/src/report/`, APPS)
		try {
			const ctx = readFileSync(new URL('ctx.ts', report), 'utf8')
			const slug = /export const SLUG = '([^']+)'/.exec(ctx)?.[1]
			readFileSync(new URL('island.ts', report), 'utf8')
			return slug && isReportSlug(slug) ? [{ slug, island: new URL('island.ts', report) }] : []
		} catch {
			return []
		}
	})
}

describe('every report’s own island specification, on its real record, where the family places it', () => {
	const apps = appsWithIslands()
	it('finds the reports that declare one', () => {
		expect(apps.length).toBeGreaterThan(0)
	})
	for (const app of apps) {
		it(`${app.slug} lays as it says`, { timeout: 60_000 }, async () => {
			const island = reportIsland(app.slug)
			const declared: { ISLAND?: unknown } = await import(app.island.href)
			const spec = hexSpaceSpecSchema.parse(declared.ISLAND)
			let record = null
			try {
				const response = await fetch(`${island.corpus.url}/api/world`)
				if (response.ok) record = worldRecordSchema.parse(await response.json())
			} catch {
				record = null
			}
			if (!record) {
				console.warn(`[report-specs] ${island.corpus.name}'s record could not be read; not judged`)
				return
			}
			const where = programPlacing(programKey(app.slug)).where
			// The sections AS THE DOOR SERVES THEM: the run's own list, in its own
			// order (nav-items.ts placedOf: `words.sections`, each analysis task
			// where `analysis` stands) — read off the site's header, which is
			// rendered from the same list, since the door answers only a host.
			// The default list is not it: Second Chair lists its analysis before
			// its sources, and One Basin lists no sources at all.
			const sections = (await servedSectionsOf(island.corpus.url, record)) ?? DEFAULT_SECTIONS(record)
			// The view lays a report TWICE (atlas top-spaces.ts): its OUTLINE first —
			// the door's sections and specification, no record — and the whole
			// island with the record once the visitor is on it. Both must lay:
			// refused with every issue named, or laid.
			expect(() => reportHexIsland(null, island, sections, spec, where), 'the outline').not.toThrow()
			expect(() => reportHexIsland(record, island, sections, spec, where), 'the island').not.toThrow()
		})
	}
})

/** A section's entry for a header link, as the door would list it. */
const SECTION_OF_LINK: Readonly<Record<string, ReportSectionEntry['section']>> = {
	galaxy: 'galaxy',
	topics: 'topics',
	sources: 'sources',
	'topic-search': 'search',
	search: 'search',
	method: 'method',
	connect: 'connect',
}

/** The report's sections in its header's order, read off its site; null
 *  where the site cannot be read. */
async function servedSectionsOf(
	url: string,
	record: WorldRecord,
): Promise<ReportSectionEntry[] | null> {
	let html: string
	try {
		const response = await fetch(`${url}/`)
		if (!response.ok) return null
		html = await response.text()
	} catch {
		return null
	}
	const seen = new Set<string>()
	const entries: ReportSectionEntry[] = []
	const defaults = new Map(DEFAULT_SECTIONS(record).map((entry) => [entry.id, entry]))
	for (const match of html.matchAll(/href="\/([a-z-]+)(?:\/([a-z0-9-]+))?"/g)) {
		const [, first = '', second] = match
		const key = second ? `${first}/${second}` : first
		if (seen.has(key)) continue
		seen.add(key)
		if (first === 'analysis' && second) {
			const task = record.tasks.find((t) => t.id === second)
			entries.push({ id: `analysis:${second}`, label: task?.title ?? second, section: 'analysis', taskId: second })
			continue
		}
		const section = SECTION_OF_LINK[first]
		if (!section || second) continue
		const known = defaults.get(section)
		entries.push(known ?? { id: section, label: section, section })
	}
	return entries.length > 0 ? entries : null
}
