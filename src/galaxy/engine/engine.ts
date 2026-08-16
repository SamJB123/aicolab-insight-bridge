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
import { createEffect, createRoot, createSignal } from 'solid-js'
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
/** THE galactic north (settled 2026-08-16): every framed view faces the
 * same compass direction — the one the authored overview faces — so
 * navigation never rotates, only slides and zooms. A home pose at
 * longitude L looks along azimuth L+π; the ground bearing producing that
 * same look direction is π/2 − L. */
const GALACTIC_NORTH_BEARING = Math.PI / 2 - OVERVIEW_POSE.lng
const CLICK_SLOP_PX = 6
const CLICK_MAX_MS = 1500

/** Vertical half-angle tangent of the 46° camera on a WIDE canvas — the
 * geometry every legacy framing constant was hand-tuned against. Fitted
 * distances multiply by legacy·TUNED_TAN so a wide desktop canvas
 * reproduces the shipped framing exactly, while narrower shapes pull back
 * until the subject fits (settled 2026-08-16). */
const TUNED_TAN = Math.tan((46 * Math.PI) / 360)
/** Standoff added inside every fitted distance (the legacy "+14"). */
const FIT_MARGIN = 14
/** Fit factor that CONTAINS a pin swarm: 1/TUNED_TAN puts the farthest
 * bare position exactly at the frustum edge (plaques may overhang there —
 * headroom removed by user call 2026-08-16 after fringe subjects showed
 * too much empty sky). Used by reading frames. */
const FIT_CONTAIN = 1 / TUNED_TAN

/** Half-angle tangents of the VISIBLE canvas strip. The camera renders a
 * virtual canvas of height H+inset and shows its top H px (setViewOffset),
 * so the subject centres in the strip the bottom sheet leaves uncovered;
 * these tangents describe that strip's angular extents. Pure math — safe
 * from any context. */
