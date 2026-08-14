/**
 * The source dust — every contributor as a small dim additive point, fully
 * present in the sky (the legacy hierarchy: topics read as stars, sources as
 * dust; the fringes are made of the weakly-connected). Facet-coloured: the
 * active colour-by lens writes a per-instance colour attribute, precomputed
 * per facet so switching lenses is one attribute swap, no rebuild.
 *
 * Selection answers through the dust (anchor dimming, the legacy system's
 * best interaction): the engine writes per-instance highlight values on
 * selection; when an anchor is active, unrelated dust fades to a whisper
 * while related grains brighten by connection strength.
 */

import { floatFrom, vec2From, vec3From } from '@aicolab/kolo/webgpu/tsl-helpers'
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
} from 'three/tsl'
import * as THREE from 'three/webgpu'

type UniFloat = THREE.UniformNode<'float', number>

const GLOW_EXTENT = 4

export interface DustData {
	/** World positions of the dust grains (xyz per grain). */
	positions: Float32Array
	/** Visual radius per grain. */
	radii: Float32Array
	/** Node index (into galaxy.nodes) per grain — for hover mapping. */
	nodeOf: Int32Array
}

export interface Dust {
	mesh: THREE.InstancedMesh
	uniforms: {
		hovered: UniFloat
		selected: UniFloat
		/** 1 while an anchor is active (dimming engaged). */
		anchorActive: UniFloat
	}
	/** Swap the facet colour attribute (values precomputed by the engine). */
	setColors(colors: Float32Array): void
	/** Write per-grain highlight (0..1 connection strength to the anchor). */
	setHighlights(highlights: Float32Array): void
	dispose(): void
}

export function createDust(data: DustData): Dust {
	const count = data.radii.length

	// Packed per-instance scalars (radius, seed) — one vertex buffer, not
	// two (WebGPU's 8-buffer pipeline cap; see stars.ts). Colour and
	// highlight keep their own attributes: the engine rewrites both at
	// runtime (facet switches, anchor dimming).
	const traits = new Float32Array(count * 2)
	for (let i = 0; i < count; i++) {
		traits[i * 2] = data.radii[i]
		traits[i * 2 + 1] = (i * 0.7548776662) % 1
	}

	const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(0.6), 3)
	const highlightAttr = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(0), 1)

	const aPosition = vec3From(
		instancedBufferAttribute(new THREE.InstancedBufferAttribute(data.positions, 3)),
	)
	const aTraits = vec2From(
		instancedBufferAttribute(new THREE.InstancedBufferAttribute(traits, 2)),
	)
	const aRadius = aTraits.x
	const aSeed = aTraits.y
	const aColor = vec3From(instancedBufferAttribute(colorAttr))
	const aHighlight = floatFrom(instancedBufferAttribute(highlightAttr))

	const uniforms = {
		hovered: uniform(-1) as UniFloat,
		selected: uniform(-1) as UniFloat,
		anchorActive: uniform(0) as UniFloat,
	}

	const material = new THREE.SpriteNodeMaterial()
	material.transparent = true
	material.blending = THREE.AdditiveBlending
	material.depthWrite = false
	material.positionNode = aPosition

	const self = float(instanceIndex)
	const cameraDistance = aPosition.sub(cameraPosition).length()
	const igniteGain = smoothstep(45, 260, cameraDistance).mul(0.78).add(0.22)
	const hoverHit = smoothstep(1, 0, self.sub(uniforms.hovered).abs())
	const selectHit = smoothstep(1, 0, self.sub(uniforms.selected).abs())
	const ignite = hoverHit.max(selectHit).mul(igniteGain)

	const twinkle = time.mul(1.1).add(aSeed.mul(Math.PI * 2)).sin().mul(0.08).add(1)
	material.scaleNode = aRadius.mul(GLOW_EXTENT).mul(twinkle).mul(ignite.mul(0.5).add(1))

	// Anchor dimming (legacy formula): connected grains brighten by strength,
	// unrelated ones fade to a whisper; no anchor → everyone at dust level.
	const anchorLevel = mix(float(0.06), float(1.0), aHighlight)
	const dimming = mix(float(1), anchorLevel, uniforms.anchorActive)

	const d = uv().sub(0.5).length()
	const glow = float(0.05).div(d).sub(0.1).max(0)
	const brightness = float(0.34).mul(dimming).mul(ignite.mul(1.4).add(1))
	material.colorNode = aColor.mul(glow).mul(brightness)
	material.mrtNode = mrt({
		bloomIntensity: float(0.15).add(ignite.mul(0.6)).add(aHighlight.mul(uniforms.anchorActive).mul(0.4)),
	})

	const geometry = new THREE.PlaneGeometry(1, 1)
	// Sprites never read the normal — reclaim its vertex-buffer slot.
	geometry.deleteAttribute('normal')
	const mesh = new THREE.InstancedMesh(geometry, material, count)
	mesh.name = 'ib-galaxy:dust'
	mesh.frustumCulled = false

	return {
		mesh,
		uniforms,
		setColors(colors: Float32Array): void {
			colorAttr.array.set(colors)
			colorAttr.needsUpdate = true
		},
		setHighlights(highlights: Float32Array): void {
			highlightAttr.array.set(highlights)
			highlightAttr.needsUpdate = true
		},
		dispose(): void {
			geometry.dispose()
			material.dispose()
		},
	}
}
