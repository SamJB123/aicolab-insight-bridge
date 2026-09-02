/**
 * Arm identity — every node resolves to the arm that owns it (families in a
 * three-tier corpus, groups in basin's two-tier one), and every arm gets an
 * authored "cosmic" hue. These hues are scenery, not data (like the nebula
 * sprite palette): they tint beams, planet atmospheres and (phase 4) the
 * nebula bands so siblings read as one constellation. Deterministic
 * golden-angle walk around the hue wheel, saturation/lightness pinned to
 * bands that sit well on the dark void.
 */

import * as THREE from 'three/webgpu'
import type { IBGalaxy, IBNodeId } from '../types.ts'
import { primaryParents } from '../layout/cosmos.ts'
import { at } from './at.ts'

export interface ArmIdentity {
	/** Node index → index into `hues` (and `ownerNodes`), or -1 (orphans). */
	armOf: Int32Array
	/** Node indices of the arm-owner nodes, arm order. */
	ownerNodes: number[]
	hues: THREE.Color[]
}

const GOLDEN_TURN = 0.6180339887498949

export function resolveArmIdentity(galaxy: IBGalaxy): ArmIdentity {
	const nodes = galaxy.nodes
	const index = new Map<IBNodeId, number>()
	nodes.forEach((node, i) => index.set(node.id, i))
	const parentOf = primaryParents(galaxy)
	// Arms are owned by the highest topic tier PRESENT: families, else groups,
	// else the topics themselves (a single-level corpus still gets its hues).
	const ownerTier = nodes.some((n) => n.tier === 2) ? 2 : nodes.some((n) => n.tier === 1) ? 1 : 0

	const ownerNodes: number[] = []
	const armIndexByNode = new Map<number, number>()
	nodes.forEach((node, i) => {
		if (node.tier === ownerTier) {
			armIndexByNode.set(i, ownerNodes.length)
			ownerNodes.push(i)
		}
	})

	const armOf = new Int32Array(nodes.length).fill(-1)
	nodes.forEach((_node, i) => {
		let cursor: number | undefined = i
		for (let hop = 0; hop < 4 && cursor !== undefined; hop++) {
			const arm = armIndexByNode.get(cursor)
			if (arm !== undefined) {
				armOf[i] = arm
				return
			}
			const parentId = parentOf.get(at(nodes, cursor).id)
			cursor = parentId !== undefined ? index.get(parentId) : undefined
		}
	})

	// Hue walk starts in the violet-blue band (reads "cosmic" immediately) and
	// steps by the golden turn so neighbouring arms never share a hue.
	const hues = ownerNodes.map((_, k) => {
		const hue = (0.68 + k * GOLDEN_TURN) % 1
		return new THREE.Color().setHSL(hue, 0.62, 0.62)
	})
	return { armOf, ownerNodes, hues }
}
