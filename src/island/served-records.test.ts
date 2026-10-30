// Every served report's REAL record, read from its site, builds a sound
// world: every door of every room leads to a space that exists. Skipped
// without a network (the records are public; a site that cannot be read
// is reported, not failed, so one site being down fails nothing).

import { programKey } from '@aicolab/atlas/chessboard/content/space/programs.ts'
import { programPlacing } from '@aicolab/atlas/chessboard/content/space/realised-spaces.ts'
import { describe, expect, it } from 'vitest'
import { realiseReportHex } from './hex-island.ts'
import { REPORT_ISLANDS, type ReportIsland } from './registry.ts'
import { buildReportWorld, worldRecordSchema } from './world.ts'

async function recordOf(island: ReportIsland) {
	try {
		const response = await fetch(`${island.corpus.url}/api/world`)
		if (!response.ok) return null
		return worldRecordSchema.parse(await response.json())
	} catch {
		return null
	}
}

describe('every served report, on its real record', () => {
	for (const island of REPORT_ISLANDS) {
		it(`${island.corpus.name} builds a sound world`, { timeout: 60_000 }, async () => {
			const record = await recordOf(island)
			if (!record) {
				console.warn(
					`[served-records] ${island.corpus.name}'s record could not be read; not judged`,
				)
				return
			}
			// Written where the family berths it, as the hub has it.
			const realised = realiseReportHex(
				record,
				island,
				null,
				null,
				programPlacing(programKey(island.slug)).where,
			)
			const started = performance.now()
			const report = buildReportWorld(record, island, realised.plan)
			// The archipelago builds every report's world at boot: each must be
			// quick about it (Watchful State, 4,000 sources, once took 75 s).
			expect(
				performance.now() - started,
				`${island.corpus.name} took too long to build`,
			).toBeLessThan(5_000)
			const ids = new Set(report.world.spaces.map((space) => space.id))
			// Every room's doors as the world reads them before it is built.
			const broken = report.world.spaces.flatMap((space) =>
				report
					.waysOf(space)
					.filter((item) => item.exit && 'space' in item.exit && !ids.has(item.exit.space))
					.map(
						(item) =>
							`${space.id} → ${item.id} → '${item.exit && 'space' in item.exit ? item.exit.space : ''}'`,
					),
			)
			expect(broken).toEqual([])
		})
	}
})
