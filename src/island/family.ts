// The Insight Bridge FAMILY as a space (settled 2026-10-31, all the way up;
// one cell size at every level): an ISLAND of its own (@aicolab/atlas
// hex-island.ts) on the one honeycomb every space lays on, held open by
// whatever host holds it (the hub's root), that holds its reports OPEN —
// one place each in the registry's order, so each report's island is placed
// out along its place's bearing on its own patch of the same honeycomb
// (never inside a cell of the family's): round its square from north
// clockwise where nothing holds the family open; held open, in its GROUP
// beyond its far shore (settled 2026-11-01, the holder at the edge: the
// first report the middle, straight out, the rest round it nearest the
// family first) — each reached from the family's square by FERRY over the
// water between, the family's way running to the end of the report's pier.
// Its places are the reports; each report's island is declared by the
// report's program where the family places it (@aicolab/atlas
// places-program.ts, open-programs.ts). Nothing about a report is written
// here: its name and its words are the registry's, its island its own.
//
// Worker-safe: content only.

import { hexIsland } from '@aicolab/atlas/chessboard/content/space/hex-island.ts'
import type { HexSpace, HexSpacePlace } from '@aicolab/atlas/chessboard/content/space/hex-space.ts'
import {
	type HexSpaceSpecInput,
	hexSpaceSpecSchema,
} from '@aicolab/atlas/chessboard/content/space/hex-space-spec.ts'
import { heldPatches } from '@aicolab/atlas/chessboard/content/space/open-programs.ts'
import { placesProgram } from '@aicolab/atlas/chessboard/content/space/places-program.ts'
import {
	type SpaceProgram,
	TOP_WHERE,
	type Where,
} from '@aicolab/atlas/chessboard/content/space/programs.ts'
import { INSIGHT_BRIDGE_APPLET, REPORT_APPLETS } from '../applets.ts'
import { REPORT_OWNER } from './sky-table.ts'

/** The family's places: a space per report, in the registry's order. */
export const familyPlaces = (): HexSpacePlace[] =>
	REPORT_APPLETS.map(
		(applet): HexSpacePlace => ({
			id: applet.id,
			label: applet.label,
			description: applet.blurb ?? '',
			stands: { kind: 'space' },
		}),
	)

/** How each report's place is reached: its way crossing the water by
 *  ferry. Where it stands is the lay's (the registry's order). */
export const familySpec = (): HexSpaceSpecInput => ({
	places: Object.fromEntries(
		REPORT_APPLETS.map((applet) => [applet.id, { path: { crossing: 'ferry' } }]),
	),
})

/** The family laid where its holder says (alone, a top): the cell each
 *  report's place takes, and where each report's island is placed — read
 *  from the report programs the host registered. */
export const familyHexIsland = (where: Where = TOP_WHERE): HexSpace =>
	hexIsland({
		key: INSIGHT_BRIDGE_APPLET.id,
		label: INSIGHT_BRIDGE_APPLET.label,
		places: familyPlaces(),
		depth: where.depth,
		spec: hexSpaceSpecSchema.parse(familySpec()),
		...(where.heldOpen ? { heldOpen: where.heldOpen } : {}),
		held: heldPatches(where),
	})

/** The family as a space program. */
export function insightBridgeProgram(): SpaceProgram {
	return placesProgram({
		key: INSIGHT_BRIDGE_APPLET.id,
		label: INSIGHT_BRIDGE_APPLET.label,
		description: 'The reports of the Insight Bridge, one island each, round the family’s square.',
		places: familyPlaces(),
		spec: familySpec(),
		lay: hexIsland,
		owner: REPORT_OWNER,
	})
}
