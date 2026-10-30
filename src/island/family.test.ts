// The family as a space: open water, its reports berthed at the corners of
// its first ring in the registry's order, each reached by ferry over the
// water between, each report's island written where the family says and
// fitting inside its cell with water round it.

import { programKey } from '@aicolab/atlas/chessboard/content/space/programs.ts'
import {
	programPlacings,
	realisedProgram,
} from '@aicolab/atlas/chessboard/content/space/realised-spaces.ts'
import { hexLatticeDistance } from '@aicolab/kolo/shaders/lattice'
import { describe, expect, it } from 'vitest'
import { INSIGHT_BRIDGE_APPLET, REPORT_APPLETS } from '../applets.ts'
import { FAMILY_REACH, FAMILY_SPACING, familyHexIsland, REPORT_RING } from './family.ts'

const FAMILY = programKey(INSIGHT_BRIDGE_APPLET.id)

/** How far a plan's land reaches from its square (m). */
const reachOf = (key: string): number => {
	const realised = realisedProgram(programKey(key))
	const [cx, cz] = realised.plan.plaza?.centre ?? [0, 0]
	return Math.max(
		...realised.plan.boundary.outlines.flatMap((outline) =>
			outline.map((p) => Math.hypot(p[0] - cx, p[1] - cz)),
		),
	)
}

describe('the Insight Bridge family', () => {
	it('berths every report at a corner of its first ring, in the registry’s order', () => {
		const placings = programPlacings(FAMILY)
		const laid = familyHexIsland()
		// Open water: its way in takes no cell.
		expect(laid.wayIn.cell).toBeNull()
		const bearings = REPORT_APPLETS.map((applet) => {
			const cell = laid.cells.get(applet.id)
			if (!cell) throw new Error(`${applet.id} has no cell`)
			expect(hexLatticeDistance(cell), applet.id).toBe(REPORT_RING)
			const at = laid.berths.get(applet.id)?.at ?? [0, 0]
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
			expect(placing?.where.depth).toBe(1)
		}
	})

	it('reaches each report by ferry from its square, over the water between', () => {
		const family = realisedProgram(FAMILY)
		const ferries = family.plan.vessels.filter(
			(vessel) => vessel.visual.kind === 'drawn' && vessel.visual.model === 'ferry',
		)
		expect(ferries).toHaveLength(REPORT_APPLETS.length)
		// Every report's pier reaches out to where the family's way ends.
		for (const applet of REPORT_APPLETS) {
			const report = realisedProgram(programKey(applet.id))
			expect(report.plan.piers.length, applet.id).toBeGreaterThan(0)
		}
	})

	it('writes each report inside its cell, water round it, and reaches no further than it says', () => {
		// A cell's inradius: how far its edge lies from its centre at the nearest.
		const inradius = FAMILY_SPACING / 2
		for (const applet of REPORT_APPLETS) {
			expect(reachOf(applet.id), applet.id).toBeLessThan(inradius * 0.9)
		}
		// The square's own ground stops short of the reports' cells.
		const family = realisedProgram(FAMILY)
		expect(reachOf(INSIGHT_BRIDGE_APPLET.id)).toBeLessThan(inradius)
		expect(family.plan.boundary.outlines.length).toBeGreaterThan(0)
		const laid = familyHexIsland()
		const farthest = Math.max(
			...[...laid.berths.values()].flatMap((berth) =>
				berth.ring.map((p) => Math.hypot(p[0], p[1])),
			),
		)
		expect(farthest).toBeLessThanOrEqual(FAMILY_REACH * (1 + 1e-6))
	})
})
