/**
 * The Insight Galaxy engine — vanilla three.js WebGPU/TSL, no framework
 * (the kolo house pattern: `mount(options) => handle`, synchronous dispose,
 * async init inside with a `disposed` check after every await, LIFO
 * cleanups). Reached ONLY by dynamic import from the SceneStage adapter so
 * three never enters an SSR/worker bundle.
 *
 * COSMOS v2 sky (settled 2026-08-14): the legacy co-membership topology,
 * baked deterministically (layout/cosmos.ts) — mainstream gravitates to the
 * core, the niche holds the fringes. Topics are stars; SOURCES are
 * facet-coloured dust; superclusters are PURE-REVEAL constellations
 * (star-atlas MST line-work, ignited by hover/focus); families are emergent
 * nebula fog splatted around their members. Focusing a constellation
 * resolves its member sources into mini-planets in place, each lit by its
 * primary topic's star. Selection engages ANCHOR DIMMING: every body's
 * brightness becomes its connection strength to the anchor.
 *
 * The frozen bake is also the CPU pick mirror — GPU never moves a node.
 */

import {
	type CameraPose,
	createPoseCamera,
	type HomeCameraPose,
	type PoseChart,
} from '@aicolab/kolo/camera/pose-camera'
import { createAdaptiveDpr } from '@aicolab/kolo/rendering/adaptive-dpr-monitor'
import { buildSpaceBackdrop } from '@aicolab/kolo/rendering/space-backdrop'
import { createTransactionalResize } from '@aicolab/kolo/rendering/transactional-resize'
import {
	initWebGpuRendererWithRecovery,
	surfaceGpuFailures,
} from '@aicolab/kolo/webgpu/backend-guard'
import { createEffect, createRoot } from 'solid-js'
import { color, screenUV } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { facetPalette, facetValues } from '../facets.ts'
import { bakeGalaxyLayout, DISC_RADIUS, primaryParents } from '../layout/cosmos.ts'
import type { GalaxyNavCore } from '../nav-core.ts'
import type { IBGalaxy, IBIntensityMode } from '../types.ts'
import { createAsterisms, type AsterismGroup } from './asterisms.ts'
import { createDust } from './dust.ts'
import { resolveArmIdentity } from './hues.ts'
import { createGalaxyLabels } from './labels.ts'
import { bakeNebulaDetail, createNebula, type NebulaField } from './nebula.ts'
import { readGalaxyPalette } from './palette.ts'
import { createPlanetCluster, type PlanetCluster } from './planets.ts'
import { createGalaxyPost } from './post.ts'
import { resolveGalaxyQuality } from './quality.ts'
import { createStarField } from './stars.ts'
import { createWhiskers, type WhiskerLink } from './whiskers.ts'

export interface GalaxyEngineOptions {
	canvas: HTMLCanvasElement
	host: HTMLElement
	galaxy: IBGalaxy
	intensityMode?: IBIntensityMode
	/** THE navigation truth (headless-core rewrite, 2026-08-16): this engine
	 * is a FACE over the core — it subscribes to the core's signals and
	 * projects them into camera/labels/fleets/dimming, and every scene input
	 * (star click, label press, wheel-out) calls a core action. The engine
	 * keeps no navigation state of its own. */
	core: GalaxyNavCore
	onReady: () => void
	onError: (message: string) => void
}

export interface GalaxyEngineHandle {
	dispose(): void
}

const HOME_MIN_RADIUS = 34
const HOME_MAX_RADIUS = 480
const OVERVIEW_POSE: HomeCameraPose = { kind: 'home', lng: -1.1, lat: 0.55, radius: 300 }
const FOCUS_DISTANCE_FAMILY = 130
const CLICK_SLOP_PX = 6
const CLICK_MAX_MS = 1500
const WHEEL_EXIT_INTENT = 320

const GRADE_INTENSITY: Record<string, number> = {
	exemplar: 10,
	high_value: 5,
	standard: 1,
	member: 1,
}

const GALAXY_CHART: PoseChart = {
	toWorld(x, y, z, out) {
		return out.set(x, z, y)
	},
	upAt(_x, _z, out) {
		return out.set(0, 0, 1)
	},
}

