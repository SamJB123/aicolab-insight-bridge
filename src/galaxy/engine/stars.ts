/**
 * The star field — every TOPIC as one instanced additive sprite (cosmos v2:
 * groups and families no longer have bodies; sources are dust.ts). One draw
 * call; encoding unchanged — stellar temperature from the host heat ramp
 * where the corpus has a real score, size from reach.
 *
 * ANCHOR DIMMING (the legacy system's best interaction): the engine writes a
 * per-instance highlight — connection strength to the current anchor
 * (selection or focused constellation) — and while an anchor is active,
 * unrelated stars fall to a whisper (mix 0.2..1 by strength, 0.03 when
 * unconnected) so relationships light up as geometry.
 *
 * Hover/selection ignition is attenuated by camera distance (the same boost
 * that reads perfectly at galaxy distance blows out in close-up).
 */

import { floatFrom, vec3From, vec4From } from '@aicolab/kolo/webgpu/tsl-helpers'
import {
	cameraPosition,
	float,
	instancedBufferAttribute,
	instanceIndex,
	mix,
	mrt,
	smoothstep,
	time,
	uniform,
	uv,
	vec3,
} from 'three/tsl'
import * as THREE from 'three/webgpu'
import type { GalaxyPalette } from './palette.ts'
import { heatRamp } from './ramp.ts'

type UniFloat = THREE.UniformNode<'float', number>

/** Sprite quad size as a multiple of a node's visual radius. */
const GLOW_EXTENT = 5

export interface StarFieldData {
	/** World-space xyz per star (pose-camera convention, +Z up). */
	positions: Float32Array
	/** Visual radius per star. */
	radii: Float32Array
	/** Heat-ramp position per star, 0..1. */
	temperatures: Float32Array
	/** Arm (family) index per star — the hover-ignition set key. */
	arms: Float32Array
}

export interface StarField {
	mesh: THREE.InstancedMesh
	uniforms: {
		/** Hovered/selected INSTANCE index (-1 = none). */
		hovered: UniFloat
		selected: UniFloat
		/** 1 while an anchor is active (dimming engaged). */
		anchorActive: UniFloat
		/** Arm index whose member stars gently ignite (family hover, NO
		 * dimming of the rest); -1 = none. */
		hoverArm: UniFloat
	}
	/** Per-instance highlight (0..1 connection strength to the anchor). */
	setHighlights(highlights: Float32Array): void
	/** Per-instance hover BOOST (0..1 extra ignition, NO dimming of others) —
	 * a separate channel from the anchor highlights so hovering a source can
	 * light its topics without disturbing an active selection anchor. */
	setBoosts(boosts: Float32Array): void
	dispose(): void
}

export function createStarField(data: StarFieldData, palette: GalaxyPalette): StarField {
	const count = data.radii.length

	// WebGPU caps a pipeline at 8 vertex buffers and each attribute takes
	// one — so the per-instance scalars ride ONE packed vec4 lane
	// (radius, temperature, seed, arm) instead of a buffer each. Only the
	// highlight keeps its own attribute: the engine rewrites it at runtime.
	const traits = new Float32Array(count * 4)
	for (let i = 0; i < count; i++) {
		traits[i * 4] = data.radii[i]
		traits[i * 4 + 1] = data.temperatures[i]
		traits[i * 4 + 2] = (i * 0.61803398875) % 1
		traits[i * 4 + 3] = data.arms[i]
	}

	const highlightAttr = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(0), 1)
	const boostAttr = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(0), 1)

	const aPosition = vec3From(
		instancedBufferAttribute(new THREE.InstancedBufferAttribute(data.positions, 3)),
	)
	const aTraits = vec4From(instancedBufferAttribute(new THREE.InstancedBufferAttribute(traits, 4)))
	const aRadius = aTraits.x
	const aTemp = aTraits.y
	const aSeed = aTraits.z
	const aArm = aTraits.w
	const aHighlight = floatFrom(instancedBufferAttribute(highlightAttr))
	const aBoost = floatFrom(instancedBufferAttribute(boostAttr))

	const uniforms = {
		hovered: uniform(-1) as UniFloat,
		selected: uniform(-1) as UniFloat,
		anchorActive: uniform(0) as UniFloat,
		// -2 = none: orphan stars carry arm -1, so -1 can't be the sentinel.
		hoverArm: uniform(-2) as UniFloat,
	}

	const material = new THREE.SpriteNodeMaterial()
	material.transparent = true
	material.blending = THREE.AdditiveBlending
	material.depthWrite = false
	material.positionNode = aPosition

	const self = float(instanceIndex)
	const twinkle = time
		.mul(1.7)
		.add(aSeed.mul(Math.PI * 2))
		.sin()
		.mul(0.05)
		.add(1)
	const cameraDistance = aPosition.sub(cameraPosition).length()
	const igniteGain = smoothstep(45, 260, cameraDistance).mul(0.78).add(0.22)
	const hoverHit = smoothstep(1, 0, self.sub(uniforms.hovered).abs())
	const selectHit = smoothstep(1, 0, self.sub(uniforms.selected).abs())
	// Family hover: every member of the hovered arm ignites gently — a set
	// glow, softer than the direct-hover ignition, with NO dimming of others.
	// The per-instance boost is the same idea for arbitrary sets (a hovered
	// source's member topics, strength-scaled by the engine).
	const armHit = aArm.sub(uniforms.hoverArm).abs().step(0.5)
	const ignite = hoverHit.max(selectHit).max(armHit.mul(0.45)).max(aBoost).mul(igniteGain)

	// Anchor dimming: mix(0.2, 1, strength) for connected, 0.03 unconnected —
	// smoothed by the highlight value itself (0 = unconnected).
	const connected = mix(float(0.2), float(1.0), aHighlight)
	const anchorLevel = mix(float(0.03), connected, smoothstep(0.0, 0.05, aHighlight))
	const dimming = mix(float(1), anchorLevel, uniforms.anchorActive)

	material.scaleNode = aRadius.mul(GLOW_EXTENT).mul(twinkle).mul(ignite.mul(0.35).add(1))

	const rampColor = heatRamp(aTemp, palette.ramp)
	const d = uv().sub(0.5).length()
	const glow = float(0.06).div(d).sub(0.12).max(0)
	const core = smoothstep(0.1, 0.02, d)
	const brightness = aTemp.mul(0.8).add(0.6).mul(ignite.mul(0.9).add(1)).mul(dimming)
	material.colorNode = rampColor
		.mul(glow)
		.mul(brightness)
		.add(vec3(1, 0.98, 0.94).mul(core).mul(brightness))
	material.mrtNode = mrt({
		bloomIntensity: float(0.5)
			.add(ignite.mul(0.7))
			.add(aHighlight.mul(uniforms.anchorActive).mul(0.35)),
	})

	const geometry = new THREE.PlaneGeometry(1, 1)
	// Sprites never read the normal — reclaim its vertex-buffer slot.
	geometry.deleteAttribute('normal')
	const mesh = new THREE.InstancedMesh(geometry, material, count)
	mesh.name = 'ib-galaxy:stars'
	mesh.frustumCulled = false

	return {
		mesh,
		uniforms,
		setHighlights(highlights: Float32Array): void {
			highlightAttr.array.set(highlights)
			highlightAttr.needsUpdate = true
		},
		setBoosts(boosts: Float32Array): void {
			boostAttr.array.set(boosts)
			boostAttr.needsUpdate = true
		},
		dispose(): void {
			geometry.dispose()
			material.dispose()
		},
	}
}
