// A report world's SCENES: its outdoors as its setup builds it — the hex
// island as any declared island is built (@aicolab/atlas declared-spaces.ts),
// the sky table the report draws in the galaxy's cell — and one pair room
// per room of the world — each built as it is entered, from the same build
// the content is, through the museum's own room builder. A room's walls
// carry its text (core's `worldText`: its cards' words, its rail's
// panels), read through the report's door as the room is built; the
// scene waits for it, and the room joins the world as its text writes it
// up.

import type { BuiltSpace } from '@aicolab/atlas/chessboard/scenes/built-space.ts'
import { buildGalleryRoomSpace } from '@aicolab/atlas/chessboard/scenes/gallery-space.ts'
import { registerIslandOwners } from '@aicolab/atlas/chessboard/scenes/island-owners.ts'
import {
	createSceneAdapter,
	type SceneAdapter,
	type SpaceBuilder,
} from '@aicolab/atlas/chessboard/scenes/scene-adapter.ts'
import { REPORT_OWNER } from '../sky-table.ts'
import type { ReportTexts } from '../texts.ts'
import type { ReportRoomBuild, ReportWorldBuild } from '../world.ts'
import { createReportOwner } from './owner.ts'

// The report's owner — the sky table on the square — draws for any island
// whose plan names it (atlas island-owners.ts), wherever a report's
// scenes are built: by its setup, by the archipelago, or with no renderer
// at all.
registerIslandOwners({ [REPORT_OWNER]: { create: createReportOwner } })

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

/** The adapter for a report world: its outdoors as the caller builds it
 *  (a declared island's own builders, atlas declared-spaces.ts), and every
 *  room — each built BARE when asked (atlas space-setups.ts BuildOptions):
 *  the same triangles, nothing fetched or painted to be seen, for the
 *  walker with no renderer. `texts` reads a room's text; with none, or
 *  bare, a room stands as the record alone gives it. */
export function createReportAdapter(
	build: ReportWorldBuild,
	outdoors: Readonly<Record<string, SpaceBuilder>>,
	bare = false,
	texts: ReportTexts | null = null,
): SceneAdapter {
	const builders: Record<string, SpaceBuilder> = { ...outdoors }
	for (const { spaceId } of build.rooms) {
		// Built as it is entered: the scene, and the space as it is once in
		// (the world declares it by name and way in), let go with it.
		builders[spaceId] = async () => {
			const built = build.roomAt(spaceId)
			if (!built) throw new Error(`[report] no room '${spaceId}'`)
			const ref = built.room.text
			const text = !bare && texts && ref ? await texts.of(ref) : null
			const written = text ? build.withText(built, text) : built
			const scene = await buildReportRoomSpace(written.room, bare)
			return { ...scene, space: written.space }
		}
	}
	return createSceneAdapter(builders)
}
