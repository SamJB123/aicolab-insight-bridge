// A report world's SCENES: the island from its plan, built from the
// three-resources kit (@aicolab/atlas scenes/island-scene.ts) with the
// sky table the report draws at the square's heart, and one pair room per
// room the world was built with — every room drawn from the same build
// the content is, through the museum's own room builder. A room's walls
// carry its text (core's `worldText`: its cards' words, its rail's
// panels), read through the report's door as the room is built; the
// scene waits for it, and the room joins the world as its text writes it
// up.

import type { BuiltSpace } from '@aicolab/atlas/chessboard/scenes/built-space.ts'
import { buildGalleryRoomSpace } from '@aicolab/atlas/chessboard/scenes/island-geometry.ts'
import { ownersFor, registerIslandOwners } from '@aicolab/atlas/chessboard/scenes/island-owners.ts'
import { buildIslandSpace } from '@aicolab/atlas/chessboard/scenes/island-scene.ts'
import {
	createSceneAdapter,
	type SceneAdapter,
	type SpaceBuilder,
} from '@aicolab/atlas/chessboard/scenes/scene-adapter.ts'
import type { ModelMetadata } from '@aicolab/atlas/models/load-model.ts'
import { SURFACE_LEVEL } from '@aicolab/atlas/three/levels.ts'
import { islandPlanOfReport, type ReportIslandPlan } from '../plan.ts'
import type { IslandSceneOf } from '../scene-document.ts'
import { REPORT_OWNER, type SkyStar } from '../sky-table.ts'
import type { ReportTexts } from '../texts.ts'
import type { ReportRoomBuild, ReportWorldBuild } from '../world.ts'
import { createReportOwner } from './owner.ts'

// The report's owner — the sky table on the square — draws for any island
// whose plan names it (atlas island-owners.ts), wherever a report's
// scenes are built: by its setup, by the archipelago, or with no renderer
// at all.
registerIslandOwners({ [REPORT_OWNER]: { create: createReportOwner } })

export interface ReportIslandSceneOptions {
	/** Build the kit's part of the island — buildings, lamps, rocks, planting
	 *  — from a scene document written from the plan, instead of from the
	 *  plan's placements directly. The two are held equal in the live scene. */
	document?: IslandSceneOf
	/** Built bare, its owners with it (atlas IslandSceneOptions). */
	bare?: boolean
}

/** A report island: the square island with its ground flat at the
 *  surface level, its sky table drawn by the report with the record's
 *  stars; the kit placed from the plan directly (the oracle) or from a
 *  document written from it. */
export async function buildReportIslandSpace(
	plan: ReportIslandPlan,
	stars: readonly SkyStar[],
	models: ModelMetadata[] | null,
	options: ReportIslandSceneOptions = {},
): Promise<BuiltSpace> {
	const document = options.document
	const bare = options.bare === true
	const island = islandPlanOfReport(plan, SURFACE_LEVEL, stars)
	return buildIslandSpace(island, models, {
		...(document ? { document: (partOf, field) => document(plan, partOf, field, stars) } : {}),
		direct: plan,
		owners: ownersFor(island, models, bare).owners(),
		bare,
	})
}

/** A report's room as a chessboard space: a pair room, through the
 *  museum's own room builder. */
export function buildReportRoomSpace(build: ReportRoomBuild, bare = false): Promise<BuiltSpace> {
	return buildGalleryRoomSpace({
		plan: build.plan,
		accent: build.accent,
		// The card's id is its interactable's, so a dive into it ripples it.
		exhibits: build.exhibits.map((e) => ({
			anchorId: e.anchorId,
			card: e.card,
			id: `item:${e.itemId}`,
		})),
		chart: build.chart,
		bare,
	})
}

/** The adapter for a report world — every space built BARE when asked
 *  (atlas world-setups.ts BuildOptions): the same triangles, nothing
 *  fetched or painted to be seen, for the walker with no renderer. `texts`
 *  reads a room's text; with none, or bare, a room stands as the record
 *  alone gives it. */
export function createReportAdapter(
	build: ReportWorldBuild,
	models: ModelMetadata[] | null,
	island: ReportIslandSceneOptions = {},
	bare = false,
	texts: ReportTexts | null = null,
): SceneAdapter {
	const builders: Record<string, SpaceBuilder> = {
		island: () => buildReportIslandSpace(build.plan, build.sky.stars, models, { ...island, bare }),
	}
	for (const room of build.rooms) {
		builders[room.spaceId] = async () => {
			const text = !bare && texts && room.text ? await texts.of(room.text) : null
			const written = text ? build.withText(room.spaceId, text) : null
			const scene = await buildReportRoomSpace(written?.room ?? room, bare)
			return written ? { ...scene, space: written.space } : scene
		}
	}
	return createSceneAdapter(builders)
}
