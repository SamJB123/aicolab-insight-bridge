/**
 * The star field — every corpus node as one instanced additive sprite
 * (webgpu_tsl_galaxy's InstancedMesh + SpriteNodeMaterial shape), one draw
 * call for all tiers: topics are small stars, groups and families the big
 * soft cores their layout radii make them.
 *
 * Encoding (settled 2026-08-14): stellar temperature. `IBNode.intensity`
 * drives the host heat ramp (--s1…--s5) plus emissive strength — severe or
 * contested topics literally burn brighter and hotter. Nodes without a
 * score sit at a calm 0.3 on the ramp (set data-side in the engine, so the
 * shader needs no missing-value branch).
 *
 * Constellation crossfade: when a group is focused, its topics dim here
 * (they resolve into planets.ts's mini-worlds) while the group's own star
 * brightens into the constellation's sun. Driven by two uniforms the engine
 * animates — the shader stays branch-light and every node stays in the one
 * draw call.
 *
 * The glow is pure math — an inverse-distance falloff with a white-hot core,
 * no textures — so bloom picks it up naturally and it holds at any DPR.
 */

import { floatFrom, vec3From } from '@aicolab/kolo/webgpu/tsl-helpers'
import {
	float,
	instancedBufferAttribute,
	instanceIndex,
	mrt,
	smoothstep,
	step,
	time,
	uniform,
	uv,
	vec3,
} from 'three/tsl'
import * as THREE from 'three/webgpu'
import type { GalaxyPalette } from './palette.ts'
import { heatRamp } from './ramp.ts'

type UniFloat = THREE.UniformNode<'float', number>

/** Sprite quad size as a multiple of a node's visual radius — the glow
 * occupies the skirt, the white core reads at roughly the radius itself. */
const GLOW_EXTENT = 5

export interface StarFieldData {
	/** World-space xyz per node (pose-camera convention, +Z up). */
	positions: Float32Array
	/** Visual radius per node. */
	radii: Float32Array
	/** Heat-ramp position per node, 0..1. */
	temperatures: Float32Array
	/** Focus key per node: a topic carries its primary group's NODE index;
	 * anything else carries -2 (so the "no focus" sentinel -1 never matches). */
	groupKeys: Float32Array
}

export interface StarFieldUniforms {
	/** Hovered instance index (-1 = none) — written by the pick loop. */
	hovered: UniFloat
	/** Selected instance index (-1 = none). */
	selected: UniFloat
	/** Focused group's node index (-1 = overview). */
	focusedGroup: UniFloat
	/** 0 = galaxy view … 1 = constellation fully resolved. */
	focusFade: UniFloat
}

export interface StarField {
	mesh: THREE.InstancedMesh
	uniforms: StarFieldUniforms
	dispose(): void
}

export function createStarField(data: StarFieldData, palette: GalaxyPalette): StarField {
	const count = data.radii.length
	const seeds = new Float32Array(count)
	for (let i = 0; i < count; i++) seeds[i] = (i * 0.61803398875) % 1 // golden-ratio phases

	// instancedBufferAttribute() returns a bare Node — kolo's converters
	// re-view them with their real node types (the contained-cast boundary).
	const aPosition = vec3From(
		instancedBufferAttribute(new THREE.InstancedBufferAttribute(data.positions, 3)),
	)
	const aRadius = floatFrom(
		instancedBufferAttribute(new THREE.InstancedBufferAttribute(data.radii, 1)),
	)
	const aTemp = floatFrom(
		instancedBufferAttribute(new THREE.InstancedBufferAttribute(data.temperatures, 1)),
	)
	const aSeed = floatFrom(instancedBufferAttribute(new THREE.InstancedBufferAttribute(seeds, 1)))
	const aGroupKey = floatFrom(
		instancedBufferAttribute(new THREE.InstancedBufferAttribute(data.groupKeys, 1)),
	)

	const uniforms: StarFieldUniforms = {
		hovered: uniform(-1),
		selected: uniform(-1),
		focusedGroup: uniform(-1),
		focusFade: uniform(0),
	}

	const material = new THREE.SpriteNodeMaterial()
	material.transparent = true
	material.blending = THREE.AdditiveBlending
	material.depthWrite = false

	material.positionNode = aPosition

	const self = float(instanceIndex)
	// Gentle authored twinkle + ignition on the hovered/selected instance.
	const twinkle = time.mul(1.7).add(aSeed.mul(Math.PI * 2)).sin().mul(0.05).add(1)
	const hoverHit = smoothstep(1, 0, self.sub(uniforms.hovered).abs())
	const selectHit = smoothstep(1, 0, self.sub(uniforms.selected).abs())
	const ignite = hoverHit.max(selectHit)
	// Constellation crossfade: my-topics-of-the-focused-group dim (planets take
	// over); the focused group's own star swells into the local sun.
	const isFocusedTopic = step(aGroupKey.sub(uniforms.focusedGroup).abs(), float(0.5))
	const isFocusedGroup = step(self.sub(uniforms.focusedGroup).abs(), float(0.5))
	const topicDim = float(1).sub(uniforms.focusFade.mul(isFocusedTopic).mul(0.88))
	const sunSwell = uniforms.focusFade.mul(isFocusedGroup).mul(0.55).add(1)
	// The rest of the galaxy steps back while a constellation holds focus.
	const bystander = float(1).sub(isFocusedTopic).mul(float(1).sub(isFocusedGroup))
	const hush = float(1).sub(uniforms.focusFade.mul(bystander).mul(0.45))

	material.scaleNode = aRadius
		.mul(GLOW_EXTENT)
		.mul(twinkle)
		.mul(ignite.mul(0.35).add(1))
		.mul(sunSwell)

	const rampColor = heatRamp(aTemp, palette.ramp)

	// Inverse-distance glow: zero exactly at the quad edge (d = 0.5), with a
	// white-hot core inside ~a tenth of the quad.
	const d = uv().sub(0.5).length()
	const glow = float(0.06).div(d).sub(0.12).max(0)
	const core = smoothstep(0.1, 0.02, d)
	const brightness = aTemp
		.mul(0.8)
		.add(0.6)
		.mul(ignite.mul(0.9).add(1))
		.mul(topicDim)
		.mul(sunSwell)
		.mul(hush)
	material.colorNode = rampColor
		.mul(glow)
		.mul(brightness)
		.add(vec3(1, 0.98, 0.94).mul(core).mul(brightness))
	// Selective-bloom feed: stars always glow a little; ignition and the
	// constellation sun push hard into the bloom/streak stack.
	material.mrtNode = mrt({
		bloomIntensity: float(0.5).add(ignite.mul(0.7)).add(uniforms.focusFade.mul(isFocusedGroup).mul(0.5)),
	})

	const geometry = new THREE.PlaneGeometry(1, 1)
	const mesh = new THREE.InstancedMesh(geometry, material, count)
	mesh.name = 'ib-galaxy:stars'
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
