/**
 * The Insight Galaxy engine — vanilla three.js WebGPU/TSL, no framework
 * (the kolo house pattern: `mount(options) => handle`, synchronous dispose,
 * async init inside with a `disposed` check after every await, LIFO
 * cleanups). Reached ONLY by dynamic import from the SceneStage adapter so
 * three never enters an SSR/worker bundle.
 *
 * Scene layers (one draw call each): star field (stars.ts) · beam web
 * (beams.ts) · focused cluster's mini-planets (planets.ts) · kolo space
 * backdrop · CSS2D labels over the top.
 *
 * Semantic zoom (settled 2026-08-14): the frozen seeded layout is both the
 * render positions and the CPU pick mirror — GPU never moves a node, so
 * picking stays honest. Clicking a topic or group focuses its CLUSTER:
 * the group star swells into a local sun, its topics resolve into planets,
 * its full beam constellation ignites (secondary DAG leans included), topic
 * labels appear, and DOF pulls focus. Zooming out past the constellation
 * envelope exits (altitude is the mode — the home-world policy).
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
import { bakeGalaxyLayout } from '../layout/bake.ts'
import {
	clusterReach,
	primaryParents,
	SPIRAL_ARM_TWIST,
	SPIRAL_CORE_RADIUS,
} from '../layout/spiral-seed.ts'
import type { GalaxyCommand, GalaxyEvents, IBGalaxy } from '../types.ts'
import { createBeamWeb } from './beams.ts'
import { resolveArmIdentity } from './hues.ts'
import { createGalaxyLabels } from './labels.ts'
import { createNebula } from './nebula.ts'
import { readGalaxyPalette } from './palette.ts'
import { createPlanetCluster, type PlanetCluster } from './planets.ts'
import { createGalaxyPost } from './post.ts'
import { resolveGalaxyQuality } from './quality.ts'
import { createStarField, type StarFieldData } from './stars.ts'

export interface GalaxyEngineOptions {
	canvas: HTMLCanvasElement
	host: HTMLElement
	galaxy: IBGalaxy
	/** Read at event time so the host can swap handlers without a rebuild. */
	events: () => GalaxyEvents
	onReady: () => void
	onError: (message: string) => void
}

export interface GalaxyEngineHandle {
	updateCommand(command: GalaxyCommand): void
	dispose(): void
}

// Camera envelope around the layout's default 100-unit disc.
const DISC_RADIUS = 100
const HOME_MIN_RADIUS = 34
const HOME_MAX_RADIUS = 480
const OVERVIEW_POSE: HomeCameraPose = { kind: 'home', lng: -1.1, lat: 0.55, radius: 300 }
/** Camera distance past a focused node, by tier (topic, group, family). */
const FOCUS_DISTANCE = [42, 80, 130] as const
/** Home radius beyond which a constellation releases back to the galaxy. */
const CONSTELLATION_EXIT_RADIUS = 262

const CLICK_SLOP_PX = 6
const CLICK_MAX_MS = 1500
/** Accumulated wheel-out (px) that releases a locked constellation view. */
const WHEEL_EXIT_INTENT = 320

