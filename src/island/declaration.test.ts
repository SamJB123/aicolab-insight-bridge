// The declared island against the ORACLE: a report declared in Overture's
// words, validated, and realised back into a plan is the plan the oracle
// lays directly (plan.ts reportIslandPlan) — every number to a micrometre,
// every drawing to the character — for a record with one task, with
// four, and with none; and the declaration is a sound island document:
// every feature of the schema, every rule of the ground met, every
// meeting of claims resolved without conflict.

import { worldCentre } from '@aicolab/atlas/chart/chart-data.ts'
import { createClearance } from '@aicolab/atlas/chessboard/content/ground.ts'
import { programKey } from '@aicolab/atlas/chessboard/content/island/programs.ts'
import { hasDoorLamp } from '@aicolab/atlas/chessboard/content/island/spoken-for.ts'
import { planAsData } from '@aicolab/atlas/chessboard/content/plan-as-data.ts'
import {
	conflictsOf,
	islandDocumentJson,
	islandIssues,
	parseIslandDocument,
} from '@aicolab/kolo/island'
import { describe, expect, it } from 'vitest'
import { declareReportIsland, reportDeclaration } from './declaration.ts'
import { islandPlanOfReport, realiseReportIsland, reportIslandPlan } from './plan.ts'
import { TRAINING_DATA } from './registry.ts'
import { syntheticRecord } from './synthetic-record.ts'

/** Deep equality with numbers to a tolerance: positions pass through the
 *  globe and back, which costs a few nanometres. */
function expectClose(actual: unknown, expected: unknown, path = 'plan', tolerance = 1e-6): void {
	if (typeof expected === 'number') {
		expect(typeof actual, path).toBe('number')
		if (typeof actual === 'number') {
			if (Math.abs(actual - expected) > tolerance) {
				throw new Error(
					`${path}: ${actual} is not ${expected} (off by ${Math.abs(actual - expected)})`,
				)
			}
		}
		return
	}
	if (Array.isArray(expected)) {
		expect(Array.isArray(actual), path).toBe(true)
		if (!Array.isArray(actual)) return
		expect(actual.length, `${path}.length`).toBe(expected.length)
		for (const [i, item] of expected.entries()) {
			expectClose(actual[i], item, `${path}[${i}]`, tolerance)
		}
		return
	}
	if (expected !== null && typeof expected === 'object') {
		expect(actual !== null && typeof actual === 'object', path).toBe(true)
		if (actual === null || typeof actual !== 'object') return
		const a: Record<string, unknown> = { ...actual }
		const e: Record<string, unknown> = { ...expected }
		expect(Object.keys(a).sort(), `${path} keys`).toEqual(Object.keys(e).sort())
		for (const key of Object.keys(e)) expectClose(a[key], e[key], `${path}.${key}`, tolerance)
		return
	}
	expect(actual, path).toBe(expected)
}

const records = {
	'one task': syntheticRecord(),
	'four tasks': syntheticRecord({
		tasks: [
			{ id: 'terms', title: 'Terms of reference' },
			{ id: 'scope', title: 'Scope', description: 'What is in and out.' },
			{ id: 'method', title: 'Method' },
			{ id: 'risks', title: 'Risks' },
		],
	}),
	'no record': null,
}

