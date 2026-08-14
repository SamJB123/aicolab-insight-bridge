/**
 * Mini-worlds — constellation mode's close-zoom LOD (user-chosen over the
 * recommended data-forged stars, 2026-08-14). When a group is focused, its
 * topics resolve from stars into small procedural planets: one instanced
 * sphere draw, analytic lighting (the home-world moon-shading family) with
 * the CLUSTER'S OWN GROUP STAR as the sun — every terminator genuinely faces
 * away from the local sun.
 *
 * Climate carries the same intensity axis as stellar temperature: calm
 * topics are verdant worlds, hot ones scorch through the host's heat ramp.
 * The arm hue tints each planet's Fresnel atmosphere so the constellation
 * reads as one family. No textures, no lights in the scene — everything is
 * math on the unit sphere.
 */

import { floatFrom, vec3From } from '@aicolab/kolo/webgpu/tsl-helpers'
import {
	cameraPosition,
	color,
	float,
	instancedBufferAttribute,
	mix,
	mrt,
	mx_noise_float,
	normalLocal,
	positionLocal,
	positionWorld,
	smoothstep,
	uniform,
	vec3,
} from 'three/tsl'
import * as THREE from 'three/webgpu'
import type { GalaxyPalette } from './palette.ts'
import { heatRamp } from './ramp.ts'

type UniFloat = THREE.UniformNode<'float', number>

export interface PlanetClusterData {
	/** Topic node indices (into the galaxy arrays), cluster members. */
	topics: number[]
	/** World positions for ALL nodes (xyz triplets). */
	positions: Float32Array
	/** Visual radii for ALL nodes. */
	radii: Float32Array
	/** Heat-ramp temperatures for ALL nodes. */
	temperatures: Float32Array
	/** Node index of the focused group — the cluster's sun. */
	sun: number
	/** The cluster's arm hue (atmosphere tint). */
	hue: THREE.Color
}

export interface PlanetCluster {
	mesh: THREE.InstancedMesh
	/** 0 = invisible … 1 = fully resolved. Engine animates it. */
	fade: UniFloat
	dispose(): void
}

/** Planets read larger than their star cores so the LOD swap feels like
 * resolving detail, not shrinking. */
const PLANET_SCALE = 1.7
const PLANET_BASE = 0.35

export function createPlanetCluster(data: PlanetClusterData, palette: GalaxyPalette): PlanetCluster {
	const count = data.topics.length
	const centers = new Float32Array(count * 3)
	const radii = new Float32Array(count)
	const temps = new Float32Array(count)
	const seeds = new Float32Array(count)
	const sunDirs = new Float32Array(count * 3)
	const sx = data.positions[data.sun * 3]
	const sy = data.positions[data.sun * 3 + 1]
	const sz = data.positions[data.sun * 3 + 2]
	data.topics.forEach((node, i) => {
		const x = data.positions[node * 3]
		const y = data.positions[node * 3 + 1]
		const z = data.positions[node * 3 + 2]
		centers[i * 3] = x
		centers[i * 3 + 1] = y
		centers[i * 3 + 2] = z
		radii[i] = PLANET_BASE + data.radii[node] * PLANET_SCALE
		temps[i] = data.temperatures[node]
		seeds[i] = ((node * 0.7639320225) % 1) * 89
		const dx = sx - x
		const dy = sy - y
		const dz = sz - z
		const len = Math.hypot(dx, dy, dz) || 1
		sunDirs[i * 3] = dx / len
		sunDirs[i * 3 + 1] = dy / len
		sunDirs[i * 3 + 2] = dz / len
	})

	const aCenter = vec3From(instancedBufferAttribute(new THREE.InstancedBufferAttribute(centers, 3)))
	const aRadius = floatFrom(instancedBufferAttribute(new THREE.InstancedBufferAttribute(radii, 1)))
	const aTemp = floatFrom(instancedBufferAttribute(new THREE.InstancedBufferAttribute(temps, 1)))
	const aSeed = floatFrom(instancedBufferAttribute(new THREE.InstancedBufferAttribute(seeds, 1)))
	const aSunDir = vec3From(
		instancedBufferAttribute(new THREE.InstancedBufferAttribute(sunDirs, 3)),
	)

	const fade: UniFloat = uniform(0)

	const material = new THREE.NodeMaterial()
	material.transparent = true
	material.positionNode = positionLocal.mul(aRadius).add(aCenter)
	material.opacityNode = fade

	// Terrain: two octaves of noise on the unit sphere, seeded per planet.
	const terrain = floatFrom(mx_noise_float(positionLocal.mul(3.1).add(aSeed)))
		.add(floatFrom(mx_noise_float(positionLocal.mul(8.7).add(aSeed))).mul(0.45))
	const land = smoothstep(-0.12, 0.42, terrain)

	// Climate: verdant when calm, scorched through the host ramp when hot.
	const climate = mix(color('#3f7a52'), heatRamp(aTemp, palette.ramp), aTemp.mul(0.85))
	const sea = climate.mul(0.22).add(vec3(0.015, 0.03, 0.055))
	const ground = climate.mul(land.mul(0.75).add(0.3))
	const surface = mix(sea, ground, land)

	// Analytic lighting by the cluster's group star; instances carry no
	// rotation, so local normals ARE world normals.
	const daylight = normalLocal.dot(aSunDir).max(0)
	const nightside = normalLocal.dot(aSunDir).mul(0.5).add(0.5)
	const viewDir = cameraPosition.sub(positionWorld).normalize()
	const fresnel = normalLocal.dot(viewDir).max(0).oneMinus().pow(2.3)
	const atmosphere = uniform(data.hue).mul(fresnel).mul(daylight.mul(0.5).add(0.25))

	material.colorNode = surface
		.mul(daylight.mul(0.95).add(0.1))
		.add(atmosphere)
		.add(climate.mul(smoothstep(0.05, 0.35, nightside).mul(0.04))) // faint hue on the dark limb

	// Planets are matter, not light — near-zero bloom feed keeps their
	// surfaces crisp while the sun and beams glow around them.
	material.mrtNode = mrt({ bloomIntensity: float(0.12) })

	const geometry = new THREE.SphereGeometry(1, 40, 24)
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
