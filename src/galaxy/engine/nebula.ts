/**
 * The nebula — EMERGENT family fog (cosmos v2): families have no bodies and
 * no authored arms; their territory is painted as raymarched fog whose
 * density field is BAKED from where their member topics actually settled in
 * the force layout. One low-res RGBA field (hue-weighted gaussian splats,
 * alpha = total density) sampled per raymarch step.
 *
 * PERF REWORK (settled 2026-08-15, research round): the worley+fBm filament
 * breakup used to run PER STEP PER PIXEL (~105 hash evaluations a step —
 * the measured mobile killer). The noise is provably a pure 2D function of
 * the same field UV the density texture is sampled at (its z argument was a
 * literal 0), so it is GPU-BAKED ONCE at engine init into a 512² detail
 * texture (`bakeNebulaDetail`) — heavily oversampled for our ~28-world-unit
 * worley cells — and the march body collapses to 3 texture fetches. The
 * march itself is the dithered fixed-count fork (see raymarch.ts), and the
 * whole fog renders in its own quarter-resolution pass (see post.ts).
 */

import {
	float,
	Fn,
	mx_fractal_noise_float,
	mx_worley_noise_float,
	smoothstep,
	texture,
	uniform,
	uv,
	vec2,
	vec3,
	vec4,
} from 'three/tsl'
import * as THREE from 'three/webgpu'
import type { Node } from 'three/webgpu'
import { ditheredRaymarchBox } from './raymarch.ts'

export interface NebulaField {
	/** Fog hue for this family. */
	hue: THREE.Color
	/** Member node indices (into the layout arrays). */
	members: number[]
	/** Splat weight per member (≈ visual radius). */
	weights: number[]
}

export interface NebulaOptions {
	fields: NebulaField[]
	/** ENGINE-world positions (xyz triplets; +Z up, disc in XY). */
	positions: Float32Array
	discRadius: number
	steps: number
	/** The pre-baked filament/wisp texture from `bakeNebulaDetail`. */
	detailTexture: THREE.Texture
}

/** The filament breakup, as a TSL expression over the field UV. Shared by
 * the one-time bake; world scale must match the slab (extent = 1.35·disc). */
const detailNode = (fieldUv: Node<'vec2'>, discRadius: number) => {
	const scaleXY = discRadius * 1.35 * 2
	const world = fieldUv.sub(0.5).mul(scaleXY)
	const noiseAt = vec3(world.x, world.y, 0)
	const filament = float(1).sub(mx_worley_noise_float(noiseAt.mul(0.035))).max(0)
	const wisps = mx_fractal_noise_float(noiseAt.mul(0.018), 3, 2.0, 0.55, 1.0)
		.mul(0.5)
		.add(0.5)
	const detail = filament.mul(0.6).add(wisps.mul(0.55))
	// R = the density breakup mask, G = the wisp lighting term.
	return vec4(smoothstep(0.35, 0.95, detail), wisps, 0, 1)
}

const DETAIL_BAKE_SIZE = 512

/**
 * One-time GPU bake of the noise breakup (the raymarch used to evaluate
 * ~105 hashes per step for this). Renders the EXACT TSL expression the
 * march previously ran, once, into a 512² target.
 */
export function bakeNebulaDetail(
	renderer: THREE.WebGPURenderer,
	discRadius: number,
): { texture: THREE.Texture; dispose(): void } {
	const target = new THREE.RenderTarget(DETAIL_BAKE_SIZE, DETAIL_BAKE_SIZE, {
		depthBuffer: false,
	})
	const material = new THREE.NodeMaterial()
	material.colorNode = detailNode(vec2(uv()), discRadius)
	const quad = new THREE.QuadMesh(material)
	const previous = renderer.getRenderTarget()
	renderer.setRenderTarget(target)
	quad.render(renderer)
	renderer.setRenderTarget(previous)
	material.dispose()
	return {
		texture: target.texture,
		dispose(): void {
			target.dispose()
		},
	}
}

