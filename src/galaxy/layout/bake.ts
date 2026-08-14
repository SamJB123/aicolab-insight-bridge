/**
 * Layout bake — a short deterministic relaxation over the spiral seed.
 *
 * Position-based (no velocities, so a small step is unconditionally stable):
 * each iteration nudges nodes by
 *   • an ANCHOR spring back to the seeded position — strong on families and
 *     groups (the spiral structure is authored, not emergent), gentle on
 *     topics — which also keeps everyone near the galactic plane;
 *   • PRIMARY-EDGE springs keeping a leaf inside its cluster's reach and off
 *     its parent's face;
 *   • SECONDARY-EDGE pulls (audit's DAG): a multi-member topic drifts toward
 *     its other superclusters, proportionally to similarity — shared topics
 *     visibly lean between constellations;
 *   • SIBLING separation within a cluster, and anchor separation between
 *     group clusters, so nothing overlaps.
 *
 * Runs once at load and freezes: the result is the render layout AND the CPU
 * pick mirror. Randomness appears only to break exact-overlap ties, drawn
 * from mulberry32 so the bake stays reproducible.
 */

import { mulberry32 } from '@aicolab/kolo/utils/seeded-random'
import type { IBGalaxy } from '../types.ts'
import {
	clusterReach,
	type GalaxyLayout,
	type GalaxyLayoutOptions,
	primaryParents,
	seedGalaxyLayout,
} from './spiral-seed.ts'

export interface GalaxyBakeOptions extends GalaxyLayoutOptions {
	iterations?: number
	/** Anchor-spring strength per tier [topic, group, family]. */
	anchorStrength?: readonly [number, number, number]
	/** Primary-edge spring strength. */
	edgeStrength?: number
	/** Secondary-edge pull strength (scaled by edge similarity). */
	secondaryStrength?: number
	/** Overlap push strength. */
	separationStrength?: number
}

/** Seed + relax in one call — the normal entry point. */
export function bakeGalaxyLayout(
	galaxy: IBGalaxy,
	options: GalaxyBakeOptions = {},
): GalaxyLayout {
	return relaxGalaxyLayout(galaxy, seedGalaxyLayout(galaxy, options), options)
}

