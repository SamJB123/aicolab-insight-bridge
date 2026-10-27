// The report island's scene document: the same document whether the plan
// was laid directly (the oracle) or as claims on the lattice, and the sky
// table at the square's heart carried as the report's own, with the
// record's stars. What else a square island's document carries — its
// frames, its pieces, its lamps, its planting — is the atlas's own test.

import { buildingPieces } from '@aicolab/atlas/chessboard/content/hex/building-pieces.ts'
import {
	syntheticFieldOf as fieldOf,
	syntheticPartOf as partOf,
} from '@aicolab/atlas/chessboard/content/hex/synthetic-parts.ts'
import { assertScene, parseScene, serializeScene } from '@aicolab/kolo/scene'
import { describe, expect, it } from 'vitest'
import { hexReportIslandPlan, reportIslandPlan } from './plan.ts'
import { reportIslandDocument } from './scene-document.ts'
import { REPORT_OWNER, SKY_TABLE_ID, SKY_TABLE_RADIUS, starsOf } from './sky-table.ts'
import { syntheticRecord } from './synthetic-record.ts'

const record = syntheticRecord({
	tasks: [
		{ id: 'terms', title: 'Terms of reference' },
		{ id: 'scope', title: 'Scope', description: 'What is in and out.' },
	],
})
const plan = reportIslandPlan(record, 'synthetic')
const field = fieldOf(plan)
const stars = starsOf(record)
const document = reportIslandDocument(plan, partOf, field, stars)

describe('the report island as a scene document', () => {
	it('is a valid island scene that survives serialisation', () => {
		expect(() => assertScene(document)).not.toThrow()
		expect(parseScene(serializeScene(document))).toEqual(document)
	})

	it('is the same document every time', () => {
		expect(reportIslandDocument(plan, partOf, field, stars)).toEqual(document)
	})

	it('is the same document from the lattice as from the plan', () => {
		const hex = hexReportIslandPlan(record, 'synthetic').plan
		expect(reportIslandDocument(hex, partOf, fieldOf(hex), stars)).toEqual(document)
	})

	it('has a frame per section, and anchors every piece to one', () => {
		const frames = document.objects.filter((o) => !o.asset && !o.components && !o.instances)
		expect(frames.map((f) => f.uuid).sort()).toEqual(plan.buildings.map((b) => b.id).sort())
		for (const building of plan.buildings) {
			const pieces = buildingPieces(building, partOf)
			const anchored = document.objects.filter((o) => o.anchor?.to === building.id)
			expect(anchored.filter((o) => o.asset).length).toBe(pieces.placements.length)
		}
	})

	it('carries the sky table as the report’s own, with the record’s stars', () => {
		const table = document.objects.find((o) => o.uuid === `owned:${SKY_TABLE_ID}`)
		expect(stars.length).toBe(record.topics.length)
		expect(table?.components?.[0]?.props).toEqual({
			by: REPORT_OWNER,
			model: SKY_TABLE_ID,
			props: { radius: SKY_TABLE_RADIUS, stars },
		})
	})
})
