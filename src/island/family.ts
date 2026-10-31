// The Insight Bridge FAMILY as a space (settled 2026-10-31, all the way up;
// one cell size at every level): an ISLAND of its own (@aicolab/atlas
// hex-island.ts) on the one honeycomb every space lays on, held open by
// whatever host holds it (the hub's root), that holds its reports OPEN —
// one place each on its first ring, at the ring's corners in the registry's
// order from north clockwise, so each report's island is placed out along
// that bearing on its own patch of the same honeycomb (never inside a cell
// of the family's) — each reached from the family's square by FERRY over the
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
	type HexCorner,
	type HexSpaceSpecInput,
	hexCornerSchema,
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

/** The ring the reports' places stand on: the first, round the square — the
 *  bearing each report's island is placed out along. */
export const REPORT_RING = 1

/** The six corners of a ring, north first and clockwise: the registry's
 *  order goes round the family the same way. */
const CORNERS = hexCornerSchema.options

/** The corner a report's place stands at, by its place in the registry. */
export function cornerOfReport(index: number): HexCorner {
	const corner = CORNERS[index]
	if (!corner) {
		throw new Error(`[insight-bridge] a seventh report has no corner of the ring to stand at`)
	}
	return corner
}

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

/** Where each report's place stands: at its corner of the first ring, its
 *  way crossing the water by ferry. */
export const familySpec = (): HexSpaceSpecInput => ({
	places: Object.fromEntries(
		REPORT_APPLETS.map((applet, i) => [
			applet.id,
			{ cell: { ring: REPORT_RING, corner: cornerOfReport(i) }, path: { crossing: 'ferry' } },
		]),
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
