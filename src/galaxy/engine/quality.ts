/**
 * Quality tiers — full cinematic on desktop, a leaner ladder on coarse
 * pointers (settled 2026-08-14: "full cinematic, adaptive"). The static tier
 * choice pairs with kolo's adaptive-DPR monitor at runtime: mobile starts at
 * DPR 1 and climbs only if the device sustains frame rate.
 */

export interface GalaxyQuality {
	nebula: boolean
	nebulaSteps: number
	anamorphic: boolean
	lensflare: boolean
	dprFloor: number
	dprCeiling: number
}

export function resolveGalaxyQuality(coarsePointer: boolean): GalaxyQuality {
	// Step counts assume the dithered march + quarter-res fog pass (settled
	// 2026-08-15): bayer jitter + the gaussian composite make 4–8 steps read
	// like the old 12–28.
	return coarsePointer
		? {
				nebula: true,
				nebulaSteps: 4,
				anamorphic: false,
				lensflare: false,
				dprFloor: 1,
				dprCeiling: 1.5,
			}
		: {
				nebula: true,
				nebulaSteps: 8,
				anamorphic: true,
				// OFF (user call 2026-08-15): its ghost samples mirror bright
				// grains across the screen centre — they read as displaced
				// "ghost grains" that wander with the view angle.
				lensflare: false,
				dprFloor: 1,
				dprCeiling: Math.min(devicePixelRatio, 2),
			}
}
