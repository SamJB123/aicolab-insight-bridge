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
import { color, screenUV } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { facetPalette, facetValues } from '../facets.ts'
import { bakeGalaxyLayout, DISC_RADIUS, primaryParents } from '../layout/cosmos.ts'
import type {
	GalaxyCommand,
	GalaxyEvents,
	IBGalaxy,
	IBIntensityMode,
} from '../types.ts'
import { createAsterisms, type AsterismGroup } from './asterisms.ts'
import { createDust } from './dust.ts'
import { resolveArmIdentity } from './hues.ts'
import { createGalaxyLabels } from './labels.ts'
import { createNebula, type NebulaField } from './nebula.ts'
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
	/** Read at event time so the host can swap handlers without a rebuild. */
	events: () => GalaxyEvents
	onReady: () => void
	onError: (message: string) => void
}

export interface GalaxyEngineHandle {
	updateCommand(command: GalaxyCommand): void
	dispose(): void
}

const HOME_MIN_RADIUS = 34
const HOME_MAX_RADIUS = 480
const OVERVIEW_POSE: HomeCameraPose = { kind: 'home', lng: -1.1, lat: 0.55, radius: 300 }
const FOCUS_DISTANCE_FAMILY = 130
const CONSTELLATION_EXIT_RADIUS = 262
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
	const { canvas, host, galaxy, events, onReady, onError } = options
	let disposed = false
	const cleanups: Array<() => void> = []
	let applyCommand: ((command: GalaxyCommand) => void) | undefined
	let pendingCommand: GalaxyCommand | undefined

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
			// Source memberships: node-indexed adjacency with grade intensities.
			interface SourceLink {
				source: number
				topic: number
				intensity: number
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
				const link: SourceLink = { source: child, topic: parent, intensity }
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
			let activeFacet = galaxy.sourceFacets?.[0]?.key

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
			const applyFacetColors = (): void => {
				const nodeColors = facetColorsFor(activeFacet)
				const instanceColors = new Float32Array(dustNodes.length * 3)
				dustNodes.forEach((node, d) => {
					instanceColors[d * 3] = nodeColors[node * 3]
					instanceColors[d * 3 + 1] = nodeColors[node * 3 + 1]
					instanceColors[d * 3 + 2] = nodeColors[node * 3 + 2]
				})
				dust.setColors(instanceColors)
			}
			applyFacetColors()

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
			// its hover/selection (per-source strength = the anchor curve).
			const whiskerLinks: WhiskerLink[] = []
			for (const [source, links] of membershipsOfSource) {
				const max = Math.max(1, ...links.map((l) => l.intensity))
				for (const link of links) {
					whiskerLinks.push({
						source,
						topic: link.topic,
						strength: Math.sqrt(link.intensity / max),
					})
				}
			}
			const whiskers = createWhiskers(whiskerLinks, positions)
			scene.add(whiskers.mesh)
			cleanups.push(() => {
				scene.remove(whiskers.mesh)
				whiskers.dispose()
			})

			// Emergent family fog. The handle stays in scope — its density fades
			// away while a constellation is focused (up close it smothers the view).
			let nebula: ReturnType<typeof createNebula> | undefined
			if (quality.nebula) {
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
				})
				const mesh = nebula.mesh
				const dispose = nebula.dispose
				scene.add(mesh)
				cleanups.push(() => {
					scene.remove(mesh)
					dispose()
				})
			}

			const labels = createGalaxyLabels(host, galaxy, positions, layout.radii)
			scene.add(labels.group)
			cleanups.push(() => {
				scene.remove(labels.group)
				labels.dispose()
			})

			// ── Camera rig ──────────────────────────────────────────────────
			const pose = createPoseCamera(camera, {
				worldRadius: DISC_RADIUS,
				homeMinRadius: HOME_MIN_RADIUS,
				homeMaxRadius: HOME_MAX_RADIUS,
				glideSeconds: 1.1,
			})
			pose.jumpTo({ ...OVERVIEW_POSE })

			const obliqueFlight = (index: number, distance: number): void => {
				const x = positions[index * 3]
				const y = positions[index * 3 + 1]
				const z = positions[index * 3 + 2]
				const length = Math.hypot(x, y, z)
				const nodeLat = length > 1e-6 ? Math.asin(z / length) : 0
				const lat = nodeLat * 0.35 + 0.55
				const lng = Math.atan2(y, x)
				const radius = Math.min(HOME_MAX_RADIUS, Math.max(HOME_MIN_RADIUS, length + distance))
				pose.flyTo({ kind: 'home', lng, lat, radius })
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

			// ── Constellation state machine ─────────────────────────────────
			let focusedGroup = -1
			let exiting = false
			let planets: PlanetCluster | undefined
			const focusAnim = { current: 0, target: 0 }
			const focusPoint = new THREE.Vector3()

			const disposePlanets = (): void => {
				if (!planets) return
				scene.remove(planets.mesh)
				planets.dispose()
				planets = undefined
			}
			const buildPlanets = (group: number): void => {
				disposePlanets()
				const topics = new Set(topicsByGroup.get(group) ?? [])
				const members: number[] = []
				const suns: number[] = []
				for (const source of dustNodes) {
					const primary = primaryTopicOf[source]
					if (primary >= 0 && topics.has(primary)) {
						members.push(source)
						suns.push(primary)
					}
				}
				if (members.length === 0) return
				planets = createPlanetCluster({
					sources: members,
					positions,
					radii: layout.radii,
					sunOf: Int32Array.from(suns),
					colors: facetColorsFor(activeFacet),
				})
				scene.add(planets.mesh)
			}
			const enterConstellation = (group: number): void => {
				if (focusedGroup === group && !exiting) return
				focusedGroup = group
				exiting = false
				focusAnim.current = 0
				focusAnim.target = 1
				buildPlanets(group)
				const topics = topicsByGroup.get(group) ?? []
				// Topics only — a constellation can hold hundreds of planetified
				// sources, and labelling them all is a wall of text. The selected
				// source gets its name via refreshConstellationLabels below.
				labels.setFocusTopics(topics)
				events().onFocusChange?.(nodes[group])
				const wx = positions[group * 3]
				const wy = positions[group * 3 + 1]
				const wz = positions[group * 3 + 2]
				focusPoint.set(wx, wy, wz)
				let reach = 6
				for (const topic of topics) {
					reach = Math.max(
						reach,
						Math.hypot(
							positions[topic * 3] - wx,
							positions[topic * 3 + 1] - wy,
							positions[topic * 3 + 2] - wz,
						),
					)
				}
				pose.flyTo({
					kind: 'ground',
					chart: GALAXY_CHART,
					view: {
						bearing: Math.atan2(-wx, -wy),
						pitch: 0.62,
						distance: Math.max(30, 14 + reach * 2.2),
						fov: 46,
					},
					flatX: wx,
					flatZ: wy,
					lookAtHeight: wz,
				})
			}
			const exitConstellation = (fly: boolean): void => {
				if (focusedGroup < 0 || exiting) return
				exiting = true
				focusAnim.target = 0
				labels.setFocusTopics([])
				events().onFocusChange?.(null)
				if (fly) {
					const home = pose.currentHomePose()
					home.lat = Math.min(home.lat, 0.8)
					home.radius = OVERVIEW_POSE.radius
					pose.flyTo(home)
				}
			}

			let selectedIndex = -1
			const selectIndex = (index: number, fireEvent: boolean): void => {
				selectedIndex = index
				stars.uniforms.selected.value = index >= 0 ? starIndexOf[index] : -1
				dust.uniforms.selected.value = index >= 0 ? dustIndexOf[index] : -1
				// A selected source keeps its membership whiskers lit.
				whiskers.uniforms.selectedSource.value =
					index >= 0 && nodes[index].tier === -1 ? index : -1
				if (index >= 0) anchorOn(index)
				else if (focusedGroup >= 0 && !exiting) anchorOn(focusedGroup)
				else clearAnchor()
				// In a constellation, the selected SOURCE earns the one source
				// label (blanket source labels are a wall of text).
				if (focusedGroup >= 0 && !exiting) {
					const topics = topicsByGroup.get(focusedGroup) ?? []
					labels.setFocusTopics(
						index >= 0 && nodes[index].tier === -1 ? [...topics, index] : topics,
					)
				}
				if (fireEvent && index >= 0) events().onSelect?.(nodes[index])
			}
			const focusIndex = (index: number, fireEvent: boolean): void => {
				const tier = nodes[index].tier
				if (tier === 0 || tier === -1) {
					const topic = tier === 0 ? index : primaryTopicOf[index]
					const groupId = topic >= 0 ? parentOf.get(nodes[topic].id) : undefined
					const group = groupId !== undefined ? idx(groupId) : undefined
					if (group !== undefined && nodes[group].tier === 1) enterConstellation(group)
					else if (topic >= 0) obliqueFlight(topic, 42)
					selectIndex(index, fireEvent)
				} else if (tier === 1) {
					enterConstellation(index)
					selectIndex(index, fireEvent)
				} else {
					exitConstellation(false)
					obliqueFlight(index, FOCUS_DISTANCE_FAMILY)
					selectIndex(index, fireEvent)
				}
			}

			// ── Post ────────────────────────────────────────────────────────
			const post = createGalaxyPost(renderer, scene, camera, quality)
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
					labels.resize(width, height)
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
					toNode
						.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
						.sub(rayOrigin)
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
			let hoveredIndex = -1
			let chromeHighlight = -1
			/** A hover currently owns the anchor-dim preview (group hover). */
			let hoverAnchored = false

			const toNdc = (event: PointerEvent): [number, number] => {
				const rect = canvas.getBoundingClientRect()
				return [
					((event.clientX - rect.left) / rect.width) * 2 - 1,
					-(((event.clientY - rect.top) / rect.height) * 2 - 1),
				]
			}
			const restoreAnchor = (): void => {
				if (selectedIndex >= 0) anchorOn(selectedIndex)
				else if (focusedGroup >= 0 && !exiting) anchorOn(focusedGroup)
				else clearAnchor()
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
				// else releases it back to the selection/constellation anchor.
				if (tier === 1) {
					anchorOn(index)
					hoverAnchored = true
				} else if (hoverAnchored) {
					hoverAnchored = false
					restoreAnchor()
				}
			}
			/** Pointer hover wins while present; chrome highlight fills in. */
			const refreshHover = (): void => {
				applyHoverVisual(hoveredIndex >= 0 ? hoveredIndex : chromeHighlight)
			}
			const setHover = (index: number): void => {
				if (index === hoveredIndex) return
				hoveredIndex = index
				refreshHover()
				canvas.style.cursor = index >= 0 ? 'pointer' : 'grab'
				events().onHover?.(index >= 0 ? nodes[index] : null)
			}
			const setChromeHighlight = (index: number): void => {
				if (index === chromeHighlight) return
				chromeHighlight = index
				refreshHover()
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
				const tier = nodes[index].tier
				if (focusedGroup >= 0 && tier <= 0) {
					// Inside a constellation, choosing members is selection, not
					// another flight — unless the body belongs elsewhere.
					const topic = tier === 0 ? index : primaryTopicOf[index]
					const groupId = topic >= 0 ? parentOf.get(nodes[topic].id) : undefined
					const group = groupId !== undefined ? idx(groupId) : undefined
					if (group === focusedGroup) {
						selectIndex(index, true)
						return
					}
				}
				focusIndex(index, true)
			}
			const onPointerLeave = (): void => {
				pointerDirty = false
				setHover(-1)
			}
			let wheelOutIntent = 0
			const onWheel = (event: WheelEvent): void => {
				event.preventDefault()
				if (focusedGroup >= 0 && !exiting) {
					if (event.deltaY > 0) {
						wheelOutIntent += event.deltaY
						if (wheelOutIntent > WHEEL_EXIT_INTENT) {
							wheelOutIntent = 0
							exitConstellation(true)
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

			// ── Commands ────────────────────────────────────────────────────
			let lastRevision = -1
			applyCommand = (command) => {
				if (command.revision === lastRevision) return
				lastRevision = command.revision
				if (command.colorFacet !== undefined && command.colorFacet !== activeFacet) {
					activeFacet = command.colorFacet
					applyFacetColors()
					if (focusedGroup >= 0 && !exiting) buildPlanets(focusedGroup)
				}
				if (command.highlight !== undefined) {
					const target =
						command.highlight === null ? undefined : idx(command.highlight)
					setChromeHighlight(target ?? -1)
				}
				if (command.focus === null) {
					exitConstellation(true)
					selectIndex(-1, false)
				} else if (command.focus !== undefined) {
					const index = idx(command.focus)
					if (index !== undefined) focusIndex(index, false)
				}
			}
			if (pendingCommand) {
				applyCommand(pendingCommand)
				pendingCommand = undefined
			}

			// ── Loop ────────────────────────────────────────────────────────
			let ready = false
			let lastTime = performance.now()
			const loop = (): void => {
				const now = performance.now()
				const dt = Math.min((now - lastTime) / 1000, 0.1)
				lastTime = now
				resize.flush()
				pose.update(dt)

				const goal = pose.goal()
				if (
					focusedGroup >= 0 &&
					!exiting &&
					goal.kind === 'home' &&
					goal.radius > CONSTELLATION_EXIT_RADIUS
				) {
					exitConstellation(false)
				}
				wheelOutIntent *= Math.exp(-dt * 1.4)

				const step = Math.min(1, dt * 2.6)
				focusAnim.current += (focusAnim.target - focusAnim.current) * step
				if (exiting && focusAnim.current < 0.02) {
					focusAnim.current = 0
					focusedGroup = -1
					exiting = false
					disposePlanets()
					if (selectedIndex < 0) clearAnchor()
				}
				const focusKey = focusedGroup >= 0 ? focusedGroup : -1
				asterisms.uniforms.focusedGroup.value = focusKey
				asterisms.uniforms.focusFade.value = focusAnim.current
				if (planets) planets.fade.value = focusAnim.current
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
				post.uniforms.focusDistance.value =
					focusedGroup >= 0
						? camera.position.distanceTo(focusPoint)
						: camera.position.length()
				const streakTarget = selectedIndex >= 0 ? 1 : 0.3
				post.uniforms.streak.value +=
					(streakTarget - post.uniforms.streak.value) * Math.min(1, dt * 3)

				if (hoverEnabled && pointerDirty && activePointers.size === 0) {
					pointerDirty = false
					setHover(pick(pointerNdcX, pointerNdcY))
				}
				post.pipeline.render()
				adaptiveDpr.update()
				labels.render(scene, camera, goalRadius, focusedGroup)
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
		updateCommand(command: GalaxyCommand): void {
			if (applyCommand) applyCommand(command)
			else pendingCommand = command
		},
		dispose(): void {
			disposed = true
			for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]?.()
			cleanups.length = 0
		},
	}
}
