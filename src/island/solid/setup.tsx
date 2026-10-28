/** @jsxImportSource @solidjs/web */
// An Insight Bridge report's island SETUP (@aicolab/atlas world-setups.ts
// IslandSetup), the browser half of its program (../program.ts): the
// report's hex island, declared from its record, its sections and its
// specification (the island alone when the record cannot be read),
// realised, its rooms on its record, its record and readings through the
// report's door on the host — and the
// report's LENS on its rooms (atlas content/lens.ts: a building's rooms as
// the scope finding is held to, the plan drawn round a room, which things
// read) and its READING SHEET (ReportSheet.tsx). The report's ORACLE is
// its island planned by the oracle plan (or a composition a host hands
// in), its kit placed from the plan: the yardstick its declared form is
// held to.

import { worldCell } from '@aicolab/atlas/chart/chart-data.ts'
import type { HexIslandSpec } from '@aicolab/atlas/chessboard/content/island/hex-island-spec.ts'
import { islandPlacesOf } from '@aicolab/atlas/chessboard/content/island/island-places.ts'
import { programKey } from '@aicolab/atlas/chessboard/content/island/programs.ts'
import { realiseIsland } from '@aicolab/atlas/chessboard/content/island/realise.ts'
import type {
	ReadingSheetProps,
	SpaceLens,
	WorldScope,
} from '@aicolab/atlas/chessboard/content/lens.ts'
import { worldOfKey } from '@aicolab/atlas/chessboard/content/world-keys.ts'
import { declaredBuilders, groundOf } from '@aicolab/atlas/chessboard/scenes/declared-spaces.ts'
import type { AtlasHost } from '@aicolab/atlas/host.ts'
import {
	type IslandSetup,
	WALK,
	type WorldBuild,
	type WorldSetup,
} from '@aicolab/atlas/solid/chessboard/world-setups.ts'
import { SURFACE_LEVEL } from '@aicolab/atlas/three/levels.ts'
import { createMemo } from 'solid-js'
import { type IslandPlanOf, islandPlanOfReport, reportIslandPlan } from '../plan.ts'
import {
	type ReportContent,
	reportDeclaration,
	reportIslandProgram,
	reportOutline,
	reportReading,
	reportTextsOf,
} from '../program.ts'
import { type ReportIsland, type ReportSlug, reportIsland } from '../registry.ts'
import type { IslandSceneOf } from '../scene-document.ts'
import { buildReportIslandSpace, createReportAdapter } from '../scenes/spaces.ts'
import { starsOf } from '../sky-table.ts'
import type { ReportTexts } from '../texts.ts'
import {
	buildingLabel,
	buildReportWorld,
	itemWithText,
	mapOf,
	type ReportScope,
	type ReportWorldBuild,
	relatedRooms,
	scopeOfRoom,
} from '../world.ts'
import { ReportSheet } from './ReportSheet.tsx'

/** The scopes a report's record relates its rooms by (../world.ts
 *  ReportScope): what the lens holds finding to. */
const SCOPE_KINDS: ReadonlySet<string> = new Set(['group', 'cohort', 'topic', 'question'])
const isReportScope = (scope: WorldScope): scope is ReportScope => SCOPE_KINDS.has(scope.kind)

/** The report's lens on its own rooms, in its own names. */
const reportLens = (report: ReportWorldBuild): SpaceLens => ({
	scopeOf: (spaceId) => scopeOfRoom(report, spaceId),
	spacesOf: (scope) => (isReportScope(scope) ? relatedRooms(report, scope) : new Set()),
	mapTitle: (spaceId) => buildingLabel(report, spaceId),
	mapOf: (spaceId) => mapOf(report, spaceId),
	readable: (thing) => report.items.has(thing.replace(/^item:/, '')),
})

/** The report's reading sheet: an item off a wall, read through the
 *  report's door; its words its room's text, read as the room was built. */
const reportSheet =
	(report: ReportWorldBuild, texts: ReportTexts, host: AtlasHost, slug: ReportSlug) =>
	(props: ReadingSheetProps) => {
		const item = createMemo(() => {
			const open = props.reading()
			return open ? (report.items.get(open.id.replace(/^item:/, '')) ?? null) : null
		})
		return (
			<ReportSheet
				item={item()}
				record={report.record}
				words={async (open) => {
					if (!open.text) return open
					const text = await texts.of(open.text.ref)
					return text ? itemWithText(open, text) : open
				}}
				reading={(ref) => reportReading(host, slug, ref)}
				onVisit={props.onVisit}
				onClose={props.onClose}
			/>
		)
	}

