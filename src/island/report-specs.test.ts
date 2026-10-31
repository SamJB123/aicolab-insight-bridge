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
import { reportHexIsland } from './hex-island.ts'
import { isReportSlug, reportIsland } from './registry.ts'
import { worldRecordSchema } from './world.ts'

const APPS = new URL('../../../apps/', import.meta.url)

/** Each app that declares an island specification: its slug (as its report
 *  context names it) and the file its specification is in. */
function appsWithIslands(): { slug: string; island: URL }[] {
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
			// Refused with every issue named, or laid.
			expect(() => reportHexIsland(record, island, null, spec, where)).not.toThrow()
		})
	}
})
