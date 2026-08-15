/**
 * Dithered box raymarch — a local fork of three's RaymarchingBox
 * (three/addons/tsl/utils/Raymarching.js), reworked for mobile fragment
 * budgets (settled 2026-08-15):
 *
 *   • bayer16 ray-start jitter (the official webgpu_volume_lighting recipe):
 *     banding becomes fine grain, so 4–8 steps look like many more — the
 *     fog's half-res gaussian pass launders the grain;
 *   • FIXED step count: the upstream loop normalises its step to the
 *     fastest-crossed axis and then marches start→end, so oblique rays
 *     through a flattened slab iterate MORE than `steps`, and the count
 *     diverges per pixel (wave-stall tax on tile GPUs). Here the segment is
 *     divided by `steps` exactly — uniform, bounded, divergence-free;
 *   • no `discard`: rays that miss the box simply contribute nothing —
 *     discard knocks transparent draws off the TBDR fast paths
 *     (HSR/LRZ/early-z) on Apple/Adreno/Mali.
 *
 * Upstream kept the same object-space unit-box contract: scale lives on the
 * mesh, the callback receives `positionRay` in [-0.5, 0.5]³.
 */

import { vec4From } from '@aicolab/kolo/webgpu/tsl-helpers'
import { bayer16 } from 'three/addons/tsl/math/Bayer.js'
import {
	cameraPosition,
	float,
	Fn,
	If,
	Loop,
	max,
	min,
	modelWorldMatrixInverse,
	positionGeometry,
	screenCoordinate,
	varying,
	vec2,
	vec3,
	vec4,
} from 'three/tsl'
import type { Node } from 'three/webgpu'

const hitBox = /*@__PURE__*/ Fn(({ orig, dir }: { orig: Node<'vec3'>; dir: Node<'vec3'> }) => {
	const boxMin = vec3(-0.5)
	const boxMax = vec3(0.5)

	const invDir = dir.reciprocal()

	const tMinTmp = boxMin.sub(orig).mul(invDir)
	const tMaxTmp = boxMax.sub(orig).mul(invDir)

	const tMin = min(tMinTmp, tMaxTmp)
	const tMax = max(tMinTmp, tMaxTmp)

	const t0 = max(tMin.x, max(tMin.y, tMin.z))
	const t1 = min(tMax.x, min(tMax.y, tMax.z))

	return vec2(t0, t1)
})

export const ditheredRaymarchBox = (
	steps: number,
	callback: (params: {
		positionRay: Node<'vec3'>
		/** Object-space length of one step (the unit box spans 1) — scale
		 * optical depth by this so opacity is path-length correct: grazing
		 * rays cross more medium than face-on rays. */
		stepLength: Node<'float'>
	}) => void,
): void => {
	const vOrigin = varying(vec3(modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0))))
	const vDirection = varying(positionGeometry.sub(vOrigin))

	const rayDir = vDirection.normalize()
	const bounds = vec2(hitBox({ orig: vOrigin, dir: rayDir })).toVar()
	bounds.assign(vec2(max(bounds.x, 0.0), bounds.y))

	If(bounds.x.lessThan(bounds.y), () => {
		const delta = bounds.y.sub(bounds.x).div(steps).toVar()
		// Per-pixel ray-start jitter within one step — the whole trick.
		const jitter = float(vec4From(bayer16(screenCoordinate)).x)
		const positionRay = vec3(
			vOrigin.add(rayDir.mul(bounds.x.add(delta.mul(jitter)))),
		).toVar()

		Loop(steps, () => {
			callback({ positionRay, stepLength: delta })
			positionRay.addAssign(rayDir.mul(delta))
		})
	})
}
