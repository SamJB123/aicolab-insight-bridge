/**
 * The cosmos bake is pure math (no three.js, no DOM), so its contracts are
 * testable directly: deterministic solves, disc containment, the legacy
 * mainstream-centre/niche-fringe rule, and the two intensity modes actually
 * producing different skies.
 */

import { describe, expect, it } from 'vitest'
import { buildFixtureGalaxy } from '../fixture.ts'
import { bakeGalaxyLayout, DISC_RADIUS, primaryParents } from './cosmos.ts'

const galaxy = buildFixtureGalaxy()

/** Radial distance in the disc plane (layout convention: disc in XZ). */
function discRadiusOf(positions: Float32Array, i: number): number {
	return Math.hypot(positions[i * 3], positions[i * 3 + 2])
}

describe('bakeGalaxyLayout', () => {
	it('is deterministic: the same corpus bakes the same sky', () => {
		const a = bakeGalaxyLayout(galaxy)
		const b = bakeGalaxyLayout(galaxy)
		expect(a.positions).toEqual(b.positions)
		expect(a.radii).toEqual(b.radii)
	})

	it('produces finite positions and per-tier radii for every node', () => {
		const layout = bakeGalaxyLayout(galaxy)
		for (let i = 0; i < galaxy.nodes.length; i++) {
			expect(Number.isFinite(layout.positions[i * 3])).toBe(true)
			expect(Number.isFinite(layout.positions[i * 3 + 1])).toBe(true)
			expect(Number.isFinite(layout.positions[i * 3 + 2])).toBe(true)
			expect(layout.radii[i]).toBeGreaterThan(0)
		}
	})

	it('normalises the sky to the disc: the 92nd-percentile body sits at DISC_RADIUS', () => {
		const layout = bakeGalaxyLayout(galaxy)
		const bodies = galaxy.nodes
			.map((node, i) => ({ node, i }))
			.filter(({ node }) => node.tier === 0 || node.tier === -1)
		const distances = bodies
			.map(({ i }) => discRadiusOf(layout.positions, i))
			.sort((a, b) => a - b)
		const p92 = distances[Math.floor(distances.length * 0.92)]
		expect(p92).toBeGreaterThan(DISC_RADIUS * 0.9)
		expect(p92).toBeLessThan(DISC_RADIUS * 1.1)
	})

	it('parks the mainstream in the core and the niche on the fringe', () => {
		const layout = bakeGalaxyLayout(galaxy)
		// Total membership intensity per source, from the raw grades.
		const grade: Record<string, number> = { exemplar: 10, high_value: 5, standard: 1 }
		const totals = new Map<string, number>()
		for (const edge of galaxy.edges) {
			const child = galaxy.nodes[layout.index.get(edge.child) ?? -1]
			if (child?.tier !== -1) continue
			const intensity = grade[edge.membershipType ?? ''] ?? 1
			totals.set(edge.child, (totals.get(edge.child) ?? 0) + intensity)
		}
		const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1])
		const quartile = Math.max(1, Math.floor(ranked.length / 4))
		const meanRadius = (entries: Array<[string, number]>): number => {
			let sum = 0
			for (const [id] of entries) {
				const i = layout.index.get(id)
				if (i !== undefined) sum += discRadiusOf(layout.positions, i)
			}
			return sum / entries.length
		}
		const mainstream = meanRadius(ranked.slice(0, quartile))
		const niche = meanRadius(ranked.slice(-quartile))
		expect(mainstream).toBeLessThan(niche)
	})

	it('bakes a different sky per intensity mode (grades vs soft)', () => {
		const grades = bakeGalaxyLayout(galaxy, { intensityMode: 'grades' })
		const soft = bakeGalaxyLayout(galaxy, { intensityMode: 'soft' })
		let moved = 0
		for (let i = 0; i < galaxy.nodes.length; i++) {
			const dx = grades.positions[i * 3] - soft.positions[i * 3]
			const dz = grades.positions[i * 3 + 2] - soft.positions[i * 3 + 2]
			if (Math.hypot(dx, dz) > 1) moved++
		}
		// The soft signal reweights most of the sky, not a node or two.
		expect(moved).toBeGreaterThan(galaxy.nodes.length * 0.25)
		// And the niche threshold is derived (percentile), not the grade constant.
		expect(soft.nicheThreshold).not.toBe(5)
		expect(grades.nicheThreshold).toBe(5)
	})

	it('places anchor tiers at their members’ weighted centroids', () => {
		const layout = bakeGalaxyLayout(galaxy)
		const parentOf = primaryParents(galaxy)
		const group = galaxy.nodes.find((node) => node.tier === 1)
		expect(group).toBeDefined()
		if (!group) return
		let x = 0
		let z = 0
		let total = 0
		galaxy.nodes.forEach((node, i) => {
			if (node.tier !== 0 || parentOf.get(node.id) !== group.id) return
			const w = Math.max(1, node.weight)
			x += layout.positions[i * 3] * w
			z += layout.positions[i * 3 + 2] * w
			total += w
		})
		expect(total).toBeGreaterThan(0)
		const gi = layout.index.get(group.id)
		expect(gi).toBeDefined()
		if (gi === undefined) return
		expect(layout.positions[gi * 3]).toBeCloseTo(x / total, 3)
		expect(layout.positions[gi * 3 + 2]).toBeCloseTo(z / total, 3)
	})
})

