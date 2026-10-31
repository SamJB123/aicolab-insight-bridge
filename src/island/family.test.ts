// The family as a space: an island on the one honeycomb, its reports held
// open in the registry’s order — round its square standing alone, in its
// group beyond its far shore held open — each
// report's island placed out along that bearing on its own patch of the
// same honeycomb, beyond the family's coast, no two patches sharing a cell
// — each reached by a ferry line over the water between, from a wharf at
// the family's shore to the report's pier, over the sea lanes.

import { insideRing } from '@aicolab/atlas/chessboard/content/ground.ts'
import { FERRY } from '@aicolab/atlas/chessboard/content/space/ferry-lines.ts'
import { HEX_SPACE } from '@aicolab/atlas/chessboard/content/space/hex-space-measures.ts'
import { pierServing, piersOf } from '@aicolab/atlas/chessboard/content/space/pier-declaration.ts'
import { insideBoundary } from '@aicolab/atlas/chessboard/content/space/plan.ts'
import { programKey } from '@aicolab/atlas/chessboard/content/space/programs.ts'
import {
	programPlacings,
	realisedProgram,
} from '@aicolab/atlas/chessboard/content/space/realised-spaces.ts'
import { hexLatticeDistance, hexLatticeLay } from '@aicolab/kolo/shaders/lattice'
import { ferryLineOf, ferryStopId, spaceCentre } from '@aicolab/kolo/space'
import { describe, expect, it } from 'vitest'
import { INSIGHT_BRIDGE_APPLET, REPORT_APPLETS } from '../applets.ts'
import { familyHexIsland } from './family.ts'

const FAMILY = programKey(INSIGHT_BRIDGE_APPLET.id)

describe('the Insight Bridge family', () => {
	it('standing alone, holds every report open round its square in the lay’s order, the registry’s', () => {
		const placings = programPlacings(FAMILY)
		const laid = familyHexIsland()
		// An island: its way in takes a cell of its own.
		expect(laid.wayIn.cell).not.toBeNull()
		const lay = hexLatticeLay(REPORT_APPLETS.length)
		const bearings = REPORT_APPLETS.map((applet, index) => {
			const cell = laid.cells.get(applet.id)
			if (!cell) throw new Error(`${applet.id} has no cell`)
			expect(cell, applet.id).toEqual(lay[index])
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

	it('held open, stands at the edge of its group: the first report straight out beyond its far shore, the rest round it nearest first', () => {
		// Held by a space to its south: its group lies north, beyond it.
		const toward: [number, number] = [0, 1]
		const laid = familyHexIsland({ at: [0, 0], depth: 0, heldOpen: { toward } })
		const placed = REPORT_APPLETS.map((applet) => {
			const cell = laid.cells.get(applet.id)
			const placing = laid.held.get(applet.id)
			if (!cell || !placing) throw new Error(`${applet.id} is not placed`)
			// On the far side, the holder's way in facing back toward it.
			expect(placing.at[1], applet.id).toBeLessThan(0)
			return { id: applet.id, cell, at: placing.at }
		})
		const [middle, ...round] = placed
		if (!middle) throw new Error('no report')
		// The middle: the first ring's cell straight out, away from the holder.
		expect(middle.cell).toEqual({ q: 0, r: -1 })
		expect(middle.at[0]).toBeCloseTo(0, 6)
		// The rest each a cell from the middle, nearer the family first: the
		// rings they stand on never fall in the registry's order.
		const rings = round.map(({ id, cell }) => {
			const fromMiddle = { q: cell.q - middle.cell.q, r: cell.r - middle.cell.r }
			expect(hexLatticeDistance(fromMiddle), id).toBe(1)
			return hexLatticeDistance(cell)
		})
		expect(rings).toEqual([...rings].sort((a, b) => a - b))
		// Its way in faces its holder, to the south: the near side, its group's
		// edge.
		expect(laid.wayIn.bearing[1]).toBeGreaterThan(0.5)
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

	it('reaches each report by a ferry line from a wharf at its shore to the report’s pier, the way ending at the wharf', () => {
		const family = realisedProgram(FAMILY)
		const familyCentre = spaceCentre(family.document)
		const ferries = family.plan.vessels.filter(
			(vessel) => vessel.visual.kind === 'drawn' && vessel.visual.model === 'ferry',
		)
		// A line per report, so many ferries each.
		expect(ferries).toHaveLength(REPORT_APPLETS.length * FERRY.vesselsPerLine)
		const placings = programPlacings(FAMILY)
		const wharves = piersOf(family.document)
		for (const applet of REPORT_APPLETS) {
			const placing = placings.get(programKey(applet.id))
			if (!placing) throw new Error(`${applet.id} is not placed`)
			// A berth for the report at a pier on the family's shore (a wharf of
			// its own, or a side of a finger pier it shares); the report's pier.
			const wharf = pierServing(wharves, applet.id)
			if (!wharf) throw new Error(`no berth for ${applet.id}`)
			const pier = piersOf(placing.document)[0]
			if (!pier) throw new Error(`${applet.id} reaches no pier out`)
			// The family's way runs on its own land, to where the flight of the
			// pier its berth is at lands.
			const plate = family.plan.piers.find((each) =>
				each.berths.some((berth) => berth.serves === applet.id),
			)?.flight?.plate
			if (!plate) throw new Error(`no flight onto ${applet.id}'s pier`)
			const way = family.plan.paths.find((path) => {
				const last = path.points[path.points.length - 1]
				return last !== undefined && Math.hypot(last[0] - plate[0], last[1] - plate[1]) < 0.5
			})
			const end = way?.points[way.points.length - 1]
			if (!end) throw new Error(`no way to ${applet.id}'s pier`)
			expect(way?.crossing, applet.id).toBeUndefined()
			expect(way?.bridges ?? [], applet.id).toEqual([])
			expect(insideBoundary(family.plan.boundary, end[0], end[1]), applet.id).toBe(true)
			// The line calls at the family and at the report; each ferry's docks
			// are those two stops, and a visitor steps ashore at the wharf's
			// landing and the pier's.
			const line = `path:${applet.id}`
			const ships = ferries.filter((vessel) => ferryLineOf(vessel.id) === line)
			expect(ships, applet.id).toHaveLength(FERRY.vesselsPerLine)
			for (const ship of ships) {
				expect(ship.timetable.docks.map((dock) => dock.id).sort()).toEqual(
					[ferryStopId(line, INSIGHT_BRIDGE_APPLET.id), ferryStopId(line, applet.id)].sort(),
				)
				// The ship's berths lie off the wharf's face and off the pier's face,
				// never on land: each dock's point a standoff off its pier's end.
				for (const dock of ship.timetable.docks) {
					const at = ship.timetable.path[dock.pointIndex]
					if (!at) throw new Error('a dock off the path')
					const berthed: [number, number] = [at[0] + familyCentre[0], at[1] + familyCentre[1]]
					const face = dock.id === ferryStopId(line, applet.id) ? pier.end : wharf.end
					expect(Math.hypot(berthed[0] - face[0], berthed[1] - face[1]), dock.id).toBeLessThan(6)
					expect(insideBoundary(family.plan.boundary, at[0], at[1]), dock.id).toBe(false)
				}
			}
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
