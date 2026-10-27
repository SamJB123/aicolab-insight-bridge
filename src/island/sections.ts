// A report's SECTIONS as the buildings of its island: which of the kit's
// forms each takes (@aicolab/atlas island/kit-forms.ts), what it is to a
// reader of map data, its site round the square, and whether it holds
// things of its own — rooms behind its door — and so is a building a
// visitor enters, or a landmark stood in the open (settled 2026-10-27).
// The buildings are the report's sections and nothing more: the Hall
// (topics), the Archive (sources), one chamber per custom analysis the
// profile declared, the beacon (connect) on a point by the shore, the
// method board by the way in, and the information desk (search) across
// the avenue from it. A section's building is its id, which is also its
// place (settled 2026-10-27: topics is 'topics', no other word for it).
//
// Worker-safe: content only.

import type { KitForm } from '@aicolab/atlas/chessboard/content/island/kit-forms.ts'
import type { IslandBuilding } from '@aicolab/atlas/chessboard/content/island/plan.ts'
import type {
	SquareBuildingSpec,
	SquareIslandSpec,
} from '@aicolab/atlas/chessboard/content/island/square-declaration.ts'
import type { BuildingWords } from '@aicolab/atlas/chessboard/content/island/vocabulary.ts'
import type { WorldRecord } from '../world/index.ts'
import { skyTableHeart } from './sky-table.ts'

export type ReportSectionKind = 'topics' | 'sources' | 'analysis' | 'connect' | 'method' | 'search'

/** The kinds that hold things of their own — rooms behind their door —
 *  and so are buildings a visitor enters; every other kind is a landmark
 *  stood in the open (settled 2026-10-27). */
export const HOLDS_ROOMS: ReadonlySet<ReportSectionKind> = new Set<ReportSectionKind>([
	'topics',
	'sources',
	'analysis',
])
export const holdsRooms = (kind: ReportSectionKind): boolean => HOLDS_ROOMS.has(kind)

/** The kit's form each section takes: the stone inn with the tower for
 *  the Hall, the long shop for the Archive, the plain inn for a chamber,
 *  the lantern tower for the beacon, a signboard for the method, the
 *  market counter for the desk. */
export const FORM_OF: Readonly<Record<ReportSectionKind, KitForm>> = {
	topics: 'inn-tower',
	sources: 'shop',
	analysis: 'inn',
	connect: 'tower',
	method: 'signboard',
	search: 'counter',
}

/** Each section's building in Overture's words. */
export const WORDS_OF: Readonly<Record<ReportSectionKind, BuildingWords>> = {
	topics: { type: 'building', subtype: 'civic', class: 'civic' },
	sources: { type: 'building', subtype: 'civic', class: 'library' },
	analysis: { type: 'building', subtype: 'civic', class: 'public' },
	connect: { type: 'infrastructure', subtype: 'tower', class: 'watchtower' },
	method: { type: 'infrastructure', subtype: 'pedestrian', class: 'information' },
	search: { type: 'infrastructure', subtype: 'pedestrian', class: 'information' },
}

/** Where each kind of section stands round the square: bearing (degrees,
 *  0 = east, clockwise on the plan) and distance from the square's
 *  centre. Chambers take the slots in turn. */
const SITES = {
	topics: { bearing: -90, distance: 46 },
	sources: { bearing: -148, distance: 44 },
	connect: { bearing: -22, distance: 50 },
	method: { bearing: 132, distance: 26 },
	// The information desk: by the way in, across the avenue from the
	// method board, clear of the chambers' paths (the fourth's runs at 42°).
	search: { bearing: 66, distance: 26 },
	analyses: [
		{ bearing: -52, distance: 45 },
		{ bearing: 18, distance: 46 },
		{ bearing: -178, distance: 46 },
		{ bearing: 42, distance: 48 },
		{ bearing: 158, distance: 46 },
		{ bearing: -120, distance: 60 },
		{ bearing: -60, distance: 62 },
		{ bearing: 0, distance: 64 },
	],
} as const

/** A section of the report as a building to be sited: what it is, what
 *  it says of itself, and the site it takes round the square. */
export interface ReportSection {
	id: string
	kind: ReportSectionKind
	label: string
	description: string
	site: { bearing: number; distance: number }
	taskId?: string
}

/** A section of the report as its own site lists it (the door's
 *  navigation, read by the host): its id, which is its place below the
 *  report, what it is, its label, and the task it is for when it is an
 *  analysis. The island stands one thing for each it has a form for. */
export interface ReportSectionEntry {
	id: string
	label: string
	section: string
	taskId?: string
}

/** The sections every report has when its own site is not asked: what a
 *  standard report lists, in its order. */
