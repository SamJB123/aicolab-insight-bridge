import { describe, expect, it } from 'vitest'
import { resolveArmIdentity } from './engine/hues.ts'
import { bakeGalaxyLayout } from './layout/cosmos.ts'
import { GalaxyNavCore } from './nav-core.ts'
import type { IBGalaxy } from './types.ts'

// Reverse input order catches layout passes that position parents first.
const galaxy: IBGalaxy = {
	nodes: Array.from({ length: 7 }, (_, i) => ({ id: `n${i}`, tier: i - 1, title: `Level ${i}`, key: i, weight: 1 })).reverse(),
	edges: Array.from({ length: 6 }, (_, i) => ({ child: `n${i}`, parent: `n${i + 1}`, isPrimary: true })),
	tiers: [], weightLabel: 'topics', mixOrder: [], mixColors: {}, seed: 7,
}

describe('deep galaxy hierarchy', () => {
	it('keeps every container in direct-entry breadcrumbs', () => {
		const core = new GalaxyNavCore(galaxy)
		expect(core.containerLineage(core.nodeOf('n1')!)).toEqual(
			['n6', 'n5', 'n4', 'n3', 'n2'].map((id) => ({ kind: 'node', id })),
		)
	})

	it('positions every generation at its child centroid with finite radii', () => {
		const layout = bakeGalaxyLayout(galaxy)
		const topic = layout.index.get('n1')!
		for (const node of galaxy.nodes.filter((node) => node.tier > 0)) {
			const i = layout.index.get(node.id)!
			expect(layout.radii[i]).toBeGreaterThan(0)
			for (let axis = 0; axis < 3; axis++) {
				expect(layout.positions[i * 3 + axis]).toBe(layout.positions[topic * 3 + axis])
			}
		}
	})

	it('assigns the deepest source and every ancestor to the root arm', () => {
		const arms = resolveArmIdentity(galaxy)
		expect(arms.ownerNodes.map((i) => galaxy.nodes[i].id)).toEqual(['n6'])
		expect([...arms.armOf]).toEqual(galaxy.nodes.map(() => 0))
	})

	it('terminates ancestry walks on cyclic input', () => {
		const cyclic = { ...galaxy, edges: [...galaxy.edges, { child: 'n6', parent: 'n2', isPrimary: true }] }
		const core = new GalaxyNavCore(cyclic)
		expect(core.containerLineage(core.nodeOf('n1')!)).toHaveLength(5)
		expect(resolveArmIdentity(cyclic).ownerNodes).toHaveLength(1)
	})
})
