// Every served report's REAL record, read from its site, builds a sound
// world: every door of every room leads to a space that exists. Skipped
// without a network (the records are public; a site that cannot be read
// is reported, not failed, so one site being down fails nothing).

import { describe, expect, it } from 'vitest'
import { reportDeclaration } from './declaration.ts'
import { realiseReportIsland } from './plan.ts'
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
			const realised = realiseReportIsland(reportDeclaration(record, island))
			const started = performance.now()
			const report = buildReportWorld(record, () => realised.reportPlan, island)
			// The archipelago builds every report's world at boot: each must be
			// quick about it (Watchful State, 4,000 sources, once took 75 s).
			expect(
				performance.now() - started,
				`${island.corpus.name} took too long to build`,
			).toBeLessThan(5_000)
			const ids = new Set(report.world.spaces.map((space) => space.id))
			const broken = report.world.spaces.flatMap((space) =>
				space.interactables
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
