/**
 * The beam web — every membership edge as one camera-facing light beam, all
 * of them in a single additive draw call.
 *
 * The design settled on the linkedparticles compute-write technique, but the
 * layout FROZE (seeded bake): endpoints never move, so the quad geometry is
 * built once on the CPU and only brightness/pulse animate, entirely in the
 * shader. Same visual result, no compute pass, no storage-buffer plumbing.
 *
 * Focus gating (settled): ambient view shows only the faint group→family
 * arcs tracing the arms; focusing a group ignites its full constellation —
 * every topic edge including secondary DAG leans, brightness = membership
 * strength × similarity. Gate = one uniform compare per vertex.
 *
 * Billboarding: each edge is one quad; the vertex shader offsets each vertex
 * perpendicular to both the edge axis and the camera ray, so beams stay
 * ribbon-thin from every angle. Slow energy pulses run child→parent.
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
	varying,
	vec3,
} from 'three/tsl'
import * as THREE from 'three/webgpu'
import { primaryParents } from '../layout/spiral-seed.ts'
import type { IBGalaxy, IBNodeId } from '../types.ts'
import type { ArmIdentity } from './hues.ts'

type UniFloat = THREE.UniformNode<'float', number>

export interface BeamUniforms {
	/** Focused group's node index (-1 = overview). */
	focusedGroup: UniFloat
	/** 0 = ambient only … 1 = constellation fully lit. */
	focusFade: UniFloat
}

export interface BeamWeb {
	mesh: THREE.Mesh
	uniforms: BeamUniforms
	dispose(): void
}

/** (t, side) corners of the two triangles making one beam quad. */
const QUAD: ReadonlyArray<readonly [number, number]> = [
	[0, -1],
	[1, -1],
	[1, 1],
	[0, -1],
	[1, 1],
	[0, 1],
]

