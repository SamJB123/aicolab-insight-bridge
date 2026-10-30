// The Insight Bridge FAMILY as a space (settled 2026-10-31, all the way up):
// OPEN WATER of its own (@aicolab/atlas hex-open-water.ts: a square on its
// own ground, each report on its own cell, water between), berthed by
// whatever host holds it (the hub's root), that BERTHS its reports — one
// cell each on its first ring, at the ring's corners in the registry's order
// from north clockwise — each reached from the family's square by FERRY over
// the water between (grown land would run from the square to a first-ring
// cell's edge, and a crossing is laid only where a way crosses water). Its
// places are the reports; what stands on each cell is the report's own
// island, declared by the report's program where the family writes it
// (@aicolab/atlas places-program.ts, berthed-programs.ts). Nothing about a
// report is written here: its name and its words are the registry's, its
// island its own.
//
// Worker-safe: content only.

import { openWaterHexSpace } from '@aicolab/atlas/chessboard/content/space/hex-open-water.ts'
import type { HexSpace, HexSpacePlace } from '@aicolab/atlas/chessboard/content/space/hex-space.ts'
import {
	type HexCorner,
	type HexSpaceSpecInput,
	hexCornerSchema,
	hexSpaceSpecSchema,
} from '@aicolab/atlas/chessboard/content/space/hex-space-spec.ts'
import { placesProgram } from '@aicolab/atlas/chessboard/content/space/places-program.ts'
import type { SpaceProgram } from '@aicolab/atlas/chessboard/content/space/programs.ts'
import { INSIGHT_BRIDGE_APPLET, REPORT_APPLETS } from '../applets.ts'
import { REPORT_OWNER } from './sky-table.ts'

/** Metres between the centres of the family's cells: each must hold a
 *  report's island whole, with water round it (family.test.ts holds every
 *  report to it: a report reaches some 50 m from its square), and the water
 *  between the square's ground and a report's cell is a ferry's crossing. */
export const FAMILY_SPACING = 150

/** The square's share of its cell: small, so that water lies between its
 *  ground and the reports' cells round it. */
export const FAMILY_SQUARE_SHARE = 0.4

/** The ring the reports stand on: the first, round the square. */
export const REPORT_RING = 1

/** How far the family reaches from its square (m): to the far corner of a
 *  first-ring cell, where its reports stand — what a holder's cell must
 *  hold. A cell's corner lies a cell's radius past its centre. */
export const FAMILY_REACH = REPORT_RING * FAMILY_SPACING + FAMILY_SPACING / Math.sqrt(3)

/** The six corners of a ring, north first and clockwise: the registry's
 *  order goes round the family the same way. */
const CORNERS = hexCornerSchema.options

/** The corner a report's cell stands at, by its place in the registry. */
export function cornerOfReport(index: number): HexCorner {
	const corner = CORNERS[index]
	if (!corner) {
		throw new Error(`[insight-bridge] a seventh report has no corner of the ring to stand at`)
	}
	return corner
}

/** The family's places: a berth per report, in the registry's order. */
export const familyPlaces = (): HexSpacePlace[] =>
	REPORT_APPLETS.map(
		(applet): HexSpacePlace => ({
			id: applet.id,
			label: applet.label,
			description: applet.blurb ?? '',
			stands: { kind: 'berth' },
		}),
	)

/** Where each report stands: at its corner of the first ring, its way
 *  crossing the water by ferry. */
export const familySpec = (): HexSpaceSpecInput => ({
	places: Object.fromEntries(
		REPORT_APPLETS.map((applet, i) => [
			applet.id,
			{ cell: { ring: REPORT_RING, corner: cornerOfReport(i) }, path: { crossing: 'ferry' } },
		]),
	),
})

/** The family laid as a top (its tests' view): the cell each report takes. */
export const familyHexIsland = (): HexSpace =>
	openWaterHexSpace({
		key: INSIGHT_BRIDGE_APPLET.id,
		label: INSIGHT_BRIDGE_APPLET.label,
		places: familyPlaces(),
		depth: 0,
		spec: hexSpaceSpecSchema.parse(familySpec()),
		spacing: FAMILY_SPACING,
		plazaShare: FAMILY_SQUARE_SHARE,
	})

/** The family as a space program. */
export function insightBridgeProgram(): SpaceProgram {
	return placesProgram({
		key: INSIGHT_BRIDGE_APPLET.id,
		label: INSIGHT_BRIDGE_APPLET.label,
		description: 'The reports of the Insight Bridge, one island each, round the family’s square.',
		places: familyPlaces(),
		spec: familySpec(),
		lay: openWaterHexSpace,
		owner: REPORT_OWNER,
		spacing: FAMILY_SPACING,
		plazaShare: FAMILY_SQUARE_SHARE,
	})
}
