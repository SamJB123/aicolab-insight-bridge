// A report's SECTIONS as the buildings of its island: which of the kit's
// forms each takes (@aicolab/atlas island/kit-forms.ts), what it says of
// itself, and whether it holds things of its own — rooms behind its door —
// and so is a building a visitor enters, or a landmark stood in the open
// (settled 2026-10-27). The buildings are the report's sections and
// nothing more: topics, sources, one chamber per custom analysis the
// profile declared, connect, method and search. A section's building is
// its id, which is also its place (settled 2026-10-27: topics is 'topics',
// no other word for it), and it is named as the report's header, map and
// tree name the section (report/nav-items.ts): Topics, the run's own word
// for its sources, Search, Method, MCP — never a name of the island's own.
// Where each stands is the hex island's to lay (hex-island.ts): a place on
// a cell of the report's map.
//
// Worker-safe: content only.

import type { KitForm } from '@aicolab/atlas/chessboard/content/island/kit-forms.ts'
import type { IslandBuilding } from '@aicolab/atlas/chessboard/content/island/plan.ts'
import { landmarkOfFeature } from '@aicolab/kolo/island'
import { sectionName } from '../report/nav-items.ts'
import type { WorldRecord } from '../world/index.ts'

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
 *  topics, the long shop for sources, the plain inn for an analysis, the
 *  lantern tower for connect, a signboard for the method, the market
 *  counter for search. */
export const FORM_OF: Readonly<Record<ReportSectionKind, KitForm>> = {
	topics: 'inn-tower',
	sources: 'shop',
	analysis: 'inn',
	connect: 'tower',
	method: 'signboard',
	search: 'counter',
}

/** A section of the report as a building: what it is, and what it says of
 *  itself. */
export interface ReportSection {
	id: string
	kind: ReportSectionKind
	label: string
	description: string
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
 *  standard report lists, in its order (its galaxy first), each by the
 *  name its header gives it. */
export const DEFAULT_SECTIONS = (record: WorldRecord | null): ReportSectionEntry[] => {
	const name = (section: 'galaxy' | 'topics' | 'sources' | 'search' | 'method' | 'connect') =>
		sectionName(section, record?.site.nouns.entities ?? 'sources')
	return [
		{ id: 'galaxy', label: name('galaxy'), section: 'galaxy' },
		{ id: 'topics', label: name('topics'), section: 'topics' },
		{ id: 'sources', label: name('sources'), section: 'sources' },
		...(record?.tasks ?? []).map((task) => ({
			id: `analysis:${task.id}`,
			label: task.title,
			section: 'analysis',
			taskId: task.id,
		})),
		{ id: 'search', label: name('search'), section: 'search' },
		{ id: 'method', label: name('method'), section: 'method' },
		{ id: 'connect', label: name('connect'), section: 'connect' },
	]
}

/** The sections a record calls for, each by its own name, which is its
 *  building's id and its place: topics, sources, an analysis per task
 *  (`analysis:<task>`), search, method, connect — the sections the
 *  report's own site lists (`sections`, from its door), else a standard
 *  report's. The overview is the island itself and the galaxy its sky
 *  table, so neither stands as a thing of its own; a section the island
 *  has no form for stands nowhere. */
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
	return sections.flatMap((entry): ReportSection[] => {
		switch (entry.section) {
			case 'topics':
				return [
					{
						id: entry.id,
						kind: 'topics',
						label: entry.label,
						description: topics
							? `${topics} topics, each in its own room, grouped the way the record groups them.`
							: 'The topics, each in its own room.',
					},
				]
			case 'sources':
				return [
					{
						id: entry.id,
						kind: 'sources',
						label: entry.label,
						description: sources
							? `Every ${nouns.entity} the record read — ${sources} of them — each in a room of their own.`
							: `Every ${nouns.entity} the record read.`,
					},
				]
			case 'analysis': {
				const taskId = entry.taskId
				if (taskId === undefined) return []
				const task = tasks.find((t) => t.id === taskId)
				return [
					{
						id: entry.id,
						kind: 'analysis',
						label: entry.label,
						description:
							task?.description || `What the record says against ${entry.label.toLowerCase()}.`,
						taskId,
					},
				]
			}
			case 'search':
				return [
					{
						id: entry.id,
						kind: 'search',
						label: entry.label,
						description: 'Find a topic, a name, a question: the desk knows the way.',
					},
				]
			case 'connect':
				return [
					{
						id: entry.id,
						kind: 'connect',
						label: entry.label,
						description: 'How scripts and assistants read this record: the connector.',
					},
				]
			case 'method':
				return [
					{
						id: entry.id,
						kind: 'method',
						label: entry.label,
						description: 'The method: how the record was read, clustered and written.',
					},
				]
			default:
				return []
		}
	})
}

/** The section's own address a building of the island stands for: its id
 *  as the island's destination declares it (kolo's landmark feature id). */
export const sectionIdOfBuilding = (buildingId: string): string =>
	landmarkOfFeature(buildingId) ?? buildingId

/** The section a building of the island is, from its id — the id is the
 *  section's own address ('topics', 'sources', 'analysis:<task>',
 *  'search', 'method', 'connect') as the island's destination declares it
 *  (kolo's landmark feature id); null for a building that is none. */
export function sectionOfBuilding(
	buildingId: string,
): { kind: ReportSectionKind; taskId?: string } | null {
	const id = sectionIdOfBuilding(buildingId)
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

/** A task's question hall, by the task. */
export const qhallSpace = (taskId: string): string => `q:${taskId}`

/** The FRONT ROOM a section's building leads into (world.ts builds the
 *  rooms so named): the hall for topics, the office for sources, a task's
 *  question hall for an analysis; null for a section stood in the open. */
export function frontRoomOf(section: Pick<ReportSection, 'kind' | 'taskId'>): string | null {
	switch (section.kind) {
		case 'topics':
			return 'hall'
		case 'sources':
			return 'office'
		case 'analysis':
			return section.taskId === undefined ? null : qhallSpace(section.taskId)
		case 'connect':
		case 'method':
		case 'search':
			return null
		default: {
			const unknown: never = section.kind
			throw new Error(`[sections] no front room for ${String(unknown)}`)
		}
	}
}

/** The pin inside a front room at its door to the island (world.ts names
 *  it so), where the island's door lands a visitor. */
export const frontDoorPinOf = (sectionId: string): string => `door:entrance:${sectionId}`
