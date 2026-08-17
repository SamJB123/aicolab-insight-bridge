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
	/** Renderer MSAA (antialias: true at construction). */
	msaa: boolean
	dprFloor: number
	dprCeiling: number
}

/** Diagnostic overrides from the URL, for perf triage on real devices:
 * `?ibq=nebula:0,anamorphic:0,msaa:0,steps:4,dpr:1` — each key optional.
 * Read once per resolve; absent or malformed entries change nothing. */
function qualityOverrides(): Partial<GalaxyQuality> {
	if (typeof location === 'undefined') return {}
	const raw = new URLSearchParams(location.search).get('ibq')
	if (!raw) return {}
	const out: Partial<GalaxyQuality> = {}
	for (const entry of raw.split(',')) {
		const [key, value] = entry.split(':')
		if (value === undefined) continue
		if (key === 'nebula') out.nebula = value !== '0'
		if (key === 'anamorphic') out.anamorphic = value !== '0'
		if (key === 'msaa') out.msaa = value !== '0'
		if (key === 'steps') {
			const steps = Number(value)
			if (Number.isFinite(steps) && steps > 0) out.nebulaSteps = steps
		}
		if (key === 'dpr') {
			const dpr = Number(value)
			if (Number.isFinite(dpr) && dpr > 0) {
				out.dprFloor = dpr
				out.dprCeiling = dpr
			}
		}
	}
	return out
}

export function resolveGalaxyQuality(coarsePointer: boolean): GalaxyQuality {
	// Step counts assume the dithered march + quarter-res fog pass (settled
	// 2026-08-15): bayer jitter + the gaussian composite make 4–8 steps read
	// like the old 12–28.
	const tier: GalaxyQuality = coarsePointer
		? {
				nebula: true,
				nebulaSteps: 4,
				anamorphic: false,
				lensflare: false,
				msaa: true,
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
				msaa: true,
				dprFloor: 1,
				dprCeiling: Math.min(devicePixelRatio, 2),
			}
	return { ...tier, ...qualityOverrides() }
}
