/**
 * Asterisms — superclusters drawn as CONSTELLATIONS (cosmos v2): no bodies,
 * just star-atlas line-work joining each group's member topics along a
 * minimum spanning tree, in the classic celestial-atlas idiom (thin, crisp,
 * faintly luminous — deliberately unlike relationship beams).
 *
 * PURE REVEAL (settled): nothing renders at rest. Hovering a topic previews
 * its constellation faintly; focusing ignites the full figure. One static
 * geometry for every group's MST, gated per-vertex by focus/hover keys —
 * one draw call, alpha does the revealing.
 */

import { floatFrom, vec3From } from '@aicolab/kolo/webgpu/tsl-helpers'
import {
	attribute,
	cameraPosition,
	float,
	mrt,
	positionGeometry,
	smoothstep,
	step,
	time,
	uniform,
	vec3,
} from 'three/tsl'
import * as THREE from 'three/webgpu'
import { at } from './at.ts'
import type { ArmIdentity } from './hues.ts'

type UniFloat = THREE.UniformNode<'float', number>

const QUAD: ReadonlyArray<readonly [number, number]> = [
	[0, -1],
	[1, -1],
	[1, 1],
	[0, -1],
	[1, 1],
	[0, 1],
]

export interface AsterismGroup {
	/** Node index of the supercluster (the focus/hover key). */
	group: number
	/** Member topic node indices. */
	members: number[]
	/** Arm index (for the hue tint). */
	arm: number
}

export interface Asterisms {
	mesh: THREE.Mesh
	uniforms: {
		/** Focused group's node index (-1 = none). */
		focusedGroup: UniFloat
		/** 0..1 ignition of the focused figure. */
		focusFade: UniFloat
		/** Hover-previewed group's node index (-1 = none). */
		hoverGroup: UniFloat
	}
	dispose(): void
}

/** Prim's MST over member positions — the asterism figure. */
function spanningEdges(members: number[], positions: Float32Array): Array<[number, number]> {
	if (members.length < 2) return []
	const inTree = new Set<number>([at(members, 0)])
	const edges: Array<[number, number]> = []
	const dist2 = (a: number, b: number): number => {
		const dx = at(positions, a * 3) - at(positions, b * 3)
		const dy = at(positions, a * 3 + 1) - at(positions, b * 3 + 1)
		const dz = at(positions, a * 3 + 2) - at(positions, b * 3 + 2)
		return dx * dx + dy * dy + dz * dz
	}
	while (inTree.size < members.length) {
		let bestFrom = -1
		let bestTo = -1
		let best = Number.POSITIVE_INFINITY
		for (const from of inTree) {
			for (const to of members) {
				if (inTree.has(to)) continue
				const d = dist2(from, to)
				if (d < best) {
					best = d
					bestFrom = from
					bestTo = to
				}
			}
		}
		if (bestTo < 0) break
		inTree.add(bestTo)
		edges.push([bestFrom, bestTo])
	}
	return edges
}