describe('the declared island is the oracle island', () => {
	for (const [name, record] of Object.entries(records)) {
		it(`lays the same plan for ${name}`, () => {
			const document = reportDeclaration(record, TRAINING_DATA)
			const realised = realiseReportIsland(document)
			const oracle = planAsData(reportIslandPlan(record, TRAINING_DATA.slug))
			expectClose(planAsData(realised.reportPlan), oracle)
		})
	}

	it('spares the planting the same ground the oracle plan does: the table and the plan agree', () => {
		const realised = realiseReportIsland(reportDeclaration(records['four tasks'], TRAINING_DATA))
		const oracle = islandPlanOfReport(
			reportIslandPlan(records['four tasks'], TRAINING_DATA.slug),
			3,
		)
		const fromTable = createClearance(realised.plan)
		const fromPlan = createClearance(oracle)
		const xs = oracle.coast.map((p) => p[0])
		const zs = oracle.coast.map((p) => p[1])
		let asked = 0
		const disagree: string[] = []
		for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1.5) {
			for (let z = Math.min(...zs); z <= Math.max(...zs); z += 1.5) {
				for (const margin of [0.5, 0.6, 0.9, 1.4, 3, 3.2]) {
					asked++
					if (fromTable(x, z, margin) !== fromPlan(x, z, margin)) {
						disagree.push(`${x.toFixed(1)},${z.toFixed(1)} @${margin}`)
					}
				}
			}
		}
		expect(asked).toBeGreaterThan(10000)
		expect(disagree).toEqual([])
	})

	it('places the lamps and benches the oracle scene places', () => {
		const realised = realiseReportIsland(reportDeclaration(records['four tasks'], TRAINING_DATA))
		const doors = realised.plan.buildings.filter(hasDoorLamp).length
		expect(realised.lamps).toHaveLength(8 + 4 + doors)
		expect(realised.lamps.filter((l) => l.lit)).toHaveLength(12)
		expect(realised.benches).toHaveLength(6)
		const plaza = realised.reportPlan.plaza
		for (const bench of realised.benches) {
			expect(
				Math.hypot(bench.position[0] - plaza.centre[0], bench.position[1] - plaza.centre[1]),
			).toBeCloseTo(plaza.radius - 3.2, 6)
		}
	})
})

describe('the declaration', () => {
	const document = reportDeclaration(records['four tasks'], TRAINING_DATA)

	it('is a sound island document: schema, ground rules, no conflicts', () => {
		expect(islandIssues(document)).toEqual([])
		const realised = realiseReportIsland(document)
		expect(conflictsOf(realised.interactions)).toEqual([])
		// The flight cuts the land; the planting gives way to everything.
		expect(realised.interactions.some((i) => i.kind === 'modification' && i.what === 'cut')).toBe(
			true,
		)
		expect(realised.interactions.filter((i) => i.kind === 'restructure').length).toBeGreaterThan(10)
	})

	it('survives being written as GeoJSON and read back', () => {
		const json = JSON.parse(JSON.stringify(islandDocumentJson(document)))
		const again = parseIslandDocument(json)
		expect(again.features.map((f) => f.id)).toEqual(document.features.map((f) => f.id))
		expectClose(
			planAsData(realiseReportIsland(again).reportPlan),
			planAsData(realiseReportIsland(document).reportPlan),
		)
	})

	it('speaks in the standard: every feature typed, every segment on connectors, every door an entrance', () => {
		const types = new Map<string, number>()
		for (const f of document.features) {
			types.set(f.properties.type, (types.get(f.properties.type) ?? 0) + 1)
		}
		expect(types.get('land')).toBe(1)
		expect(types.get('land_use')).toBe(1)
		expect(types.get('land_cover')).toBe(1)
		// Two buildings and four chambers; the flight, the avenue and a path per
		// thing with a door: six buildings, the desk, the board, the beacon.
		expect(types.get('building')).toBe(2 + 4)
		expect(types.get('segment')).toBe(2 + 9)
		const connectors = new Set(
			document.features.filter((f) => f.properties.type === 'connector').map((f) => f.id),
		)
		for (const f of document.features) {
			if (f.properties.type !== 'segment') continue
			for (const ref of f.properties.connectors) expect(connectors.has(ref.connector_id)).toBe(true)
		}
	})

	it('sits on its own cell: declared anywhere else, it is the same island there', () => {
		const at = worldCentre(programKey(TRAINING_DATA.slug))
		const elsewhere = declareReportIsland(records['four tasks'], TRAINING_DATA, [
			at[0] + 1700,
			at[1] - 900,
		])
		const here = realiseReportIsland(document)
		const there = realiseReportIsland(elsewhere)
		expectClose(
			there.plan.buildings.map((b) => b.position),
			here.plan.buildings.map((b) => b.position),
		)
		expect(elsewhere.features[0]?.geometry).not.toEqual(document.features[0]?.geometry)
	})
})