export function createBeamWeb(
	galaxy: IBGalaxy,
	worldPositions: Float32Array,
	arms: ArmIdentity,
): BeamWeb {
	const nodes = galaxy.nodes
	const index = new Map<IBNodeId, number>()
	nodes.forEach((node, i) => index.set(node.id, i))
	const parentOf = primaryParents(galaxy)

	interface EdgeRecord {
		child: number
		parent: number
		/** 0 = ambient arm arc (always faintly on) · 1 = constellation beam. */
		kind: number
		/** Node index whose focus ignites this beam (-2 for ambient). */
		focusKey: number
		strength: number
		color: THREE.Color
	}
	const records: EdgeRecord[] = []
	const fallbackHue = new THREE.Color('#7f9bd6')
	for (const edge of galaxy.edges) {
		const child = index.get(edge.child)
		const parent = index.get(edge.parent)
		if (child === undefined || parent === undefined) continue
		const hue = arms.hues[arms.armOf[child]] ?? fallbackHue
		if (nodes[child].tier === 1) {
			records.push({
				child,
				parent,
				kind: 0,
				focusKey: -2,
				strength: edge.isPrimary ? 1 : 0.5,
				color: hue,
			})
		} else if (nodes[child].tier === 0) {
			const homeId = parentOf.get(edge.child)
			const home = homeId !== undefined ? index.get(homeId) : undefined
			if (home === undefined) continue
			records.push({
				child,
				parent,
				kind: 1,
				focusKey: home,
				strength: edge.isPrimary ? 1 : 0.3 + (edge.similarity ?? 0.5) * 0.55,
				color: hue,
			})
		}
	}

	const vertexCount = records.length * QUAD.length
	const positionArr = new Float32Array(vertexCount * 3)
	const endArr = new Float32Array(vertexCount * 3)
	const tArr = new Float32Array(vertexCount)
	const sideArr = new Float32Array(vertexCount)
	const colorArr = new Float32Array(vertexCount * 3)
	const metaArr = new Float32Array(vertexCount * 3) // kind, focusKey, strength
	const seedArr = new Float32Array(vertexCount)
	records.forEach((record, e) => {
		const seed = ((e * 0.7548776662) % 1) * Math.PI * 2
		QUAD.forEach(([t, side], corner) => {
			const v = e * QUAD.length + corner
			for (let c = 0; c < 3; c++) {
				positionArr[v * 3 + c] = worldPositions[record.child * 3 + c]
				endArr[v * 3 + c] = worldPositions[record.parent * 3 + c]
			}
			tArr[v] = t
			sideArr[v] = side
			colorArr[v * 3] = record.color.r
			colorArr[v * 3 + 1] = record.color.g
			colorArr[v * 3 + 2] = record.color.b
			metaArr[v * 3] = record.kind
			metaArr[v * 3 + 1] = record.focusKey
			metaArr[v * 3 + 2] = record.strength
			seedArr[v] = seed
		})
	})

	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute('position', new THREE.BufferAttribute(positionArr, 3))
	geometry.setAttribute('aEnd', new THREE.BufferAttribute(endArr, 3))
	geometry.setAttribute('aT', new THREE.BufferAttribute(tArr, 1))
	geometry.setAttribute('aSide', new THREE.BufferAttribute(sideArr, 1))
	geometry.setAttribute('aColor', new THREE.BufferAttribute(colorArr, 3))
	geometry.setAttribute('aMeta', new THREE.BufferAttribute(metaArr, 3))
	geometry.setAttribute('aSeed', new THREE.BufferAttribute(seedArr, 1))

	const uniforms: BeamUniforms = {
		focusedGroup: uniform(-1),
		focusFade: uniform(0),
	}
	const uWidth = uniform(0.16)
	const uAmbient = uniform(0.05)

	const material = new THREE.MeshBasicNodeMaterial()
	material.transparent = true
	material.blending = THREE.AdditiveBlending
	material.depthWrite = false
	material.side = THREE.DoubleSide

	const aEnd = vec3From(attribute('aEnd'))
	const t = floatFrom(attribute('aT'))
	const side = floatFrom(attribute('aSide'))
	const aColor = vec3From(attribute('aColor'))
	const aMeta = vec3From(attribute('aMeta'))
	const aSeed = floatFrom(attribute('aSeed'))

	const kind = aMeta.x
	const focusKey = aMeta.y
	const strength = aMeta.z

	const axis = aEnd.sub(positionGeometry)
	const mid = positionGeometry.add(axis.mul(t))
	// Tiny bias keeps the cross product finite when sighting straight along a
	// beam; visually invisible everywhere else.
	const toCamera = cameraPosition.sub(mid).add(vec3(0.011, 0.017, 0.013))
	const ribbon = axis.cross(toCamera).normalize()
	const width = uWidth.mul(strength.mul(0.7).add(0.5))
	material.positionNode = mid.add(ribbon.mul(side).mul(width))

	// Per-edge brightness, computed in the vertex stage and interpolated.
	const focusMatch = step(focusKey.sub(uniforms.focusedGroup).abs(), float(0.5))
	const ambientAlpha = uAmbient.mul(strength)
	const constellationAlpha = focusMatch.mul(uniforms.focusFade).mul(strength).mul(0.85)
	const vAlpha = varying(ambientAlpha.mul(float(1).sub(kind)).add(constellationAlpha.mul(kind)))
	const vColor = varying(aColor)
	const vT = varying(t)
	const vSide = varying(side)
	const vSeed = varying(aSeed)

	const lateral = float(1).sub(vSide.abs()).pow(2)
	const pulse = vT.mul(Math.PI * 5).sub(time.mul(2.1)).add(vSeed).sin().mul(0.28).add(0.72)
	const endFade = smoothstep(0.0, 0.07, vT).mul(smoothstep(1.0, 0.93, vT))
	material.colorNode = vColor.mul(vAlpha.mul(lateral).mul(pulse).mul(endFade)).mul(2.2)
	material.mrtNode = mrt({ bloomIntensity: float(0.65) })

	const mesh = new THREE.Mesh(geometry, material)
	mesh.name = 'ib-galaxy:beams'
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