export function createAsterisms(
	groups: AsterismGroup[],
	positions: Float32Array,
	arms: ArmIdentity,
	/** A/B: analytic edge coverage in place of MSAA (see quality.analyticAA). */
	analyticAA = false,
): Asterisms {
	interface LineRecord {
		a: number
		b: number
		key: number
		color: THREE.Color
	}
	const atlasWhite = new THREE.Color('#dfe6f2')
	const records: LineRecord[] = []
	for (const group of groups) {
		const hue = arms.hues[group.arm] ?? atlasWhite
		const color = hue.clone().lerp(atlasWhite, 0.6)
		for (const [a, b] of spanningEdges(group.members, positions)) {
			records.push({ a, b, key: group.group, color })
		}
	}

	const vertexCount = Math.max(1, records.length) * QUAD.length
	const positionArr = new Float32Array(vertexCount * 3)
	const endArr = new Float32Array(vertexCount * 3)
	const tArr = new Float32Array(vertexCount)
	const sideArr = new Float32Array(vertexCount)
	const colorArr = new Float32Array(vertexCount * 3)
	const keyArr = new Float32Array(vertexCount).fill(-2)
	const seedArr = new Float32Array(vertexCount)
	records.forEach((record, e) => {
		const seed = ((e * 0.7548776662) % 1) * Math.PI * 2
		QUAD.forEach(([t, side], corner) => {
			const v = e * QUAD.length + corner
			for (let c = 0; c < 3; c++) {
				positionArr[v * 3 + c] = at(positions, record.a * 3 + c)
				endArr[v * 3 + c] = at(positions, record.b * 3 + c)
			}
			tArr[v] = t
			sideArr[v] = side
			colorArr[v * 3] = record.color.r
			colorArr[v * 3 + 1] = record.color.g
			colorArr[v * 3 + 2] = record.color.b
			keyArr[v] = record.key
			seedArr[v] = seed
		})
	})

	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute('position', new THREE.BufferAttribute(positionArr, 3))
	geometry.setAttribute('aEnd', new THREE.BufferAttribute(endArr, 3))
	geometry.setAttribute('aT', new THREE.BufferAttribute(tArr, 1))
	geometry.setAttribute('aSide', new THREE.BufferAttribute(sideArr, 1))
	geometry.setAttribute('aColor', new THREE.BufferAttribute(colorArr, 3))
	geometry.setAttribute('aKey', new THREE.BufferAttribute(keyArr, 1))
	geometry.setAttribute('aSeed', new THREE.BufferAttribute(seedArr, 1))

	const uniforms = {
		focusedGroup: uniform(-1) as UniFloat,
		focusFade: uniform(0) as UniFloat,
		hoverGroup: uniform(-1) as UniFloat,
	}
	const uWidth = uniform(0.055)

	const material = new THREE.MeshBasicNodeMaterial()
	material.transparent = true
	material.blending = THREE.AdditiveBlending
	material.depthWrite = false
	material.side = THREE.DoubleSide

	const aEnd = vec3From(attribute('aEnd'))
	const t = floatFrom(attribute('aT'))
	const side = floatFrom(attribute('aSide'))
	const aColor = vec3From(attribute('aColor'))
	const aKey = floatFrom(attribute('aKey'))
	const aSeed = floatFrom(attribute('aSeed'))

	const axis = aEnd.sub(positionGeometry)
	const mid = positionGeometry.add(axis.mul(t))
	const toCamera = cameraPosition.sub(mid).add(vec3(0.011, 0.017, 0.013))
	const ribbon = axis.cross(toCamera).normalize()
	material.positionNode = mid.add(ribbon.mul(side).mul(uWidth))

	// Pure reveal: focused figure at full ignition, hovered figure a whisper.
	const focusMatch = step(aKey.sub(uniforms.focusedGroup).abs(), float(0.5))
	const hoverMatch = step(aKey.sub(uniforms.hoverGroup).abs(), float(0.5))
	const alpha = focusMatch.mul(uniforms.focusFade).max(hoverMatch.mul(0.3))

	// Atlas lines: crisp lateral edge, a slow shimmer so the figure breathes.
	// With analytic AA the profile additionally fades over one pixel
	// footprint of `side` — hairline ribbons under-sample the profile and
	// shimmer without MSAA; this is the Line2NodeMaterial coverage idiom.
	const profile = float(1).sub(side.abs()).pow(1.5)
	const lateral = analyticAA
		? profile.mul(
				smoothstep(
					float(1).sub(side.fwidth().mul(1.5).max(0.001)),
					float(1),
					side.abs(),
				).oneMinus(),
			)
		: profile
	const shimmer = time.mul(0.7).add(aSeed).sin().mul(0.08).add(0.92)
	const endFade = smoothstep(0.0, 0.04, t).mul(smoothstep(1.0, 0.96, t))
	material.colorNode = aColor.mul(alpha.mul(lateral).mul(shimmer).mul(endFade)).mul(1.7)
	material.mrtNode = mrt({ bloomIntensity: float(0.45) })

	const mesh = new THREE.Mesh(geometry, material)
	mesh.name = 'ib-galaxy:asterisms'
	mesh.frustumCulled = false

	return {
		mesh,
		uniforms,
		dispose(): void {
			geometry.dispose()
			material.dispose()
		},
	}
}
