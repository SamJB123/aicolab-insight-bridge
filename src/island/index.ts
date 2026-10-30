// An Insight Bridge report as an ISLAND of a host's world (@aicolab/atlas):
// the content half — the registry of report islands, the sections their
// buildings are, the report's hex island laid on its map's cells with the
// sky table in the galaxy's cell, the world of rooms built from the record,
// the island program a host registers, and the FAMILY that berths every
// report (family.ts). Worker-safe: a host's scope (evaluated by its server)
// reads it. The scenes and the setup — the browser's — are `./setup`
// (solid/setup.tsx).

export {
	cornerOfReport,
	FAMILY_REACH,
	FAMILY_SPACING,
	familyHexIsland,
	familyPlaces,
	familySpec,
	insightBridgeProgram,
	REPORT_RING,
} from './family.ts'
export {
	realiseReportHex,
	reportHexDeclaration,
	reportHexIsland,
	reportIslandOptions,
	reportPlaces,
} from './hex-island.ts'
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
export {
	entersBuilding,
	holdsRooms,
	type ReportSection,
	type ReportSectionEntry,
	type ReportSectionKind,
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