export interface Nebula {
	mesh: THREE.Mesh
	uniforms: {
		/** 0..1 master density fade — the engine clears the fog away when a
		 * constellation is focused (up close it smothers the view). */
		fade: THREE.UniformNode<'float', number>
		/** Field/arm index whose fog ignites (chrome hover of a family);
		 * -1 = none. Matched against the baked dominant-arm mask. */
		hoverArm: THREE.UniformNode<'float', number>
	}
	dispose(): void
}

const FIELD_SIZE = 160
const SLAB_THICKNESS = 42
/** Gaussian splat radius in world units. */
const SPLAT_SIGMA = 8

export function createNebula(options: NebulaOptions): Nebula {
	const { fields, positions, discRadius, steps, detailTexture } = options
	const extent = discRadius * 1.35 // world half-extent the field covers

	// ── Bake the density field on the CPU ───────────────────────────────────
	const data = new Float32Array(FIELD_SIZE * FIELD_SIZE * 4)
	// Per-field density accumulation, argmaxed into a dominant-arm mask so
	// the shader can ignite ONE family's fog on hover.
	const armAccum = fields.map(() => new Float32Array(FIELD_SIZE * FIELD_SIZE))
	const toPixel = (world: number): number =>
		((world / extent) * 0.5 + 0.5) * (FIELD_SIZE - 1)
	const sigmaPx = (SPLAT_SIGMA / (2 * extent)) * FIELD_SIZE
	const reach = Math.ceil(sigmaPx * 3)
	fields.forEach((field, arm) => {
		field.members.forEach((member, m) => {
			const px = toPixel(positions[member * 3])
			const py = toPixel(positions[member * 3 + 1]) // world: disc is XY
			const weight = 0.35 + (field.weights[m] ?? 1) * 0.5
			const x0 = Math.max(0, Math.floor(px - reach))
			const x1 = Math.min(FIELD_SIZE - 1, Math.ceil(px + reach))
			const y0 = Math.max(0, Math.floor(py - reach))
			const y1 = Math.min(FIELD_SIZE - 1, Math.ceil(py + reach))
			for (let y = y0; y <= y1; y++) {
				for (let x = x0; x <= x1; x++) {
					const dx = x - px
					const dy = y - py
					const g = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaPx * sigmaPx)) * weight
					if (g < 0.002) continue
					const texel = y * FIELD_SIZE + x
					const at = texel * 4
					data[at] += field.hue.r * g
					data[at + 1] += field.hue.g * g
					data[at + 2] += field.hue.b * g
					data[at + 3] += g
					armAccum[arm][texel] += g
				}
			}
		})
	})
	// Dominant arm per texel (-2 where empty, so no uniform value matches).
	const armData = new Float32Array(FIELD_SIZE * FIELD_SIZE).fill(-2)
	for (let texel = 0; texel < FIELD_SIZE * FIELD_SIZE; texel++) {
		let best = 0
		for (let arm = 0; arm < armAccum.length; arm++) {
			if (armAccum[arm][texel] > best) {
				best = armAccum[arm][texel]
				armData[texel] = arm
			}
		}
	}
	const armTexture = new THREE.DataTexture(
		armData,
		FIELD_SIZE,
		FIELD_SIZE,
		THREE.RedFormat,
		THREE.FloatType,
	)
	// Index data — interpolation would blend arm ids into nonsense.
	armTexture.magFilter = THREE.NearestFilter
	armTexture.minFilter = THREE.NearestFilter
	armTexture.needsUpdate = true
	const fieldTexture = new THREE.DataTexture(
		data,
		FIELD_SIZE,
		FIELD_SIZE,
		THREE.RGBAFormat,
		THREE.FloatType,
	)
	fieldTexture.magFilter = THREE.LinearFilter
	fieldTexture.minFilter = THREE.LinearFilter
	fieldTexture.needsUpdate = true

	// Dialed down 2026-08-15 (user: fog read too bright at overview) — the
	// fog should read as atmosphere behind the stars, not compete with them.
	const uDensity = uniform(0.72)
	const uBrightness = uniform(0.26)
	const uFade: THREE.UniformNode<'float', number> = uniform(1)
	// "None" sentinel: -3, distinct from the arm mask's empty-texel -2.
	const uHoverArm: THREE.UniformNode<'float', number> = uniform(-3)

	const material = new THREE.NodeMaterial()
	material.transparent = true
	material.side = THREE.BackSide
	material.depthWrite = false
	// NO mrtNode here: the fog renders in its OWN single-target pass now, and
	// an MRT declaration whose members match none of the pass's attachments
	// compiles to an EMPTY WGSL output struct — an invalid shader module.
	// (Its old bloomIntensity feed was a negligible 0.05, dropped by design.)

	const scaleXY = extent * 2
	material.colorNode = Fn(() => {
		const finalColor = vec4(0).toVar()
		// Fixed-count dithered march; the step body is 3 texture fetches —
		// every noise term lives in the pre-baked detail texture. No
		// early-out Break: on wave hardware it stalls the whole wave and a
		// sparse fog almost never saturates anyway.
		ditheredRaymarchBox(steps, ({ positionRay, stepLength }) => {
			const fieldUv = vec2(
				positionRay.x.add(0.5),
				positionRay.y.add(0.5),
			)
			const fieldSample = texture(fieldTexture, fieldUv)
			const fogHue = fieldSample.rgb.div(fieldSample.a.max(0.0001))
			// Family hover: the hovered arm's territory ignites.
			const armHit = texture(armTexture, fieldUv)
				.r.sub(uHoverArm)
				.abs()
				.step(0.5)
			// R = filament breakup mask, G = wisp lighting (bakeNebulaDetail).
			const detail = texture(detailTexture, fieldUv)

			const zEnv = float(1).sub(positionRay.z.abs().mul(2)).max(0).pow(2)
			// Beer–Lambert per step (fix 2026-08-15): optical depth scales with
			// the actual step LENGTH (grazing rays cross more medium), and
			// 1 − e^(−τ) can never exceed 1 — the front-to-back accumulator
			// assumes per-step opacity < 1, and the old linear weight overshot
			// it at low step counts, ringing between blown-out white and
			// cancelled-transparent depending on where the samples landed.
			const opticalDepth = fieldSample.a
				.mul(detail.r)
				.mul(zEnv)
				.mul(uDensity)
				.mul(uFade)
				.mul(armHit.mul(0.35).add(1))
				.mul(stepLength)
				.mul(10)
			const stepAlpha = float(1).sub(opticalDepth.negate().exp())

			const lit = fogHue
				.mul(detail.g.mul(0.45).add(0.6))
				.mul(uBrightness)
				.mul(armHit.mul(0.9).add(1))
			finalColor.rgb.addAssign(finalColor.a.oneMinus().mul(stepAlpha).mul(lit))
			finalColor.a.addAssign(finalColor.a.oneMinus().mul(stepAlpha))
		})
		return finalColor
	})()

	const geometry = new THREE.BoxGeometry(1, 1, 1)
	const mesh = new THREE.Mesh(geometry, material)
	// The engine's world has +Z up with the disc in XY; the slab's local x/y
	// span the disc and local z is thickness (matching positionRay use above).
	mesh.scale.set(scaleXY, scaleXY, SLAB_THICKNESS)
	mesh.name = 'ib-galaxy:nebula'
	mesh.frustumCulled = false
	mesh.renderOrder = -1

	return {
		mesh,
		uniforms: { fade: uFade, hoverArm: uHoverArm },
		dispose(): void {
			geometry.dispose()
			material.dispose()
			fieldTexture.dispose()
			armTexture.dispose()
		},
	}
}
