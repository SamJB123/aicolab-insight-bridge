// The family as a space: an island on the one honeycomb, its reports held
// open at the corners of its first ring in the registry's order — each
// report's island placed out along that bearing on its own patch of the
// same honeycomb, beyond the family's coast, no two patches sharing a cell
// — each reached by ferry over the water between, the family's way running
// to the end of the report's pier.

import { insideRing } from '@aicolab/atlas/chessboard/content/ground.ts'
import { HEX_SPACE } from '@aicolab/atlas/chessboard/content/space/hex-space-measures.ts'
import { piersOf } from '@aicolab/atlas/chessboard/content/space/pier-declaration.ts'
import { programKey } from '@aicolab/atlas/chessboard/content/space/programs.ts'
import {
	programPlacings,
	realisedProgram,
} from '@aicolab/atlas/chessboard/content/space/realised-spaces.ts'
import { hexLatticeDistance } from '@aicolab/kolo/shaders/lattice'
import { spaceCentre } from '@aicolab/kolo/space'
import { describe, expect, it } from 'vitest'
import { INSIGHT_BRIDGE_APPLET, REPORT_APPLETS } from '../applets.ts'
import { familyHexIsland, REPORT_RING } from './family.ts'

const FAMILY = programKey(INSIGHT_BRIDGE_APPLET.id)

describe('the Insight Bridge family', () => {
	it('holds every report open at a corner of its first ring, in the registry’s order', () => {
		const placings = programPlacings(FAMILY)
		const laid = familyHexIsland()
		// An island: its way in takes a cell of its own.
		expect(laid.wayIn.cell).not.toBeNull()
		const bearings = REPORT_APPLETS.map((applet) => {
			const cell = laid.cells.get(applet.id)
			if (!cell) throw new Error(`${applet.id} has no cell`)
			expect(hexLatticeDistance(cell), applet.id).toBe(REPORT_RING)
			const at = laid.held.get(applet.id)?.at ?? [0, 0]
			return Math.atan2(at[0], -at[1])
		})
		// North first, then clockwise: each bearing past the last.
		for (let i = 1; i < bearings.length; i++) {
			const turn = ((bearings[i] ?? 0) - (bearings[i - 1] ?? 0) + Math.PI * 2) % (Math.PI * 2)
			expect(turn, `${REPORT_APPLETS[i]?.id} after ${REPORT_APPLETS[i - 1]?.id}`).toBeGreaterThan(0)
			expect(turn).toBeLessThan(Math.PI)
		}
		for (const applet of REPORT_APPLETS) {
			const placing = placings.get(programKey(applet.id))
			expect(placing, applet.id).toBeDefined()
			expect(placing?.holder?.key).toBe(FAMILY)
			expect(placing?.path).toBe(applet.id)
			// On the family's own honeycomb: the same turn.
			expect(placing?.where.depth).toBe(0)
		}
	})

	it('lays every report on the one cell size, on its own patch beyond the family’s coast, no two patches sharing a cell', () => {
		const laid = familyHexIsland()
		expect(laid.spacing).toBe(HEX_SPACE.spacing)
		const family = realisedProgram(FAMILY)
		const familyCentre = spaceCentre(family.document)
		const taken = new Map<string, string>()
		for (const applet of REPORT_APPLETS) {
			const placing = laid.held.get(applet.id)
			if (!placing) throw new Error(`${applet.id} is not placed`)
			// Beyond the first ring, out along its bearing.
			expect(Math.hypot(placing.at[0], placing.at[1]), applet.id).toBeGreaterThan(HEX_SPACE.spacing)
			for (const cell of placing.patch) {
				const key = `${cell.q},${cell.r}`
				expect(
					taken.get(key),
					`${applet.id} and ${taken.get(key)} both take ${key}`,
				).toBeUndefined()
				taken.set(key, applet.id)
			}
			// Its coast lies wholly off the family's land.
			for (const p of placing.coast) {
				const inPlan: [number, number] = [p[0] - familyCentre[0], p[1] - familyCentre[1]]
				const onFamily = family.plan.boundary.outlines.some((outline) =>
					insideRing(outline, inPlan[0], inPlan[1]),
				)
				expect(onFamily, applet.id).toBe(false)
			}
			const report = realisedProgram(programKey(applet.id))
			expect(report.plan.boundary.kind).toBe('coast')
		}
	})

	it('reaches each report by ferry from its square, the way ending at the report’s pier', () => {
		const family = realisedProgram(FAMILY)
		const familyCentre = spaceCentre(family.document)
		const ferries = family.plan.vessels.filter(
			(vessel) => vessel.visual.kind === 'drawn' && vessel.visual.model === 'ferry',
		)
		expect(ferries).toHaveLength(REPORT_APPLETS.length)
		const placings = programPlacings(FAMILY)
		for (const applet of REPORT_APPLETS) {
			const placing = placings.get(programKey(applet.id))
			if (!placing) throw new Error(`${applet.id} is not placed`)
			// A pier's ends are read in the one frame (piersOf).
			const pier = piersOf(placing.document)[0]
			if (!pier) throw new Error(`${applet.id} reaches no pier out`)
			const way = family.plan.paths.find((path) => path.id === `route:path:${applet.id}`)
			const end = way?.points[way.points.length - 1]
			if (!end) throw new Error(`no way to ${applet.id}`)
			// Both in the one frame: the family's way ends where the pier ends.
			expect(end[0] + familyCentre[0], applet.id).toBeCloseTo(pier.end[0], 3)
			expect(end[1] + familyCentre[1], applet.id).toBeCloseTo(pier.end[1], 3)
			expect(way?.crossing).toBe('ferry')
			// Over the water from the family's coast out to its very end.
			const [from = 1, to = 0] = way?.bridges?.[0] ?? []
			expect(from, applet.id).toBeLessThan(1)
			expect(to, applet.id).toBe(1)
		}
		// The family's own way in keeps off every report's bearing.
		const laid = familyHexIsland()
		const wayIn = laid.wayIn.bearing
		for (const applet of REPORT_APPLETS) {
			const at = laid.held.get(applet.id)?.at ?? [0, 0]
			const d = Math.hypot(at[0], at[1]) || 1
			expect((at[0] / d) * wayIn[0] + (at[1] / d) * wayIn[1], applet.id).toBeLessThan(
				Math.cos(Math.PI / 12),
			)
		}
	})
})
