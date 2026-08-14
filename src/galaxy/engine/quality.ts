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
	return coarsePointer
		? {
				nebula: true,
				nebulaSteps: 12,
				anamorphic: false,
				lensflare: false,
				dprFloor: 1,
				dprCeiling: 1.5,
			}
		: {
				nebula: true,
				nebulaSteps: 28,
				anamorphic: true,
				lensflare: true,
				dprFloor: 1,
				dprCeiling: Math.min(devicePixelRatio, 2),
			}
}
