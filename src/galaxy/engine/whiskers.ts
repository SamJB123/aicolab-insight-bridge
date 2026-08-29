/**
 * Membership whiskers — a source's edges to its topics, drawn on demand
 * (settled 2026-08-15): hovering or selecting a SOURCE reveals thin lines
 * from that grain to every topic it contributes to, brightness scaled by
 * membership strength. Deliberately unlike the constellation asterisms —
 * thinner, cooler, and keyed per SOURCE, so they read as "where this voice
 * lives", not as structure.
 *
 * Same one-draw idiom as asterisms.ts: EVERY membership edge lives in one
 * static geometry, per-vertex keyed by its source node index; two uniforms
 * (hovered source, selected source) gate alpha in-shader, so reveal costs
 * zero rebuilds. Corpora carry tens of thousands of membership edges — that
 * is still only ~6 verts each, well within a single buffer's comfort zone.
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

type UniFloat = THREE.UniformNode<'float', number>

const QUAD: ReadonlyArray<readonly [number, number]> = [
	[0, -1],
	[1, -1],
	[1, 1],
	[0, -1],
	[1, 1],
	[0, 1],
]

export interface WhiskerLink {
	/** Source node index (the reveal key). */
	source: number
	/** Topic node index (the far end). */
	topic: number
	/** 0..1 membership strength (drives brightness). */
	strength: number
}

export interface Whiskers {
	mesh: THREE.Mesh
	uniforms: {
		/** Source NODE index whose whiskers reveal on hover (-1 = none). */
		hoverSource: UniFloat
		/** Source NODE index whose whiskers stay lit while selected. */
		selectedSource: UniFloat
	}
	dispose(): void
}

export function createWhiskers(
	links: WhiskerLink[],
	positions: Float32Array,
	/** A/B: analytic edge coverage in place of MSAA (see quality.analyticAA). */
	analyticAA = false,
): Whiskers {
	const vertexCount = Math.max(1, links.length) * QUAD.length
	const positionArr = new Float32Array(vertexCount * 3)
	const endArr = new Float32Array(vertexCount * 3)
	const tArr = new Float32Array(vertexCount)
	const sideArr = new Float32Array(vertexCount)
	const keyArr = new Float32Array(vertexCount).fill(-2)
	const strengthArr = new Float32Array(vertexCount)
	links.forEach((link, e) => {
		QUAD.forEach(([t, side], corner) => {
			const v = e * QUAD.length + corner
			for (let c = 0; c < 3; c++) {
				positionArr[v * 3 + c] = at(positions, link.source * 3 + c)
				endArr[v * 3 + c] = at(positions, link.topic * 3 + c)
			}
			tArr[v] = t
			sideArr[v] = side
			keyArr[v] = link.source
			strengthArr[v] = link.strength
		})
	})

	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute('position', new THREE.BufferAttribute(positionArr, 3))
	geometry.setAttribute('aEnd', new THREE.BufferAttribute(endArr, 3))
	geometry.setAttribute('aT', new THREE.BufferAttribute(tArr, 1))
	geometry.setAttribute('aSide', new THREE.BufferAttribute(sideArr, 1))
	geometry.setAttribute('aKey', new THREE.BufferAttribute(keyArr, 1))
	geometry.setAttribute('aStrength', new THREE.BufferAttribute(strengthArr, 1))

	const uniforms = {
		hoverSource: uniform(-1) as UniFloat,
		selectedSource: uniform(-1) as UniFloat,
	}
	const uWidth = uniform(0.03)

	const material = new THREE.MeshBasicNodeMaterial()
	material.transparent = true
	material.blending = THREE.AdditiveBlending
	material.depthWrite = false
	material.side = THREE.DoubleSide

	const aEnd = vec3From(attribute('aEnd'))
	const t = floatFrom(attribute('aT'))
	const side = floatFrom(attribute('aSide'))
	const aKey = floatFrom(attribute('aKey'))
	const aStrength = floatFrom(attribute('aStrength'))

	const axis = aEnd.sub(positionGeometry)
	const mid = positionGeometry.add(axis.mul(t))
	const toCamera = cameraPosition.sub(mid).add(vec3(0.011, 0.017, 0.013))
	const ribbon = axis.cross(toCamera).normalize()
	// Width follows the grade ladder too: exemplar links render solid,
	// member links hairline (settled 2026-08-15).
	const width = uWidth.mul(aStrength.mul(0.9).add(0.45))
	material.positionNode = mid.add(ribbon.mul(side).mul(width))

	// Reveal: hovered source at a whisper, selected source fully committed.
	const hoverMatch = step(aKey.sub(uniforms.hoverSource).abs(), float(0.5))
	const selectMatch = step(aKey.sub(uniforms.selectedSource).abs(), float(0.5))
	const alpha = hoverMatch.mul(0.5).max(selectMatch.mul(0.95)).mul(aStrength.mul(0.65).add(0.35))

	// Cool, thin, faintly alive — a different voice from the atlas lines.
	// Analytic-AA coverage fade mirrors asterisms.ts (hairline whiskers are
	// the worst under-samplers in the scene without MSAA).
	const profile = float(1).sub(side.abs()).pow(1.6)
	const lateral = analyticAA
		? profile.mul(
				smoothstep(
					float(1).sub(side.fwidth().mul(1.5).max(0.001)),
					float(1),
					side.abs(),
				).oneMinus(),
			)
		: profile
	const flow = time.mul(-1.4).add(t.mul(14)).sin().mul(0.1).add(0.9)
	const endFade = smoothstep(0.0, 0.05, t).mul(smoothstep(1.0, 0.9, t))
	const tint = vec3(0.62, 0.78, 0.95)
	material.colorNode = tint.mul(alpha.mul(lateral).mul(flow).mul(endFade)).mul(1.5)
	material.mrtNode = mrt({ bloomIntensity: float(0.3) })

	const mesh = new THREE.Mesh(geometry, material)
	mesh.name = 'ib-galaxy:whiskers'
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
