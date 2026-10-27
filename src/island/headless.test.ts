// A report world's ground built with no renderer, held to the SCENE as
// its oracle (@aicolab/atlas scenes/headless-harness.ts): the island and
// every room built twice — BARE, under node, with no document, no image
// and no texture loader to be had; and DRESSED by the builders the world
// runs — and each space collected as the engine collects a space at load.
// The two must be one soup, triangle for triangle, so it hashes the same
// and indexes the same for the walker.
//
//   a report world from its record (the hub's path): its hex island, built
//     as any declared island is, and its rooms
//   the square island planned directly (the oracle's path)

import { declaredBuilders } from '@aicolab/atlas/chessboard/scenes/declared-spaces.ts'
import {
	expectOneWorld,
	models,
	standInNetwork,
} from '@aicolab/atlas/chessboard/scenes/headless-harness.ts'
import { SURFACE_LEVEL } from '@aicolab/atlas/three/levels.ts'
import { describe, expect, it } from 'vitest'
import { realiseReportHex } from './hex-island.ts'
import { islandPlanOfReport, reportIslandPlan } from './plan.ts'
import { TRAINING_DATA } from './registry.ts'
import { buildReportIslandSpace, createReportAdapter } from './scenes/spaces.ts'
import { starsOf } from './sky-table.ts'
import { syntheticRecord } from './synthetic-record.ts'
import { buildReportWorld } from './world.ts'

standInNetwork()

describe('the ground built with no renderer, for a report', () => {
	it('a report world from its record: its hex island and its rooms (the hub’s path)', async () => {
		const record = syntheticRecord()
		const realised = realiseReportHex(record, TRAINING_DATA)
		const report = buildReportWorld(record, TRAINING_DATA, realised.plan)
		const triangles = await expectOneWorld(report.world.spaces, (bare) =>
			createReportAdapter(report, declaredBuilders(realised, models, 'island', bare), bare),
		)
		expect(triangles.get('island')).toBeGreaterThan(8000)
		expect(report.rooms.length).toBeGreaterThan(0)
		for (const room of report.rooms) expect(triangles.get(room.spaceId)).toBeGreaterThan(0)
	}, 300_000)

	it('the square island planned directly (the oracle’s path)', async () => {
		const record = syntheticRecord()
		const square = reportIslandPlan(record, TRAINING_DATA.slug)
		const stars = starsOf(record)
		const report = buildReportWorld(
			record,
			TRAINING_DATA,
			islandPlanOfReport(square, SURFACE_LEVEL, stars),
		)
		const island = report.world.spaces.filter((space) => space.id === 'island')
		expect(island).toHaveLength(1)
		const triangles = await expectOneWorld(island, (bare) =>
			createReportAdapter(
				report,
				{ island: () => buildReportIslandSpace(square, stars, models, { bare }) },
				bare,
			),
		)
		expect(triangles.get('island')).toBeGreaterThan(8000)
	}, 300_000)
})