/** What every build of a report island hands the app beyond its world and
 *  scenes: its lens, its sheet, its rooms, what can be found. */
const reportBuild = (
	report: ReportWorldBuild,
	island: ReportIsland,
	host: AtlasHost,
): Pick<WorldBuild, 'world' | 'roomAt' | 'waysOf' | 'findables' | 'lensAt' | 'sheet'> & {
	texts: ReportTexts
} => {
	const texts = reportTextsOf(host, island.slug)
	const lens = reportLens(report)
	return {
		world: report.world,
		// A room's plan and ways, unbuilt: the room itself is built as it is
		// entered.
		roomAt: (spaceId) => {
			const plan = report.planOf(spaceId)
			return plan ? { spaceId, plan } : undefined
		},
		waysOf: report.waysOf,
		findables: report.findables,
		lensAt: () => lens,
		sheet: reportSheet(report, texts, host, island.slug),
		texts,
	}
}

/** A report island's setups: as declared, and as it was first built — the
 *  oracle, planned by the oracle plan or by the composition a host hands
 *  in (`plan`), its kit placed from the plan or from a scene document
 *  written from it (`scene`). With a DRAFT (a host's editor of the
 *  island's specification), the island is declared from the draft as it
 *  stands when the world is built, in place of the specification its door
 *  gives, and explored alone: a draft is no island anyone else stands on. */
export function reportIslandSetup(
	slug: ReportSlug,
	oracle: { plan?: IslandPlanOf; scene?: IslandSceneOf } = {},
	draft?: () => HexIslandSpec,
): IslandSetup {
	const island = reportIsland(slug)
	const program = reportIslandProgram(slug)
	// The report's world key: its program's, which the host registered
	// beside this.
	const key = programKey(slug)
	const alone: Pick<WorldSetup, 'relay'> = draft ? { relay: false } : {}
	const shared = {
		...alone,
		// Its room is its cell's (room-service lattice rooms): the archipelago's
		// visitors on this island and its own route's meet there.
		name: worldCell(key).cell,
		label: `${island.corpus.name}, seen from above as an island. ${WALK}`,
		mapTitle: 'The building',
		finding: { label: 'Find anything', placeholder: 'Find a topic, a name, a question…' },
		skeleton: () => worldOfKey(key),
		content: (host: AtlasHost) => program.content(host),
		outline: (host: AtlasHost) => reportOutline(island, host),
	}
	// The report's HEX ISLAND, as its program declares it from what the door
	// gave (../hex-island.ts), realised and built as any declared island is,
	// with the report's rooms behind its doors.
	const declared: WorldSetup<ReportContent> = {
		...shared,
		callbackPath: `/overture/${slug}/island`,
		build: (models, content, options) => {
			const bare = options.bare === true
			const realised = realiseIsland(
				draft ? reportDeclaration(slug, content, draft()) : program.declaration(content),
			)
			const report = buildReportWorld(content?.record ?? null, island, realised.plan)
			const built = reportBuild(report, island, options.host)
			return {
				...built,
				adapter: createReportAdapter(
					report,
					declaredBuilders(realised, models, 'island', bare),
					bare,
					built.texts,
				),
				island: groundOf(realised, models, bare),
				places: islandPlacesOf(realised.document, report.world, report.world.start, report.waysOf),
			}
		},
	}
	// The island as it was FIRST BUILT, its oracle: the square island, laid
	// by the oracle plan or the composition a host hands in, its kit placed
	// from the plan or from a scene document written from it.
	const asBuilt: WorldSetup<ReportContent> = {
		...shared,
		callbackPath: `/place/${slug}/island`,
		build: (models, content, options) => {
			const bare = options.bare === true
			const record = content?.record ?? null
			const square = (oracle.plan ?? reportIslandPlan)(record, island.slug)
			const stars = starsOf(record)
			const report = buildReportWorld(
				record,
				island,
				islandPlanOfReport(square, SURFACE_LEVEL, stars),
			)
			const built = reportBuild(report, island, options.host)
			return {
				...built,
				adapter: createReportAdapter(
					report,
					{
						island: () =>
							buildReportIslandSpace(square, stars, models, {
								...(oracle.scene ? { document: oracle.scene } : {}),
								bare,
							}),
					},
					bare,
					built.texts,
				),
			}
		},
	}
	return { key, setup: () => declared, oracle: () => asBuilt }
}
