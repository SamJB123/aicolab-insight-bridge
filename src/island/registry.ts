// THE REPORT ISLANDS: one per Insight Bridge corpus whose report serves
// the world record (core's `world` read, through the report's door),
// named by the corpus's slug — every applet of the family (../applets.ts).
// Everything a report island needs beyond its record is derived here from
// the family registry — its origin (where its Beacon and method board
// link), its world key (the `$world` of a place URL), its relay room — so
// adding an island is adding its corpus. Worker-safe (data only).

import { REPORT_APPLETS } from '../applets.ts'
import { CORPORA, type Corpus, type CorpusSlug } from '../corpora.ts'

export type ReportSlug = CorpusSlug

export interface ReportIsland {
	slug: ReportSlug
	/** The corpus whose site serves the record: its `name` is how the site
	 *  brands itself; its `url` (no trailing slash) is the origin the record,
	 *  the readings, the connector and the method are served from. */
	corpus: Corpus
	/** The relay room the island is served in: the DO's name (`[a-z0-9-]`). */
	name: string
}

function islandOf(slug: ReportSlug): ReportIsland {
	const corpus = CORPORA.find((c) => c.slug === slug)
	if (!corpus) throw new Error(`[report-islands] the corpora registry has no '${slug}'`)
	return { slug, corpus, name: `report-${slug}` }
}

/** Every report's island, in the family's order. */
export const REPORT_ISLANDS: readonly ReportIsland[] = REPORT_APPLETS.map((applet) =>
	islandOf(applet.id),
)

export function isReportSlug(value: string): value is ReportSlug {
	return REPORT_ISLANDS.some((island) => island.slug === value)
}

export function reportIsland(slug: ReportSlug): ReportIsland {
	const island = REPORT_ISLANDS.find((i) => i.slug === slug)
	if (!island) throw new Error(`[report-islands] no island for '${slug}'`)
	return island
}

/** The proving island: Training Data, the first report built as one. */
export const TRAINING_DATA: ReportIsland = reportIsland('training-data')

/** The island served in a relay room, if the room is a report's. */
export function reportIslandOfRoom(name: string): ReportIsland | null {
	return REPORT_ISLANDS.find((i) => i.name === name) ?? null
}