export function mountGalaxyEngine(options: GalaxyEngineOptions): GalaxyEngineHandle {
	const { canvas, host, galaxy, core, onReady, onError } = options
	let disposed = false
	const cleanups: Array<() => void> = []

	void (async () => {
		try {
			// ── Layout: bake once, freeze, mirror ───────────────────────────
			const layout = bakeGalaxyLayout(galaxy, {
				intensityMode: options.intensityMode ?? 'grades',
			})
			const nodes = galaxy.nodes
			const count = nodes.length
			// Pose-camera convention: +Z is the world axis, equator in XY. The
			// layout's disc is XZ with y thickness → (x, y, z) → (x, z, −y).
			const positions = new Float32Array(count * 3)
			for (let i = 0; i < count; i++) {
				positions[i * 3] = layout.positions[i * 3]
				positions[i * 3 + 1] = layout.positions[i * 3 + 2]
				positions[i * 3 + 2] = -layout.positions[i * 3 + 1]
			}

			// ── Membership structure ────────────────────────────────────────
			const parentOf = primaryParents(galaxy)
			const idx = (id: string): number | undefined => layout.index.get(id)
			const starNodes: number[] = []
			const dustNodes: number[] = []
			const starIndexOf = new Int32Array(count).fill(-1)
			const dustIndexOf = new Int32Array(count).fill(-1)
			nodes.forEach((node, i) => {
				if (node.tier === 0) {
					starIndexOf[i] = starNodes.length
					starNodes.push(i)
				} else if (node.tier === -1) {
					dustIndexOf[i] = dustNodes.length
					dustNodes.push(i)
				}
			})
			const topicsByGroup = new Map<number, number[]>()
			nodes.forEach((node, i) => {
				if (node.tier !== 0) return
				const parentId = parentOf.get(node.id)
				const parent = parentId !== undefined ? idx(parentId) : undefined
				if (parent === undefined || nodes[parent].tier !== 1) return
				const list = topicsByGroup.get(parent)
				if (list) list.push(i)
				else topicsByGroup.set(parent, [i])
			})
			const groupsByFamily = new Map<number, number[]>()
			nodes.forEach((node, i) => {
				if (node.tier !== 1) return
				const parentId = parentOf.get(node.id)
				const parent = parentId !== undefined ? idx(parentId) : undefined
				if (parent === undefined || nodes[parent].tier !== 2) return
				const list = groupsByFamily.get(parent)
				if (list) list.push(i)
				else groupsByFamily.set(parent, [i])
			})
			// The overview's labelled tier: families where they exist, else groups.
			const topTierNodes: number[] = []
			{
				const hasFamilies = nodes.some((node) => node.tier === 2)
				nodes.forEach((node, i) => {
					if (node.tier === (hasFamilies ? 2 : 1)) topTierNodes.push(i)
				})
			}
			// Source memberships: node-indexed adjacency with grade intensities.
			// The GRADE ladder carries the soft-clustering semantics (settled
			// 2026-08-15): 2 = exemplar (the topic's progenitors), 1 = high_value
			// (confident contributors), 0 = member (related, not focused).
			interface SourceLink {
				source: number
				topic: number
				intensity: number
				grade: 0 | 1 | 2
			}
			const gradeOf = (membershipType: string | undefined, intensity: number): 0 | 1 | 2 => {
				if (membershipType === 'exemplar') return 2
				if (membershipType === 'high_value') return 1
				if (membershipType !== undefined) return 0
				// Soft-score corpora carry no grade names — classify by intensity.
				return intensity >= 10 ? 2 : intensity >= 5 ? 1 : 0
			}
			const membershipsOfTopic = new Map<number, SourceLink[]>()
			const membershipsOfSource = new Map<number, SourceLink[]>()
			for (const edge of galaxy.edges) {
				const child = idx(edge.child)
				const parent = idx(edge.parent)
				if (child === undefined || parent === undefined) continue
				if (nodes[child].tier !== -1 || nodes[parent].tier !== 0) continue
				const intensity =
					edge.membershipType && GRADE_INTENSITY[edge.membershipType] !== undefined
						? GRADE_INTENSITY[edge.membershipType]
						: Math.max(1, (edge.similarity ?? 0.1) * 10)
				const link: SourceLink = {
					source: child,
					topic: parent,
					intensity,
					grade: gradeOf(edge.membershipType ?? undefined, intensity),
				}
				const byTopic = membershipsOfTopic.get(parent)
				if (byTopic) byTopic.push(link)
				else membershipsOfTopic.set(parent, [link])
				const bySource = membershipsOfSource.get(child)
				if (bySource) bySource.push(link)
				else membershipsOfSource.set(child, [link])
			}
			const primaryTopicOf = new Int32Array(count).fill(-1)
			nodes.forEach((node, i) => {
				if (node.tier !== -1) return
				const parentId = parentOf.get(node.id)
				const parent = parentId !== undefined ? idx(parentId) : undefined
				if (parent !== undefined && nodes[parent].tier === 0) primaryTopicOf[i] = parent
			})

			const arms = resolveArmIdentity(galaxy)

			// ── Facet colour arrays (node-indexed, per facet) ───────────────
			const facetColorCache = new Map<string, Float32Array>()
			const facetColorsFor = (facetKey: string | undefined): Float32Array => {
				const key = facetKey ?? ''
				const cached = facetColorCache.get(key)
				if (cached) return cached
				const colors = new Float32Array(count * 3).fill(0.62)
				if (facetKey) {
					const palette = facetPalette(facetValues(galaxy, facetKey))
					const parsed = new Map<string, THREE.Color>()
					for (const [value, hex] of palette) parsed.set(value, new THREE.Color(hex))
					for (const node of dustNodes) {
						const value = nodes[node].facets?.[facetKey]
						const tint = value !== undefined ? parsed.get(value) : undefined
						if (!tint) continue
						colors[node * 3] = tint.r
						colors[node * 3 + 1] = tint.g
						colors[node * 3 + 2] = tint.b
					}
				}
				facetColorCache.set(key, colors)
				return colors
			}
			// The colour-by lens is core truth. Per Solid's split-effect
			// contract ("extract the data you need in the compute phase and
			// pass plain values to the effect"), the lens is READ in the
			// projection's compute and flows to every consumer AS A PARAMETER
			// — no ambient reads, no shadow copies.

			// ── Renderer ────────────────────────────────────────────────────
			const touch = matchMedia('(pointer: coarse)').matches
			const quality = resolveGalaxyQuality(touch)
			const renderer = await initWebGpuRendererWithRecovery(
				() => {
					const r = new THREE.WebGPURenderer({
						canvas,
						antialias: true,
						logarithmicDepthBuffer: true,
					})
					r.setPixelRatio(touch ? quality.dprFloor : quality.dprCeiling)
					r.setSize(host.clientWidth || 1, host.clientHeight || 1, false)
					r.toneMapping = THREE.ACESFilmicToneMapping
					r.toneMappingExposure = 1.1
					return r
				},
				{ tag: 'ib-galaxy', isDisposed: () => disposed },
			)
			if (!renderer) return
			surfaceGpuFailures(renderer, 'ib-galaxy')
			cleanups.push(() => renderer.dispose())

			// ── Scene ───────────────────────────────────────────────────────
			const palette = readGalaxyPalette(host)
			const scene = new THREE.Scene()
			const innerVoid = palette.voidColor.clone().multiplyScalar(2.4)
			scene.backgroundNode = screenUV
				.distance(0.5)
				.remap(0, 0.65)
				.mix(color(innerVoid), color(palette.voidColor))

			const camera = new THREE.PerspectiveCamera(
				46,
				(host.clientWidth || 1) / (host.clientHeight || 1),
				0.5,
				9000,
			)

			const backdrop = buildSpaceBackdrop({
				starRadius: 4000,
				nebulaRadius: HOME_MAX_RADIUS * 1.35,
				name: 'ib-galaxy:space',
			})
			scene.add(backdrop.group)
			cleanups.push(() => {
				scene.remove(backdrop.group)
				backdrop.dispose()
			})

			// Stars (topics only).
			const starPositions = new Float32Array(starNodes.length * 3)
			const starRadii = new Float32Array(starNodes.length)
			const starTemps = new Float32Array(starNodes.length)
			const starArms = new Float32Array(starNodes.length)
			starNodes.forEach((node, s) => {
				starPositions[s * 3] = positions[node * 3]
				starPositions[s * 3 + 1] = positions[node * 3 + 1]
				starPositions[s * 3 + 2] = positions[node * 3 + 2]
				starRadii[s] = layout.radii[node]
				starTemps[s] = nodes[node].intensity ?? 0.3
				starArms[s] = arms.armOf[node]
			})
			const stars = createStarField(
				{
					positions: starPositions,
					radii: starRadii,
					temperatures: starTemps,
					arms: starArms,
				},
				palette,
			)
			scene.add(stars.mesh)
			cleanups.push(() => {
				scene.remove(stars.mesh)
				stars.dispose()
			})

			// Dust (sources).
			const dustPositions = new Float32Array(dustNodes.length * 3)
			const dustRadii = new Float32Array(dustNodes.length)
			const dustNodeOf = new Int32Array(dustNodes.length)
			dustNodes.forEach((node, d) => {
				dustPositions[d * 3] = positions[node * 3]
				dustPositions[d * 3 + 1] = positions[node * 3 + 1]
				dustPositions[d * 3 + 2] = positions[node * 3 + 2]
				dustRadii[d] = layout.radii[node]
				dustNodeOf[d] = node
			})
			const dust = createDust({
				positions: dustPositions,
				radii: dustRadii,
				nodeOf: dustNodeOf,
			})
			scene.add(dust.mesh)
			cleanups.push(() => {
				scene.remove(dust.mesh)
				dust.dispose()
			})
			const applyFacetColors = (lens: string | undefined): void => {
				const nodeColors = facetColorsFor(lens)
				const instanceColors = new Float32Array(dustNodes.length * 3)
				dustNodes.forEach((node, d) => {
					instanceColors[d * 3] = nodeColors[node * 3]
					instanceColors[d * 3 + 1] = nodeColors[node * 3 + 1]
					instanceColors[d * 3 + 2] = nodeColors[node * 3 + 2]
				})
				dust.setColors(instanceColors)
			}
			applyFacetColors(core.lens())

			// Asterisms (pure-reveal constellations).
			const asterismGroups: AsterismGroup[] = [...topicsByGroup.entries()].map(
				([group, members]) => ({ group, members, arm: arms.armOf[group] }),
			)
			const asterisms = createAsterisms(asterismGroups, positions, arms)
			scene.add(asterisms.mesh)
			cleanups.push(() => {
				scene.remove(asterisms.mesh)
				asterisms.dispose()
			})

			// Membership whiskers: a source's edges to its topics, revealed on
			// its hover/selection. Strength is the GRADE ladder (settled
			// 2026-08-15): exemplar links solid and bright, high-value medium,
			// member thin and faint — where a source is a progenitor reads
			// instantly, categorically, not as a smooth ramp.
			const WHISKER_GRADE_STRENGTH = [0.25, 0.62, 1] as const
			const whiskerLinks: WhiskerLink[] = []
			for (const [source, links] of membershipsOfSource) {
				for (const link of links) {
					whiskerLinks.push({
						source,
						topic: link.topic,
						strength: WHISKER_GRADE_STRENGTH[link.grade],
					})
				}
			}
			const whiskers = createWhiskers(whiskerLinks, positions)
			scene.add(whiskers.mesh)
			cleanups.push(() => {
				scene.remove(whiskers.mesh)
				whiskers.dispose()
			})

			// Emergent family fog, in its OWN scene: post.ts renders it as a
			// quarter-resolution pass (the mobile frame-budget fix). The handle
			// stays in scope — its density fades away while a constellation is
			// focused (up close it smothers the view).
			let nebula: ReturnType<typeof createNebula> | undefined
			let fogScene: THREE.Scene | undefined
			if (quality.nebula) {
				// One-time GPU bake of the filament noise (the march used to
				// evaluate it per step per pixel).
				const detail = bakeNebulaDetail(renderer, DISC_RADIUS)
				cleanups.push(() => detail.dispose())
				const fields: NebulaField[] = arms.ownerNodes.map((_owner, arm) => {
					const members: number[] = []
					const weights: number[] = []
					starNodes.forEach((node) => {
						if (arms.armOf[node] === arm) {
							members.push(node)
							weights.push(layout.radii[node])
						}
					})
					return { hue: arms.hues[arm], members, weights }
				})
				nebula = createNebula({
					fields,
					positions,
					discRadius: DISC_RADIUS,
					steps: quality.nebulaSteps,
					detailTexture: detail.texture,
				})
				fogScene = new THREE.Scene()
				fogScene.add(nebula.mesh)
				const dispose = nebula.dispose
				cleanups.push(() => dispose())
			}

			// Interactive wayfinding labels (kolo overlay, adopted 2026-08-16):
			// clicks and hovers call CORE ACTIONS; the label set itself is
			// decided by the projection (the drill level's children).
			const accentScratch = new THREE.Color()
			const labels = createGalaxyLabels(host, galaxy, positions, {
				accentOf: (node, lens) => {
					// Sources ride the ACTIVE facet lens colour (settled
					// 2026-08-16) — the same node-indexed palette the dust uses,
					// so pins and grains always agree; everything else rides the
					// arm hue the nebulae resolved. The lens arrives as a
					// PARAMETER (from the projection's compute) — no ambient read.
					if (nodes[node].tier === -1) {
						const colors = facetColorsFor(lens)
						accentScratch.setRGB(colors[node * 3], colors[node * 3 + 1], colors[node * 3 + 2])
						return `#${accentScratch.getHexString()}`
					}
					const arm = arms.armOf[node]
					const hue = arm >= 0 ? arms.hues[arm] : undefined
					return hue ? `#${hue.getHexString()}` : '#8fa4c9'
				},
				onSelect: (node) => core.openNode(nodes[node].id),
				onHover: (node) => core.setHovered(node >= 0 ? nodes[node].id : null),
			})
			cleanups.push(() => labels.dispose())
			/** A topic's contributing sources, matching what planetifies. */
			const contributorsOf = (topic: number): number[] =>
				(membershipsOfTopic.get(topic) ?? [])
					.filter((link) => link.grade >= 1)
					.map((link) => link.source)

			// ── Camera rig ──────────────────────────────────────────────────
			const pose = createPoseCamera(camera, {
				worldRadius: DISC_RADIUS,
				homeMinRadius: HOME_MIN_RADIUS,
				homeMaxRadius: HOME_MAX_RADIUS,
				glideSeconds: 1.1,
			})
			pose.jumpTo({ ...OVERVIEW_POSE })

			const obliquePose = (index: number, distance: number): HomeCameraPose => {
				const x = positions[index * 3]
				const y = positions[index * 3 + 1]
				const z = positions[index * 3 + 2]
				const length = Math.hypot(x, y, z)
				const nodeLat = length > 1e-6 ? Math.asin(z / length) : 0
				const lat = nodeLat * 0.35 + 0.55
				const lng = Math.atan2(y, x)
				const radius = Math.min(HOME_MAX_RADIUS, Math.max(HOME_MIN_RADIUS, length + distance))
				return { kind: 'home', lng, lat, radius }
			}

			// ── Anchor dimming ──────────────────────────────────────────────
			const starHighlights = new Float32Array(starNodes.length)
			const dustHighlights = new Float32Array(dustNodes.length)
			const clearAnchor = (): void => {
				stars.uniforms.anchorActive.value = 0
				dust.uniforms.anchorActive.value = 0
			}
			const applyAnchor = (): void => {
				stars.setHighlights(starHighlights)
				dust.setHighlights(dustHighlights)
				stars.uniforms.anchorActive.value = 1
				dust.uniforms.anchorActive.value = 1
			}
			/** Connection strengths to `node` (legacy: s-c uses a sqrt curve). */
			const anchorOn = (node: number): void => {
				starHighlights.fill(0)
				dustHighlights.fill(0)
				const tier = nodes[node].tier
				if (tier === 0) {
					starHighlights[starIndexOf[node]] = 1
					const links = membershipsOfTopic.get(node) ?? []
					const max = Math.max(1, ...links.map((l) => l.intensity))
					for (const link of links) {
						dustHighlights[dustIndexOf[link.source]] = Math.sqrt(link.intensity / max)
					}
				} else if (tier === -1) {
					dustHighlights[dustIndexOf[node]] = 1
					const links = membershipsOfSource.get(node) ?? []
					const max = Math.max(1, ...links.map((l) => l.intensity))
					for (const link of links) {
						starHighlights[starIndexOf[link.topic]] = Math.sqrt(link.intensity / max)
					}
				} else {
					// Group/family anchor: member topics fully lit, their sources
					// by membership strength.
					const members =
						tier === 1
							? (topicsByGroup.get(node) ?? [])
							: starNodes.filter((topic) => arms.ownerNodes[arms.armOf[topic]] === node)
					for (const topic of members) {
						starHighlights[starIndexOf[topic]] = 1
						const links = membershipsOfTopic.get(topic) ?? []
						const max = Math.max(1, ...links.map((l) => l.intensity))
						for (const link of links) {
							const at = dustIndexOf[link.source]
							dustHighlights[at] = Math.max(dustHighlights[at], Math.sqrt(link.intensity / max))
						}
					}
				}
				applyAnchor()
			}

			// ── Facet spotlight (settled 2026-08-16) ────────────────────────
			// While the source drill sits on a facet value, that cohort's dust
			// stays lit and the rest recedes; stars hold at a readable middle.
			const applySpotlight = (facet: string, value: string): void => {
				starHighlights.fill(0.55)
				dustHighlights.fill(0)
				for (const node of dustNodes) {
					if (nodes[node].facets?.[facet] === value) {
						dustHighlights[dustIndexOf[node]] = 1
					}
				}
				applyAnchor()
			}

			// ── Fleet + focus animation (presentation, driven by projection) ─
			let planets: PlanetCluster | undefined
			const focusAnim = { current: 0, target: 0 }
			const focusPoint = new THREE.Vector3()
			/** Planets linger through the fade-out; the loop disposes them once
			 * focusAnim settles near zero. */
			let pendingFleetClear = false

			const disposePlanets = (): void => {
				if (!planets) return
				scene.remove(planets.mesh)
				planets.dispose()
				planets = undefined
			}
			/** What the current planet fleet was built FROM — so facet switches
			 * rebuild the same fleet, whatever mode produced it. Sources only
			 * planetify at the TOPIC level (settled 2026-08-16) — a focused
			 * constellation keeps its sources as grains. */
			let fleet: { kind: 'topic' | 'source'; key: number } | undefined
			const spawnPlanets = (
				members: number[],
				suns: number[],
				glows: number[],
				lens: string | undefined,
			): void => {
				disposePlanets()
				if (members.length === 0) return
				planets = createPlanetCluster({
					sources: members,
					positions,
					radii: layout.radii,
					sunOf: Int32Array.from(suns),
					colors: facetColorsFor(lens),
					glows: Float32Array.from(glows),
				})
				scene.add(planets.mesh)
			}
			const clearFleet = (): void => {
				disposePlanets()
				fleet = undefined
			}
			/** Topic-selected fleet (settled 2026-08-15): the fleet rebuilds to
			 * THAT topic's exemplars + high-value contributors only, all sun-lit
			 * by the selected topic; its member-grade sources stay grains and
			 * everything unengaged dims through the anchor. */
			const buildTopicPlanets = (topic: number, lens: string | undefined): void => {
				fleet = { kind: 'topic', key: topic }
				const links = (membershipsOfTopic.get(topic) ?? []).filter((link) => link.grade >= 1)
				spawnPlanets(
					links.map((link) => link.source),
					links.map(() => topic),
					links.map((link) => (link.grade === 2 ? 1 : 0)),
					lens,
				)
			}
			/** Source mode planetifies ONLY the selected source (revised
			 * 2026-08-15 after seeing co-contributor fleets: too many planets) —
			 * the one world is the selection marker, sun-lit by its primary
			 * topic; it glows if the source is an exemplar anywhere. */
			const buildSourcePlanets = (source: number, lens: string | undefined): void => {
				fleet = { kind: 'source', key: source }
				const links = membershipsOfSource.get(source) ?? []
				const sun = primaryTopicOf[source] >= 0 ? primaryTopicOf[source] : (links[0]?.topic ?? -1)
				if (sun < 0) {
					disposePlanets()
					return
				}
				spawnPlanets([source], [sun], [links.some((link) => link.grade === 2) ? 1 : 0], lens)
			}
			const rebuildFleet = (lens: string | undefined): void => {
				if (!fleet) return
				if (fleet.kind === 'topic') buildTopicPlanets(fleet.key, lens)
				else buildSourcePlanets(fleet.key, lens)
			}
			// ── Framing (pure pose computation; the projection flies them) ──
			const groupOfTopic = (topic: number): number => {
				const groupId = parentOf.get(nodes[topic].id)
				const group = groupId !== undefined ? idx(groupId) : undefined
				return group !== undefined && nodes[group].tier === 1 ? group : -1
			}
			const reachFrom = (cx: number, cy: number, cz: number, members: number[]): number => {
				let reach = 6
				for (const member of members) {
					reach = Math.max(
						reach,
						Math.hypot(
							positions[member * 3] - cx,
							positions[member * 3 + 1] - cy,
							positions[member * 3 + 2] - cz,
						),
					)
				}
				return reach
			}
			const groundFrame = (center: number, distance: number): CameraPose => {
				const wx = positions[center * 3]
				const wy = positions[center * 3 + 1]
				const wz = positions[center * 3 + 2]
				return {
					kind: 'ground',
					chart: GALAXY_CHART,
					view: {
						bearing: Math.atan2(-wx, -wy),
						pitch: 0.62,
						distance,
						fov: 46,
					},
					flatX: wx,
					flatZ: wy,
					lookAtHeight: wz,
				}
			}
			const frameGroup = (group: number): CameraPose => {
				const reach = reachFrom(
					positions[group * 3],
					positions[group * 3 + 1],
					positions[group * 3 + 2],
					topicsByGroup.get(group) ?? [],
				)
				return groundFrame(group, Math.max(30, 14 + reach * 2.2))
			}
			/** Frames a source with its CONTEXT (settled 2026-08-16 papercut):
			 * arrived via a topic → frame the source and THAT topic; otherwise
			 * frame its membership reach with the readability cap. */
			const frameSource = (source: number, contextTopic: number): CameraPose => {
				const cx = positions[source * 3]
				const cy = positions[source * 3 + 1]
				const cz = positions[source * 3 + 2]
				if (contextTopic >= 0) {
					const reach = reachFrom(cx, cy, cz, [contextTopic])
					return groundFrame(source, Math.max(30, 14 + reach * 1.4))
				}
				const topics = (membershipsOfSource.get(source) ?? []).map((link) => link.topic)
				const reach = reachFrom(cx, cy, cz, topics)
				return groundFrame(source, Math.min(220, Math.max(30, 14 + reach * 1.2)))
			}

			// ── Projection: the core's navigation state → the sky ───────────
			// This is the 3D FACE of the headless core (settled 2026-08-16):
			// every visual consequence of "where the user is" — labels, camera,
			// fleets, anchors, figures — is COMPUTED from (level, lens) here.
			// The engine holds no navigation state of its own.
			interface Projection {
				key: string
				/** The colour-by lens, READ IN THE COMPUTE and carried as data
				 * so every consumer receives it as a parameter. */
				lens: string | undefined
				/** Asterism ignite key (a group's node index; -1 = none). */
				framedGroup: number
				/** Drives focusAnim (constellation/reading engagement). */
				framed: boolean
				labels: number[]
				anchor:
					| { kind: 'node'; index: number }
					| { kind: 'spotlight'; facet: string; value: string }
					| null
				/** Selection-ring node index (-1 = none). */
				selected: number
				fleet: { kind: 'topic' | 'source'; key: number } | null
				/** Whisker-lit source node index (-1 = none). */
				whisker: number
				/** Node whose position becomes the DOF/fog focus point. */
				frameCenter: number
				/** Computed destination pose; null = leave the camera alone.
				 * A remembered pose for `key` always wins (up restores the
				 * exact view you left — settled 2026-08-16). */
				pose: CameraPose | null
			}
			const restingProjection = (
				key: string,
				lens: string | undefined,
				labels: number[],
			): Projection => ({
				key,
				lens,
				framedGroup: -1,
				framed: false,
				labels,
				anchor: null,
				selected: -1,
				fleet: null,
				whisker: -1,
				frameCenter: -1,
				pose: null,
			})
			const project = (): Projection => {
				const level = core.level()
				const key = core.stateKey()
				const lens = core.lens()
				if (level.kind === 'reading' || level.kind === 'document') {
					const node = level.kind === 'document' ? level.source : level.node
					const trail = level.kind === 'document' ? core.trail() : level.trail
					const index = idx(node.id) ?? -1
					if (index < 0)
						return { ...restingProjection(key, lens, topTierNodes), pose: { ...OVERVIEW_POSE } }
					if (node.tier === 0) {
						const group = groupOfTopic(index)
						return {
							key,
							lens,
							framedGroup: group,
							framed: true,
							labels: contributorsOf(index),
							anchor: { kind: 'node', index },
							selected: index,
							fleet: { kind: 'topic', key: index },
							whisker: -1,
							frameCenter: index,
							pose: group >= 0 ? frameGroup(group) : obliquePose(index, 42),
						}
					}
					// Source reading — its trail names the context (equal-citizen
					// rule: opened via a topic, that topic rides the trail).
					const tail = trail.at(-1)
					const tailNode = tail?.kind === 'node' ? idx(tail.id) : undefined
					const contextTopic = tailNode !== undefined && nodes[tailNode].tier === 0 ? tailNode : -1
					return {
						key,
						lens,
						framedGroup: -1,
						framed: true,
						labels: (membershipsOfSource.get(index) ?? []).map((link) => link.topic),
						anchor: { kind: 'node', index },
						selected: index,
						fleet: { kind: 'source', key: index },
						whisker: index,
						frameCenter: index,
						pose: frameSource(index, contextTopic),
					}
				}
				if (level.kind === 'children') {
					const index = idx(level.anchor.id) ?? -1
					if (index < 0) return restingProjection(key, lens, topTierNodes)
					if (level.anchor.tier === 1) {
						return {
							key,
							lens,
							framedGroup: index,
							framed: true,
							labels: topicsByGroup.get(index) ?? [],
							anchor: { kind: 'node', index },
							selected: -1,
							fleet: null,
							whisker: -1,
							frameCenter: index,
							pose: frameGroup(index),
						}
					}
					// Family: oblique overview of its territory (no focus mode).
					return {
						...restingProjection(key, lens, groupsByFamily.get(index) ?? []),
						anchor: { kind: 'node', index },
						frameCenter: index,
						pose: obliquePose(index, FOCUS_DISTANCE_FAMILY),
					}
				}
				if (level.kind === 'cohort') {
					return {
						...restingProjection(
							key,
							lens,
							dustNodes.filter((node) => nodes[node].facets?.[level.facet] === level.value),
						),
						anchor: { kind: 'spotlight', facet: level.facet, value: level.value },
					}
				}
				if (level.kind === 'facets' || level.kind === 'values') {
					// The sources-mode resting pin field (retained experiment).
					return restingProjection(key, lens, [...dustNodes])
				}
				// Topics root: the authored overview.
				return { ...restingProjection(key, lens, topTierNodes), pose: { ...OVERVIEW_POSE } }
			}
			const snapshotPose = (): CameraPose => {
				const goal = pose.goal()
				if (goal.kind === 'home') return { ...goal }
				if (goal.kind === 'place') return { ...goal, direction: goal.direction.clone() }
				return { ...goal, view: { ...goal.view } }
			}
			let framedGroup = -1
			let currentProjection: Projection | undefined
			/** The anchor baseline hover previews restore to. */
			const reapplyAnchor = (): void => {
				const anchor = currentProjection?.anchor ?? null
				if (!anchor) {
					clearAnchor()
					return
				}
				if (anchor.kind === 'node') anchorOn(anchor.index)
				else applySpotlight(anchor.facet, anchor.value)
			}
			const applyProjection = (next: Projection): void => {
				const prev = currentProjection
				currentProjection = next
				// Remember the view being left so "up" can restore it exactly.
				if (prev && prev.key !== next.key) core.poseMemory.set(prev.key, snapshotPose())
				const lensChanged = prev !== undefined && next.lens !== prev.lens
				if (lensChanged) applyFacetColors(next.lens)
				labels.setLabels(next.labels, next.lens)
				stars.uniforms.selected.value = next.selected >= 0 ? starIndexOf[next.selected] : -1
				dust.uniforms.selected.value = next.selected >= 0 ? dustIndexOf[next.selected] : -1
				whiskers.uniforms.selectedSource.value = next.whisker
				reapplyAnchor()
				framedGroup = next.framedGroup
				if (next.framed && !prev?.framed) focusAnim.current = 0
				focusAnim.target = next.framed ? 1 : 0
				if (next.fleet) {
					pendingFleetClear = false
					if (fleet?.kind !== next.fleet.kind || fleet.key !== next.fleet.key) {
						if (next.fleet.kind === 'topic') buildTopicPlanets(next.fleet.key, next.lens)
						else buildSourcePlanets(next.fleet.key, next.lens)
					} else if (lensChanged) {
						rebuildFleet(next.lens)
					}
				} else if (fleet) {
					pendingFleetClear = true
				}
				if (next.frameCenter >= 0) {
					focusPoint.set(
						positions[next.frameCenter * 3],
						positions[next.frameCenter * 3 + 1],
						positions[next.frameCenter * 3 + 2],
					)
				}
				if (prev?.key !== next.key) {
					const remembered = core.poseMemory.get(next.key)
					if (remembered) pose.flyTo(remembered)
					else if (next.pose) pose.flyTo(next.pose)
				}
			}

			// ── Post ────────────────────────────────────────────────────────
			const post = createGalaxyPost(renderer, scene, camera, quality, fogScene)
			cleanups.push(() => post.dispose())

			// ── Resize + adaptive DPR ───────────────────────────────────────
			const resize = createTransactionalResize(
				host,
				() => {
					const width = host.clientWidth
					const height = host.clientHeight
					camera.aspect = width / height
					camera.updateProjectionMatrix()
					renderer.setSize(width, height, false)
				},
				{ applyPixelRatio: (value) => renderer.setPixelRatio(value) },
			)
			cleanups.push(() => resize.dispose())
			const adaptiveDpr = createAdaptiveDpr({
				ceiling: quality.dprCeiling,
				floor: quality.dprFloor,
				// Rungs between floor and ceiling: resolution degrades and
				// recovers gently instead of visibly halving (out-of-range rungs
				// are dropped, so this is safe for the mobile 1..1.5 envelope).
				steps: [1.25, 1.5],
				apply: (value) => resize.requestPixelRatio(value),
			})

			// ── Picking (analytic, all bodies: stars + dust) ────────────────
			const rayOrigin = new THREE.Vector3()
			const rayDir = new THREE.Vector3()
			const toNode = new THREE.Vector3()
			const pick = (ndcX: number, ndcY: number): number => {
				rayOrigin.copy(camera.position)
				rayDir.set(ndcX, ndcY, 0.5).unproject(camera).sub(rayOrigin).normalize()
				const heightPx = host.clientHeight || 1
				const pxScale = (2 * Math.tan((camera.fov * Math.PI) / 360)) / heightPx
				let best = -1
				let bestT = Number.POSITIVE_INFINITY
				for (let i = 0; i < count; i++) {
					const tier = nodes[i].tier
					if (tier !== 0 && tier !== -1) continue
					toNode.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).sub(rayOrigin)
					const t = toNode.dot(rayDir)
					if (t <= 0 || t >= bestT) continue
					const missSq = toNode.lengthSq() - t * t
					const px = tier === 0 ? 8 : 6
					const threshold = Math.max(layout.radii[i] * (tier === 0 ? 1.6 : 2.4), px * pxScale * t)
					if (missSq < threshold * threshold) {
						best = i
						bestT = t
					}
				}
				return best
			}

			// ── Pointer input ───────────────────────────────────────────────
			const hoverEnabled = matchMedia('(hover: hover)').matches
			const activePointers = new Map<number, { x: number; y: number }>()
			let pointerNdcX = 0
			let pointerNdcY = 0
			let pointerDirty = false
			let pinchDistance = 0
			let downX = 0
			let downY = 0
			let downTime = 0
			let dragging = false
			/** A hover currently owns the anchor-dim preview (group hover). */
			let hoverAnchored = false

			const toNdc = (event: PointerEvent): [number, number] => {
				const rect = canvas.getBoundingClientRect()
				return [
					((event.clientX - rect.left) / rect.width) * 2 - 1,
					-(((event.clientY - rect.top) / rect.height) * 2 - 1),
				]
			}
			/** Light `index` exactly as scene hover does — shared by pointer
			 * hover and chrome-driven highlights (settled 2026-08-15):
			 * topic → ignition + its constellation previews; source → grain +
			 * membership whiskers + its topics boosted by strength (NO
			 * constellation, NO dimming); group → line-work + member stars +
			 * full anchor-dim preview; family → its fog and member stars
			 * ignite (no dimming). */
			const starBoosts = new Float32Array(starNodes.length)
			let boostsActive = false
			const applyHoverVisual = (index: number): void => {
				const tier = index >= 0 ? nodes[index].tier : -9
				stars.uniforms.hovered.value = tier === 0 ? starIndexOf[index] : -1
				dust.uniforms.hovered.value = tier === -1 ? dustIndexOf[index] : -1
				// Constellation preview belongs to TOPICS (and hovered groups) —
				// a source previews its own memberships, never a constellation.
				let preview = -1
				if (tier === 1) preview = index
				else if (tier === 0) {
					const groupId = parentOf.get(nodes[index].id)
					const group = groupId !== undefined ? idx(groupId) : undefined
					if (group !== undefined && nodes[group].tier === 1) preview = group
				}
				asterisms.uniforms.hoverGroup.value = preview
				whiskers.uniforms.hoverSource.value = tier === -1 ? index : -1
				if (tier === -1) {
					starBoosts.fill(0)
					const links = membershipsOfSource.get(index) ?? []
					const max = Math.max(1, ...links.map((l) => l.intensity))
					for (const link of links) {
						starBoosts[starIndexOf[link.topic]] = Math.sqrt(link.intensity / max) * 0.55
					}
					stars.setBoosts(starBoosts)
					boostsActive = true
				} else if (boostsActive) {
					boostsActive = false
					starBoosts.fill(0)
					stars.setBoosts(starBoosts)
				}
				// Fog-owner hover (families; groups in two-tier corpora): the
				// arm's territory and member stars ignite without dimming.
				const arm = tier >= 1 ? arms.ownerNodes.indexOf(index) : -1
				stars.uniforms.hoverArm.value = arm >= 0 ? arm : -2
				if (nebula) nebula.uniforms.hoverArm.value = arm >= 0 ? arm : -3
				// Group hover: the full anchor-dim preview engages; anything
				// else releases it back to the projection's own anchor.
				if (tier === 1) {
					anchorOn(index)
					hoverAnchored = true
				} else if (hoverAnchored) {
					hoverAnchored = false
					reapplyAnchor()
				}
			}

			const onPointerDown = (event: PointerEvent): void => {
				canvas.setPointerCapture(event.pointerId)
				activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
				if (activePointers.size === 2) {
					const [a, b] = [...activePointers.values()]
					pinchDistance = Math.hypot(a.x - b.x, a.y - b.y)
				}
				downX = event.clientX
				downY = event.clientY
				downTime = performance.now()
				dragging = false
				core.markInteracted()
			}
			const onPointerMove = (event: PointerEvent): void => {
				const tracked = activePointers.get(event.pointerId)
				if (tracked) {
					const dx = event.clientX - tracked.x
					const dy = event.clientY - tracked.y
					tracked.x = event.clientX
					tracked.y = event.clientY
					if (activePointers.size === 2) {
						const [a, b] = [...activePointers.values()]
						const distance = Math.hypot(a.x - b.x, a.y - b.y)
						if (pinchDistance > 0) pose.zoomBy(pinchDistance / Math.max(1, distance))
						pinchDistance = distance
						return
					}
					if (Math.hypot(event.clientX - downX, event.clientY - downY) > CLICK_SLOP_PX) {
						dragging = true
					}
					if (dragging) {
						const heightPx = host.clientHeight || 1
						pose.panBy((-dx / heightPx) * 2.2, (dy / heightPx) * 2.2)
					}
				}
				const [ndcX, ndcY] = toNdc(event)
				pointerNdcX = ndcX
				pointerNdcY = ndcY
				pointerDirty = true
			}
			const endPointer = (event: PointerEvent): void => {
				activePointers.delete(event.pointerId)
				pinchDistance = 0
			}
			const onPointerUp = (event: PointerEvent): void => {
				const wasPinch = activePointers.size === 2
				endPointer(event)
				if (wasPinch || dragging || performance.now() - downTime > CLICK_MAX_MS) return
				const [ndcX, ndcY] = toNdc(event)
				const index = pick(ndcX, ndcY)
				if (index < 0) return
				// Every scene choice is the SAME core action drill rows use —
				// the equal-citizen rule; the projection derives the rest.
				core.openNode(nodes[index].id)
			}
			const onPointerLeave = (): void => {
				pointerDirty = false
				core.setHovered(null)
			}
			let wheelOutIntent = 0
			let wheelUpFiredAt = 0
			const onWheel = (event: WheelEvent): void => {
				event.preventDefault()
				// Wheeling OUT of an engaged view IS the up-action (settled
				// 2026-08-16 papercut: one exit path, same destination as the
				// named up-control). One gesture steps ONE level: after a fire,
				// a short cooldown swallows the burst's momentum so sustained
				// deliberate scrolling steps further, a single flick doesn't.
				if (currentProjection?.framed) {
					if (event.deltaY > 0) {
						const now = performance.now()
						if (now - wheelUpFiredAt < 700) return
						wheelOutIntent += event.deltaY
						if (wheelOutIntent > WHEEL_EXIT_INTENT) {
							wheelOutIntent = 0
							wheelUpFiredAt = now
							core.upOneLevel()
						}
					}
					return
				}
				pose.zoomBy(Math.exp(event.deltaY * 0.0012))
			}
			canvas.style.cursor = 'grab'
			canvas.style.touchAction = 'none'
			canvas.addEventListener('pointerdown', onPointerDown)
			canvas.addEventListener('pointermove', onPointerMove)
			canvas.addEventListener('pointerup', onPointerUp)
			canvas.addEventListener('pointercancel', endPointer)
			canvas.addEventListener('pointerleave', onPointerLeave)
			canvas.addEventListener('wheel', onWheel, { passive: false })
			cleanups.push(() => {
				canvas.removeEventListener('pointerdown', onPointerDown)
				canvas.removeEventListener('pointermove', onPointerMove)
				canvas.removeEventListener('pointerup', onPointerUp)
				canvas.removeEventListener('pointercancel', endPointer)
				canvas.removeEventListener('pointerleave', onPointerLeave)
				canvas.removeEventListener('wheel', onWheel)
				canvas.style.cursor = ''
				canvas.style.touchAction = ''
			})

			// ── Core subscription (the face's reactive root) ────────────────
			// Effects re-run whenever the core's navigation state or lens
			// changes; hover/highlight ride their own effect so pointer motion
			// never re-projects the whole view.
			const disposeProjection = createRoot((disposeRoot) => {
				createEffect(
					// EVERYTHING the projection reads lives in this COMPUTE
					// (project() walks the core's level/trail/reading/lens and
					// returns plain data), so the callback touches no reactive
					// values — the split-effect contract's own prescription.
					() => project(),
					(projection) => {
						applyProjection(projection)
					},
				)
				createEffect(
					() => ({ hovered: core.hovered(), highlight: core.highlight() }),
					({ hovered, highlight }) => {
						const target = hovered ?? highlight
						const index = target !== null ? (idx(target) ?? -1) : -1
						applyHoverVisual(index)
						canvas.style.cursor = index >= 0 && hovered !== null ? 'pointer' : 'grab'
					},
				)
				return disposeRoot
			})
			cleanups.push(disposeProjection)

			// ── Loop ────────────────────────────────────────────────────────
			let ready = false
			let lastTime = performance.now()
			const loop = (): void => {
				const now = performance.now()
				const dt = Math.min((now - lastTime) / 1000, 0.1)
				lastTime = now
				resize.flush()
				pose.update(dt)

				wheelOutIntent *= Math.exp(-dt * 1.4)

				const step = Math.min(1, dt * 2.6)
				focusAnim.current += (focusAnim.target - focusAnim.current) * step
				if (pendingFleetClear && focusAnim.current < 0.02) {
					pendingFleetClear = false
					clearFleet()
				}
				// A source reading suppresses the MST figure — the whiskers own
				// the line language there (framedGroup is -1 by projection).
				asterisms.uniforms.focusedGroup.value = framedGroup
				asterisms.uniforms.focusFade.value = focusAnim.current
				if (planets) planets.fade.value = focusAnim.current
				const goal = pose.goal()
				const goalRadius = goal.kind === 'home' ? goal.radius : camera.position.length()
				if (nebula) {
					// Fog belongs to the overview: it clears FULLY as focus engages
					// (settled 2026-08-15) and on any deep manual dive — and once
					// invisible the whole raymarch is skipped (the retina
					// frame-budget fix).
					const radiusFade = Math.min(1, Math.max(0, (goalRadius - 60) / 140))
					const fogFade = Math.min(1 - focusAnim.current, radiusFade)
					nebula.uniforms.fade.value = fogFade
					nebula.mesh.visible = fogFade > 0.02
				}
				post.uniforms.bokeh.value = focusAnim.current * 1.5
				post.uniforms.focusDistance.value = currentProjection?.framed
					? camera.position.distanceTo(focusPoint)
					: camera.position.length()
				const streakTarget = (currentProjection?.selected ?? -1) >= 0 ? 1 : 0.3
				post.uniforms.streak.value +=
					(streakTarget - post.uniforms.streak.value) * Math.min(1, dt * 3)

				if (hoverEnabled && pointerDirty && activePointers.size === 0) {
					pointerDirty = false
					const index = pick(pointerNdcX, pointerNdcY)
					core.setHovered(index >= 0 ? nodes[index].id : null)
				}
				post.pipeline.render()
				adaptiveDpr.update()
				labels.update(camera)
				if (!ready) {
					ready = true
					onReady()
				}
			}
			renderer.setAnimationLoop(loop)
			cleanups.push(() => renderer.setAnimationLoop(null))
			cleanups.push(() => disposePlanets())
		} catch (error) {
			console.error('[ib-galaxy] failed to initialise:', error)
			onError(error instanceof Error ? error.message : String(error))
		}
	})()

	return {
		dispose(): void {
			disposed = true
			for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]?.()
			cleanups.length = 0
		},
	}
}
