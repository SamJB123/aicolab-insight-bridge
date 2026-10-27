// A report world's ground built with no renderer, held to the SCENE as
// its oracle (@aicolab/atlas scenes/headless-harness.ts): the island and
// every room built twice — BARE, under node, with no document, no image
// and no texture loader to be had; and DRESSED by the builders the world
// runs — and each space collected as the engine collects a space at load.
// The two must be one soup, triangle for triangle, so it hashes the same
// and indexes the same for the walker.
//
//   a report world from its record (the hub's path): its island, its rooms
//   a report island planned directly (the oracle's path)

import { islandDocument } from '@aicolab/atlas/chessboard/content/island/island-document.ts'
import {
	expectOneWorld,
	models,
	standInNetwork,
} from '@aicolab/atlas/chessboard/scenes/headless-harness.ts'
import { describe, expect, it } from 'vitest'
import { reportDeclaration } from './declaration.ts'
import { realiseReportIsland } from './plan.ts'
import { TRAINING_DATA } from './registry.ts'
import { createReportAdapter, type ReportIslandSceneOptions } from './scenes/spaces.ts'
import { syntheticRecord } from './synthetic-record.ts'
import { buildReportWorld } from './world.ts'

standInNetwork()

describe('the ground built with no renderer, for a report', () => {
	it('a report world from its record: its island and its rooms (the hub’s path)', async () => {
		const record = syntheticRecord()
		const realised = realiseReportIsland(reportDeclaration(record, TRAINING_DATA))
		const report = buildReportWorld(record, () => realised.reportPlan, TRAINING_DATA)
		const island: ReportIslandSceneOptions = {
			document: (_plan, partOf, field) => islandDocument(realised, partOf, field),
		}
		const triangles = await expectOneWorld(report.world.spaces, (bare) =>
			createReportAdapter(report, models, island, bare),
		)
		expect(triangles.get('island')).toBeGreaterThan(8000)
		expect(report.rooms.length).toBeGreaterThan(0)
		for (const room of report.rooms) expect(triangles.get(room.spaceId)).toBeGreaterThan(0)
	}, 300_000)

	it('a report island planned directly (the oracle’s path)', async () => {
		const report = buildReportWorld(syntheticRecord())
		const island = report.world.spaces.filter((space) => space.id === 'island')
		expect(island).toHaveLength(1)
		const triangles = await expectOneWorld(island, (bare) =>
			createReportAdapter(report, models, {}, bare),
		)
		expect(triangles.get('island')).toBeGreaterThan(8000)
	}, 300_000)
})
