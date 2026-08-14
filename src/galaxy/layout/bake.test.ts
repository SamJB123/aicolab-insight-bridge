import { describe, expect, it } from 'vitest'
import { buildFixtureGalaxy } from '../fixture.ts'
import type { IBGalaxy } from '../types.ts'
import { bakeGalaxyLayout } from './bake.ts'
import { primaryParents, seedGalaxyLayout } from './spiral-seed.ts'

const DISC_RADIUS = 100

function positionOf(layout: { positions: Float32Array }, i: number): [number, number, number] {
	return [layout.positions[i * 3], layout.positions[i * 3 + 1], layout.positions[i * 3 + 2]]
}

function distance(a: [number, number, number], b: [number, number, number]): number {
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

describe('galaxy layout bake', () => {
	it('is deterministic: same galaxy → identical positions and radii', () => {
		const a = bakeGalaxyLayout(buildFixtureGalaxy())
		const b = bakeGalaxyLayout(buildFixtureGalaxy())
		expect(Array.from(a.positions)).toEqual(Array.from(b.positions))
		expect(Array.from(a.radii)).toEqual(Array.from(b.radii))
	})

	it('changes with the seed', () => {
		const a = bakeGalaxyLayout(buildFixtureGalaxy({ seed: 1 }))
		const b = bakeGalaxyLayout(buildFixtureGalaxy({ seed: 2 }))
		expect(Array.from(a.positions)).not.toEqual(Array.from(b.positions))
	})

	const expectSane = (galaxy: IBGalaxy): void => {
		const layout = bakeGalaxyLayout(galaxy)
		expect(layout.positions.length).toBe(galaxy.nodes.length * 3)
		for (let i = 0; i < galaxy.nodes.length; i++) {
			const [x, y, z] = positionOf(layout, i)
			expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true)
			expect(Math.hypot(x, z)).toBeLessThan(DISC_RADIUS * 1.5)
			expect(Math.abs(y)).toBeLessThan(12)
			expect(layout.radii[i]).toBeGreaterThan(0)
		}
	}

	it('keeps every node finite and inside the disc (three tiers)', () => {
		expectSane(buildFixtureGalaxy())
	})

	it('handles the two-tier (basin) shape and audit flavour', () => {
		expectSane(buildFixtureGalaxy({ families: 0, groups: 20, topics: 88 }))
		expectSane(buildFixtureGalaxy({ withMix: false, groups: 59, topics: 276, families: 11 }))
	})

	it('keeps topics closer to their own group than to the average other group', () => {
		const galaxy = buildFixtureGalaxy()
		const layout = bakeGalaxyLayout(galaxy)
		const parentOf = primaryParents(galaxy)
		const groups = galaxy.nodes.filter((n) => n.tier === 1)

		let own = 0
		let other = 0
		let counted = 0
		for (const node of galaxy.nodes) {
			if (node.tier !== 0) continue
			const parentId = parentOf.get(node.id)
			if (parentId === undefined) continue
			const i = layout.index.get(node.id)
			const p = layout.index.get(parentId)
			if (i === undefined || p === undefined) continue
			own += distance(positionOf(layout, i), positionOf(layout, p))
			let sum = 0
			let n = 0
			for (const group of groups) {
				if (group.id === parentId) continue
				const g = layout.index.get(group.id)
				if (g === undefined) continue
				sum += distance(positionOf(layout, i), positionOf(layout, g))
				n += 1
			}
			other += sum / Math.max(1, n)
			counted += 1
		}
		expect(counted).toBeGreaterThan(100)
		expect(own / counted).toBeLessThan((other / counted) * 0.35)
	})

	it('places parentless leaves on the outer halo', () => {
		const galaxy = buildFixtureGalaxy({ orphans: 2 })
		const layout = seedGalaxyLayout(galaxy)
		const parentOf = primaryParents(galaxy)
		const orphanNodes = galaxy.nodes.filter((n) => n.tier === 0 && !parentOf.has(n.id))
		expect(orphanNodes.length).toBe(2)
		for (const node of orphanNodes) {
			const i = layout.index.get(node.id)
			expect(i).not.toBe(undefined)
			if (i === undefined) continue
			const [x, , z] = positionOf(layout, i)
			expect(Math.hypot(x, z)).toBeGreaterThan(DISC_RADIUS)
		}
	})
})
