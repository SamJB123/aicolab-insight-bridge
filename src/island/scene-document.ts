// A report island as a kolo SCENE DOCUMENT: the square island's document
// (@aicolab/atlas hex/scene-document.ts) written from the oracle plan,
// with the sky table the report draws at the square's heart.
//
// Worker-safe: content only.

import type { PartOf } from '@aicolab/atlas/chessboard/content/hex/building-pieces.ts'
import {
	type IslandField,
	squareIslandDocument,
} from '@aicolab/atlas/chessboard/content/hex/scene-document.ts'
import type { IslandScene } from '@aicolab/kolo/scene'
import { islandPlanOfReport, type ReportIslandPlan } from './plan.ts'
import type { SkyStar } from './sky-table.ts'

/** How a report's island is written as a scene document: from its plan,
 *  the kit's parts, its field, and the record's stars (the sky table's). */
export type IslandSceneOf = (
	plan: ReportIslandPlan,
	partOf: PartOf,
	field: IslandField,
	stars: readonly SkyStar[],
) => IslandScene

export const reportIslandDocument: IslandSceneOf = (plan, partOf, field, stars) =>
	squareIslandDocument(plan, islandPlanOfReport(plan, field.surfaceY, stars), partOf, field)
