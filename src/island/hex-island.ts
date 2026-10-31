// A report's island as a HEX ISLAND (@aicolab/atlas hex-island.ts; settled
// 2026-10-28): its sections, in the order its door lists them — the order
// the host's map lays them in — each at the centre of the cell the map
// gives it. The overview is the island itself, its square; the galaxy is
// the sky table the report draws, standing in the galaxy's own cell; every
// other section is the kit's building for it (sections.ts). What the report
// says of its island beyond that is its specification (the atlas's one
// definition, hex-space-spec.ts), declared by the report's own app on its
// report host and served through its door; a report that says nothing
// stands the default. The island is written WHERE ITS HOLDER SAYS (the
// family that holds it open: atlas programs.ts Where), on the one honeycomb
// at the holder's own turn, its way in facing its holder.
//
// Worker-safe: content only.

import {
	type DestinationSpaceOptions,
	declareDestinationSpace,
	laidSpaceOptions,
} from '@aicolab/atlas/chessboard/content/space/destination-spaces.ts'
import { hexIsland } from '@aicolab/atlas/chessboard/content/space/hex-island.ts'
import type { HexSpace, HexSpacePlace } from '@aicolab/atlas/chessboard/content/space/hex-space.ts'
import {
	DEFAULT_HEX_SPACE_SPEC,
	type HexSpaceSpec,
} from '@aicolab/atlas/chessboard/content/space/hex-space-spec.ts'
import { TOP_WHERE, type Where } from '@aicolab/atlas/chessboard/content/space/programs.ts'
import {
	type RealisedSpace,
	realiseSpace,
} from '@aicolab/atlas/chessboard/content/space/realise.ts'
import type { SpaceDocument } from '@aicolab/kolo/space'
import type { WorldRecord } from '../world/index.ts'
import type { ReportIsland } from './registry.ts'
import {
	DEFAULT_SECTIONS,
	FORM_OF,
	frontDoorPinOf,
	frontRoomOf,
	type ReportSectionEntry,
	sectionsOf,
} from './sections.ts'
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
export const reportIslandOptions = (laid: HexSpace): DestinationSpaceOptions => ({
	owner: REPORT_OWNER,
	ownsLook: false,
	...laidSpaceOptions(laid),
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
): HexSpacePlace[] {
	const built = new Map(sectionsOf(record, sections).map((s) => [s.id, s]))
	const stars = starsOf(record).map((star) => ({ ...star }))
	return sections.flatMap((entry): HexSpacePlace[] => {
		if (entry.section === 'galaxy') {
			return [
				{
					id: entry.id,
					label: entry.label,
					description: SKY_TABLE_WORDS.description,
					stands: {
						kind: 'model',
						model: SKY_TABLE_ID,
						told: { radius: SKY_TABLE_RADIUS, stars },
						radius: SKY_TABLE_RADIUS,
					},
					nameShown: 'always',
				},
			]
		}
		const section = built.get(entry.id)
		if (!section) return []
		// A section with rooms behind its door: the door leads into its front
		// room — once the record is read; the island alone has no rooms.
		const front = record ? frontRoomOf(section) : null
		return [
			{
				id: section.id,
				label: section.label,
				description: section.description,
				stands: { kind: 'model', model: FORM_OF[section.kind] },
				nameShown: 'always',
				...(front ? { exit: { space: front, entry: frontDoorPinOf(section.id) } } : {}),
			},
		]
	})
}

/** The report's island laid: its places on the map's cells, as deep as its
 *  holder says it stands, as its specification says. */
export function reportHexIsland(
	record: WorldRecord | null,
	island: ReportIsland,
	sections?: readonly ReportSectionEntry[] | null,
	spec?: HexSpaceSpec | null,
	where: Where = TOP_WHERE,
): HexSpace {
	return hexIsland({
		key: island.slug,
		label: record?.site.title ?? island.corpus.name,
		description: island.corpus.blurb,
		places: reportPlaces(record, sections ?? undefined),
		depth: where.depth,
		spec: spec ?? DEFAULT_HEX_SPACE_SPEC,
		...(where.heldOpen ? { heldOpen: where.heldOpen } : {}),
	})
}

/** The report's island declared, written where its holder says (alone, a
 *  top: at the origin). */
export function reportHexDeclaration(
	record: WorldRecord | null,
	island: ReportIsland,
	sections?: readonly ReportSectionEntry[] | null,
	spec?: HexSpaceSpec | null,
	where: Where = TOP_WHERE,
): SpaceDocument {
	const hex = reportHexIsland(record, island, sections, spec, where)
	return declareDestinationSpace(island.slug, hex.destination, reportIslandOptions(hex), where.at)
}

/** The report's island realised: the plan its world and its scenes are
 *  built from. */
export const realiseReportHex = (
	record: WorldRecord | null,
	island: ReportIsland,
	sections?: readonly ReportSectionEntry[] | null,
	spec?: HexSpaceSpec | null,
	where: Where = TOP_WHERE,
): RealisedSpace => realiseSpace(reportHexDeclaration(record, island, sections, spec, where))
