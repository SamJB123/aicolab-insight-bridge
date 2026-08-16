/**
 * The cosmos bake — the legacy insight-bridge force topology, run as a
 * DETERMINISTIC seeded solve at load (cosmos v2, settled 2026-08-14).
 *
 * Reverse-engineered from the legacy frontend and ported faithfully:
 *   • one input signal per source→topic membership — intensity, from grades
 *     {exemplar: 10, high_value: 5, standard: 1} (mode 'grades') or the
 *     corpus's continuous soft scores (mode 'soft');
 *   • same-type edges DERIVED by co-membership projection
 *     Σ over shared set of √(Iₐ·Iᵦ);
 *   • spring rest length 2D·(1 − √I/√Iₘₐₓ) per edge class — the strongest
 *     relationships collapse to zero distance — with cubic stiffness
 *     (I/Iₘₐₓ)³;
 *   • the mainstream/niche rule: nodes whose TOTAL incident intensity
 *     exceeds a threshold are RELEASED (their many short springs drag them
 *     into the core); weakly-connected nodes get a radial containment force
 *     parking them on the fringe shell at D/2. Sources are pinned harder
 *     than topics. Grades mode keeps the legacy threshold 5; soft mode
 *     derives it from the 65th percentile of per-node totals (the units
 *     change with the signal).
 *
 * Deliberate deviations, documented:
 *   • charge is TRUE repulsion (the legacy WebGPU port had a sign inversion
 *     that made it attraction; rejected);
 *   • ghost springs (max-length weak springs between unrelated same-type
 *     pairs) are approximated by the Barnes-Hut charge — same spreading
 *     pressure at a fraction of the edge count;
 *   • topics sharing a supercluster gain a small extra c-c affinity so
 *     constellations stay spatially gatherable even where co-source
 *     structure is thin (the legacy corpora were source-dense; ours vary).
 *
 * Determinism: d3-force's phyllotaxis initial placement is deterministic and
 * every stochastic jiggle draws from `randomSource(mulberry32(seed))` — the
 * same corpus bakes the same sky for every visitor, no seed storage needed.
 * Positions are normalised so the 92nd-percentile radius lands on
 * DISC_RADIUS, keeping the camera envelope stable across corpora and modes.
 *
 * Pure math — no three.js, no DOM — so it runs in node tests and doubles as
 * the CPU pick mirror at runtime.
 */

import { mulberry32 } from '@aicolab/kolo/utils/seeded-random'
import {
	forceCollide,
	forceLink,
	forceManyBody,
	forceRadial,
	forceSimulation,
	forceX,
	forceY,
	type SimulationLinkDatum,
	type SimulationNodeDatum,
} from 'd3-force'
import type { IBGalaxy, IBIntensityMode, IBNodeId, IBTier } from '../types.ts'

export interface GalaxyLayout {
	/** xyz triplets, order mirrors `galaxy.nodes`. */
	positions: Float32Array
	/** Visual node radius, same order. */
	radii: Float32Array
	index: Map<IBNodeId, number>
	/** The niche threshold actually used (for diagnostics/tests). */
	nicheThreshold: number
}

export interface CosmosBakeOptions {
	intensityMode?: IBIntensityMode
	/** Normalised sky radius (the 92nd-percentile node lands here). */
	discRadius?: number
	/** Simulation ticks. */
	ticks?: number
	/** Vertical (±y) thickness of the disc. */
	thickness?: number
}

export const DISC_RADIUS = 100

/** Visual-radius band per tier: [min, max], scaled by √(weight/tierMax).
 * Tiers 1/2 have no bodies since cosmos v2 — their radii only feed camera
 * framing via clusterReach. */
const RADIUS_BANDS: Record<IBTier, readonly [number, number]> = {
	[-1]: [0.14, 0.42],
	0: [0.35, 1.4],
	1: [1.6, 3.0],
	2: [2.4, 3.8],
}

const GRADE_INTENSITY: Record<string, number> = {
	exemplar: 10,
	high_value: 5,
	standard: 1,
	member: 1,
}

/** Extra c-c affinity for topics sharing a supercluster (our extension). */
const SAME_GROUP_AFFINITY = 4

