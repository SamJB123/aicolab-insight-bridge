/**
 * Labels — real DOM over the canvas via CSS2DRenderer (settled 2026-08-14:
 * ui-solid typography and accessibility beat rasterised text). The renderer
 * is backend-agnostic (pure matrix math + CSS transforms), so it rides over
 * WebGPU untouched; its overlay renders after the pipeline each frame, so
 * DOM and world never separate (the wayfinding-overlay contract).
 *
 * Density follows the zoom tier: family names at overview, group names as
 * the camera dips in, topic names only inside a focused constellation.
 */

import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import * as THREE from 'three/webgpu'
import type { IBGalaxy } from '../types.ts'

/** Camera radii below which each anchor tier's names appear. The default
 * overview sits above both — the first dive reveals the names, and the
 * family ring never renders as a clump of overlapping text. */
const FAMILY_LABEL_RADIUS = 280
const GROUP_LABEL_RADIUS = 175
/** At close zoom, only the groups nearest the camera get names — labelling
 * all 59 at once is noise, and the far side of the disc is unreadable
 * anyway. */
const GROUP_LABEL_LIMIT = 10

interface AnchorLabel {
	node: number
	tier: number
	object: CSS2DObject
}

export interface GalaxyLabels {
	group: THREE.Group
	/** Per-frame visibility pass + overlay render. */
	render(
		scene: THREE.Scene,
		camera: THREE.PerspectiveCamera,
		cameraRadius: number,
		focusedGroup: number,
	): void
	/** Swap the topic-label set when a constellation is entered/left. */
	setFocusTopics(topics: number[]): void
	resize(width: number, height: number): void
	dispose(): void
}

export function createGalaxyLabels(
	host: HTMLElement,
	galaxy: IBGalaxy,
	positions: Float32Array,
	radii: Float32Array,
): GalaxyLabels {
	const renderer = new CSS2DRenderer()
	renderer.setSize(host.clientWidth || 1, host.clientHeight || 1)
	renderer.domElement.className = 'ib-galaxy-labels'
	host.appendChild(renderer.domElement)

	const group = new THREE.Group()
	group.name = 'ib-galaxy:labels'

	const makeLabel = (node: number, tier: number): CSS2DObject => {
		const element = document.createElement('div')
		element.className = 'ib-galaxy-label'
		element.dataset.tier = String(tier)
		element.textContent = galaxy.nodes[node].title
		const object = new CSS2DObject(element)
		// Topic labels sit clear of their PLANET (larger than the star), the
		// anchor tiers just above their glow cores.
		const lift = tier === 0 ? radii[node] * 3.4 + 1.6 : radii[node] * 1.6 + 0.9
		object.position.set(
			positions[node * 3],
			positions[node * 3 + 1],
			positions[node * 3 + 2] + lift,
		)
		object.visible = false
		return object
	}

	const anchors: AnchorLabel[] = []
	galaxy.nodes.forEach((node, i) => {
		if (node.tier === 0) return
		const object = makeLabel(i, node.tier)
		anchors.push({ node: i, tier: node.tier, object })
		group.add(object)
	})
	const hasFamilies = anchors.some((a) => a.tier === 2)

	let topicLabels: CSS2DObject[] = []

	return {
		group,
		setFocusTopics(topics: number[]): void {
			for (const label of topicLabels) {
				group.remove(label)
				label.element.remove()
			}
			topicLabels = topics.map((node) => {
				const object = makeLabel(node, 0)
				group.add(object)
				return object
			})
		},
		render(scene, camera, cameraRadius, focusedGroup): void {
			const constellation = focusedGroup >= 0
			const groupCandidates: Array<{ anchor: AnchorLabel; distSq: number }> = []
			for (const anchor of anchors) {
				if (constellation) {
					anchor.object.visible = anchor.node === focusedGroup
				} else if (anchor.tier === 2) {
					anchor.object.visible = cameraRadius < FAMILY_LABEL_RADIUS
				} else {
					// Two-tier corpora have no families — groups ARE the overview
					// names, so they take the family threshold.
					const within =
						cameraRadius < (hasFamilies ? GROUP_LABEL_RADIUS : FAMILY_LABEL_RADIUS)
					anchor.object.visible = false
					if (within) {
						groupCandidates.push({
							anchor,
							distSq: camera.position.distanceToSquared(anchor.object.position),
						})
					}
				}
			}
			groupCandidates.sort((a, b) => a.distSq - b.distSq)
			for (const { anchor } of groupCandidates.slice(0, GROUP_LABEL_LIMIT)) {
				anchor.object.visible = true
			}
			for (const label of topicLabels) label.visible = constellation
			renderer.render(scene, camera)
		},
		resize(width, height): void {
			renderer.setSize(width, height)
		},
		dispose(): void {
			for (const label of topicLabels) label.element.remove()
			for (const anchor of anchors) anchor.object.element.remove()
			renderer.domElement.remove()
		},
	}
}
