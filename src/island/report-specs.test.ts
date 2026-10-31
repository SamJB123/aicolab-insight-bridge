// Every report's OWN island specification (its app's `src/report/island.ts`,
// served through its door) lays on its REAL record, where the family places
// it — what the hub's view builds when a visitor nears the report. A
// specification the lay refuses there is a world that fails to open: it is
// caught here, before anything is deployed. Skipped for a record that
// cannot be read (the records are public; a site being down fails nothing).

import { readdirSync, readFileSync } from 'node:fs'
import { hexSpaceSpecSchema } from '@aicolab/atlas/chessboard/content/space/hex-space-spec.ts'
import { piersOf } from '@aicolab/atlas/chessboard/content/space/pier-declaration.ts'
import { programKey } from '@aicolab/atlas/chessboard/content/space/programs.ts'
import { programPlacing } from '@aicolab/atlas/chessboard/content/space/realised-spaces.ts'
import { spaceCentre } from '@aicolab/kolo/space'
import { describe, expect, it } from 'vitest'
import type { WorldRecord } from '../world/index.ts'
import { reportHexDeclaration, reportHexIsland } from './hex-island.ts'
import { isReportSlug, REPORT_ISLANDS, type ReportSlug, reportIsland } from './registry.ts'
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

describe('every report, on its real record and its served sections and specification, where the family places it', () => {
	const apps = appsWithIslands()
	it('finds the reports that declare a specification', () => {
		expect(apps.length).toBeGreaterThan(0)
	})
	for (const { slug } of REPORT_ISLANDS) {
		it(`${slug} lays as it says, its pier where the family's ferry docks`, { timeout: 60_000 }, async () => {
			const island = reportIsland(slug)
			// Its specification as its door serves it: its app's own, where it
			// declares one; else none (the island stands the default).
			const own = apps.find((app) => app.slug === slug)
			const declared: { ISLAND?: unknown } = own ? await import(own.island.href) : {}
			const spec = own ? hexSpaceSpecSchema.parse(declared.ISLAND) : null
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
			const placing = programPlacing(programKey(slug))
			const where = placing.where
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
			// The family places the report, and runs its ferry to the report's pier,
			// from the report's declaration with no content; the view streams the
			// report in from its served sections and specification. Both must put
			// the pier in the same place (the one frame), or the ferry docks at
			// open water.
			const placed = piersOf(placing.document)[0]
			if (!placed) throw new Error(`${slug} is placed with no pier`)
			const placedCentre = spaceCentre(placing.document)
			for (const [lay, content] of [
				['the outline', null],
				['the island', record],
			] as const) {
				const document = reportHexDeclaration(content, island, sections, spec, where)
				const streamed = piersOf(document)[0]
				if (!streamed) throw new Error(`${slug}: ${lay} has no pier`)
				expect(
					Math.hypot(streamed.end[0] - placed.end[0], streamed.end[1] - placed.end[1]),
					`${slug}: ${lay}'s pier against the one the family docks at`,
				).toBeLessThan(1e-3)
				// Its plan metres about the same point: the ground streamed in is
				// drawn where the family posed the report (kolo frame.ts origin).
				const centre = spaceCentre(document)
				expect(
					Math.hypot(centre[0] - placedCentre[0], centre[1] - placedCentre[1]),
					`${slug}: ${lay}'s origin against the one the family poses it by`,
				).toBeLessThan(1e-6)
			}
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
