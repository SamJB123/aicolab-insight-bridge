/**
 * Source worlds — the mini-planets, re-purposed for cosmos v2 (user call,
 * 2026-08-14): when a constellation is focused, its member SOURCES resolve
 * from dust into small procedural planets IN PLACE — at their force-layout
 * positions (honest topology), each lit by its PRIMARY topic's star: the
 * terminator genuinely faces the sun it feeds most. A slow axial spin (the
 * noise field rotating around the world axis) gives life without moving
 * anything.
 *
 * Surfaces tint from the active facet colour (the world IS its contributor
 * kind), broken by two octaves of noise into land and sea.
 */

import { floatFrom, vec3From, vec4From } from '@aicolab/kolo/webgpu/tsl-helpers'
import {
	cameraPosition,
	cos,
	instancedBufferAttribute,
	float,
	mix,
	mrt,
	mx_noise_float,
	normalLocal,
	positionLocal,
	positionWorld,
	sin,
	smoothstep,
	time,
	uniform,
	vec3,
} from 'three/tsl'
import * as THREE from 'three/webgpu'

type UniFloat = THREE.UniformNode<'float', number>

export interface PlanetClusterData {
	/** Source node indices (into the galaxy arrays), cluster members. */
	sources: number[]
	/** World positions for ALL nodes (xyz triplets). */
	positions: Float32Array
	/** Visual radii for ALL nodes. */
	radii: Float32Array
	/** Per-source primary-topic node index (the sun each world faces). */
	sunOf: Int32Array
	/** Per-source facet colour (xyz per source, active lens). */
	colors: Float32Array
	/** 1 where the source is an EXEMPLAR (a progenitor of its topic) — the
	 * world earns a brighter atmosphere signature (settled 2026-08-15:
	 * same size, glow only). */
	glows: Float32Array
}

export interface PlanetCluster {
	mesh: THREE.InstancedMesh
	/** 0 = invisible … 1 = fully resolved. Engine animates it. */
	fade: UniFloat
	dispose(): void
}

const PLANET_SCALE = 2.6
const PLANET_BASE = 0.28

export function createPlanetCluster(data: PlanetClusterData): PlanetCluster {
	const count = data.sources.length
	const centers = new Float32Array(count * 3)
	// Packed [radius, seed, glow, 0] — one vertex buffer, not three (WebGPU's
	// 8-buffer pipeline cap; see stars.ts). This mesh sat at exactly 8.
	const traits = new Float32Array(count * 4)
	const sunDirs = new Float32Array(count * 3)
	const colors = new Float32Array(count * 3)
	data.sources.forEach((node, i) => {
		const x = data.positions[node * 3]
		const y = data.positions[node * 3 + 1]
		const z = data.positions[node * 3 + 2]
		centers[i * 3] = x
		centers[i * 3 + 1] = y
		centers[i * 3 + 2] = z
		traits[i * 4] = PLANET_BASE + data.radii[node] * PLANET_SCALE
		traits[i * 4 + 1] = ((node * 0.7639320225) % 1) * 89
		traits[i * 4 + 2] = data.glows[i]
		const sun = data.sunOf[i]
		const dx = data.positions[sun * 3] - x
		const dy = data.positions[sun * 3 + 1] - y
		const dz = data.positions[sun * 3 + 2] - z
		const len = Math.hypot(dx, dy, dz) || 1
		sunDirs[i * 3] = dx / len
		sunDirs[i * 3 + 1] = dy / len
		sunDirs[i * 3 + 2] = dz / len
		colors[i * 3] = data.colors[node * 3]
		colors[i * 3 + 1] = data.colors[node * 3 + 1]
		colors[i * 3 + 2] = data.colors[node * 3 + 2]
	})

	const aCenter = vec3From(instancedBufferAttribute(new THREE.InstancedBufferAttribute(centers, 3)))
	const aTraits = vec4From(instancedBufferAttribute(new THREE.InstancedBufferAttribute(traits, 4)))
	const aRadius = aTraits.x
	const aSeed = aTraits.y
	const aGlow = aTraits.z
	const aSunDir = vec3From(instancedBufferAttribute(new THREE.InstancedBufferAttribute(sunDirs, 3)))
	const aColor = vec3From(instancedBufferAttribute(new THREE.InstancedBufferAttribute(colors, 3)))

	const fade: UniFloat = uniform(0)

	const material = new THREE.NodeMaterial()
	material.transparent = true
	material.positionNode = positionLocal.mul(aRadius).add(aCenter)
	material.opacityNode = fade
	// Exemplar worlds bloom a little harder — the progenitor signature.
	material.mrtNode = mrt({ bloomIntensity: float(0.12).add(aGlow.mul(0.3)) })

	// Axial spin: rotate the SAMPLING frame around world Z (the disc normal)
	// so the surface drifts while geometry stands still. Slow drift (user
	// call 2026-08-16): ~6 min per rotation — alive only when you rest your
	// eyes on a world, never busy.
	const spin = time.mul(0.018).add(aSeed)
	const cs = cos(spin)
	const sn = sin(spin)
	const spun = vec3(
		positionLocal.x.mul(cs).sub(positionLocal.y.mul(sn)),
		positionLocal.x.mul(sn).add(positionLocal.y.mul(cs)),
		positionLocal.z,
	)

	const terrain = floatFrom(mx_noise_float(spun.mul(3.4).add(aSeed))).add(
		floatFrom(mx_noise_float(spun.mul(9.1).add(aSeed))).mul(0.45),
	)
	const land = smoothstep(-0.12, 0.42, terrain)

	// The facet colour IS the world's identity: seas darken it, land lifts it.
	const sea = aColor.mul(0.16).add(vec3(0.012, 0.02, 0.045))
	const ground = aColor.mul(land.mul(0.7).add(0.35))
	const surface = mix(sea, ground, land)

	const daylight = normalLocal.dot(aSunDir).max(0)
	const viewDir = cameraPosition.sub(positionWorld).normalize()
	const fresnel = normalLocal.dot(viewDir).max(0).oneMinus().pow(2.3)
	// Exemplars (progenitors) carry a distinctly brighter, whiter atmosphere
	// at the SAME size — the settled grade signature (2026-08-15).
	const atmosphere = aColor
		.mul(fresnel)
		.mul(daylight.mul(0.5).add(0.22))
		.mul(aGlow.mul(1.1).add(1))
		.add(vec3(0.9, 0.95, 1).mul(fresnel).mul(aGlow).mul(0.28))

	material.colorNode = surface.mul(daylight.mul(0.95).add(0.08)).add(atmosphere)

	// 24×14 is visually identical at mini-world sizes and meaningfully
	// cheaper with hundreds of instances (retina frame-budget fix).
	const geometry = new THREE.SphereGeometry(1, 24, 14)
	const mesh = new THREE.InstancedMesh(geometry, material, count)
	mesh.name = 'ib-galaxy:planets'
	mesh.frustumCulled = false

	return {
		mesh,
		fade,
		dispose(): void {
			geometry.dispose()
			material.dispose()
		},
	}
}