describe('bakeGalaxyLayout on dense corpora', () => {
	it('survives topics with hundreds of members (the Second Chair crash)', () => {
		// Synthetic corpus shaped like the real failure: broad `member`-grade
		// memberships give every topic a huge shared set. The full clique
		// projection is O(n²) per topic and used to blow the call stack via
		// Math.max(...spread); the hub-and-spoke degrade must handle it.
		const nodes: typeof galaxy.nodes = []
		const edges: typeof galaxy.edges = []
		const topicCount = 40
		const sourceCount = 500
		for (let t = 0; t < topicCount; t++) {
			nodes.push({ id: `t:${t}`, tier: 0, title: `Topic ${t}`, key: t, weight: 10 })
		}
		let stamp = 1
		const nextRandom = (): number => {
			// Tiny deterministic LCG — the shape matters, not the randomness.
			stamp = (stamp * 48271) % 2147483647
			return stamp / 2147483647
		}
		for (let s = 0; s < sourceCount; s++) {
			nodes.push({ id: `s:${s}`, tier: -1, title: `Source ${s}`, key: s, weight: 1 })
			const joined = new Set<number>()
			for (let m = 0; m < 25; m++) joined.add(Math.floor(nextRandom() * topicCount))
			let first = true
			for (const t of joined) {
				edges.push({
					child: `s:${s}`,
					parent: `t:${t}`,
					isPrimary: first,
					membershipType: 'member',
				})
				first = false
			}
		}
		const dense: typeof galaxy = {
			tiers: [
				{ tier: 0, label: 'Topic', labelPlural: 'Topics' },
				{ tier: -1, label: 'Source', labelPlural: 'Sources' },
			],
			nodes,
			edges,
			weightLabel: 'sources',
			seed: 7,
		}
		const layout = bakeGalaxyLayout(dense, { ticks: 60 })
		expect(Number.isFinite(layout.positions[0])).toBe(true)
		expect(layout.positions.length).toBe(nodes.length * 3)
	})
})

describe('primaryParents', () => {
	it('prefers primary edges, falling back to any edge', () => {
		const parents = primaryParents(galaxy)
		for (const edge of galaxy.edges) {
			if (edge.isPrimary) {
				// The recorded parent for this child must come from a primary edge
				// (the first one encountered).
				const recorded = parents.get(edge.child)
				const primaries = galaxy.edges
					.filter((entry) => entry.child === edge.child && entry.isPrimary)
					.map((entry) => entry.parent)
				expect(primaries).toContain(recorded)
			}
		}
		// Every child with any edge is mapped.
		for (const edge of galaxy.edges) {
			expect(parents.has(edge.child)).toBe(true)
		}
	})
})
