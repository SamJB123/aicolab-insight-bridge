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
	/** Selective bloom in the post chain. */
	bloom: boolean
	/** The whole PostProcessing pipeline; false renders the scene raw
	 * (diagnosis only — the nebula composites through post, so it vanishes
	 * with it). */
	post: boolean
	/** Renderer logarithmic depth (construction option). */
	logDepth: boolean
	/** The effect-shedding governor (diagnosis turns it off so pinned
	 * measurements stay pinned). */
	governor: boolean
	/** Diagnosis: apply this shed level immediately at startup (replicates
	 * the exact runtime state the governor reaches, construction options
	 * untouched). */
	shedStart: number
	/** Multiplier on the star/dust sprite glow extents (quad size relative
	 * to the node radius). Overdraw scales with its SQUARE — the diagnostic
	 * knob for the small-cores-plus-bloom experiment. */
	glowScale: number
	/** Diagnosis: the deep-space backdrop (star dome + nebula billboards). */
	backdrop: boolean
	/** Diagnosis: the procedural screen-gradient scene background. */
	background: boolean
	/** Render the anamorphic streak loop into a quarter-res target (three's
	 * own webgpu_postprocessing_anamorphic technique) — ~1/16th the loop
	 * executions; the soft streak hides the upsample. DEFAULT since
	 * 2026-08-17 (user A/B: indistinguishable, 246→147ms on the weak-GPU
	 * bench); `?ibq=streaklo:0` restores the full-res loop. */
	streakQuarterRes: boolean
	/** Analytic in-material edge coverage (fwidth smoothstep on
	 * ribbons/whiskers, fresnel rim on planets) instead of 4×MSAA — when
	 * on, msaa is forced off. DEFAULT since 2026-08-17 (user A/B:
	 * indistinguishable, 246→161ms alone, 80ms combined with the quarter-
	 * res streak); `?ibq=aa:0` restores MSAA. */
	analyticAA: boolean
	dprFloor: number
	dprCeiling: number
}

/** Diagnostic overrides from the URL, for perf triage on real devices:
 * `?ibq=nebula:0,anamorphic:0,msaa:0,bloom:0,post:0,logdepth:0,steps:4,dpr:1`
 * — each key optional. Read once per resolve; absent or malformed entries
 * change nothing. */
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
		if (key === 'bloom') out.bloom = value !== '0'
		if (key === 'post') out.post = value !== '0'
		if (key === 'logdepth') out.logDepth = value !== '0'
		if (key === 'governor') out.governor = value !== '0'
		if (key === 'shed') {
			const level = Number(value)
			if (Number.isFinite(level) && level >= 0) out.shedStart = level
		}
		if (key === 'glow') {
			const scale = Number(value)
			if (Number.isFinite(scale) && scale > 0) out.glowScale = scale
		}
		if (key === 'backdrop') out.backdrop = value !== '0'
		if (key === 'bg') out.background = value !== '0'
		if (key === 'streaklo') out.streakQuarterRes = value !== '0'
		if (key === 'aa') out.analyticAA = value !== '0'
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
				bloom: true,
				post: true,
				logDepth: true,
				governor: true,
				shedStart: 0,
				glowScale: 1,
				backdrop: true,
				background: true,
				streakQuarterRes: true,
				analyticAA: true,
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
				bloom: true,
				post: true,
				logDepth: true,
				governor: true,
				shedStart: 0,
				glowScale: 1,
				backdrop: true,
				background: true,
				streakQuarterRes: true,
				analyticAA: true,
				dprFloor: 1,
				dprCeiling: Math.min(devicePixelRatio, 2),
			}
	const merged = { ...tier, ...qualityOverrides() }
	// Analytic AA replaces MSAA — the whole point is dropping the 4× sample
	// cost, and three's own smooth-edge branches key off samples anyway.
	if (merged.analyticAA) merged.msaa = false
	return merged
}
