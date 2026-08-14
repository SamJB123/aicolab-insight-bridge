/**
 * @aicolab/insight-bridge/galaxy — the Insight Galaxy: one 3D dashboard
 * organism serving every corpus explorer.
 *
 * Deliberately a SEPARATE subpath from the package root: this entry (from
 * phase 2) reaches three.js and kolo's WebGPU modules, and the root barrel
 * must stay light enough for the attribution mark. Hosts import:
 *
 *   import { GalaxyMap, type IBGalaxy } from '@aicolab/insight-bridge/galaxy'
 *
 * build an `IBGalaxy` from their landscape queries (a ~20-line adapter), and
 * wire `onSelect` into their existing drawers. `probeWebGpu` is re-exported
 * for hosts that want to gate navigation items, not just the stage.
 */

export { probeWebGpu } from '@aicolab/kolo/webgpu/backend-guard'
export { createGalaxyAdapter, type GalaxyConfiguration } from './adapter.ts'
export { GalaxyGatePanel, type GalaxyGatePanelProps } from './chrome/gate-panel.tsx'
export {
	buildFixtureContent,
	buildFixtureGalaxy,
	FIXTURE_MIX_COLORS,
	FIXTURE_MIX_ORDER,
	type FixtureGalaxyOptions,
} from './fixture.ts'
export { GalaxyMap, type GalaxyMapProps } from './GalaxyMap.tsx'
export {
	bakeGalaxyLayout,
	type GalaxyBakeOptions,
	relaxGalaxyLayout,
} from './layout/bake.ts'
export {
	type GalaxyLayout,
	type GalaxyLayoutOptions,
	primaryParents,
	seedGalaxyLayout,
} from './layout/spiral-seed.ts'
export type {
	GalaxyCommand,
	GalaxyEvents,
	IBContentSection,
	IBEdge,
	IBEntityRow,
	IBFacetRow,
	IBFlag,
	IBGalaxy,
	IBNode,
	IBNodeContent,
	IBNodeId,
	IBPoint,
	IBQuote,
	IBTier,
	IBTierMeta,
} from './types.ts'
