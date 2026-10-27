// A report island DECLARED: the square island (@aicolab/atlas
// square-declaration.ts) written from the record's sections — each a
// building on its site facing the square, naming the section it is as
// its place — with the sky table at the square's heart, at the point the
// island is written at: its own cell's centre in the archipelago, which
// the chart finds from the report's applet.
//
// Worker-safe: content only.

import { worldCentre } from '@aicolab/atlas/chart/chart-data.ts'
import { programKey } from '@aicolab/atlas/chessboard/content/island/programs.ts'
import { declareSquareIsland } from '@aicolab/atlas/chessboard/content/island/square-declaration.ts'
import type { IslandDocument } from '@aicolab/kolo/island'
import type { HexPoint } from '@aicolab/kolo/spatial/hex'
import type { WorldRecord } from '../world/index.ts'
import type { ReportIsland } from './registry.ts'
import { type ReportSectionEntry, reportIslandSpec } from './sections.ts'

/** The report island, declared round `writtenAt` (plan metres of the
 *  archipelago's frame), with the sections its own site lists where the
 *  host has read them. */
export function declareReportIsland(
	record: WorldRecord | null,
	island: ReportIsland,
	writtenAt: HexPoint,
	sections?: readonly ReportSectionEntry[],
): IslandDocument {
	return declareSquareIsland(reportIslandSpec(record, island.slug, sections), writtenAt)
}

/** A report island's declaration, from its record, at its own cell. */
export function reportDeclaration(
	record: WorldRecord | null,
	island: ReportIsland,
	sections?: readonly ReportSectionEntry[],
): IslandDocument {
	return declareReportIsland(record, island, worldCentre(programKey(island.slug)), sections)
}
