/**
 * Analytic spiral placement — the deterministic first pass of the layout.
 *
 * Three-tier galaxies: families anchor spiral arms around the core; their
 * groups walk outward along the arm's logarithmic sweep; topics scatter in a
 * seeded disc around their primary group. Two-tier galaxies (basin): groups
 * take a golden-angle phyllotaxis over the disc — still reads spiral — and
 * topics cluster the same way. Leaves with no parent edge at all sit on an
 * outer halo ring, visibly outside the structure (that IS their story).
 *
 * Everything draws from mulberry32(galaxy.seed): the same corpus renders the
 * same galaxy for every visitor, every visit, every screenshot. The bake
 * (./bake.ts) then relaxes overlaps without disturbing this structure.
 *
 * Pure math — no three.js, no DOM — so it runs in node tests and doubles as
 * the CPU pick mirror at runtime.
 */

import { mulberry32 } from '@aicolab/kolo/utils/seeded-random'
import type { IBGalaxy, IBNode, IBNodeId, IBTier } from '../types.ts'

export interface GalaxyLayoutOptions {
	/** Outer radius of the galactic disc, in world units. */
	discRadius?: number
	/** Radius of the family-core ring. */
	coreRadius?: number
	/** Radians an arm sweeps from core to rim. */
	armTwist?: number
	/** Vertical (±y) scatter of leaves off the galactic plane. */
	thickness?: number
	/** Scale of a cluster's topic scatter (multiplied by √childCount). */
	clusterSpread?: number
}

export interface GalaxyLayout {
	/** xyz triplets, order mirrors `galaxy.nodes`. */
	positions: Float32Array
	/** Visual node radius, same order. */
	radii: Float32Array
	index: Map<IBNodeId, number>
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** Default arm geometry — exported so the nebula volume can phase-lock its
 * bands to the same spiral law the layout draws. */
export const SPIRAL_CORE_RADIUS = 26
export const SPIRAL_ARM_TWIST = 2.6

/** Visual-radius band per tier: [min, max], scaled by √(weight/tierMax). */
const RADIUS_BANDS: Record<IBTier, readonly [number, number]> = {
	0: [0.35, 1.4],
	1: [1.6, 3.0],
	2: [2.4, 3.8],
}

/** One formula for a cluster's reach, shared with the bake so springs and
 * seeding can't disagree about how big a constellation is. */
export function clusterReach(
	childCount: number,
	parentRadius: number,
	clusterSpread: number,
): number {
	return clusterSpread * Math.sqrt(Math.max(1, childCount)) + parentRadius + 0.8
}

/** Primary parent per child: the first primary edge wins; children with only
 * secondary edges fall back to their first edge so data holes still place
 * near their strongest link. */
export function primaryParents(galaxy: IBGalaxy): Map<IBNodeId, IBNodeId> {
	const parentOf = new Map<IBNodeId, IBNodeId>()
	for (const edge of galaxy.edges) {
		if (edge.isPrimary && !parentOf.has(edge.child)) parentOf.set(edge.child, edge.parent)
	}
	for (const edge of galaxy.edges) {
		if (!parentOf.has(edge.child)) parentOf.set(edge.child, edge.parent)
	}
	return parentOf
}

export function seedGalaxyLayout(
	galaxy: IBGalaxy,
	options: GalaxyLayoutOptions = {},
): GalaxyLayout {
	const {
		discRadius = 100,
		coreRadius = SPIRAL_CORE_RADIUS,
		armTwist = SPIRAL_ARM_TWIST,
		thickness = 2.2,
		clusterSpread = 1.9,
	} = options
	const nodes = galaxy.nodes
	const index = new Map<IBNodeId, number>()
	nodes.forEach((node, i) => index.set(node.id, i))
	const at = (id: IBNodeId): number => {
		const i = index.get(id)
		if (i === undefined) throw new Error(`galaxy layout: unknown node id "${id}"`)
		return i
	}
	const positions = new Float32Array(nodes.length * 3)
	const radii = new Float32Array(nodes.length)
	const setPos = (i: number, x: number, y: number, z: number): void => {
		positions[i * 3] = x
		positions[i * 3 + 1] = y
		positions[i * 3 + 2] = z
	}

	// Visual radii: √weight within each tier's band.
	const tierMaxWeight = new Map<IBTier, number>()
	for (const node of nodes) {
		tierMaxWeight.set(node.tier, Math.max(tierMaxWeight.get(node.tier) ?? 1, node.weight))
	}
	nodes.forEach((node, i) => {
		const [lo, hi] = RADIUS_BANDS[node.tier]
		const max = tierMaxWeight.get(node.tier) ?? 1
		radii[i] = lo + (hi - lo) * Math.sqrt(Math.max(0, node.weight) / max)
	})

	const parentOf = primaryParents(galaxy)
	const childCounts = new Map<IBNodeId, number>()
	for (const node of nodes) {
		if (node.tier !== 0) continue
		const parent = parentOf.get(node.id)
		if (parent !== undefined) childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1)
	}

