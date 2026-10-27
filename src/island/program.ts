// An Insight Bridge report as an ISLAND PROGRAM (@aicolab/atlas island/
// programs.ts): its content is its world record and its own sections,
// read through its door on the host's root — the applet seam's row the
// report's slug names, which answers with core's `ReportCap` (its
// `world`, `worldText`, `worldReading` and `navPage`), the one way a
// report is read (settled 2026-10-25), over the host's one session for
// the report (../applet/session.ts) — or, with no host at hand, the
// record its site serves publicly; its declaration is the island declared
// from that record, the island alone without it (its buildings closed);
// its skeleton the island alone. The setup — the scenes, the rooms, the
// readings — is the browser's (solid/setup.tsx).
//
// Worker-safe: content only.

import { worldCentre } from '@aicolab/atlas/chart/chart-data.ts'
import {
	type IslandProgram,
	programKey,
} from '@aicolab/atlas/chessboard/content/island/programs.ts'
import type { AtlasHost } from '@aicolab/atlas/host.ts'
import { sectionsOf } from '../applet/reads.ts'
import { reportSession } from '../applet/session.ts'
import {
	type WorldReading,
	type WorldReadingRef,
	type WorldRecord,
	worldRecordSchema,
} from '../world/index.ts'
import { declareReportIsland } from './declaration.ts'
import { reportIslandPlan } from './plan.ts'
import { type ReportIsland, type ReportSlug, reportIsland } from './registry.ts'
import type { ReportSectionEntry } from './sections.ts'
import { createReportTexts, type ReportTexts } from './texts.ts'
import { buildReportWorld } from './world.ts'

/** What a report island is built from: the report's world record, and
 *  the report's own sections as its door lists them (none where the door
 *  did not say, and the island stands a standard report's). */
export interface ReportContent {
	record: WorldRecord
	sections: readonly ReportSectionEntry[] | null
}

/** One item's reading, through the report's door: the host's one session
 *  for the report over its socket (../applet/session.ts), the same its
 *  page face reads through. */
export const reportReading = (
	host: AtlasHost,
	slug: ReportSlug,
	ref: WorldReadingRef,
): Promise<WorldReading | null> =>
	reportSession(host.socket, slug).run((cap) => cap.worldReading(ref))

/** The island's room texts, through the report's door, kept for the
 *  island's life (texts.ts). */
export const reportTextsOf = (host: AtlasHost, slug: ReportSlug): ReportTexts =>
	createReportTexts((ref) => reportSession(host.socket, slug).run((cap) => cap.worldText(ref)))

/** The report's world record and its own sections through its door.
 *  Unavailable is not an error: the island stands with its buildings
 *  closed — for a host that binds no door for the report as for a door
 *  that will not answer; a door that answers no sections leaves the
 *  island a standard report's. */
async function reportContent(island: ReportIsland, host: AtlasHost): Promise<ReportContent | null> {
	try {
		const session = reportSession(host.socket, island.slug)
		const [record, sections] = await Promise.all([
			session.run((cap) => cap.world()),
			session
				.run(async (cap) => sectionsOf(await cap.navPage()))
				.catch((err: unknown) => {
					console.warn(`[chessboard] the ${island.corpus.name} sections are unavailable:`, err)
					return null
				}),
		])
		if (!record) throw new Error('the host has no door to it')
		return { record: worldRecordSchema.parse(record), sections }
	} catch (err) {
		console.error(`[chessboard] the ${island.corpus.name} record is unavailable:`, err)
		return null
	}
}

/** The record as the report's site serves it publicly, for a reader with
 *  no host (a server route realising the island); null where it cannot
 *  be read. The sections are the door's alone. */
async function fetchReportContent(island: ReportIsland): Promise<ReportContent | null> {
	try {
		const response = await fetch(`${island.corpus.url}/api/world`)
		if (!response.ok) return null
		return { record: worldRecordSchema.parse(await response.json()), sections: null }
	} catch {
		return null
	}
}

/** The point a report's island is written at: its own cell's centre. */
const reportCellOf = (slug: ReportSlug) => worldCentre(programKey(slug))

export function reportIslandProgram(slug: ReportSlug): IslandProgram<ReportContent> {
	const island = reportIsland(slug)
	return {
		key: slug,
		content: (host) => reportContent(island, host),
		fetchContent: () => fetchReportContent(island),
		declaration: (content) =>
			declareReportIsland(
				content?.record ?? null,
				island,
				// Declared at its own cell: declaration.ts reportDeclaration
				// finds it from the chart; here the program is asked by key,
				// which the chart has placed.
				reportCellOf(slug),
				content?.sections ?? undefined,
			),
		skeleton: () => buildReportWorld(null, reportIslandPlan, island).world,
	}
}
