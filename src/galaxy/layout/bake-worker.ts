/**
 * Module worker: runs the d3-force layout bake off the main thread. The
 * 300-tick simulation is ~1s of solid CPU on a fast machine and 7s+ on a
 * weak one — inline it froze the page through first paint (measured
 * 2026-08-17, one 7.6s long task at 6× CPU throttle).
 */
import type { IBGalaxy } from '../types.ts'
import { bakeGalaxyLayout, type CosmosBakeOptions } from './cosmos.ts'

export interface BakeRequest {
	galaxy: IBGalaxy
	options: CosmosBakeOptions
}

export interface BakeResponse {
	positions: Float32Array
	radii: Float32Array
	nicheThreshold: number
}

self.onmessage = (event: MessageEvent<BakeRequest>) => {
	const { galaxy, options } = event.data
	const layout = bakeGalaxyLayout(galaxy, options)
	const response: BakeResponse = {
		positions: layout.positions,
		radii: layout.radii,
		nicheThreshold: layout.nicheThreshold,
	}
	postMessage(response, { transfer: [layout.positions.buffer, layout.radii.buffer] })
}