/** Relaxes `layout.positions` in place and returns the same layout. */
export function relaxGalaxyLayout(
	galaxy: IBGalaxy,
	layout: GalaxyLayout,
	options: GalaxyBakeOptions = {},
): GalaxyLayout {
	const {
		iterations = 240,
		anchorStrength = [0.02, 0.2, 0.35],
		edgeStrength = 0.08,
		secondaryStrength = 0.006,
		separationStrength = 0.5,
		clusterSpread = 1.9,
	} = options
	const { positions, radii, index } = layout
	const nodes = galaxy.nodes
	const anchors = positions.slice()
	const rng = mulberry32(galaxy.seed ^ 0x9e3779b9)

	const parentOf = primaryParents(galaxy)
	const clusters = new Map<number, number[]>()
	const primaryEdges: Array<[number, number]> = []
	const secondaryEdges: Array<[number, number, number]> = []
	for (const node of nodes) {
		if (node.tier !== 0) continue
		const i = index.get(node.id)
		if (i === undefined) continue
		const parentId = parentOf.get(node.id)
		const p = parentId !== undefined ? index.get(parentId) : undefined
		if (p === undefined) continue
		primaryEdges.push([i, p])
		const members = clusters.get(p)
		if (members) members.push(i)
		else clusters.set(p, [i])
	}
	for (const edge of galaxy.edges) {
		if (edge.isPrimary) continue
		const child = index.get(edge.child)
		const parent = index.get(edge.parent)
		if (child === undefined || parent === undefined) continue
		if (parentOf.get(edge.child) === edge.parent) continue // primary via fallback
		secondaryEdges.push([child, parent, edge.similarity ?? 0.5])
	}
	const reachOf = new Map<number, number>()
	for (const [p, members] of clusters) {
		reachOf.set(p, clusterReach(members.length, radii[p], clusterSpread))
	}
	const groupIdx = nodes.flatMap((node, i) => (node.tier === 1 ? [i] : []))

	// Nudge `i` along its offset from `j`, jittering when exactly coincident.
	const pushApart = (i: number, j: number, amount: number, yDamp: number): void => {
		let dx = positions[i * 3] - positions[j * 3]
		let dy = positions[i * 3 + 1] - positions[j * 3 + 1]
		let dz = positions[i * 3 + 2] - positions[j * 3 + 2]
		let d = Math.hypot(dx, dy, dz)
		if (d < 1e-6) {
			const angle = rng() * Math.PI * 2
			dx = Math.cos(angle)
			dy = 0
			dz = Math.sin(angle)
			d = 1
		}
		positions[i * 3] += (dx / d) * amount
		positions[i * 3 + 1] += (dy / d) * amount * yDamp
		positions[i * 3 + 2] += (dz / d) * amount
	}

	for (let iter = 0; iter < iterations; iter++) {
		// Primary springs: stay within reach, off the parent's face.
		for (const [child, parent] of primaryEdges) {
			const dx = positions[parent * 3] - positions[child * 3]
			const dy = positions[parent * 3 + 1] - positions[child * 3 + 1]
			const dz = positions[parent * 3 + 2] - positions[child * 3 + 2]
			const d = Math.hypot(dx, dy, dz)
			const reach = reachOf.get(parent) ?? 4
			const minD = (radii[child] + radii[parent]) * 1.6
			if (d > reach) {
				const k = ((d - reach) / d) * edgeStrength
				positions[child * 3] += dx * k
				positions[child * 3 + 1] += dy * k
				positions[child * 3 + 2] += dz * k
			} else if (d < minD) {
				pushApart(child, parent, (minD - d) * 0.5, 0.3)
			}
		}
		// Secondary pulls (the DAG lean).
		for (const [child, parent, similarity] of secondaryEdges) {
			const k = secondaryStrength * similarity
			positions[child * 3] += (positions[parent * 3] - positions[child * 3]) * k
			positions[child * 3 + 1] += (positions[parent * 3 + 1] - positions[child * 3 + 1]) * k
			positions[child * 3 + 2] += (positions[parent * 3 + 2] - positions[child * 3 + 2]) * k
		}
		// Sibling separation inside each cluster.
		for (const members of clusters.values()) {
			for (let a = 0; a < members.length; a++) {
				for (let b = a + 1; b < members.length; b++) {
					const i = members[a]
					const j = members[b]
					const dx = positions[i * 3] - positions[j * 3]
					const dy = positions[i * 3 + 1] - positions[j * 3 + 1]
					const dz = positions[i * 3 + 2] - positions[j * 3 + 2]
					const d = Math.hypot(dx, dy, dz)
					const minSep = (radii[i] + radii[j]) * 2.4
					if (d < minSep) {
						const amount = (minSep - d) * 0.5 * separationStrength
						pushApart(i, j, amount, 0.3)
						pushApart(j, i, amount, 0.3)
					}
				}
			}
		}
		// Cluster separation between group anchors.
		for (let a = 0; a < groupIdx.length; a++) {
			for (let b = a + 1; b < groupIdx.length; b++) {
				const i = groupIdx[a]
				const j = groupIdx[b]
				const dx = positions[i * 3] - positions[j * 3]
				const dz = positions[i * 3 + 2] - positions[j * 3 + 2]
				const d = Math.hypot(dx, dz)
				const minSep = (reachOf.get(i) ?? radii[i] * 2) + (reachOf.get(j) ?? radii[j] * 2)
				if (d < minSep) {
					const amount = (minSep - d) * 0.05
					pushApart(i, j, amount, 0)
					pushApart(j, i, amount, 0)
				}
			}
		}
		// Anchor springs — the authored structure always wins in the end.
		for (let i = 0; i < nodes.length; i++) {
			const k = anchorStrength[nodes[i].tier]
			positions[i * 3] += (anchors[i * 3] - positions[i * 3]) * k
			positions[i * 3 + 1] += (anchors[i * 3 + 1] - positions[i * 3 + 1]) * k
			positions[i * 3 + 2] += (anchors[i * 3 + 2] - positions[i * 3 + 2]) * k
		}
	}
	return layout
}