/** One formula for a cluster's reach, shared with the engine so camera
 * framing and layout can't disagree about how big a constellation is. */
export function clusterReach(
	childCount: number,
	parentRadius: number,
	clusterSpread: number,
): number {
	return clusterSpread * Math.sqrt(Math.max(1, childCount)) + parentRadius + 0.8
}

/** Primary parent per child: the first primary edge wins; children with only
 * secondary edges fall back to their first edge. */
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

interface CosmosNode extends SimulationNodeDatum {
	id: IBNodeId
	/** Index into galaxy.nodes. */
	node: number
	tier: IBTier
	collide: number
	totalIntensity: number
}

interface CosmosLink extends SimulationLinkDatum<CosmosNode> {
	rest: number
	strength: number
}

export function bakeGalaxyLayout(galaxy: IBGalaxy, options: CosmosBakeOptions = {}): GalaxyLayout {
	const {
		intensityMode = 'grades',
		discRadius = DISC_RADIUS,
		ticks = 300,
		thickness = 2.2,
	} = options
	const nodes = galaxy.nodes
	const index = new Map<IBNodeId, number>()
	nodes.forEach((node, i) => index.set(node.id, i))
	const positions = new Float32Array(nodes.length * 3)
	const radii = new Float32Array(nodes.length)

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

	// ── Simulation participants: topics + sources only ─────────────────────
	const simNodes: CosmosNode[] = []
	const simIndexOf = new Map<number, number>()
	nodes.forEach((node, i) => {
		if (node.tier !== 0 && node.tier !== -1) return
		simIndexOf.set(i, simNodes.length)
		simNodes.push({
			id: node.id,
			node: i,
			tier: node.tier,
			collide: node.tier === 0 ? radii[i] * 2.2 : radii[i] * 1.5 + 0.35,
			totalIntensity: 0,
		})
	})

	// ── Edge intensities ────────────────────────────────────────────────────
	const gradeOf = (
		membershipType: string | null | undefined,
		similarity: number | null | undefined,
	): number => {
		if (membershipType && GRADE_INTENSITY[membershipType] !== undefined) {
			return GRADE_INTENSITY[membershipType]
		}
		if (similarity != null) return Math.max(1, similarity * 10)
		return 1
	}

	// Real source→topic memberships, plus each topic's member-source list for
	// the co-membership projections.
	interface Membership {
		source: number // sim index
		topic: number // sim index
		intensity: number
	}
	const memberships: Membership[] = []
	const sourcesByTopic = new Map<number, Array<{ source: number; intensity: number }>>()
	for (const edge of galaxy.edges) {
		const childIdx = index.get(edge.child)
		const parentIdx = index.get(edge.parent)
		if (childIdx === undefined || parentIdx === undefined) continue
		if (nodes[childIdx].tier !== -1 || nodes[parentIdx].tier !== 0) continue
		const source = simIndexOf.get(childIdx)
		const topic = simIndexOf.get(parentIdx)
		if (source === undefined || topic === undefined) continue
		const grade = gradeOf(edge.membershipType, edge.similarity)
		const intensity = intensityMode === 'soft' ? Math.max(0.1, edge.softIntensity ?? grade) : grade
		memberships.push({ source, topic, intensity })
		const list = sourcesByTopic.get(topic)
		if (list) list.push({ source, intensity })
		else sourcesByTopic.set(topic, [{ source, intensity }])
	}

	// Derived same-type intensities: Σ √(Iₐ·Iᵦ) over the shared set. The full
	// clique is O(n²) per shared container — real corpora have topics with
	// hundreds of `member`-grade sources, which explodes into millions of
	// springs (and a blown call stack). Past a threshold the clique degrades
	// to HUB-AND-SPOKE: every member pairs with the strongest K members only.
	// Same gathering pressure (everyone is pulled toward the same exemplar
	// hubs, and the hubs toward each other), linear spring count.
	const PROJECTION_CLIQUE_LIMIT = 24
	const PROJECTION_HUBS = 12
	const pairKey = (a: number, b: number): number => (a < b ? a * 65536 + b : b * 65536 + a)
	const accumulatePairs = (
		list: Array<{ at: number; intensity: number }>,
		pairs: Map<number, number>,
	): void => {
		if (list.length > PROJECTION_CLIQUE_LIMIT) {
			// Deterministic hub choice: intensity desc, sim index as tiebreak.
			const ranked = [...list].sort((a, b) => b.intensity - a.intensity || a.at - b.at)
			const hubs = ranked.slice(0, PROJECTION_HUBS)
			for (const member of ranked) {
				for (const hub of hubs) {
					if (hub.at === member.at) continue
					const key = pairKey(member.at, hub.at)
					pairs.set(key, (pairs.get(key) ?? 0) + Math.sqrt(member.intensity * hub.intensity))
				}
			}
			return
		}
		for (let a = 0; a < list.length; a++) {
			for (let b = a + 1; b < list.length; b++) {
				const key = pairKey(list[a].at, list[b].at)
				pairs.set(key, (pairs.get(key) ?? 0) + Math.sqrt(list[a].intensity * list[b].intensity))
			}
		}
	}
	const sourcePair = new Map<number, number>()
	for (const list of sourcesByTopic.values()) {
		accumulatePairs(
			list.map((entry) => ({ at: entry.source, intensity: entry.intensity })),
			sourcePair,
		)
	}
	const topicsBySource = new Map<number, Array<{ topic: number; intensity: number }>>()
	for (const membership of memberships) {
		const list = topicsBySource.get(membership.source)
		if (list) list.push({ topic: membership.topic, intensity: membership.intensity })
		else
			topicsBySource.set(membership.source, [
				{ topic: membership.topic, intensity: membership.intensity },
			])
	}
	const topicPair = new Map<number, number>()
	for (const list of topicsBySource.values()) {
		accumulatePairs(
			list.map((entry) => ({ at: entry.topic, intensity: entry.intensity })),
			topicPair,
		)
	}
	// Our extension: same-supercluster topics gain a fixed affinity so
	// constellations gather even where co-source structure is thin.
	const topicsByGroup = new Map<IBNodeId, number[]>()
	for (const edge of galaxy.edges) {
		const childIdx = index.get(edge.child)
		const parentIdx = index.get(edge.parent)
		if (childIdx === undefined || parentIdx === undefined) continue
		if (nodes[childIdx].tier !== 0 || nodes[parentIdx].tier !== 1) continue
		if (!edge.isPrimary) continue
		const sim = simIndexOf.get(childIdx)
		if (sim === undefined) continue
		const list = topicsByGroup.get(edge.parent)
		if (list) list.push(sim)
		else topicsByGroup.set(edge.parent, [sim])
	}
	for (const members of topicsByGroup.values()) {
		for (let a = 0; a < members.length; a++) {
			for (let b = a + 1; b < members.length; b++) {
				const key = pairKey(members[a], members[b])
				topicPair.set(key, (topicPair.get(key) ?? 0) + SAME_GROUP_AFFINITY)
			}
		}
	}

	// ── Links with legacy rest/strength per class ───────────────────────────
	const links: CosmosLink[] = []
	const addClass = (entries: Array<{ a: number; b: number; intensity: number }>): void => {
		// Loop, never spread — an edge class can hold 10⁵+ entries and
		// Math.max(...) overflows the call stack past ~10⁵ arguments.
		let maxIntensity = 0.001
		for (const entry of entries) {
			if (entry.intensity > maxIntensity) maxIntensity = entry.intensity
		}
		const sqrtMax = Math.sqrt(maxIntensity)
		for (const entry of entries) {
			const rest =
				discRadius * 2 - discRadius * 2 * (Math.sqrt(Math.max(entry.intensity, 0)) / sqrtMax)
			const strength = Math.max(0.003, (entry.intensity / maxIntensity) ** 3)
			links.push({ source: entry.a, target: entry.b, rest, strength })
			simNodes[entry.a].totalIntensity += entry.intensity
			simNodes[entry.b].totalIntensity += entry.intensity
		}
	}
	addClass(memberships.map((m) => ({ a: m.source, b: m.topic, intensity: m.intensity })))
	addClass(
		[...sourcePair.entries()].map(([key, intensity]) => ({
			a: Math.floor(key / 65536),
			b: key % 65536,
			intensity,
		})),
	)
	addClass(
		[...topicPair.entries()].map(([key, intensity]) => ({
			a: Math.floor(key / 65536),
			b: key % 65536,
			intensity,
		})),
	)

	// ── The niche threshold ─────────────────────────────────────────────────
	let nicheThreshold = 5
	if (intensityMode === 'soft') {
		const totals = simNodes.map((node) => node.totalIntensity).sort((a, b) => a - b)
		nicheThreshold = totals[Math.floor(totals.length * 0.65)] ?? 5
	}

	// ── Solve ───────────────────────────────────────────────────────────────
	const rng = mulberry32(galaxy.seed)
	const simulation = forceSimulation<CosmosNode>(simNodes)
		.randomSource(rng)
		.force(
			'link',
			forceLink<CosmosNode, CosmosLink>(links)
				.distance((link) => link.rest)
				.strength((link) => link.strength),
		)
		.force('charge', forceManyBody<CosmosNode>().strength(-30).theta(0.9))
		.force(
			'collide',
			forceCollide<CosmosNode>()
				.radius((node) => node.collide)
				.strength(0.5),
		)
		.force(
			'radial',
			forceRadial<CosmosNode>(discRadius / 2, 0, 0).strength((node) =>
				node.totalIntensity > nicheThreshold ? 0 : node.tier === -1 ? 0.05 : 0.025,
			),
		)
		.force('gravityX', forceX<CosmosNode>(0).strength(0.012))
		.force('gravityY', forceY<CosmosNode>(0).strength(0.012))
		.stop()
	for (let tick = 0; tick < ticks; tick++) simulation.tick()

	// ── Normalise to the disc + write out ───────────────────────────────────
	const radiiSorted = simNodes
		.map((node) => Math.hypot(node.x ?? 0, node.y ?? 0))
		.sort((a, b) => a - b)
	const p92 = radiiSorted[Math.floor(radiiSorted.length * 0.92)] || 1
	const scale = discRadius / p92

	// Layout convention (unchanged): disc in XZ, y = thickness.
	for (const simNode of simNodes) {
		const i = simNode.node
		positions[i * 3] = (simNode.x ?? 0) * scale
		positions[i * 3 + 1] = (rng() * 2 - 1) * thickness
		positions[i * 3 + 2] = (simNode.y ?? 0) * scale
	}

	// Anchor tiers have no bodies — their positions are member centroids
	// (weighted by member weight) for camera framing, labels and fog.
	const centroidOf = (memberIdxs: number[]): [number, number, number] => {
		let x = 0
		let y = 0
		let z = 0
		let total = 0
		for (const member of memberIdxs) {
			const w = Math.max(1, nodes[member].weight)
			x += positions[member * 3] * w
			y += positions[member * 3 + 1] * w
			z += positions[member * 3 + 2] * w
			total += w
		}
		if (total === 0) return [0, 0, 0]
		return [x / total, y / total, z / total]
	}
	const parentOf = primaryParents(galaxy)
	const membersOf = new Map<IBNodeId, number[]>()
	nodes.forEach((node, i) => {
		if (node.tier !== 0) return
		const parent = parentOf.get(node.id)
		if (parent === undefined) return
		const list = membersOf.get(parent)
		if (list) list.push(i)
		else membersOf.set(parent, [i])
	})
	nodes.forEach((node, i) => {
		if (node.tier !== 1) return
		const [x, y, z] = centroidOf(membersOf.get(node.id) ?? [])
		positions[i * 3] = x
		positions[i * 3 + 1] = y
		positions[i * 3 + 2] = z
	})
	const groupsOf = new Map<IBNodeId, number[]>()
	nodes.forEach((node, i) => {
		if (node.tier !== 1) return
		const parent = parentOf.get(node.id)
		if (parent === undefined) return
		const list = groupsOf.get(parent)
		if (list) list.push(i)
		else groupsOf.set(parent, [i])
	})
	nodes.forEach((node, i) => {
		if (node.tier !== 2) return
		const [x, y, z] = centroidOf(groupsOf.get(node.id) ?? [])
		positions[i * 3] = x
		positions[i * 3 + 1] = y
		positions[i * 3 + 2] = z
	})

	return { positions, radii, index, nicheThreshold }
}
