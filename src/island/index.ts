// An Insight Bridge report as an ISLAND of a host's archipelago
// (@aicolab/atlas): the content half — the registry of report islands,
// the sections their buildings are, the report's hex island laid on its
// map's cells with the sky table in the galaxy's cell, the square island
// it was first built as (its oracle) in every form the atlas composes it,
// the declarations, the scene document, the world of rooms built from the
// record, and the island program a host registers with the chart. Worker-safe: a host's
// scope (evaluated by its server) reads it. The scenes and the setup —
// the browser's — are `./setup` (solid/setup.tsx).

export { declareReportIsland, reportDeclaration } from './declaration.ts'
export {
	REPORT_ISLAND_OPTIONS,
	realiseReportHex,
	reportHexDeclaration,
	reportHexIsland,
	reportPlaces,
} from './hex-island.ts'
export {
	hexReportIslandPlan,
	type IslandPlanOf,
	islandPlanOfReport,
	type ReportIslandPlan,
	realiseReportIsland,
	reportIslandInput,
	reportIslandPlan,
} from './plan.ts'
export {
	type ReportContent,
	reportIslandProgram,
	reportReading,
	reportTextsOf,
} from './program.ts'
export {
	isReportSlug,
	REPORT_ISLANDS,
	type ReportIsland,
	type ReportSlug,
	reportIsland,
	reportIslandOfRoom,
	TRAINING_DATA,
} from './registry.ts'
export { type IslandSceneOf, reportIslandDocument } from './scene-document.ts'
export {
	entersBuilding,
	holdsRooms,
	type ReportSection,
	type ReportSectionEntry,
	type ReportSectionKind,
	reportIslandSpec,
	sectionIdOfBuilding,
	sectionOfBuilding,
	sectionsOf,
} from './sections.ts'
export {
	REPORT_OWNER,
	SKY_TABLE_ID,
	SKY_TABLE_RADIUS,
	type SkyStar,
	starsOf,
} from './sky-table.ts'
export { createReportTexts, type ReportTexts } from './texts.ts'
export {
	buildingLabel,
	buildReportWorld,
	itemWithText,
	mapOf,
	type ReportItem,
	type ReportRoomBuild,
	type ReportScope,
	type ReportWorldBuild,
	relatedRooms,
	scopeOfRoom,
} from './world.ts'
