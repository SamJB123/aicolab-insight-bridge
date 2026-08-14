/**
 * Facet palette — deterministic categorical colours for the source-dust
 * lenses (settled 2026-08-14: the package GENERATES them; hosts don't ship
 * palettes). A golden-angle hue walk in HSL, tuned for dust on the dark
 * void: saturated enough to tell apart, dim enough to stay dust. Pure math
 * (hex strings) so the chrome legend and the engine share one source of
 * truth without either importing three.js.
 */

import type { IBGalaxy } from './types.ts'

const GOLDEN_TURN = 0.6180339887498949

function hslToHex(h: number, s: number, l: number): string {
	const k = (n: number) => (n + h * 12) % 12
	const a = s * Math.min(l, 1 - l)
	const channel = (n: number) => {
		const value = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
		return Math.round(value * 255)
			.toString(16)
			.padStart(2, '0')
	}
	return `#${channel(0)}${channel(8)}${channel(4)}`
}

/** Value → colour for one facet's values, in first-seen order. */
export function facetPalette(values: readonly string[]): Map<string, string> {
	const palette = new Map<string, string>()
	values.forEach((value, i) => {
		const hue = (0.09 + i * GOLDEN_TURN) % 1
		palette.set(value, hslToHex(hue, 0.58, 0.66))
	})
	return palette
}

/** The distinct values of a facet across a galaxy's sources, stable order
 * (first appearance in node order). */
export function facetValues(galaxy: IBGalaxy, facetKey: string): string[] {
	const seen = new Set<string>()
	const values: string[] = []
	for (const node of galaxy.nodes) {
		if (node.tier !== -1) continue
		const value = node.facets?.[facetKey]
		if (value !== undefined && !seen.has(value)) {
			seen.add(value)
			values.push(value)
		}
	}
	return values
}
