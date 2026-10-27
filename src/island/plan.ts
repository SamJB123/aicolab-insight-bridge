// A report island's PLAN: the square island (@aicolab/atlas
// square-island-plan.ts) laid from the record's sections — the oracle —
// in every form the atlas composes it: laid directly (`reportIslandPlan`),
// as claims on the lattice (`hexReportIslandPlan`), declared in Overture's
// words (declaration.ts) and realised back (`realiseReportIsland`), and
// as the island plan the scene builds from with the sky table at its
// heart (`islandPlanOfReport`). All four are held equal by the tests.
//
// Worker-safe: content only.

import { hexSquareIslandPlan } from '@aicolab/atlas/chessboard/content/hex/square-island-hex.ts'
import type { IslandPlan } from '@aicolab/atlas/chessboard/content/island/plan.ts'
import {
	type RealisedIsland,
	realiseIsland,
} from '@aicolab/atlas/chessboard/content/island/realise.ts'
import { laidBuildingsOf } from '@aicolab/atlas/chessboard/content/island/square-declaration.ts'
import {
	islandPlanOfSquare,
	type SquareIslandInput,
	type SquareIslandPlan,
	squareIslandPlan,
	squarePlanOf,
} from '@aicolab/atlas/chessboard/content/square-island-plan.ts'
import type { IslandDocument } from '@aicolab/kolo/island'
import type { WorldRecord } from '../world/index.ts'
import { type ReportSectionEntry, reportIslandSpec } from './sections.ts'
import { SKY_TABLE_RADIUS, type SkyStar, skyTableOwned } from './sky-table.ts'

/** The report island's plan: the square island's, laid from its sections. */
export type ReportIslandPlan = SquareIslandPlan

/** How a record's island is planned: the plan itself, or any composition
 *  held to it (the hex claims). */
export type IslandPlanOf = (record: WorldRecord | null, slug: string) => ReportIslandPlan

/** What the square island is composed from, for a record. */
export function reportIslandInput(
	record: WorldRecord | null,
	slug: string,
	sections?: readonly ReportSectionEntry[],
): SquareIslandInput {
	const spec = reportIslandSpec(record, slug, sections)
	return {
		slug,
		title: spec.title,
		buildings: laidBuildingsOf(spec),
		heart: SKY_TABLE_RADIUS,
	}
}

/** The oracle: the island laid directly from the record's sections. */
export const reportIslandPlan = (
	record: WorldRecord | null,
	slug: string,
	sections?: readonly ReportSectionEntry[],
): ReportIslandPlan => squareIslandPlan(reportIslandInput(record, slug, sections))

/** The island composed as claims on the hex lattice, held to the oracle. */
export const hexReportIslandPlan = (record: WorldRecord | null, slug: string) =>
	hexSquareIslandPlan(reportIslandInput(record, slug))

/** The oracle plan as the island plan the scene builds from: flat, the
 *  sky table at the square's heart with the record's stars. */
export const islandPlanOfReport = (
	plan: ReportIslandPlan,
	surfaceY: number,
	stars: readonly SkyStar[] = [],
): IslandPlan => islandPlanOfSquare(plan, surfaceY, [skyTableOwned(plan.plaza, stars)])

/** A report island's realisation: its plan in the oracle's shape. */
export function realiseReportIsland(
	document: IslandDocument,
): RealisedIsland & { reportPlan: ReportIslandPlan } {
	const realised = realiseIsland(document)
	return { ...realised, reportPlan: squarePlanOf(realised.plan) }
}
