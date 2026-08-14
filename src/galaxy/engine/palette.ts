/**
 * Host-token palette for the engine. The 3D scene may not hardcode corpus
 * colours: the temperature ramp reads the host's --s1…--s5 heat scale (the
 * same ramp its 2D charts use) off the stage's computed style — the audit
 * explorer's getComputedStyle pattern — with neutral fallbacks for hosts
 * that don't define them. The void colour is the one authored literal,
 * declared in galaxy-map.css (`--ib-galaxy-void`) and read back here so CSS
 * frame and rendered background can never disagree.
 *
 * Values must parse via THREE.Color.setStyle (hex/rgb/hsl). Unparseable or
 * unresolved values (e.g. a raw `light-dark(…)` token string) fall back.
 */

import * as THREE from 'three/webgpu'

export interface GalaxyPalette {
	/** Cold→hot heat ramp, --s1…--s5. */
	ramp: [THREE.Color, THREE.Color, THREE.Color, THREE.Color, THREE.Color]
	/** The deep-space ground, --ib-galaxy-void. */
	voidColor: THREE.Color
}

const FALLBACK_RAMP = ['#88a37c', '#b9c27a', '#e0a94e', '#c96f3a', '#8e3b2e'] as const
const FALLBACK_VOID = '#0e1220'

/** setStyle accepts these prefixes; anything else (custom-property soup,
 * light-dark(), empty string) takes the fallback. */
const PARSEABLE = /^(#|rgb|hsl)/

function readColor(styles: CSSStyleDeclaration, token: string, fallback: string): THREE.Color {
	const value = styles.getPropertyValue(token).trim()
	return new THREE.Color(PARSEABLE.test(value) ? value : fallback)
}

export function readGalaxyPalette(host: HTMLElement): GalaxyPalette {
	const styles = getComputedStyle(host)
	return {
		ramp: [
			readColor(styles, '--s1', FALLBACK_RAMP[0]),
			readColor(styles, '--s2', FALLBACK_RAMP[1]),
			readColor(styles, '--s3', FALLBACK_RAMP[2]),
			readColor(styles, '--s4', FALLBACK_RAMP[3]),
			readColor(styles, '--s5', FALLBACK_RAMP[4]),
		],
		voidColor: readColor(styles, '--ib-galaxy-void', FALLBACK_VOID),
	}
}
