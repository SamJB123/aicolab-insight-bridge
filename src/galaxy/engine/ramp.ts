/**
 * The heat ramp as a TSL expression — one definition shared by stars
 * (stellar temperature) and planets (climate), so the two LODs of a node can
 * never disagree about what its intensity looks like. Colours arrive as
 * uniforms, so a live palette change could rewrite them without a rebuild.
 */

import { mix, smoothstep, uniform } from 'three/tsl'
import type { Node } from 'three/webgpu'
import type * as THREE from 'three/webgpu'

export function heatRamp(
	t: Node<'float'>,
	ramp: readonly [THREE.Color, THREE.Color, THREE.Color, THREE.Color, THREE.Color],
) {
	return mix(
		mix(
			mix(
				mix(uniform(ramp[0]), uniform(ramp[1]), smoothstep(0.0, 0.25, t)),
				uniform(ramp[2]),
				smoothstep(0.25, 0.5, t),
			),
			uniform(ramp[3]),
			smoothstep(0.5, 0.75, t),
		),
		uniform(ramp[4]),
		smoothstep(0.75, 1.0, t),
	)
}