const stripTangents = (
	width: number,
	height: number,
	insetPx: number,
): { tanH: number; tanV: number; aspect: number } => {
	const inset = Math.min(Math.max(0, insetPx), height * 0.7)
	const virtual = height + inset
	const visible = height - inset
	return {
		tanH: (TUNED_TAN * width) / virtual,
		tanV: (TUNED_TAN * visible) / virtual,
		aspect: width / Math.max(1, visible),
	}
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3
/** Structural pose comparison — a same-place re-projection only moves the
 * camera when the COMPUTED pose actually changed (canvas reshape, drawer
 * inset), never on unrelated re-runs (lens switches, hover-driven data). */
const posesEqual = (a: CameraPose | null, b: CameraPose | null): boolean => {
	if (a === b) return true
	if (!a || !b) return false
	if (a.kind === 'home' && b.kind === 'home')
		return near(a.lng, b.lng) && near(a.lat, b.lat) && near(a.radius, b.radius)
	if (a.kind === 'ground' && b.kind === 'ground')
		return (
			near(a.flatX, b.flatX) &&
			near(a.flatZ, b.flatZ) &&
			near(a.lookAtHeight ?? 0, b.lookAtHeight ?? 0) &&
			near(a.view.bearing, b.view.bearing) &&
			near(a.view.pitch, b.view.pitch) &&
			near(a.view.distance, b.view.distance)
		)
	return false
}

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
			// HOVER only (selection reveal removed 2026-08-16 to match topics:
			// a reading shows no line figure). Strength is the GRADE ladder
			// (settled 2026-08-15): exemplar links solid and bright, high-value
			// medium, member thin and faint — where a source is a progenitor
			// reads instantly, categorically, not as a smooth ramp.
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
			/** A source's meaningfully-engaged topics — the mirror of
			 * contributorsOf (settled 2026-08-16): a pin always means
			 * exemplar/high-value; ordinary-member topics stay bare stars,
			 * brightness-graded by the anchor dimming. */
			const engagementsOf = (source: number): number[] =>
				(membershipsOfSource.get(source) ?? [])
					.filter((link) => link.grade >= 1)
					.map((link) => link.topic)

			// ── Camera rig ──────────────────────────────────────────────────
			const pose = createPoseCamera(camera, {
				worldRadius: DISC_RADIUS,
				homeMinRadius: HOME_MIN_RADIUS,
				homeMaxRadius: HOME_MAX_RADIUS,
				glideSeconds: 1.1,
			})

			// ── Viewport-attuned framing (settled 2026-08-16) ───────────────
			// The live canvas shape and the web UI's bottom-sheet inset are
			// reactive framing inputs: project() reads them in its COMPUTE, so
			// a rotation, window reshape, or drawer detent re-frames the view
			// through the ordinary projection path (animated fly).
			const [frameGeometry, setFrameGeometry] = createSignal(
				{ width: host.clientWidth || 1, height: host.clientHeight || 1 },
				{ equals: (a, b) => a.width === b.width && a.height === b.height },
			)
			/** REACTIVE strip tangents — call ONLY from project()'s compute
			 * (its signal reads are what re-frame on reshape). */
			const visibleStrip = (): { tanH: number; tanV: number; aspect: number } => {
				const { width, height } = frameGeometry()
				return stripTangents(width, height, core.viewportInset())
			}
			/** Distance fitting a subject of world radius `reach` at the
			 * view's authored tightness `legacy` (the shipped multiplier —
			 * desktop-wide framing reproduces exactly). */
			const fitDistance = (reach: number, legacy: number): number => {
				const strip = visibleStrip()
				return (
					FIT_MARGIN +
					(reach * legacy * TUNED_TAN) / Math.max(0.05, Math.min(strip.tanH, strip.tanV))
				)
			}
			/** Aspect correction for authored FIXED distances (no reach to
			 * fit): widen by how much the limiting half-angle narrowed. */
			const fitFixed = (legacy: number): number => {
				const strip = visibleStrip()
				return (
					FIT_MARGIN +
					(legacy - FIT_MARGIN) * (TUNED_TAN / Math.max(0.05, Math.min(strip.tanH, strip.tanV)))
				)
			}
			/** The home zoom-out clamp, widened for narrow strips so fitted
			 * overviews are reachable. */
			const fittedHomeMax = (): number => {
				const strip = visibleStrip()
				return (
					HOME_MAX_RADIUS *
					Math.max(1, TUNED_TAN / Math.max(0.05, Math.min(strip.tanH, strip.tanV)))
				)
			}
			const overviewPose = (): HomeCameraPose => ({
				...OVERVIEW_POSE,
				radius: Math.min(fittedHomeMax(), fitFixed(OVERVIEW_POSE.radius)),
			})
			/** Applies the visible-strip camera geometry: aspect + view offset
			 * frame a virtual canvas of height H+inset and show its top H px,
			 * centring every pose kind in the uncovered strip. Plain values in
			 * — callable from the resize path and the geometry effect alike. */
			const applyViewport = (width: number, height: number, insetPx: number): void => {
				const inset = Math.round(Math.min(Math.max(0, insetPx), height * 0.7))
				const virtual = height + inset
				camera.aspect = width / virtual
				if (inset > 0) camera.setViewOffset(width, virtual, 0, inset, width, height)
				else camera.clearViewOffset()
				const strip = stripTangents(width, height, inset)
				pose.setHomeMaxRadius(
					HOME_MAX_RADIUS *
						Math.max(1, TUNED_TAN / Math.max(0.05, Math.min(strip.tanH, strip.tanV))),
				)
			}
			pose.jumpTo(overviewPose())

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
				// Every framed view faces GALACTIC NORTH — the overview's own
				// orientation — so moving between levels or across the disc
				// never rotates the compass (settled 2026-08-16, superseding
				// the per-node bearings that made transitions spin).
				return {
					kind: 'ground',
					chart: GALAXY_CHART,
					view: {
						bearing: GALACTIC_NORTH_BEARING,
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
				return groundFrame(group, Math.max(30, fitDistance(reach, 2.2)))
			}
			/** A family's territory, faced from galactic north like every
			 * other framed view (replaced the swing-to-sector orbit pose,
			 * 2026-08-16 — the one place a rotation survived). */
			const frameFamily = (family: number): CameraPose => {
				const reach = reachFrom(
					positions[family * 3],
					positions[family * 3 + 1],
					positions[family * 3 + 2],
					groupsByFamily.get(family) ?? [],
				)
				return groundFrame(family, Math.max(30, fitDistance(reach, 2.2)))
			}
			/** Frames a topic with its contributor PINS all in-frame (fixed
			 * 2026-08-16: the old pose framed the parent group's topic spread
			 * and routinely cropped the contributor swarm). */
			const frameTopic = (topic: number): CameraPose => {
				const reach = reachFrom(
					positions[topic * 3],
					positions[topic * 3 + 1],
					positions[topic * 3 + 2],
					contributorsOf(topic),
				)
				return groundFrame(topic, Math.max(30, fitDistance(reach, FIT_CONTAIN)))
			}
			/** Frames a source with ALL its engagement pins in-frame (fixed
			 * 2026-08-16: the context-topic-only reach and the membership
			 * distance cap both cropped pins). The arrival topic joins the
			 * fit so the narrative connection stays visible even when the
			 * source is a mere member of it. */
			const frameSource = (source: number, contextTopic: number): CameraPose => {
				const members = engagementsOf(source)
				if (contextTopic >= 0) members.push(contextTopic)
				const reach = reachFrom(
					positions[source * 3],
					positions[source * 3 + 1],
					positions[source * 3 + 2],
					members,
				)
				return groundFrame(source, Math.max(30, fitDistance(reach, FIT_CONTAIN)))
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
				/** Node whose position becomes the DOF/fog focus point. */
				frameCenter: number
				/** Computed destination pose; null = leave the camera alone.
				 * A remembered pose for `key` wins when it was captured under
				 * a matching canvas shape (up restores the exact view you
				 * left — settled 2026-08-16); a reshaped canvas re-fits. */
				pose: CameraPose | null
				/** Visible-strip aspect this projection was computed under —
				 * the pose-memory compatibility key. */
				aspect: number
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
				frameCenter: -1,
				pose: null,
				aspect: visibleStrip().aspect,
			})
			const project = (): Projection => {
				const level = core.level()
				const key = core.stateKey()
				const lens = core.lens()
				// Read once so EVERY branch tracks the canvas shape + drawer
				// inset — a reshape re-projects regardless of where we are.
				const aspect = visibleStrip().aspect
				if (level.kind === 'reading' || level.kind === 'document') {
					const node = level.kind === 'document' ? level.source : level.node
					const trail = level.kind === 'document' ? core.trail() : level.trail
					const index = idx(node.id) ?? -1
					if (index < 0)
						return { ...restingProjection(key, lens, topTierNodes), pose: overviewPose() }
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
							frameCenter: index,
							pose: frameTopic(index),
							aspect,
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
						labels: engagementsOf(index),
						anchor: { kind: 'node', index },
						selected: index,
						fleet: { kind: 'source', key: index },
						frameCenter: index,
						pose: frameSource(index, contextTopic),
						aspect,
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
							frameCenter: index,
							pose: frameGroup(index),
							aspect,
						}
					}
					// Family: oblique overview of its territory (no focus mode).
					return {
						...restingProjection(key, lens, groupsByFamily.get(index) ?? []),
						anchor: { kind: 'node', index },
						frameCenter: index,
						pose: frameFamily(index),
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
				return { ...restingProjection(key, lens, topTierNodes), pose: overviewPose() }
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
				// Remember the view being left so "up" can restore it exactly,
				// tagged with the canvas shape it was seen under.
				if (prev && prev.key !== next.key)
					core.poseMemory.set(prev.key, { pose: snapshotPose(), aspect: prev.aspect })
				const lensChanged = prev !== undefined && next.lens !== prev.lens
				if (lensChanged) applyFacetColors(next.lens)
				// Only touch the pins when the SET (or its tinting lens)
				// changed — re-projections that aren't about labels (resize
				// ticks, drawer-inset changes) must not churn pin DOM
				// (resize-squish bug, settled 2026-08-16).
				const labelsChanged =
					!prev ||
					prev.lens !== next.lens ||
					prev.labels.length !== next.labels.length ||
					prev.labels.some((node, at) => node !== next.labels[at])
				if (labelsChanged) labels.setLabels(next.labels, next.lens)
				stars.uniforms.selected.value = next.selected >= 0 ? starIndexOf[next.selected] : -1
				dust.uniforms.selected.value = next.selected >= 0 ? dustIndexOf[next.selected] : -1
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
					// A memory captured under a meaningfully different canvas
					// shape would restore cropped — prefer the fresh fit then
					// (settled 2026-08-16).
					const remembered = core.poseMemory.get(next.key)
					const rememberedFits =
						remembered && Math.abs(remembered.aspect - next.aspect) < next.aspect * 0.05
					if (remembered && rememberedFits) pose.flyTo(remembered.pose)
					else if (next.pose) pose.flyTo(next.pose)
				} else if (prev && next.pose && !posesEqual(prev.pose, next.pose)) {
					// Same place, reshaped canvas (rotation, resize, drawer
					// detent): glide to the re-fitted framing.
					pose.flyTo(next.pose)
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
					// Synchronous so this very frame renders undistorted; the
					// geometry signal then re-frames through the projection
					// path (the inset read here is a plain non-reactive read —
					// the reactive subscription lives in project()'s compute).
					applyViewport(width, height, core.viewportInset())
					renderer.setSize(width, height, false)
					setFrameGeometry({ width, height })
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
			let pinchAngle = 0
			let pinchCentroidY = 0
			const angleDelta = (to: number, from: number): number =>
				((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI
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

			// Manual camera control (settled 2026-08-16): EVERY level has the
			// full set — drag pans, right-drag rotates, wheel/pinch zooms,
			// two-finger twist rotates, two-finger vertical drag tilts.
			// Canonical north is only where navigation ARRIVES; it never
			// limits what you can do.
			//
			// Handlers live on the HOST, not the canvas: wayfinding pins sit
			// over the sky and swallow canvas-targeted events, which silently
			// broke any two-finger gesture with a finger on a pin (588 pins
			// make that the common case). Pins are gesture surface like any
			// map's markers — drag-from-pin pans, pinch-over-pin zooms — and
			// a pin's own tap only fires when the gesture stayed a tap. Other
			// stage UI (breadcrumb, search, tooltips) keeps its input.
			const gestureSurface = (target: EventTarget | null): boolean => {
				if (target === canvas) return true
				if (!(target instanceof Element)) return false
				if (target.closest('.kolo-wayfinding')) return true
				return (
					target.closest('button, [role=button], a, input, select, textarea, [contenteditable]') ===
					null
				)
			}
			const rotatePointers = new Set<number>()
			/** A drag/pinch happened — the release must not read as a pin tap. */
			let gestureConsumed = false
			const onPointerDown = (event: PointerEvent): void => {
				if (!gestureSurface(event.target)) return
				// Capture only canvas-born pointers: capturing pin-born ones
				// would retarget their stream and break the pin's own click.
				if (event.target === canvas) canvas.setPointerCapture(event.pointerId)
				if (event.button === 2) rotatePointers.add(event.pointerId)
				activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
				if (activePointers.size === 1) gestureConsumed = false
				if (activePointers.size === 2) {
					const [a, b] = [...activePointers.values()]
					pinchDistance = Math.hypot(a.x - b.x, a.y - b.y)
					pinchAngle = Math.atan2(b.y - a.y, b.x - a.x)
					pinchCentroidY = (a.y + b.y) / 2
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
						// Touch mirror of desktop right-drag (settled 2026-08-16):
						// pinch zooms, TWISTING the two fingers rotates the bearing
						// (content follows the twist), dragging both fingers
						// up/down tilts the pitch.
						const [a, b] = [...activePointers.values()]
						const distance = Math.hypot(a.x - b.x, a.y - b.y)
						const angle = Math.atan2(b.y - a.y, b.x - a.x)
						const centroidY = (a.y + b.y) / 2
						if (pinchDistance > 0) {
							gestureConsumed = true
							pose.zoomBy(pinchDistance / Math.max(1, distance))
							const heightPx = host.clientHeight || 1
							// Bearing sign probe-verified 2026-08-16: content
							// follows the twist direction.
							pose.rotateBy(
								angleDelta(pinchAngle, angle),
								((centroidY - pinchCentroidY) / heightPx) * 2.2,
							)
						}
						pinchDistance = distance
						pinchAngle = angle
						pinchCentroidY = centroidY
						return
					}
					if (Math.hypot(event.clientX - downX, event.clientY - downY) > CLICK_SLOP_PX) {
						dragging = true
						gestureConsumed = true
					}
					if (dragging) {
						const heightPx = host.clientHeight || 1
						if (rotatePointers.has(event.pointerId)) {
							pose.rotateBy((dx / heightPx) * 2.2, (dy / heightPx) * 2.2)
						} else {
							pose.panBy((-dx / heightPx) * 2.2, (dy / heightPx) * 2.2)
						}
					}
				}
				// Hover picking follows the pointer only over the open sky —
				// over a pin, the pin's own hover callbacks govern.
				if (event.target === canvas) {
					const [ndcX, ndcY] = toNdc(event)
					pointerNdcX = ndcX
					pointerNdcY = ndcY
					pointerDirty = true
				}
			}
			const endPointer = (event: PointerEvent): void => {
				activePointers.delete(event.pointerId)
				rotatePointers.delete(event.pointerId)
				pinchDistance = 0
			}
			const onPointerUp = (event: PointerEvent): void => {
				const wasPinch = activePointers.size === 2
				const wasRotate = rotatePointers.has(event.pointerId)
				endPointer(event)
				if (event.target !== canvas) return
				// gestureConsumed also catches the SECOND finger of a pinch
				// lifting last — its release is the gesture ending, not a tap
				// (pre-existing pinch-end tap-through, caught 2026-08-16).
				if (
					wasPinch ||
					wasRotate ||
					dragging ||
					gestureConsumed ||
					performance.now() - downTime > CLICK_MAX_MS
				)
					return
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
			// A drag/pinch that involved a pin must not fire the pin's click
			// on release (map convention: dragging from a marker pans, it
			// doesn't select).
			const onOverlayClick = (event: MouseEvent): void => {
				if (!gestureConsumed) return
				if (event.target instanceof Element && event.target.closest('.kolo-wayfinding')) {
					event.preventDefault()
					event.stopPropagation()
				}
			}
			// Wheel is ZOOM at every level, both directions (settled
			// 2026-08-16, superseding wheel-out-as-up: leaving a level goes
			// through the named up-control or breadcrumb only).
			const onWheel = (event: WheelEvent): void => {
				if (!gestureSurface(event.target)) return
				event.preventDefault()
				pose.zoomBy(Math.exp(event.deltaY * 0.0012))
			}
			const onContextMenu = (event: Event): void => {
				// Right-drag is the rotate gesture; the browser menu would
				// swallow it on release.
				if (gestureSurface(event.target)) event.preventDefault()
			}
			// Pointers released outside the host (drag-from-pin has no
			// capture) still need their tracking cleared.
			const onWindowPointerEnd = (event: PointerEvent): void => {
				endPointer(event)
			}
			canvas.style.cursor = 'grab'
			canvas.style.touchAction = 'none'
			host.style.touchAction = 'none'
			host.addEventListener('pointerdown', onPointerDown)
			host.addEventListener('pointermove', onPointerMove)
			host.addEventListener('pointerup', onPointerUp)
			host.addEventListener('pointercancel', endPointer)
			host.addEventListener('pointerleave', onPointerLeave)
			host.addEventListener('wheel', onWheel, { passive: false })
			host.addEventListener('contextmenu', onContextMenu)
			host.addEventListener('click', onOverlayClick, { capture: true })
			window.addEventListener('pointerup', onWindowPointerEnd)
			window.addEventListener('pointercancel', onWindowPointerEnd)
			cleanups.push(() => {
				host.removeEventListener('pointerdown', onPointerDown)
				host.removeEventListener('pointermove', onPointerMove)
				host.removeEventListener('pointerup', onPointerUp)
				host.removeEventListener('pointercancel', endPointer)
				host.removeEventListener('pointerleave', onPointerLeave)
				host.removeEventListener('wheel', onWheel)
				host.removeEventListener('contextmenu', onContextMenu)
				host.removeEventListener('click', onOverlayClick, { capture: true })
				window.removeEventListener('pointerup', onWindowPointerEnd)
				window.removeEventListener('pointercancel', onWindowPointerEnd)
				canvas.style.cursor = ''
				canvas.style.touchAction = ''
				host.style.touchAction = ''
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
					// The drawer inset changes the camera's view offset even
					// between navigations (geometry changes route through the
					// resize handler, which applies synchronously — this
					// effect is idempotent over those).
					() => ({ geometry: frameGeometry(), inset: core.viewportInset() }),
					({ geometry, inset }) => {
						applyViewport(geometry.width, geometry.height, inset)
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
			let fleetFade = 0
			const loop = (): void => {
				const now = performance.now()
				const dt = Math.min((now - lastTime) / 1000, 0.1)
				lastTime = now
				resize.flush()
				pose.update(dt)

				const step = Math.min(1, dt * 2.6)
				focusAnim.current += (focusAnim.target - focusAnim.current) * step
				// The fleet fades on its OWN track: an up-navigation from a
				// topic to its still-framed group keeps focusAnim at 1, so
				// gating the fleet's fade and disposal on focusAnim left the
				// planets hanging forever (bug fixed 2026-08-16).
				const fleetGoal = pendingFleetClear ? 0 : focusAnim.current
				fleetFade += (fleetGoal - fleetFade) * step
				if (pendingFleetClear && fleetFade < 0.02) {
					pendingFleetClear = false
					clearFleet()
				}
				// A source reading suppresses the MST figure (framedGroup is -1
				// by projection) — readings show NO line figure at all; lines
				// are hover previews only (aligned with topics 2026-08-16).
				asterisms.uniforms.focusedGroup.value = framedGroup
				asterisms.uniforms.focusFade.value = focusAnim.current
				if (planets) planets.fade.value = fleetFade
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
