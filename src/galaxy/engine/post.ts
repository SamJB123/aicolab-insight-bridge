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
import { setPassSamples } from '@aicolab/kolo/webgpu/three-internals'
import { dof, floatFrom, gaussianBlur, lensflare } from '@aicolab/kolo/webgpu/tsl-helpers'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import {
	color,
	float,
	Fn,
	If,
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
	/** Governor rung: skip the streak's bright-pass render (rtt autoUpdate)
	 * AND its 44-tap loop (uniform branch — GPUs skip uniform control flow).
	 * Measured 35% of frame cost on weak adapters, 2026-08-17. No-op when
	 * the tier built without anamorphic. */
	setAnamorphic(on: boolean): void
	/** Governor rung: toggle the scene pass's 4×MSAA at runtime (measured
	 * 38% of frame cost on weak adapters, 2026-08-17). PassNode re-reads
	 * `options.samples` every update, so this applies next frame. */
	setSceneMsaa(on: boolean): void
	dispose(): void
}

const STREAK_SAMPLES = 44
const STREAK_TINT = '#8fa4ff'

/** The fog pass renders at this fraction of the frame (settled 2026-08-15,
 * the official webgpu_volume_lighting value): 1/16th the fog fragments; the
 * gaussian composite both upsamples and launders the march's bayer grain. */
const FOG_RESOLUTION_SCALE = 0.25

export function createGalaxyPost(
	renderer: THREE.WebGPURenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
	quality: GalaxyQuality,
	/** The nebula's own scene — rendered quarter-res and composited additively
	 * (its old in-scene alpha-over-void differs only against the near-black
	 * background). Omit when the tier has no fog. */
	fogScene?: THREE.Scene,
): GalaxyPost {
	const uniforms: GalaxyPostUniforms = {
		focusDistance: uniform(300),
		bokeh: uniform(0),
		streak: uniform(0.3),
	}
	const anamorphicOn = uniform(1)

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

	if (fogScene) {
		// samples: 0 — the quarter-res fog is a soft additive cloud that the
		// gaussian composite blurs anyway; inheriting the renderer's 4×MSAA
		// here was pure bandwidth cost.
		const fogPass = pass(fogScene, camera, { depthBuffer: false, samples: 0 })
		fogPass.setResolutionScale(FOG_RESOLUTION_SCALE)
		// The fog leaves the shared bloom MRT here; its old contribution was
		// a negligible 0.05 (settled: dropped).
		composed = composed.add(gaussianBlur(fogPass, 0.7).rgb)
	}

	let streakBrightPass: ReturnType<typeof rtt> | undefined
	if (quality.anamorphic) {
		// Bright areas cached once (rtt), then smeared horizontally with a
		// softness-weighted loop — the classic anamorphic streak. The whole
		// effect sits behind the governor's uniform gate: uniform control
		// flow is skipped wholesale on GPUs, and setAnamorphic also pauses
		// the bright-pass render itself.
		const brightPass = rtt(maskedBright)
		streakBrightPass = brightPass
		const streakNode = Fn(() => {
			const total = vec4(0).toVar()
			If(anamorphicOn.greaterThan(0.5), () => {
				const half = STREAK_SAMPLES / 2
				const invSize = vec2(1).div(viewportSize)
				Loop({ start: -half, end: half }, ({ i }) => {
					const step = floatFrom(i)
					const softness = step.abs().div(half).oneMinus().pow(2)
					const shifted = vec2(uv().x.add(invSize.x.mul(step).mul(4)), uv().y)
					total.addAssign(brightPass.sample(shifted).mul(softness))
				})
			})
			return total.div(STREAK_SAMPLES / 3)
		})()
		composed = composed.add(streakNode.mul(color(STREAK_TINT)).mul(uniforms.streak).mul(0.5))
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

	/** DOF bypassed 2026-08-15 (user A/B for constellation-line aliasing):
	 * the asterism ribbons are depthWrite:false, so the DOF reads the FAR
	 * depth behind them, assigns crisp nearby line-work a large blur radius,
	 * and its discrete tap gather chews the thin edges into shimmer. Flip to
	 * restore the focus-pull. */
	const DOF_ENABLED = false
	const focused = DOF_ENABLED
		? dof(composed, viewZ, uniforms.focusDistance, 30, uniforms.bokeh)
		: composed
	const pipeline = new THREE.RenderPipeline(renderer)
	pipeline.outputNode = focused.mul(vignette({ innerRadius: 0.35, outerRadius: 1.05 }))
	pipeline.needsUpdate = true

	return {
		pipeline,
		uniforms,
		setAnamorphic(on: boolean): void {
			anamorphicOn.value = on ? 1 : 0
			if (streakBrightPass) streakBrightPass.autoUpdate = on
		},
		setSceneMsaa(on: boolean): void {
			setPassSamples(scenePass, on ? 4 : 0)
		},
		dispose(): void {
			pipeline.dispose()
		},
	}
}
