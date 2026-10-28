// Audit every room plan of a report world for geometric faults: an outline
// that crosses itself, alleys whose rectangles overlap one another, and
// anchors that lie outside the room's outline or outside their own alley.
//   npx tsx scripts/room-geometry-audit.mts /tmp/secondchair-world.json [roomId]
import { readFileSync } from 'node:fs'
// Every report's island registered as its program, as the tests have them.
import '../src/island/test-scope.ts'
import { buildReportWorld, everyRoom } from '../src/island/world.ts'
import { worldRecordSchema } from '../src/world/index.ts'

type V = readonly [number, number]
const [file, only] = process.argv.slice(2)
if (!file) throw new Error('usage: room-geometry-audit.mts <world.json> [roomId]')
const record = worldRecordSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
const build = buildReportWorld(record)

const cross = (o: V, a: V, b: V) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
const segmentsCross = (a: V, b: V, c: V, d: V): boolean => {
	const d1 = cross(c, d, a)
	const d2 = cross(c, d, b)
	const d3 = cross(a, b, c)
	const d4 = cross(a, b, d)
	return (
		((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
		((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))
	)
}
const inside = (ring: readonly V[], x: number, z: number): boolean => {
	let ok = false
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const a = ring[i]
		const b = ring[j]
		if (!a || !b) continue
		if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) ok = !ok
	}
	return ok
}
type Box = { minX: number; maxX: number; minZ: number; maxZ: number }
const overlap = (a: Box, b: Box, tol = 0.05): number => {
	const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)
	const d = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ)
	return w > tol && d > tol ? w * d : 0
}

/** A line of the report, on stdout. */
const say = (line: string): void => {
	process.stdout.write(`${line}\n`)
}

let faulty = 0
const summary = { rooms: 0, selfCrossing: 0, bayOverlaps: 0, anchorsOutside: 0, anchorsOffBay: 0 }
for (const { room } of everyRoom(build)) {
	if (only && room.spaceId !== only) continue
	const plan = room.plan
	summary.rooms++
	const outline = plan.outline ?? []
	const faults: string[] = []
	if (!plan.outline) faults.push('no outline')
	// Self-crossing outline.
	for (let i = 0; i < outline.length; i++) {
		const a = outline[i]
		const b = outline[(i + 1) % outline.length]
		for (let j = i + 2; j < outline.length; j++) {
			if ((j + 1) % outline.length === i) continue
			const c = outline[j]
			const d = outline[(j + 1) % outline.length]
			if (a && b && c && d && segmentsCross(a, b, c, d)) {
				faults.push(`outline edge ${i} crosses edge ${j}`)
			}
		}
	}
	if (faults.length) summary.selfCrossing++
	// Overlapping alleys.
	const bays = plan.bays ?? []
	let overlapsHere = 0
	for (let i = 0; i < bays.length; i++) {
		for (let j = i + 1; j < bays.length; j++) {
			const a = bays[i]
			const b = bays[j]
			if (!a || !b) continue
			const area = overlap(a.bounds, b.bounds)
			if (area > 0) {
				overlapsHere++
				if (overlapsHere <= 6)
					faults.push(`alley '${a.label}' overlaps '${b.label}' by ${area.toFixed(1)} m²`)
			}
		}
	}
	if (overlapsHere) summary.bayOverlaps++
	// Anchors outside the outline, or outside their alley.
	let outsideHere = 0
	let offBayHere = 0
	for (const anchor of plan.anchors) {
		const [x, , z] = anchor.position
		if (!inside(outline, x, z)) {
			outsideHere++
			if (outsideHere <= 4)
				faults.push(
					`anchor ${anchor.id} at (${x.toFixed(1)}, ${z.toFixed(1)}) is outside the outline`,
				)
		}
		if (anchor.bay) {
			const bay = bays.find((b) => b.id === anchor.bay)
			if (bay) {
				const grown = {
					minX: bay.bounds.minX - 4,
					maxX: bay.bounds.maxX + 4,
					minZ: bay.bounds.minZ - 4,
					maxZ: bay.bounds.maxZ + 4,
				}
				if (x < grown.minX || x > grown.maxX || z < grown.minZ || z > grown.maxZ) {
					offBayHere++
					if (offBayHere <= 4)
						faults.push(`anchor ${anchor.id} is far from its alley '${bay.label}'`)
				}
			}
		}
	}
	if (outsideHere) summary.anchorsOutside++
	if (offBayHere) summary.anchorsOffBay++
	if (faults.length) {
		faulty++
		if (faulty <= 12 || only) {
			say(
				`\n== ${room.spaceId} (${room.label}) ${plan.width.toFixed(0)}×${plan.depth.toFixed(0)} m, ${bays.length} alleys, ${plan.anchors.length} anchors`,
			)
			for (const f of faults) say(`    ${f}`)
			if (overlapsHere > 6) say(`    … ${overlapsHere} overlaps in all`)
			if (outsideHere > 4) say(`    … ${outsideHere} anchors outside in all`)
		}
	}
}
say(`\nsummary ${JSON.stringify(summary)} faulty rooms ${faulty}`)