/** Identity chart bridging the pose camera's flat ground convention
 * (x/z plane, y = height) onto this world (+Z up, disc in XY). Lets the
 * GROUND pose frame an arbitrary cluster point with an authored
 * bearing/pitch/distance — the constellation view is locked by
 * construction, exactly like a destination's HD-2D view. */
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
			const layout = bakeGalaxyLayout(galaxy)
			const count = galaxy.nodes.length
			// Pose-camera convention: +Z is the world axis, equator in XY. The
			// layout's disc is XZ with y thickness → (x, y, z) → (x, z, −y).
			const positions = new Float32Array(count * 3)
			for (let i = 0; i < count; i++) {
				positions[i * 3] = layout.positions[i * 3]
				positions[i * 3 + 1] = layout.positions[i * 3 + 2]
				positions[i * 3 + 2] = -layout.positions[i * 3 + 1]
			}
			const temperatures = new Float32Array(count)
			galaxy.nodes.forEach((node, i) => {
				temperatures[i] = node.intensity ?? 0.3
			})

			// Membership structure for focus routing + crossfades.
			const parentOf = primaryParents(galaxy)
			const groupOfTopic = new Int32Array(count).fill(-1)
			const topicsByGroup = new Map<number, number[]>()
			galaxy.nodes.forEach((node, i) => {
				if (node.tier !== 0) return
				const parentId = parentOf.get(node.id)
				const parent = parentId !== undefined ? layout.index.get(parentId) : undefined
				if (parent === undefined) return
				groupOfTopic[i] = parent
				const members = topicsByGroup.get(parent)
				if (members) members.push(i)
				else topicsByGroup.set(parent, [i])
			})
			const groupKeys = new Float32Array(count)
			galaxy.nodes.forEach((node, i) => {
				groupKeys[i] = node.tier === 0 && groupOfTopic[i] >= 0 ? groupOfTopic[i] : -2
			})
			const arms = resolveArmIdentity(galaxy)

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
					// Coarse pointers start at the floor and let the adaptive
					// monitor earn its way up; desktop starts at the ceiling and
					// drops only if it struggles.
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

			const data: StarFieldData = {
				positions,
				radii: layout.radii,
				temperatures,
				groupKeys,
			}
			const stars = createStarField(data, palette)
			scene.add(stars.mesh)
			cleanups.push(() => {
				scene.remove(stars.mesh)
				stars.dispose()
			})

			const beams = createBeamWeb(galaxy, positions, arms)
			scene.add(beams.mesh)
			cleanups.push(() => {
				scene.remove(beams.mesh)
				beams.dispose()
			})

			const labels = createGalaxyLabels(host, galaxy, positions, layout.radii)
			scene.add(labels.group)
			cleanups.push(() => {
				scene.remove(labels.group)
				labels.dispose()
			})

			if (quality.nebula) {
				const nebula = createNebula({
					discRadius: DISC_RADIUS,
					coreRadius: SPIRAL_CORE_RADIUS,
					armTwist: SPIRAL_ARM_TWIST,
					hues: arms.hues,
					steps: quality.nebulaSteps,
				})
				scene.add(nebula.mesh)
				cleanups.push(() => {
					scene.remove(nebula.mesh)
					nebula.dispose()
				})
			}

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
				// Home poses always look at the origin; sharing the node's
				// LONGITUDE puts it on the camera→origin axis. Latitude keeps an
				// oblique elevation — matching an in-plane node's ~0 latitude
				// would land the camera edge-on in the disc, an unreadable smear.
				const nodeLat = length > 1e-6 ? Math.asin(z / length) : 0
				const lat = nodeLat * 0.35 + 0.55
				const lng = Math.atan2(y, x)
				const radius = Math.min(HOME_MAX_RADIUS, Math.max(HOME_MIN_RADIUS, length + distance))
				pose.flyTo({ kind: 'home', lng, lat, radius })
			}

			// ── Constellation state machine ─────────────────────────────────
			let focusedGroup = -1 // node index of the focused group (or -1)
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
			const enterConstellation = (group: number): void => {
				if (focusedGroup === group && !exiting) return
				disposePlanets()
				focusedGroup = group
				exiting = false
				focusAnim.current = 0
				focusAnim.target = 1
				const topics = topicsByGroup.get(group) ?? []
				planets = createPlanetCluster(
					{
						topics,
						positions,
						radii: layout.radii,
						temperatures,
						sun: group,
						hue: arms.hues[arms.armOf[group]] ?? new THREE.Color('#7f9bd6'),
					},
					palette,
				)
				scene.add(planets.mesh)
				labels.setFocusTopics(topics)
				events().onFocusChange?.(galaxy.nodes[group])
				const wx = positions[group * 3]
				const wy = positions[group * 3 + 1]
				const wz = positions[group * 3 + 2]
				focusPoint.set(wx, wy, wz)
				const reach = clusterReach(topics.length, layout.radii[group], 1.9)
				// Camera on the galactic-core side of the cluster, looking outward:
				// the constellation reads against deep space, not the bright core.
				pose.flyTo({
					kind: 'ground',
					chart: GALAXY_CHART,
					view: {
						bearing: Math.atan2(-wx, -wy),
						pitch: 0.62,
						distance: Math.max(30, 16 + reach * 3.0),
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
					// Inherit the longitude but temper the latitude — the ground
					// pose sits high, and an exit straight to a pole reads odd.
					const home = pose.currentHomePose()
					home.lat = Math.min(home.lat, 0.8)
					home.radius = OVERVIEW_POSE.radius
					pose.flyTo(home)
				}
			}

			let selectedIndex = -1
			const selectIndex = (index: number, fireEvent: boolean): void => {
				selectedIndex = index
				stars.uniforms.selected.value = index
				if (fireEvent && index >= 0) events().onSelect?.(galaxy.nodes[index])
			}
			const focusIndex = (index: number, fireEvent: boolean): void => {
				const tier = galaxy.nodes[index].tier
				if (tier === 0) {
					const group = groupOfTopic[index]
					if (group >= 0) enterConstellation(group)
					else obliqueFlight(index, FOCUS_DISTANCE[0])
					selectIndex(index, fireEvent)
				} else if (tier === 1) {
					enterConstellation(index)
					selectIndex(index, fireEvent)
				} else {
					exitConstellation(false)
					obliqueFlight(index, FOCUS_DISTANCE[2])
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
				apply: (value) => resize.requestPixelRatio(value),
			})

			// ── Picking (analytic, against the frozen mirror) ───────────────
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
					toNode
						.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
						.sub(rayOrigin)
					const t = toNode.dot(rayDir)
					if (t <= 0 || t >= bestT) continue
					const missSq = toNode.lengthSq() - t * t
					// Hit within the star's glow or an 8px screen ring, whichever
					// is larger at this depth.
					const threshold = Math.max(layout.radii[i] * 1.6, 8 * pxScale * t)
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

			const toNdc = (event: PointerEvent): [number, number] => {
				const rect = canvas.getBoundingClientRect()
				return [
					((event.clientX - rect.left) / rect.width) * 2 - 1,
					-(((event.clientY - rect.top) / rect.height) * 2 - 1),
				]
			}
			const setHover = (index: number): void => {
				if (index === hoveredIndex) return
				hoveredIndex = index
				stars.uniforms.hovered.value = index
				canvas.style.cursor = index >= 0 ? 'pointer' : 'grab'
				events().onHover?.(index >= 0 ? galaxy.nodes[index] : null)
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
				if (focusedGroup >= 0 && groupOfTopic[index] === focusedGroup) {
					// Inside a constellation, choosing a sibling planet is a
					// selection, not another flight.
					selectIndex(index, true)
					return
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
					// The constellation view is locked; a sustained wheel-out is
					// the release gesture (a stray tick decays away in the loop).
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
				if (command.focus === null) {
					exitConstellation(true)
					selectIndex(-1, false)
				} else if (command.focus !== undefined) {
					const index = layout.index.get(command.focus)
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

				// Altitude is the mode: zooming out of a constellation releases it.
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

				// Crossfade animation + uniform fan-out.
				const step = Math.min(1, dt * 2.6)
				focusAnim.current += (focusAnim.target - focusAnim.current) * step
				if (exiting && focusAnim.current < 0.02) {
					focusAnim.current = 0
					focusedGroup = -1
					exiting = false
					disposePlanets()
				}
				const focusKey = focusedGroup >= 0 ? focusedGroup : -1
				stars.uniforms.focusedGroup.value = focusKey
				stars.uniforms.focusFade.value = focusAnim.current
				beams.uniforms.focusedGroup.value = focusKey
				beams.uniforms.focusFade.value = focusAnim.current
				if (planets) planets.fade.value = focusAnim.current
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
				const cameraRadius = goal.kind === 'home' ? goal.radius : camera.position.length()
				labels.render(scene, camera, cameraRadius, focusedGroup)
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