	const rng = mulberry32(galaxy.seed)
	const sortAnchors = (list: IBNode[]): IBNode[] =>
		[...list].sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : 1))
	const families = sortAnchors(nodes.filter((n) => n.tier === 2))
	const groups = sortAnchors(nodes.filter((n) => n.tier === 1))

	// ── Anchor tiers ────────────────────────────────────────────────────────
	const placedAnchors = new Set<IBNodeId>()
	const phyllotaxis = (list: IBNode[], rInner: number, rOuter: number): void => {
		list.forEach((node, k) => {
			const angle = k * GOLDEN_ANGLE + (rng() - 0.5) * 0.1
			const r = rInner + (rOuter - rInner) * Math.sqrt((k + 0.5) / list.length)
			setPos(
				at(node.id),
				Math.cos(angle) * r,
				(rng() - 0.5) * thickness * 0.8,
				Math.sin(angle) * r,
			)
			placedAnchors.add(node.id)
		})
	}

	if (families.length > 0) {
		const armAngle = new Map<IBNodeId, number>()
		families.forEach((family, k) => {
			const angle = (k / families.length) * Math.PI * 2 + (rng() - 0.5) * 0.3
			armAngle.set(family.id, angle)
			setPos(at(family.id), Math.cos(angle) * coreRadius, 0, Math.sin(angle) * coreRadius)
			placedAnchors.add(family.id)
		})
		for (const family of families) {
			const base = armAngle.get(family.id) ?? 0
			const members = groups.filter((g) => parentOf.get(g.id) === family.id)
			members.forEach((group, j) => {
				const t = (j + 1) / (members.length + 1)
				const angle = base + armTwist * t + (rng() - 0.5) * 0.12
				const r = coreRadius + (discRadius - coreRadius) * t ** 0.85
				setPos(
					at(group.id),
					Math.cos(angle) * r,
					(rng() - 0.5) * thickness * 0.8,
					Math.sin(angle) * r,
				)
				placedAnchors.add(group.id)
			})
		}
		// Groups whose parent is missing/unplaced: quiet outer phyllotaxis band.
		const armless = groups.filter((g) => !placedAnchors.has(g.id))
		if (armless.length > 0) phyllotaxis(armless, discRadius * 0.9, discRadius * 1.05)
	} else {
		phyllotaxis(groups, coreRadius, discRadius)
	}

	// ── Leaves ──────────────────────────────────────────────────────────────
	let orphanRank = 0
	nodes.forEach((node, i) => {
		if (node.tier !== 0) return
		const parentId = parentOf.get(node.id)
		const parentIdx = parentId !== undefined ? index.get(parentId) : undefined
		if (parentId !== undefined && parentIdx !== undefined && placedAnchors.has(parentId)) {
			const reach = clusterReach(childCounts.get(parentId) ?? 1, radii[parentIdx], clusterSpread)
			const angle = rng() * Math.PI * 2
			const dist = reach * Math.sqrt(rng())
			setPos(
				i,
				positions[parentIdx * 3] + Math.cos(angle) * dist,
				positions[parentIdx * 3 + 1] + (rng() * 2 - 1) * thickness,
				positions[parentIdx * 3 + 2] + Math.sin(angle) * dist,
			)
		} else {
			// Halo ring: parentless leaves sit visibly outside the structure.
			const angle = orphanRank * GOLDEN_ANGLE + (rng() - 0.5) * 0.2
			orphanRank += 1
			const r = discRadius * 1.12
			setPos(i, Math.cos(angle) * r, (rng() - 0.5) * thickness, Math.sin(angle) * r)
		}
	})

	return { positions, radii, index }
}