const DEFAULT_SECTIONS = (record: WorldRecord | null): ReportSectionEntry[] => [
	{ id: 'topics', label: 'Topics', section: 'topics' },
	{ id: 'sources', label: 'Sources', section: 'sources' },
	...(record?.tasks ?? []).map((task) => ({
		id: `analysis:${task.id}`,
		label: task.title,
		section: 'analysis',
		taskId: task.id,
	})),
	{ id: 'search', label: 'Search', section: 'search' },
	{ id: 'method', label: 'Method', section: 'method' },
	{ id: 'connect', label: 'Connect', section: 'connect' },
]

/** The sections a record calls for, each by its own name, which is its
 *  building's id and its place: topics, sources, an analysis per task
 *  (`analysis:<task>`), search, method, connect — the sections the
 *  report's own site lists (`sections`, from its door), else a standard
 *  report's. The overview is the island itself and the galaxy its sky
 *  table, so neither stands as a thing of its own; a section the island
 *  has no form for stands nowhere. Each kind keeps its site round the
 *  square; the analyses take the chambers' slots in turn. */
export function sectionsOf(
	record: WorldRecord | null,
	sections: readonly ReportSectionEntry[] = DEFAULT_SECTIONS(record),
): ReportSection[] {
	const nouns = record?.site.nouns ?? {
		entity: 'source',
		entities: 'sources',
		document: 'document',
		documents: 'documents',
	}
	const topics = record?.topics.length ?? 0
	const sources = record?.sources.length ?? 0
	const tasks = record?.tasks ?? []
	let chambers = 0
	return sections.flatMap((entry): ReportSection[] => {
		switch (entry.section) {
			case 'topics':
				return [
					{
						id: entry.id,
						kind: 'topics',
						label: 'The Hall of Topics',
						description: topics
							? `${topics} topics, each in its own room, grouped the way the record groups them.`
							: 'The topics, each in its own room.',
						site: SITES.topics,
					},
				]
			case 'sources':
				return [
					{
						id: entry.id,
						kind: 'sources',
						label: 'The Archive',
						description: sources
							? `Every ${nouns.entity} the record read — ${sources} of them — each in a room of their own.`
							: `Every ${nouns.entity} the record read.`,
						site: SITES.sources,
					},
				]
			case 'analysis': {
				const taskId = entry.taskId
				if (taskId === undefined) return []
				const task = tasks.find((t) => t.id === taskId)
				const slot = SITES.analyses[chambers++ % SITES.analyses.length] ?? SITES.analyses[0]
				return [
					{
						id: entry.id,
						kind: 'analysis',
						label: task?.title ?? entry.label,
						description:
							task?.description || `What the record says against ${entry.label.toLowerCase()}.`,
						site: slot,
						taskId,
					},
				]
			}
			case 'search':
				return [
					{
						id: entry.id,
						kind: 'search',
						label: 'The information desk',
						description: 'Find a topic, a name, a question: the desk knows the way.',
						site: SITES.search,
					},
				]
			case 'connect':
				return [
					{
						id: entry.id,
						kind: 'connect',
						label: 'The Beacon',
						description: 'How scripts and assistants read this record: the connector.',
						site: SITES.connect,
					},
				]
			case 'method':
				return [
					{
						id: entry.id,
						kind: 'method',
						label: 'How this was made',
						description: 'The method: how the record was read, clustered and written.',
						site: SITES.method,
					},
				]
			default:
				return []
		}
	})
}

/** The section a building of the island is, from its id — the id is the
 *  section's own address ('topics', 'sources', 'analysis:<task>',
 *  'search', 'method', 'connect'); null for a building that is none. */
export function sectionOfBuilding(id: string): { kind: ReportSectionKind; taskId?: string } | null {
	if (id.startsWith('analysis:')) return { kind: 'analysis', taskId: id.slice('analysis:'.length) }
	switch (id) {
		case 'topics':
		case 'sources':
		case 'connect':
		case 'method':
		case 'search':
			return { kind: id }
		default:
			return null
	}
}

/** Whether a building of the island is one a visitor enters: its
 *  section's rooms stand behind its door. */
export const entersBuilding = (b: Pick<IslandBuilding, 'id'>): boolean => {
	const section = sectionOfBuilding(b.id)
	return section !== null && holdsRooms(section.kind)
}

/** A section as the square island declares it: its form, its words, its
 *  site, and itself as its place. */
const buildingOf = (section: ReportSection): SquareBuildingSpec => ({
	id: section.id,
	kind: FORM_OF[section.kind],
	label: section.label,
	description: section.description,
	site: section.site,
	words: WORDS_OF[section.kind],
	place: section.id,
})

/** The report's island as a square island (@aicolab/atlas
 *  square-declaration.ts): its sections round the square, the sky table
 *  at its heart with the record's stars, the island the report's place. */
export function reportIslandSpec(
	record: WorldRecord | null,
	slug: string,
	sections?: readonly ReportSectionEntry[],
): SquareIslandSpec {
	return {
		slug,
		title: record?.site.title ?? null,
		place: slug,
		buildings: sectionsOf(record, sections).map(buildingOf),
		heart: skyTableHeart(record),
	}
}
