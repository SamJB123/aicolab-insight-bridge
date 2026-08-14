/**
 * The lens — the full cinematic stack (settled 2026-08-14), assembled per
 * quality tier:
 *
 *   scene pass + MRT{output, bloomIntensity}
 *     → SELECTIVE bloom (the bloomIntensity channel masks the feed, so only
 *       what a material marks glows — stars/beams yes, planets barely,
 *       nebula no)
 *     → anamorphic streak (standalone rtt bright-pass + horizontal loop —
 *       the webgpu_postprocessing_anamorphic technique without patching
 *       BloomNode) gated on selection via a uniform
 *     → lensflare ghosts off the same masked feed
 *     → DOF focus-pull (wide focal band; the scene spans hundreds of units)
 *     → vignette.
 *
 * One deliberate divergence from the settled list: TRAA is left out in
 * favour of the renderer's MSAA (antialias: true). TRAA's temporal
 * reprojection ghosts on twinkling additive sprites — the dominant content
 * here — while MSAA already covers the geometric edges (planets). Revisit if
 * aliasing is ever observed in practice.
 */

import { vignette } from '@aicolab/kolo/rendering/vignette'
import { dof, floatFrom, lensflare } from '@aicolab/kolo/webgpu/tsl-helpers'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import {
	color,
	float,
	Fn,
	Loop,
	mrt,
	output,
	pass,
	rtt,
	uniform,
	uv,
	vec2,
	vec4,
	viewportSize,
} from 'three/tsl'
import * as THREE from 'three/webgpu'
import type { GalaxyQuality } from './quality.ts'

type UniFloat = THREE.UniformNode<'float', number>

export interface GalaxyPostUniforms {
	/** DOF focus distance (world units from the camera). */
	focusDistance: UniFloat
	/** DOF bokeh scale — 0 disables the pull. */
	bokeh: UniFloat
	/** Anamorphic streak gain (0..1) — driven by selection state. */
	streak: UniFloat
}

export interface GalaxyPost {
	pipeline: THREE.RenderPipeline
	uniforms: GalaxyPostUniforms
	dispose(): void
}

const STREAK_SAMPLES = 44
const STREAK_TINT = '#8fa4ff'

export function createGalaxyPost(
	renderer: THREE.WebGPURenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
	quality: GalaxyQuality,
): GalaxyPost {
	const uniforms: GalaxyPostUniforms = {
		focusDistance: uniform(300),
		bokeh: uniform(0),
		streak: uniform(0.3),
	}

	const scenePass = pass(scene, camera)
	scenePass.setMRT(
		mrt({
			output,
			// Default for materials that don't declare their own: the backdrop's
			// authored stars/nebula sprites keep a gentle glow.
			bloomIntensity: float(0.3),
		}),
	)
	const sceneColor = scenePass.getTextureNode('output')
	const bloomMask = scenePass.getTextureNode('bloomIntensity')
	const viewZ = scenePass.getViewZNode('depth')

	const maskedBright = sceneColor.mul(bloomMask)
	let composed = sceneColor.add(bloom(maskedBright, 1.0, 0.45, 0.18))

	if (quality.anamorphic) {
		// Bright areas cached once (rtt), then smeared horizontally with a
		// softness-weighted loop — the classic anamorphic streak.
		const brightPass = rtt(maskedBright)
		const streakNode = Fn(() => {
			const total = vec4(0).toVar()
			const half = STREAK_SAMPLES / 2
			const invSize = vec2(1).div(viewportSize)
			Loop({ start: -half, end: half }, ({ i }) => {
				const step = floatFrom(i)
				const softness = step.abs().div(half).oneMinus().pow(2)
				const shifted = vec2(uv().x.add(invSize.x.mul(step).mul(4)), uv().y)
				total.addAssign(brightPass.sample(shifted).mul(softness))
			})
			return total.div(STREAK_SAMPLES / 3)
		})()
		composed = composed.add(
			streakNode.mul(color(STREAK_TINT)).mul(uniforms.streak).mul(0.5),
		)
	}

	if (quality.lensflare) {
		composed = composed.add(
			lensflare(maskedBright, {
				ghostTint: color('#93b0c9'),
				threshold: float(0.35),
				ghostSamples: float(3),
			}).mul(0.35),
		)
	}

	const focused = dof(composed, viewZ, uniforms.focusDistance, 30, uniforms.bokeh)
	const pipeline = new THREE.RenderPipeline(renderer)
	pipeline.outputNode = focused.mul(vignette({ innerRadius: 0.35, outerRadius: 1.05 }))
	pipeline.needsUpdate = true

	return {
		pipeline,
		uniforms,
		dispose(): void {
			pipeline.dispose()
		},
	}
}
