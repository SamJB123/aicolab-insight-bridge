// A report's island as a HEX ISLAND (@aicolab/atlas hex-island.ts; settled
// 2026-10-28): its sections, in the order its door lists them — the order
// the host's map lays them in — each at the centre of the cell the map
// gives it. The overview is the island itself, its square; the galaxy is
// the sky table the report draws, standing in the galaxy's own cell; every
// other section is the kit's building for it (sections.ts). What the report
// says of its island beyond that is its specification (the atlas's one
// definition, hex-island-spec.ts), declared by the report's own app on its
// report host and served through its door; a report that says nothing
// stands the default.
//
// Worker-safe: content only.

import { islandDepth, worldCentre } from '@aicolab/atlas/chart/chart-data.ts'
import {
	type DestinationIslandOptions,
	declareDestinationIsland,
} from '@aicolab/atlas/chessboard/content/island/destination-islands.ts'
import {
	type HexIsland,
	type HexIslandPlace,
	hexIsland,
} from '@aicolab/atlas/chessboard/content/island/hex-island.ts'
import {
	DEFAULT_HEX_ISLAND_SPEC,
	type HexIslandSpec,
} from '@aicolab/atlas/chessboard/content/island/hex-island-spec.ts'
import { programKey } from '@aicolab/atlas/chessboard/content/island/programs.ts'
import {
	type RealisedIsland,
	realiseIsland,
} from '@aicolab/atlas/chessboard/content/island/realise.ts'
import type { IslandDocument } from '@aicolab/kolo/island'
import type { HexPoint } from '@aicolab/kolo/spatial/hex'
import type { WorldRecord } from '../world/index.ts'
import type { ReportIsland } from './registry.ts'
import { DEFAULT_SECTIONS, FORM_OF, type ReportSectionEntry, sectionsOf } from './sections.ts'
import {
	REPORT_OWNER,
	SKY_TABLE_ID,
	SKY_TABLE_RADIUS,
	SKY_TABLE_WORDS,
	starsOf,
} from './sky-table.ts'

/** How a report island is declared beyond what it lays: the report draws
 *  what the kit does not (its sky table), in the toolkit's own look, its
 *  shore and its biome what its specification says. */
export const reportIslandOptions = (
	laid: Pick<HexIsland, 'shore' | 'biome'>,
): DestinationIslandOptions => ({
	owner: REPORT_OWNER,
	ownsLook: false,
	shore: laid.shore,
	biome: laid.biome,
})

/** The report's places, in its door's order: the galaxy the sky table its
 *  owner draws, told the record's stars; each section the island has a
 *  form for the kit's building for it. The overview, the island itself, is
 *  no place of its own. Every one is a place the host's tree and map list,
 *  so its name shows always in the world: a visitor sees at a glance which
 *  thing there is which place there. */
export function reportPlaces(
	record: WorldRecord | null,
	sections: readonly ReportSectionEntry[] = DEFAULT_SECTIONS(record),
): HexIslandPlace[] {
	const built = new Map(sectionsOf(record, sections).map((s) => [s.id, s]))
	const stars = starsOf(record).map((star) => ({ ...star }))
	return sections.flatMap((entry): HexIslandPlace[] => {
		if (entry.section === 'galaxy') {
			return [
				{
					id: entry.id,
					label: entry.label,
					description: SKY_TABLE_WORDS.description,
					stands: {
						drawn: SKY_TABLE_ID,
						told: { radius: SKY_TABLE_RADIUS, stars },
						radius: SKY_TABLE_RADIUS,
					},
					nameShown: 'always',
				},
			]
		}
		const section = built.get(entry.id)
		return section
			? [
					{
						id: section.id,
						label: section.label,
						description: section.description,
						stands: { kit: FORM_OF[section.kind] },
						nameShown: 'always',
					},
				]
			: []
	})
}

/** The report's island laid: its places on the map's cells, as deep as its
 *  place stands in the host's tree, as its specification says. */
export function reportHexIsland(
	record: WorldRecord | null,
	island: ReportIsland,
	sections?: readonly ReportSectionEntry[] | null,
	spec?: HexIslandSpec | null,
): HexIsland {
	return hexIsland({
		key: island.slug,
		label: record?.site.title ?? island.corpus.name,
		description: island.corpus.blurb,
		places: reportPlaces(record, sections ?? undefined),
		depth: islandDepth(programKey(island.slug)),
		spec: spec ?? DEFAULT_HEX_ISLAND_SPEC,
	})
}

/** The report's island declared, at its own cell unless told where. */
export function reportHexDeclaration(
	record: WorldRecord | null,
	island: ReportIsland,
	sections?: readonly ReportSectionEntry[] | null,
	spec?: HexIslandSpec | null,
	writtenAt: HexPoint = worldCentre(programKey(island.slug)),
): IslandDocument {
	const hex = reportHexIsland(record, island, sections, spec)
	return declareDestinationIsland(island.slug, hex.destination, reportIslandOptions(hex), writtenAt)
}

/** The report's island realised: the plan its world and its scenes are
 *  built from. */
export const realiseReportHex = (
	record: WorldRecord | null,
	island: ReportIsland,
	sections?: readonly ReportSectionEntry[] | null,
	spec?: HexIslandSpec | null,
): RealisedIsland => realiseIsland(reportHexDeclaration(record, island, sections, spec))
