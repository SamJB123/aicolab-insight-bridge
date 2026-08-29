/**
 * Labels — the galaxy's binding over kolo's wayfinding overlay (adopted
 * 2026-08-16, replacing CSS2DRenderer): projected DOM markers with the
 * battle-tested space-aware collapse (overlapping labels structurally
 * impossible — losers collapse to a remnant and reveal on hover/focus),
 * multi-line balanced plaques, and REAL buttons — labels participate in the
 * one interaction grammar (click = the drill-row action, hover = the scene
 * highlight sync).
 *
 * EVERY tier gets the full pin (revised 2026-08-16 after runtime testing —
 * the pin's collapse-to-face answers crowding by design, where the plaque
 * anatomy's dot remnant merely hid labels): leader pole + faceted face
 * carrying the tier's icon, echoing the navigation's own mode icons
 * (family ❂ · supercluster ✷ · topic ✦ · source ◍). Accents: anchor tiers
 * and topics ride the arm hue the nebulae resolved; SOURCES ride the active
 * facet lens colour (the engine re-issues the set on lens switches).
 *
 * WHICH nodes are labelled stays the engine's policy (the drill level's
 * children) — this module renders exactly the set it is given.
 */

import {
	mountWayfindingOverlay,
	type WayfindingTarget,
} from '@aicolab/kolo/rendering/wayfinding-overlay'
import '@aicolab/kolo/rendering/wayfinding-overlay.css'
import type * as THREE from 'three/webgpu'
import type { IBGalaxy } from '../types.ts'
import { at } from './at.ts'

export interface GalaxyLabelsOptions {
	/** Marker accent for a node under the given colour-by lens. The lens
	 * arrives AS DATA from the projection's compute (Solid's split-effect
	 * contract) — never read ambiently here. */
	accentOf(node: number, lens: string | undefined): string
	/** Label press — routed like the matching drill row. */
	onSelect(node: number): void
	/** Label hover — the chrome-highlight sync (-1 clears). */
	onHover(node: number): void
}

export interface GalaxyLabels {
	/** Declare the EXACT set of labelled nodes (indices into galaxy.nodes)
	 * with the active colour-by lens for accent resolution. */
	setLabels(nodes: number[], lens: string | undefined): void
	/** Projection + collapse pass; call once per rendered frame. */
	update(camera: THREE.Camera): void
	dispose(): void
}

/** Tier icons for the pin faces (settled 2026-08-16): leaves echo the
 * navigation's mode icons; anchors carry heavier marks (◈ kept for
 * families by user call). */
const TIER_FACE: Record<number, string> = { 2: '◈', 1: '✷', 0: '✦', [-1]: '◍' }

export function createGalaxyLabels(
	host: HTMLElement,
	galaxy: IBGalaxy,
	positions: Float32Array,
	options: GalaxyLabelsOptions,
): GalaxyLabels {
	const overlay = mountWayfindingOverlay(host, {
		onSelect: (id) => options.onSelect(Number(id)),
		onHover: (id) => options.onHover(id === null ? -1 : Number(id)),
	})

	const weightLabelFor = (tier: number): string =>
		galaxy.tiers.find((meta) => meta.tier === tier)?.weightLabel ?? galaxy.weightLabel

	return {
		setLabels(nodes: number[], lens: string | undefined): void {
			overlay.setTargets(
				nodes.map((node): WayfindingTarget => {
					const entry = at(galaxy.nodes, node)
					// NO world-space lift (removed 2026-08-16, a CSS2D-era
					// holdover): the pin's POLE does the elevating — its foot
					// belongs exactly at the node.
					return {
						id: String(node),
						label: entry.title,
						detail: `${entry.weight} ${weightLabelFor(entry.tier)}`,
						accent: options.accentOf(node, lens),
						anatomy: 'pin',
						faceMarkup: `<span class="kolo-wayfinding__fallback" aria-hidden="true">${TIER_FACE[entry.tier] ?? '✦'}</span>`,
						world: {
							x: at(positions, node * 3),
							y: at(positions, node * 3 + 1),
							z: at(positions, node * 3 + 2),
						},
					}
				}),
			)
		},
		update(camera): void {
			overlay.update(camera)
		},
		dispose(): void {
			overlay.dispose()
		},
	}
}
