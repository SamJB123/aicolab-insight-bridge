/**
 * The nebula — a genuinely raymarched volume (settled 2026-08-14), not
 * sprites: one box over the whole disc, marched with RaymarchingBox
 * (unit-box local space; the mesh scale shapes it into a slab). Density is
 * fully procedural — no 3D textures:
 *
 *   • a SPIRAL ARM MASK phase-locked to the layout's geometry (same
 *     armTwist and t^0.85 radius law as spiral-seed.ts), so nebula bands
 *     trace the actual arms rather than a generic swirl;
 *   • worley + fractal noise carve the bands into filaments;
 *   • radial + vertical envelopes keep the slab a disc.
 *
 * Each band is tinted by its arm's authored hue (hues.ts) via a uniform
 * array, so families visibly own their territory. Very-many-armed corpora
 * (basin's 20 groups) cap the VISUAL band count — beyond ~7 bands the mask
 * reads as noise, and the nebula is scenery, not data.
 */

import { uniformArrayElementVec3 } from '@aicolab/kolo/webgpu/tsl-helpers'
import { RaymarchingBox } from 'three/addons/tsl/utils/Raymarching.js'
import {
	Break,
	float,
	Fn,
	If,
	mrt,
	mx_fractal_noise_float,
	mx_worley_noise_float,
	smoothstep,
	uniform,
	uniformArray,
	vec3,
	vec4,
} from 'three/tsl'
import * as THREE from 'three/webgpu'

export interface NebulaOptions {
	discRadius: number
	coreRadius: number
	/** Must match spiral-seed's armTwist so bands sit on the arms. */
	armTwist: number
	/** Arm hues from hues.ts, band order. */
	hues: THREE.Color[]
	steps: number
}

export interface Nebula {
	mesh: THREE.Mesh
	dispose(): void
}

const MAX_BANDS = 7
const SLAB_THICKNESS = 46

export function createNebula(options: NebulaOptions): Nebula {
	const { discRadius, coreRadius, armTwist, hues, steps } = options
	const bands = Math.max(1, Math.min(MAX_BANDS, hues.length))
	const bandHues = uniformArray(
		Array.from({ length: bands }, (_, k) => hues[k % hues.length].clone()),
	)
	const uDensity = uniform(0.75)
	const uBrightness = uniform(0.34)

	const material = new THREE.NodeMaterial()
	material.transparent = true
	material.side = THREE.BackSide
	material.depthWrite = false
	// Nebula light is faint by design — keep it out of the bloom feed.
	material.mrtNode = mrt({ bloomIntensity: float(0.05) })

	const scale = vec3(discRadius * 2.6, discRadius * 2.6, SLAB_THICKNESS)

	material.colorNode = Fn(() => {
		const finalColor = vec4(0).toVar()
		RaymarchingBox(steps, ({ positionRay }) => {
			// Local unit box → world-ish coordinates.
			const world = positionRay.mul(scale).toVar()
			const radial = world.xy.length().toVar()
			const angle = world.y.atan(world.x)

			// The same arm law the layout uses: t along the arm from the core
			// radius law r = core + (disc − core)·t^0.85, unwound here.
			const t = radial
				.sub(coreRadius)
				.div(discRadius - coreRadius)
				.clamp(0, 1)
				.pow(1 / 0.85)
			const armPhase = angle.sub(t.mul(armTwist))
			const banding = armPhase.mul(bands).cos().mul(0.5).add(0.5)
			const armMask = smoothstep(0.35, 0.92, banding)

			// Which band are we in? → that arm's hue.
			const bandIndex = armPhase
				.div((Math.PI * 2) / bands)
				.add(0.5)
				.floor()
				.mod(bands)
				.add(bands)
				.mod(bands)
			const hue = uniformArrayElementVec3(bandHues, bandIndex.toInt())

			// Filaments: worley ridges broken by fBm.
			const filament = float(1)
				.sub(mx_worley_noise_float(world.mul(0.03)))
				.max(0)
			const wisps = mx_fractal_noise_float(world.mul(0.016), 3, 2.0, 0.52, 1.0)
				.mul(0.5)
				.add(0.5)
			const detail = filament.mul(0.62).add(wisps.mul(0.52))

			// Disc envelopes.
			const rr = radial.div(discRadius)
			const radialEnv = smoothstep(0.1, 0.34, rr).mul(smoothstep(1.25, 0.8, rr))
			const zEnv = float(1).sub(positionRay.z.abs().mul(2)).max(0).pow(2)

			const density = armMask
				.mul(radialEnv)
				.mul(zEnv)
				.mul(smoothstep(0.42, 0.95, detail))
				.mul(uDensity)
				.mul(float(1).div(steps))
				.mul(14)

			const lit = hue.mul(wisps.mul(0.5).add(0.6)).mul(uBrightness)
			finalColor.rgb.addAssign(finalColor.a.oneMinus().mul(density).mul(lit))
			finalColor.a.addAssign(finalColor.a.oneMinus().mul(density))
			If(finalColor.a.greaterThanEqual(0.92), () => {
				Break()
			})
		})
		return finalColor
	})()

	const geometry = new THREE.BoxGeometry(1, 1, 1)
	const mesh = new THREE.Mesh(geometry, material)
	mesh.scale.set(discRadius * 2.6, discRadius * 2.6, SLAB_THICKNESS)
	mesh.name = 'ib-galaxy:nebula'
	mesh.frustumCulled = false
	// Draw beneath the additive layers: the volume is the deep ground.
	mesh.renderOrder = -1

	return {
		mesh,
		dispose(): void {
			geometry.dispose()
			material.dispose()
		},
	}
}
