// A report as a chessboard world — THE WORLD IS A FUNCTION OF THE RECORD.
//
// The island is the report's SITE: one building per section (the Hall of
// Topics, the Archive, one per custom analysis, the beacon, the method
// board), the sky table in its square, the harbour, a docent. Inside, every topic
// and every source is a room, and the record's relations are ITEMS you read
// and jump into (the engine's dive): a source's written perspective on a
// topic IS the way to that topic from the source's room, and the way to the
// source from the topic's.
//
//   topic room    a NAVE ROOM (atlas nave-plan.ts): the key points on the
//                 reading rail at its centre, read as one accordion; a
//                 hallway per cohort of the first analysed facet, the
//                 cohort's lens at its mouth and the cohort's sources'
//                 perspectives down it (by grade when the run analysed no
//                 facet); a second facet's lenses and the topic's other
//                 groups at the nave's end; the way back is its primary
//                 group's room.
//   source room   a nave room: its documents on the rail, one panel each; a
//                 hallway per family of the topics it engaged, the family's
//                 card at the mouth and its perspectives down it; its answers
//                 to a question task in a hallway of their own; its other
//                 cohorts as plaques by the door; the way back is its home
//                 cohort's gallery.
//   cohort room   every source carrying the value; for every topic the
//                 cohort has a lens on, the lens, jumped through to the topic.
//   group room    a card for each child (group or topic).
//   question room every source that answered, its answer jumped through to
//                 the source.
//
// A link between two rooms is ONE record (both items share its id), so a
// way always has its counterpart and reads from either side; a bay's
// heading card is the one way that is one-way (into a family's or a task's
// front room). A room past the planner's capacity splits into wings (I,
// II, …) chained by doors. Rooms are built on entry, so a record of
// thousands of sources costs nothing until someone walks in. Three-free:
// the relay builds the world from no record (the island alone) and the
// spaces agree.

import { type BuildingRoom, buildingPlan } from '@aicolab/atlas/chessboard/content/building-plan.ts'
import { gridPlan } from '@aicolab/atlas/chessboard/content/grid-plan.ts'
import {
	DeclaredIsland,
	type IslandAdditions,
	type IslandWords,
} from '@aicolab/atlas/chessboard/content/island/declared-world.ts'
import { placeChoice } from '@aicolab/atlas/chessboard/content/island/island-places.ts'
import type { IslandBuilding, IslandPlan } from '@aicolab/atlas/chessboard/content/island/plan.ts'
import { maxItemsFor, planItemRoom } from '@aicolab/atlas/chessboard/content/item-room-plan.ts'
import { READ_ACTION } from '@aicolab/atlas/chessboard/content/lens.ts'
import {
	HALLWAY_CAPACITY,
	HALLWAY_CHILDREN,
	HALLWAYS_PER_SIDE,
	hallwayCapacity,
	type NaveBayLoad,
	type NaveRailLoad,
	planNaveRoom,
} from '@aicolab/atlas/chessboard/content/nave-plan.ts'
import {
	type ChartInlay,
	type DoorStyle,
	GALLERY_FLOOR_TOP,
	onWallPlan,
	type RoomPlan,
} from '@aicolab/atlas/chessboard/content/room-plan.ts'
import { SURFACE_LEVEL } from '@aicolab/atlas/three/levels.ts'
import {
	type ChessboardInteractable,
	type ChessboardMap,
	type ChessboardSpace,
	type ChessboardWorld,
	DIVE_ACTION,
	FIND_ACTION,
	type Findable,
	type PlanTurn,
	turnOffset,
} from '@aicolab/kolo/chessboard/content'
import {
	isPromptTask,
	type WorldAnswer,
	type WorldFacet,
	type WorldGroup,
	type WorldPrompt,
	type WorldReadingRef,
	type WorldRecord,
	type WorldSource,
	type WorldText,
	type WorldTextRef,
	type WorldTopic,
	worldRecordSchema,
} from '../world/index.ts'
import {
	type IslandPlanOf,
	islandPlanOfReport,
	type ReportIslandPlan,
	reportIslandPlan,
} from './plan.ts'
import { type ReportIsland, TRAINING_DATA } from './registry.ts'
import { holdsRooms, sectionOfBuilding } from './sections.ts'
import { SKY_TABLE_ID, starsOf, TOPIC_ACCENT } from './sky-table.ts'

export { worldRecordSchema }

/* ── items: what hangs on a wall, and what you can jump into ────────────── */

/** `points` is a room's key points, read as one accordion from the reading
 *  rail; `card` is a room's card for a room beyond it (a family's card for
 *  one of its topics): nothing to read, only somewhere to jump. */
export type ReportItemKind =
	| 'perspective'
	| 'lens'
	| 'points'
	| 'document'
	| 'answer'
	| 'plaque'
	| 'card'

/** The card a wall shows for an item (the museum's exhibit card). */
export interface ReportCard {
	title: string
	date: string
	tags: readonly string[]
	excerpt: string
}

export interface ReportItem {
	id: string
	kind: ReportItemKind
	card: ReportCard
	/** What the sheet reads: the lede, the position, the quotes — as the record
	 *  gives them, and as its room's text fills them (`text`). */
	eyebrow: string
	title: string
	detail: string
	position: string | null
	lede: string
	quotes: readonly { text: string; source: string | null }[]
	/** Where its words are, when they are a room's text and not the record's. */
	text: ItemText | null
	/** The key points fetched when the sheet opens, when the item has any. */
	reading: WorldReadingRef | null
	/** Rooms this item speaks of — "go there" chips. */
	visits: readonly { label: string; spaceId: string }[]
}

/** An item's words in a room's text: whose text (`ref`) and the row there. */
export type ItemText =
	| { kind: 'perspective'; ref: WorldTextRef; topicId: number; sourceId: string }
	| { kind: 'lens'; ref: WorldTextRef; topicId: number; facet: string; value: string }
	| {
			kind: 'answer'
			ref: WorldTextRef
			taskId: string
			promptKey: string
			documentId: string
			/** What the words are said of, for the card a text fills. */
			source: string
			clause: string
			document: string | null
	  }

/** Where a room's rail panels are written: its topic's key points, its one
 *  document's, the quotes of the lens heading a han. Null for a rail whose
 *  panels the record names (a source's documents, a question's text). */
type RailText =
	| { kind: 'points' }
	| { kind: 'document'; documentId: string }
	| { kind: 'lens'; topicId: number; facet: string; value: string }

/* ── rooms as built ─────────────────────────────────────────────────────── */

export interface ReportRoomBuild {
	spaceId: string
	label: string
	subtitle: string
	accent: string
	building: string
	plan: RoomPlan
	exhibits: { anchorId: string; card: ReportCard; itemId: string }[]
	chart?: ChartInlay
	/** Whose text its walls carry (a topic, a source, a cohort, a task); null
	 *  for a room the record writes up alone (a hall, a group, the office). */
	text: WorldTextRef | null
	/** Where its rail's panels are written, when its text writes them. */
	rail: RailText | null
}

/** The record as a sky: every topic a star at its baked place — what the
 *  table in the island's square shows. */
export interface ReportSky {
	stars: { x: number; y: number; r: number; accent: string; label: string }[]
}

export interface ReportWorldBuild {
	world: ChessboardWorld
	plan: ReportIslandPlan
	sky: ReportSky
	rooms: ReportRoomBuild[]
	/** Each building's rooms as its plan is drawn from them — the same
	 *  rooms the map re-plots when it shows a subset of the building. */
	buildings: ReadonlyMap<string, readonly BuildingRoom[]>
	items: ReadonlyMap<string, ReportItem>
	/** What the record holds, for finding: every theme, topic, cohort,
	 *  source and question, each the room it has — its themes first. */
	findables: Findable[]
	record: WorldRecord | null
	/** A room as its text writes it up: its cards, its rail, its things'
	 *  words — what its scene is built from once the text is read. */
	withText(
		spaceId: string,
		text: WorldText,
	): { room: ReportRoomBuild; space: ChessboardSpace } | null
}

/** A subset of the record's rooms, named by one of the record's own
 *  relations: a group (its topics and the groups under it), a cohort (the
 *  sources carrying the facet value, the topics it has a lens on), a topic
 *  (its strong sources), a question (the sources that answered). The id is
 *  the relation's own room. The info desk holds finding to one; the map
 *  draws one; standing in a room is standing in its own. */
export interface ReportScope {
	kind: 'group' | 'cohort' | 'topic' | 'question'
	/** The scope's room: `g:<id>`, `c:<facet>:<value>`, `t:<id>`, `q:<task>:<key>`. */
	id: string
	label: string
}

const topicSpace = (id: number) => `t:${id}`
const groupSpace = (id: number) => `g:${id}`
const sourceSpace = (id: string) => `s:${id}`
const cohortSpace = (facet: string, value: string) => `c:${facet}:${slug(value)}`
/** A facet's hall in the Sources building: its cohorts' thresholds. Only
 *  a record with MORE THAN ONE analysed facet has them; with one, the
 *  office introduces that facet's cohorts itself. */
const facetSpace = (facet: string) => `f:${facet}`
const hasFacetHalls = (record: WorldRecord): boolean => record.facets.length > 1
const questionSpace = (taskId: string, key: string) => `q:${taskId}:${slug(key)}`
const qhallSpace = (taskId: string) => `q:${taskId}`

/** The rooms a scope selects, from the record's relations, with every
 *  wing and han that hangs off a selected room (by the building's own
 *  parent links, never by reading ids). */
export function relatedRooms(build: ReportWorldBuild, scope: ReportScope): Set<string> {
	const record = build.record
	const seeds = new Set<string>([scope.id])
	if (record) {
		if (scope.kind === 'group') {
			// The group, the groups under it, and every topic in any of them.
			const groupIds = new Set<number>()
			let frontier = record.groups.filter((g) => groupSpace(g.id) === scope.id).map((g) => g.id)
			while (frontier.length > 0) {
				for (const id of frontier) groupIds.add(id)
				frontier = record.groups
					.filter((g) => g.parentId != null && groupIds.has(g.parentId) && !groupIds.has(g.id))
					.map((g) => g.id)
			}
			for (const id of groupIds) seeds.add(groupSpace(id))
			for (const t of record.topics) {
				if (t.parents.some((p) => groupIds.has(p.groupId))) seeds.add(topicSpace(t.id))
			}
		} else if (scope.kind === 'cohort') {
			for (const facet of record.facets) {
				for (const v of facet.values) {
					if (cohortSpace(facet.key, v.value) !== scope.id) continue
					for (const s of record.sources) {
						if ((s.facets[facet.key] ?? []).includes(v.value)) seeds.add(sourceSpace(s.id))
					}
					for (const t of record.topics) {
						if (t.lenses.some((l) => l.facet === facet.key && l.value === v.value)) {
							seeds.add(topicSpace(t.id))
						}
					}
				}
			}
		} else if (scope.kind === 'topic') {
			const topic = record.topics.find((t) => topicSpace(t.id) === scope.id)
			if (topic) {
				for (const m of record.memberships) {
					if (m.topicId === topic.id) seeds.add(sourceSpace(m.sourceId))
				}
				for (const p of topic.parents) seeds.add(groupSpace(p.groupId))
			}
		} else {
			for (const task of record.tasks) {
				if (!isPromptTask(task)) continue
				for (const q of task.prompts) {
					if (questionSpace(task.id, q.key) !== scope.id) continue
					for (const a of q.answers) seeds.add(sourceSpace(a.sourceId))
				}
			}
		}
	}
	// A room's wings and hans come with it: they are the rooms reached from
	// it, so anything whose parent chain reaches a selected room. (A front
	// hall is never a seed: everything in its building is reached from it.)
	const related = new Set(seeds)
	for (const rooms of build.buildings.values()) {
		const parentOf = new Map(rooms.map((r) => [r.spaceId, r.parent]))
		for (const room of rooms) {
			let current: string | null = room.spaceId
			for (let hops = 0; current && hops < 64; hops++) {
				if (seeds.has(current)) {
					related.add(room.spaceId)
					break
				}
				current = parentOf.get(current) ?? null
			}
		}
	}
	return related
}

/** A building's plain name on the map: Topics, Sources, a task's title,
 *  else its front room's own name (a lobby). */
export function buildingLabel(build: ReportWorldBuild, spaceId: string): string {
	const building = build.rooms.find((r) => r.spaceId === spaceId)?.building
	if (building === 'topics') return 'Topics'
	if (building === 'sources') return 'Sources'
	const task = build.record?.tasks.find((t) => `analysis:${t.id}` === building)
	if (task) return task.title
	const front = build.rooms.find((r) => r.spaceId === building)
	return front?.label ?? build.world.spaces.find((s) => s.id === spaceId)?.label ?? ''
}

/* ── the map's rule ─────────────────────────────────────────────────────── */
// The map draws the room you stand in, every room above it up to its
// front hall, and nothing below — except that a front hall also draws the
// rooms one door down. Wings and hans are the same room spilling over, so
// they are drawn with it and the map does not change inside them. "Above"
// is every parent the record gives a room, not only the primary: a topic's
// groups, a group's parent group (else the hall), a source's lobby for every
// facet value it carries (else the office), a lobby's office, a question's
// task hall. The rooms are placed on a grid of cells, each room on the side
// of the room it is reached from that its door faces, so corridors stay
// short and never cross; the plan is drawn by `gridPlan`.

/** The entities' own rooms, by the record: what a wing or a han continues. */
function entityRooms(record: WorldRecord): Set<string> {
	const rooms = new Set<string>(['hall', 'office'])
	for (const t of record.topics) rooms.add(topicSpace(t.id))
	for (const g of record.groups) rooms.add(groupSpace(g.id))
	for (const s of record.sources) rooms.add(sourceSpace(s.id))
	for (const facet of record.facets) {
		if (hasFacetHalls(record)) rooms.add(facetSpace(facet.key))
		for (const v of facet.values) rooms.add(cohortSpace(facet.key, v.value))
	}
	for (const task of record.tasks) {
		rooms.add(qhallSpace(task.id))
		if (!isPromptTask(task)) continue
		for (const q of task.prompts) rooms.add(questionSpace(task.id, q.key))
	}
	return rooms
}

/** The rooms above a room in the record: every parent. */
function parentsOf(record: WorldRecord, spaceId: string): string[] {
	for (const t of record.topics) {
		if (topicSpace(t.id) !== spaceId) continue
		return t.parents.length > 0 ? t.parents.map((p) => groupSpace(p.groupId)) : ['hall']
	}
	for (const g of record.groups) {
		if (groupSpace(g.id) === spaceId) return [g.parentId != null ? groupSpace(g.parentId) : 'hall']
	}
	for (const s of record.sources) {
		if (sourceSpace(s.id) !== spaceId) continue
		const lobbies = record.facets.flatMap((facet) =>
			(s.facets[facet.key] ?? []).flatMap((value) =>
				facet.values.some((v) => v.value === value) ? [cohortSpace(facet.key, value)] : [],
			),
		)
		return lobbies.length > 0 ? lobbies : ['office']
	}
	for (const facet of record.facets) {
		// A cohort's lobby is reached from its facet's hall when the record
		// has them, else from the office; a facet's hall from the office.
		const above = hasFacetHalls(record) ? facetSpace(facet.key) : 'office'
		if (facetSpace(facet.key) === spaceId && hasFacetHalls(record)) return ['office']
		for (const v of facet.values) {
			if (cohortSpace(facet.key, v.value) === spaceId) return [above]
		}
	}
	for (const task of record.tasks) {
		if (!isPromptTask(task)) continue
		for (const q of task.prompts) {
			if (questionSpace(task.id, q.key) === spaceId) return [qhallSpace(task.id)]
		}
	}
	return []
}

/** A front hall's sections: the rooms one door down. */
function sectionsOf(record: WorldRecord, spaceId: string): string[] {
	if (spaceId === 'hall') {
		return [
			...record.groups.filter((g) => g.parentId == null).map((g) => groupSpace(g.id)),
			...record.topics.filter((t) => t.parents.length === 0).map((t) => topicSpace(t.id)),
		]
	}
	if (spaceId === 'office') {
		return hasFacetHalls(record)
			? record.facets.map((facet) => facetSpace(facet.key))
			: record.facets.flatMap((facet) => facet.values.map((v) => cohortSpace(facet.key, v.value)))
	}
	for (const facet of record.facets) {
		if (hasFacetHalls(record) && facetSpace(facet.key) === spaceId) {
			return facet.values.map((v) => cohortSpace(facet.key, v.value))
		}
	}
	for (const task of record.tasks) {
		if (qhallSpace(task.id) !== spaceId || !isPromptTask(task)) continue
		return task.prompts.map((q) => questionSpace(task.id, q.key))
	}
	return []
}

/** The map for where you stand: the rooms the rule selects, placed and
 *  drawn. Null when the world has no record or the room is not a
 *  building's (the island keeps its own plan). */
export function mapOf(build: ReportWorldBuild, spaceId: string): ChessboardMap | null {
	const record = build.record
	if (!record) return null
	const building = build.rooms.find((r) => r.spaceId === spaceId)?.building
	if (!building) return null
	// Every building's rooms: the rule crosses buildings (a source's lobby
	// is a building of its own; its office is another).
	const rooms = [...build.buildings.values()].flat()
	const byId = new Map(rooms.map((r) => [r.spaceId, r]))
	const entities = entityRooms(record)
	// The room you stand in: a wing or a han is its room.
	const homeOf = (id: string): string => {
		let current = id
		for (let hops = 0; hops < 64 && !entities.has(current); hops++) {
			const parent = byId.get(current)?.parent
			if (!parent) break
			current = parent
		}
		return current
	}
	/** A room's overflow: every room whose parent chain reaches it without
	 *  passing another entity's room (its wings and hans, their hans). */
	const overflowOf = (home: string): string[] =>
		rooms.filter((r) => r.spaceId !== home && homeOf(r.spaceId) === home).map((r) => r.spaceId)
	const home = homeOf(spaceId)
	const front = isHallOfSections(record, home)
	// Cells: the home at the origin; a parent on the side its up door faces
	// (rows run down the plan, so the front hall ends up lowest); a wing
	// beyond its onward door, a han beyond its alley's door; a front hall's
	// sections on the side each bay's door faces. A cell already taken
	// yields to the nearest free one.
	const cells = new Map<string, [number, number]>()
	const taken = new Set<string>()
	const key = (c: number, r: number) => `${c},${r}`
	// Every room but yours is TURNED to face the room it is reached from:
	// the one quarter-turn that points its door at the door it is reached
	// through, so the corridor between them is a straight stub. Your room
	// is never turned; the turns compose outward along the door edges.
	const turns = new Map<string, PlanTurn>()
	const turnOf = (id: string): PlanTurn => turns.get(id) ?? 0
	const faceTurn = (id: string, doorId: string, wanted: [number, number]): PlanTurn => {
		const plan = byId.get(id)?.plan
		const door = plan?.doors.find((d) => d.doorId === doorId)
		const wall = door ? plan?.walls.find((w) => w.id === door.wallId) : undefined
		if (!wall) return 0
		const out: [number, number] = [Math.sign(wall.outward[0]), Math.sign(wall.outward[1])]
		for (const k of [0, 1, 2, 3] as const) {
			const [x, z] = turnOffset(out[0], out[1], k)
			if (x === wanted[0] && z === wanted[1]) return k
		}
		return 0
	}
	/** Placed beside `from` through its door, and turned to face it. */
	const placeFacing = (id: string, from: string, doorId: string | null, fallback: DoorStep) => {
		const step = doorId ? doorDir(from, doorId) : fallback
		place(id, cells.get(from) ?? [0, 0], step)
		if (doorId && !turns.has(id)) turns.set(id, faceTurn(id, doorId, [-step.dir[0], -step.dir[1]]))
	}
	const place = (id: string, from: [number, number], step: DoorStep): void => {
		if (cells.has(id)) return
		const { dir, lateral } = step
		// Beside `from` on the door's side, shifted along that wall to where
		// the door is, so a room's rooms-through-doors fan out along it.
		const want: [number, number] = [
			from[0] + dir[0] + (dir[0] === 0 ? lateral : 0),
			from[1] + dir[1] + (dir[1] === 0 ? lateral : 0),
		]
		let best: [number, number] | null = null
		let bestCost = Number.POSITIVE_INFINITY
		for (let dc = -6; dc <= 6; dc++) {
			for (let dr = -6; dr <= 6; dr++) {
				const c = want[0] + dc
				const r = want[1] + dr
				if (taken.has(key(c, r)) || (c === from[0] && r === from[1])) continue
				// Nearest to the wanted cell, staying on the wanted side of `from`.
				const side = dir[0] * (c - from[0]) + dir[1] * (r - from[1])
				const cost = Math.abs(dc) + Math.abs(dr) + (side > 0 ? 0 : 4)
				if (cost < bestCost) {
					bestCost = cost
					best = [c, r]
				}
			}
		}
		const at = best ?? want
		cells.set(id, at)
		taken.add(key(at[0], at[1]))
	}
	/** Which way a door on a room's plan faces: its wall's outward normal,
	 *  as a step on the grid (x east, z south = down the plan). */
	const doorDir = (id: string, doorId: string): DoorStep => {
		const plan = byId.get(id)?.plan
		const door = plan?.doors.find((d) => d.doorId === doorId)
		const wall = door ? plan?.walls.find((w) => w.id === door.wallId) : undefined
		if (!plan || !wall) return { dir: [0, 1], lateral: 0 }
		// As the room is drawn: its walls turned with it.
		const turn = turnOf(id)
		const outward = (w: { outward: readonly [number, number] }): [number, number] => {
			const [x, z] = turnOffset(w.outward[0], w.outward[1], turn)
			return [Math.sign(x), Math.sign(z)]
		}
		const dir = outward(wall)
		// The room's doors that face this way, in order along that side
		// (each alley's end wall is a wall of its own, so this is by the
		// room, not the wall), centred: with two doors facing west, the north
		// one wants the row above and the south one this row, so their rooms
		// fan out along the side.
		const facing = plan.doors.flatMap((d) => {
			const w = plan.walls.find((x) => x.id === d.wallId)
			if (!w) return []
			const o = outward(w)
			if (o[0] !== dir[0] || o[1] !== dir[1]) return []
			const along = w.doors.find((x) => x.doorId === d.doorId)?.along ?? 0
			const [lx, lz] = onWallPlan(w, along, 0)
			const [px, pz] = turnOffset(lx, lz, turn)
			return [{ doorId: d.doorId, sideways: dir[0] !== 0 ? pz : px }]
		})
		const ordered = facing.sort((p, q) => p.sideways - q.sideways)
		const rank = ordered.findIndex((d) => d.doorId === doorId)
		const lateral = rank < 0 ? 0 : Math.floor(rank - (ordered.length - 1) / 2)
		return { dir, lateral }
	}
	/** The door of `room` that opens on `other`: the same door id on both plans. */
	const doorBetween = (room: string, other: string): string | null => {
		const mine = byId.get(room)?.plan.doors ?? []
		const theirs = new Set((byId.get(other)?.plan.doors ?? []).map((d) => d.doorId))
		return mine.find((d) => theirs.has(d.doorId))?.doorId ?? null
	}
	const placeOverflow = (ofHome: string) => {
		for (const id of overflowOf(ofHome)) {
			const parent = byId.get(id)?.parent
			if (!parent || !cells.has(parent)) continue
			placeFacing(id, parent, doorBetween(parent, id), NORTH)
		}
	}
	cells.set(home, [0, 0])
	taken.add(key(0, 0))
	placeOverflow(home)
	// Up the record to the front hall, every parent, breadth first.
	const drawn = new Set<string>([home, ...overflowOf(home)])
	let frontier = [home]
	for (let hops = 0; hops < 64 && frontier.length > 0; hops++) {
		const next: string[] = []
		for (const id of frontier) {
			for (const parent of parentsOf(record, id)) {
				if (!byId.has(parent)) continue
				if (!cells.has(parent)) {
					// Through the child's up door, from the room that holds it.
					placeFacing(parent, id, doorBetween(id, parent), SOUTH)
					placeOverflow(parent)
				}
				if (!drawn.has(parent)) {
					drawn.add(parent)
					for (const o of overflowOf(parent)) drawn.add(o)
					next.push(parent)
				}
			}
		}
		frontier = next
	}
	// A front hall's sections, one door down, on the side each door faces.
	if (front) {
		for (const section of sectionsOf(record, home)) {
			if (!byId.has(section)) continue
			const holder = [home, ...overflowOf(home)].find((h) => doorBetween(h, section)) ?? home
			placeFacing(section, holder, doorBetween(holder, section), EAST)
			drawn.add(section)
		}
	}
	const gridRooms = [...drawn].flatMap((id) => {
		const room = byId.get(id)
		const cell = cells.get(id)
		return room && cell ? [{ spaceId: id, plan: room.plan, cell, turn: turnOf(id) }] : []
	})
	// Every door shared by two drawn rooms.
	const doors: { doorId: string; a: string; b: string }[] = []
	const list = [...drawn]
	for (let i = 0; i < list.length; i++) {
		for (let j = i + 1; j < list.length; j++) {
			const a = list[i]
			const b = list[j]
			if (!a || !b) continue
			const doorId = doorBetween(a, b)
			if (doorId) doors.push({ doorId, a, b })
		}
	}
	const frontRoom = list.find((id) => isFrontRoom(record, id))
	return gridPlan({
		rooms: gridRooms,
		doors,
		...(frontRoom ? { entrance: { spaceId: frontRoom, doorId: `door:entrance:${building}` } } : {}),
	})
}

/** A step on the map's grid through a door: which way the door faces, and
 *  where along its wall it is (−1 / 0 / 1: the third of the wall). */
interface DoorStep {
	dir: [number, number]
	lateral: number
}
const NORTH: DoorStep = { dir: [0, -1], lateral: 0 }
const SOUTH: DoorStep = { dir: [0, 1], lateral: 0 }
const EAST: DoorStep = { dir: [1, 0], lateral: 0 }

function isFrontRoom(record: WorldRecord, spaceId: string): boolean {
	return (
		spaceId === 'hall' ||
		spaceId === 'office' ||
		record.tasks.some((task) => qhallSpace(task.id) === spaceId)
	)
}

/** A hall that introduces sections — the map draws it with the rooms one
 *  door down: every front hall, and a facet's hall inside the office. */
function isHallOfSections(record: WorldRecord, spaceId: string): boolean {
	return (
		isFrontRoom(record, spaceId) ||
		(hasFacetHalls(record) && record.facets.some((f) => facetSpace(f.key) === spaceId))
	)
}

/** The scope a room stands in: a topic's primary group, a group itself, a
 *  source's first cohort, a lobby's cohort, a question's own; a wing or a
 *  han stands in its room's. A front hall stands in none. */
export function scopeOfRoom(build: ReportWorldBuild, spaceId: string): ReportScope | null {
	const record = build.record
	if (!record) return null
	// A wing or a han stands in the room it continues: up the parent links
	// to the first room that is an entity's own.
	let id = spaceId
	for (const rooms of build.buildings.values()) {
		const parentOf = new Map(rooms.map((r) => [r.spaceId, r.parent]))
		if (!parentOf.has(id)) continue
		for (let hops = 0; hops < 64; hops++) {
			const found = scopeOfEntity(record, id)
			if (found) return found
			const parent = parentOf.get(id)
			if (!parent) break
			id = parent
		}
	}
	return scopeOfEntity(record, id)
}

function scopeOfEntity(record: WorldRecord, spaceId: string): ReportScope | null {
	const groupById = new Map(record.groups.map((g) => [g.id, g]))
	for (const t of record.topics) {
		if (topicSpace(t.id) !== spaceId) continue
		const primary = t.parents.find((p) => p.isPrimary) ?? t.parents[0]
		const group = primary ? groupById.get(primary.groupId) : undefined
		return group ? { kind: 'group', id: groupSpace(group.id), label: group.title } : null
	}
	for (const g of record.groups) {
		if (groupSpace(g.id) === spaceId) return { kind: 'group', id: spaceId, label: g.title }
	}
	for (const facet of record.facets) {
		for (const v of facet.values) {
			if (cohortSpace(facet.key, v.value) === spaceId) {
				return { kind: 'cohort', id: spaceId, label: v.label }
			}
		}
	}
	for (const s of record.sources) {
		if (sourceSpace(s.id) !== spaceId) continue
		for (const facet of record.facets) {
			const value = (s.facets[facet.key] ?? [])[0]
			const v = value ? facet.values.find((x) => x.value === value) : undefined
			if (v) return { kind: 'cohort', id: cohortSpace(facet.key, v.value), label: v.label }
		}
		return null
	}
	for (const task of record.tasks) {
		if (!isPromptTask(task)) continue
		for (const q of task.prompts) {
			if (questionSpace(task.id, q.key) === spaceId) {
				return { kind: 'question', id: spaceId, label: q.clause }
			}
		}
	}
	return null
}

/* ── accents by kind ────────────────────────────────────────────────────── */

const ACCENT = {
	topic: TOPIC_ACCENT,
	group: '#9c78b6',
	source: '#56b5a7',
	cohort: '#819ad1',
	question: '#cf775f',
	hall: TOPIC_ACCENT,
	office: '#56b5a7',
	task: '#cf775f',
	map: '#4f6d9b',
	way: '#8d6a40',
} as const

const style = (accent: string, grand = false): DoorStyle => (grand ? { accent, grand } : { accent })

/* ── nodes and links ────────────────────────────────────────────────────── */

/** `han`: the wing an alley overflows into, at any depth — a topic's cohort
 *  too big for its alcove, a family with more groups than an alley opens.
 *  The alley keeps its leading items and a door in its end wall; the han
 *  holds the rest (its remaining cross-alleys, its remaining cards in
 *  alphabetical ranges), the alley's heading on its plinth when it has one. */
type NodeKind =
	| 'hall'
	| 'office'
	| 'fhall'
	| 'qhall'
	| 'group'
	| 'topic'
	| 'source'
	| 'cohort'
	| 'question'
	| 'han'

/** Where an item stands in a nave room. */
type Place =
	| { at: 'bay'; bay: string }
	| { at: 'heading'; bay: string }
	| { at: 'byDoor' }
	| { at: 'naveEnd' }
	| { at: 'rail' }

/** An alley of a nave room: its id (unique within the room), its painted
 *  name, which side of the nave it opens off (else alternating), and its
 *  cross-alleys, to any depth. Items are placed in an alley by id. */
interface BaySpec {
	id: string
	label: string
	side?: 'west' | 'east'
	children?: BaySpec[]
}

/** A nave room's structure: its alleys in order and what stands at its
 *  centre: the rail, or the info desk whose finding is held to this room's
 *  world. */
interface NaveSpec {
	bays: BaySpec[]
	rail: NaveRailLoad | null
	/** The table at the nave's centre, where there is no rail: a lobby's
	 *  info desk held to its cohort, or a front hall's chart table. */
	desk?: { scope: string; label: string } | 'chart'
}

/** How many of a section's items a front hall hangs in its introducing
 *  bay: a taste, beside the plaque, before the door. */
const TASTE = 3

interface Node {
	id: string
	kind: NodeKind
	label: string
	subtitle: string
	accent: string
	building: string
	/** Items hung here that are no link's end (a room's own cards). */
	looseItems: string[]
	/** A topic's or a source's room is a nave room; the rest hang as a list. */
	nave: NaveSpec | null
	/** Where each item stands in a nave room; an unplaced item hangs at the nave's end. */
	placement: Map<string, Place>
	/** For a han: the node whose link end each moved item is (an item may
	 *  be both ends of its own link, so the side cannot be read off it). */
	origin: Map<string, string>
	/** Whose text its walls carry: a topic's, a source's, a cohort's, a
	 *  task's (a han carries its room's); null for a room of the record alone. */
	text: WorldTextRef | null
	/** Where its rail's panels are written, when its text writes them. */
	rail: RailText | null
}

interface Link {
	id: string
	a: string
	b: string
	/** The item beside the door on each side, when there is one. */
	itemA: string | null
	itemB: string | null
	/** The door's style on each side. */
	styleA: DoorStyle
	styleB: DoorStyle
	/** The node for which this link is the way back (its up door). */
	upFor: string | null
	/** On side a, this link is the door in the back wall of this bay's
	 *  alcove (a hub's way into a cohort's wing, a front hall's way into a
	 *  section's room): no card hangs for it. */
	bayDoor?: string
	/** A taste: side a's card goes through to the room on side b, landing
	 *  at its own door; side b hangs nothing for it (the way back is the
	 *  room's). */
	taste?: true
	/** The door's label and hover line on each side. */
	labelA: string
	labelB: string
	descriptionA: string
	descriptionB: string
}

const slug = (value: string) =>
	value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '') || 'x'

const numeral = (i: number) =>
	['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][i] ?? String(i + 1)

/** Alphabetical ranges of at most an alley each, as even as they come,
 *  signed by the initials they span, the way a library signs its stacks.
 *  `ids` come already sorted by `nameOf`. */
function rangeBays(
	ids: readonly string[],
	nameOf: (id: string) => string,
): { bays: BaySpec[]; rangeOf: Map<string, string> } {
	const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?'
	const rangeCount = Math.ceil(ids.length / HALLWAY_CAPACITY)
	const rangeSize = rangeCount > 0 ? Math.ceil(ids.length / rangeCount) : 0
	const rangeOf = new Map<string, string>()
	const bays: BaySpec[] = []
	for (let k = 0; k < rangeCount; k++) {
		const members = ids.slice(k * rangeSize, (k + 1) * rangeSize)
		const from = members[0]
		const to = members[members.length - 1]
		if (!from || !to) continue
		const a = initial(nameOf(from))
		const z = initial(nameOf(to))
		const id = `range:${k}`
		bays.push({ id, label: a === z ? a : `${a}–${z}` })
		for (const member of members) rangeOf.set(member, id)
	}
	return { bays, rangeOf }
}
const clip = (text: string, max = 180) =>
	text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** An exhibit's hover line: its card's date, and what jumping in does. */
const exhibitDescription = (card: ReportCard, item: ReportItem, leads: boolean): string =>
	leads
		? `${card.date} · ${item.kind === 'card' ? 'a way through' : 'jump in to go there'}`
		: card.date

/** What an exhibit says when examined: its card's excerpt, else the item's lede, else its title. */
const exhibitLine = (card: ReportCard, item: ReportItem): string =>
	card.excerpt || item.lede || item.title

/**
 * An item as a room's text writes it up: a stance's title and analysis, a
 * lens's analysis and quotes, an answer's lead and position (an answer's
 * card in a task's hall takes its lead as the excerpt). An item the text does
 * not hold is as the record gave it.
 */
export function itemWithText(item: ReportItem, text: WorldText): ReportItem {
	const at = item.text
	if (!at) return item
	switch (at.kind) {
		case 'perspective': {
			const p = text.perspectives.find(
				(x) => x.topicId === at.topicId && x.sourceId === at.sourceId,
			)
			if (!p) return item
			return {
				...item,
				title: p.title || item.title,
				lede: p.analysis,
				card: { ...item.card, title: p.title || item.card.title, excerpt: clip(p.analysis) },
			}
		}
		case 'lens': {
			const l = text.lenses.find(
				(x) => x.topicId === at.topicId && x.facet === at.facet && x.value === at.value,
			)
			if (!l) return item
			return {
				...item,
				lede: l.analysis,
				quotes: l.quotes,
				card: { ...item.card, excerpt: clip(l.analysis) },
			}
		}
		case 'answer': {
			const a = text.answers.find(
				(x) =>
					x.taskId === at.taskId && x.promptKey === at.promptKey && x.documentId === at.documentId,
			)
			if (!a) return item
			if (item.kind === 'card') {
				// a taste of the answer in its task's hall
				const excerpt = clip(a.lead ?? `${at.source} addressed ${at.clause}.`)
				return { ...item, lede: excerpt, card: { ...item.card, excerpt } }
			}
			return {
				...item,
				title: a.lead ?? `${at.source} on ${at.clause}`,
				detail: [at.clause, at.document, a.position].filter(Boolean).join(' · '),
				position: a.position || null,
				card: {
					...item.card,
					title: a.lead ?? at.source,
					date: clip(a.position || 'Answered', 72),
					excerpt: clip(
						a.lead ? `${at.source}: ${a.lead}` : `${at.source} addressed ${at.clause}.`,
					),
				},
			}
		}
	}
}

/** A rail's panels as its room's text writes them. */
function railPanelsOf(rail: RailText, text: WorldText): readonly string[] {
	switch (rail.kind) {
		case 'points':
			return text.points
		case 'document':
			return text.documents.find((d) => d.id === rail.documentId)?.points ?? []
		case 'lens':
			return (
				text.lenses
					.find(
						(l) => l.topicId === rail.topicId && l.facet === rail.facet && l.value === rail.value,
					)
					?.quotes.map((q) => q.text) ?? []
			)
	}
}

/** So many rail panels, planned before their text is read (it writes them). */
const unwritten = (n: number): string[] => Array.from({ length: n }, () => '')
const documentRail = (documentId: string): RailText => ({ kind: 'document', documentId })
const lensRail = (topicId: number, facet: string, value: string): RailText => ({
	kind: 'lens',
	topicId,
	facet,
	value,
})

/** The nouns a record calls its things by, else the plain ones. */
const nounsOf = (record: WorldRecord | null) =>
	record?.site.nouns ?? {
		entity: 'source',
		entities: 'sources',
		document: 'document',
		documents: 'documents',
	}

/** A report's SITE on the one base (atlas island/declared-world.ts): what
 *  the report adds to the island its record declares — its title and its
 *  line, the docent and what she says of the record, the sky table's
 *  words and its finding, each section's front room behind its door, the
 *  way from each landmark to its place, and every room. */
class ReportSite extends DeclaredIsland {
	constructor(
		private readonly report: {
			key: string
			/** The relay room the island is served in: the DO's name. */
			name: string
			record: WorldRecord | null
			rooms: readonly ChessboardSpace[]
			/** A building's front room, when the record gives it one. */
			frontOf(buildingId: string): string | null
		},
	) {
		super(report.key)
	}

	protected override additions(plan: IslandPlan): IslandAdditions {
		const { record, rooms, frontOf } = this.report
		const site = record?.site
		const nouns = nounsOf(record)
		const harbour = plan.harbour
		if (!harbour)
			throw new Error(`[report] '${this.key}' has no harbour for its docent to walk from`)
		const hallBuilding = plan.buildings.find((b) => sectionOfBuilding(b.id)?.kind === 'topics')
		const hallStep = hallBuilding ? plan.doorstep(hallBuilding) : harbour.steps
		/** A landmark's words: what it is, and the way to its place — the
		 *  section it is, on the page beside the world (settled 2026-10-27);
		 *  the desk finds things here as well. */
		const landmark = (b: IslandBuilding): IslandWords => {
			switch (sectionOfBuilding(b.id)?.kind) {
				case 'connect':
					return {
						dialogue: {
							lines: [
								{
									text: `${b.label}. ${b.description}`,
									choices: [placeChoice('Open the connector', b.id), { label: 'Noted.' }],
								},
							],
						},
					}
				case 'method':
					return {
						dialogue: {
							lines: [
								{
									text: `${b.label}. ${b.description}`,
									choices: [placeChoice('Read the method', b.id), { label: 'Noted.' }],
								},
							],
						},
					}
				case 'search':
					return {
						dialogue: {
							lines: [
								{
									speaker: b.label,
									text: `${b.description} Ask here and it will walk you there, or search the whole report on the page.`,
									choices: [
										{ label: 'Find something here', action: { type: FIND_ACTION } },
										placeChoice('Search the report', b.id),
										{ label: 'Just looking, thanks.' },
									],
								},
							],
						},
					}
				default:
					return {}
			}
		}
		return {
			label: site?.title ?? 'A report',
			subtitle: site
				? `${site.eyebrow ?? ''}${site.eyebrow ? ' · ' : ''}${plural(record?.sources.length ?? 0, nouns.entity, nouns.entities)} · ${plural(record?.topics.length ?? 0, 'topic', 'topics')}`
				: 'An Insight Bridge report, as an island',
			view: { distance: 34, pitch: (52 * Math.PI) / 180 },
			guide: {
				id: 'guide:docent',
				label: 'The docent',
				route: [
					[harbour.steps[0], SURFACE_LEVEL, harbour.steps[1] - 6],
					[hallStep[0], SURFACE_LEVEL, hallStep[1] + 6],
				],
				dwellSeconds: 8,
				talkSeconds: 40,
				dialogue: {
					lines: [
						{
							text: site
								? `Welcome to ${site.title}. ${site.standfirst ?? ''} The square is just up the avenue: its table shows the whole record as a sky. The Hall of Topics stands at the top of the island; the Archive holds every ${nouns.entity}.`
								: 'Welcome. The record has not arrived yet; the buildings stand ready.',
							choices: [{ label: 'Where do I start?', next: 1 }, { label: 'Thank you.' }],
						},
						{
							text: `If you know what you are looking for, the sky table in the square will find it and walk you there. If you want the shape of it first, stand at the table and look up.`,
							choices: [{ label: 'On my way.' }],
						},
					],
				},
			},
			words: {
				// The sky table: the record as a sky — the report's galaxy, whose
				// place it is — and the way to any of it.
				[SKY_TABLE_ID]: {
					dialogue: {
						lines: [
							{
								speaker: 'The sky table',
								text: `${record ? plural(record.topics.length, 'topic', 'topics') : 'The topics'} as stars, placed by who engaged what, and ${nouns.entities} as the dust between them. Choose any star or any ${nouns.entity} and the table will walk you there.`,
								choices: [
									{ label: 'Find something', action: { type: FIND_ACTION } },
									placeChoice('See the galaxy', 'galaxy'),
									{ label: 'Just looking, thanks.' },
								],
							},
						],
					},
				},
				// The landmarks: the beacon, the method board, the information desk.
				...Object.fromEntries(
					plan.buildings.flatMap((b) => {
						const section = sectionOfBuilding(b.id)
						return section && holdsRooms(section.kind) ? [] : [[b.id, landmark(b)]]
					}),
				),
			},
			interiors: Object.fromEntries(
				plan.buildings.flatMap((b) => {
					const front = frontOf(b.id)
					return front ? [[b.id, { space: front, entry: `door:entrance:${b.id}` }]] : []
				}),
			),
			spaces: rooms,
		}
	}
}

/**
 * The world for a record (null = the island alone: the relay, a route's
 * validation, the app before the record arrives), on the report island
 * it is served as (Training Data, the proving island, by default).
 */
export function buildReportWorld(
	record: WorldRecord | null,
	planOf: IslandPlanOf = reportIslandPlan,
	island: ReportIsland = TRAINING_DATA,
): ReportWorldBuild {
	const plan = planOf(record, island.slug)
	const items = new Map<string, ReportItem>()
	const nodes = new Map<string, Node>()
	const links: Link[] = []
	const findables: Findable[] = []

	const nouns = nounsOf(record)
	const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

	/** A cohort lobby's alley for each lensed topic, and the range for each
	 *  of its sources. */
	const cohortAlleys = new Map<string, Map<number, string>>()
	const cohortRanges = new Map<string, Map<string, string>>()
	/** Items and placements declared for a node before it is added (a front
	 *  hall's bays are built as its node is): kept until the node exists. */
	const pending = new Map<string, { loose: string[]; placed: [string, Place][] }>()
	const pendingFor = (nodeId: string) => {
		let p = pending.get(nodeId)
		if (!p) {
			p = { loose: [], placed: [] }
			pending.set(nodeId, p)
		}
		return p
	}
	const addNode = (
		input: Omit<Node, 'nave' | 'placement' | 'origin' | 'text' | 'rail'> & {
			nave?: NaveSpec | null
			text?: WorldTextRef
			rail?: RailText
		},
	): Node => {
		const p = pending.get(input.id)
		pending.delete(input.id)
		const node: Node = {
			...input,
			looseItems: [...input.looseItems, ...(p?.loose ?? [])],
			nave: input.nave ?? null,
			placement: new Map(p?.placed ?? []),
			origin: new Map(),
			text: input.text ?? null,
			rail: input.rail ?? null,
		}
		nodes.set(node.id, node)
		return node
	}
	const place = (nodeId: string, itemId: string, at: Place): void => {
		const node = nodes.get(nodeId)
		if (node) node.placement.set(itemId, at)
		else pendingFor(nodeId).placed.push([itemId, at])
	}
	/** An item of a node's own — no link's end — hung where it is placed. */
	const loose = (nodeId: string, itemId: string): void => {
		const node = nodes.get(nodeId)
		if (node) node.looseItems.push(itemId)
		else pendingFor(nodeId).loose.push(itemId)
	}
	const addLink = (link: Link): void => {
		links.push(link)
	}

	if (record) {
		const facetByKey = new Map(record.facets.map((f) => [f.key, f]))
		const topicById = new Map(record.topics.map((t) => [t.id, t]))
		const groupById = new Map(record.groups.map((g) => [g.id, g]))
		const sourceById = new Map(record.sources.map((s) => [s.id, s]))
		const perspectiveByPair = new Map(
			record.perspectives.map((p) => [`${p.topicId}|${p.sourceId}`, p]),
		)
		const valueLabel = (facet: WorldFacet, value: string) =>
			facet.values.find((v) => v.value === value)?.label ?? value
		// A source's facets are the COHORTS it belongs to: the values the
		// record's facets declare (each of those is a lobby). A value a source
		// carries that its facet does not declare (One Basin's sources carry
		// `unknown` on a facet whose declared values are the known sectors)
		// is no cohort, so it names no room and no way up.
		const facetsOfSource = (sourceId: string): { facet: WorldFacet; value: string }[] => {
			const source = sourceById.get(sourceId)
			if (!source) return []
			return record.facets.flatMap((facet) =>
				(source.facets[facet.key] ?? [])
					.filter((value) => facet.values.some((v) => v.value === value))
					.map((value) => ({ facet, value })),
			)
		}
		const sourceDetail = (sourceId: string): string =>
			facetsOfSource(sourceId)
				.map(({ facet, value }) => valueLabel(facet, value))
				.join(' · ')
		const gradeWord = (grade: string) => (grade === 'exemplar' ? 'exemplar' : 'high value')

		/* ── the structure of the nave rooms ── */
		// A topic's hallways are the cohorts of the FIRST analysed facet (a
		// source's first value on it); with no facet analysed, its grades. A
		// source's hallways are the families (the top generation) of the topics
		// it engaged, then its answers to each question task.
		const firstFacet = record.facets[0] ?? null
		const cohortOf = (sourceId: string): string | null =>
			firstFacet ? ((sourceById.get(sourceId)?.facets[firstFacet.key] ?? [])[0] ?? null) : null
		const cohortBay = (value: string | null) =>
			value === null ? 'cohort:none' : `cohort:${slug(value)}`
		const cohortBayLabel = (value: string | null) =>
			value === null || !firstFacet ? 'Not classified' : valueLabel(firstFacet, value)
		const gradeBay = (grade: string) => `grade:${grade}`
		const familyOf = (topicId: number): number | null => {
			const t = topicById.get(topicId)
			const primary = t?.parents.find((p) => p.isPrimary) ?? t?.parents[0]
			let g = primary ? groupById.get(primary.groupId) : undefined
			while (g && g.parentId != null) g = groupById.get(g.parentId)
			return g?.id ?? null
		}
		const familyBay = (groupId: number | null) =>
			groupId === null ? 'family:none' : `family:${groupId}`
		const strongTopicsOf = new Map<string, number[]>()
		const strongCohortsOf = new Map<number, Set<string | null>>()
		const strongGradesOf = new Map<number, Set<string>>()
		for (const m of record.memberships) {
			const list = strongTopicsOf.get(m.sourceId) ?? []
			list.push(m.topicId)
			strongTopicsOf.set(m.sourceId, list)
			const cohorts = strongCohortsOf.get(m.topicId) ?? new Set()
			cohorts.add(cohortOf(m.sourceId))
			strongCohortsOf.set(m.topicId, cohorts)
			const grades = strongGradesOf.get(m.topicId) ?? new Set()
			grades.add(m.grade)
			strongGradesOf.set(m.topicId, grades)
		}
		const answeredTasksOf = new Map<string, string[]>()
		for (const task of record.tasks) {
			if (!isPromptTask(task)) continue
			const answered = new Set(task.prompts.flatMap((q) => q.answers.map((a) => a.sourceId)))
			for (const sourceId of answered) {
				const list = answeredTasksOf.get(sourceId) ?? []
				list.push(task.id)
				answeredTasksOf.set(sourceId, list)
			}
		}
		const valueOrder = new Map((firstFacet?.values ?? []).map((v, i) => [v.value, i]))
		const cohortRank = (value: string | null) =>
			value === null ? 999 : (valueOrder.get(value) ?? 999)
		const familyOrder = new Map(record.groups.map((g, i) => [g.id, i]))
		const nameOf = (sourceId: string) => sourceById.get(sourceId)?.name ?? sourceId
		/** Topics as alleys by the run's hierarchy: a top-level group is an
		 *  alley, its child groups are cross-alleys, recursively, each
		 *  holding the topics whose own (primary) group it is; topics with no
		 *  group share one alley. Only groups on a lensed topic's line appear. */
		const hierarchyAlleys = (
			topics: readonly WorldTopic[],
		): { bays: BaySpec[]; alleyOfTopic: Map<number, string> } => {
			const specs = new Map<number, BaySpec>()
			const roots: BaySpec[] = []
			const alleyOfTopic = new Map<number, string>()
			let loose = false
			const specFor = (groupId: number): BaySpec | undefined => {
				const have = specs.get(groupId)
				if (have) return have
				const g = groupById.get(groupId)
				if (!g) return undefined
				const spec: BaySpec = { id: `g:${g.id}`, label: g.title, children: [] }
				specs.set(groupId, spec)
				if (g.parentId == null) roots.push(spec)
				else {
					const parent = specFor(g.parentId)
					if (parent) parent.children?.push(spec)
					else roots.push(spec)
				}
				return spec
			}
			for (const t of topics) {
				const primary = t.parents.find((p) => p.isPrimary) ?? t.parents[0]
				const spec = primary ? specFor(primary.groupId) : undefined
				if (spec) alleyOfTopic.set(t.id, spec.id)
				else {
					alleyOfTopic.set(t.id, 'topics')
					loose = true
				}
			}
			const order = (list: BaySpec[]): BaySpec[] =>
				list
					.sort(
						(a, b) =>
							(familyOrder.get(Number(a.id.slice(2))) ?? 0) -
							(familyOrder.get(Number(b.id.slice(2))) ?? 0),
					)
					.map((b) => ({ ...b, children: b.children ? order(b.children) : undefined }))
			return {
				bays: [...order(roots), ...(loose ? [{ id: 'topics', label: 'Topics' }] : [])],
				alleyOfTopic,
			}
		}

		/* ── introducing bays: a front hall's threshold to each section ── */
		// The Hintze Hall's form: a bay per section down the nave, each a
		// threshold — the section's name on its pier, its plaque (what it is,
		// how much it holds), a TASTE of its items as cards that go through to
		// their rooms, and the door at the alley's end into the section's own
		// room. The section's link to the hall carries the door (`bayDoor`).
		const introduce = (
			hall: string,
			section: { id: string; label: string; eyebrow: string; description: string; detail: string },
			taste: readonly {
				room: string
				title: string
				detail: string
				excerpt: string
				/** Where its excerpt is written, when the hall's text writes it (an answer's). */
				text?: ItemText
			}[],
		): BaySpec => {
			const plaqueId = `plaque:${hall}:${section.id}`
			items.set(plaqueId, {
				id: plaqueId,
				kind: 'plaque',
				card: {
					title: section.label,
					date: section.eyebrow,
					tags: [],
					excerpt: clip(section.description || section.detail),
				},
				eyebrow: section.eyebrow,
				title: section.label,
				detail: section.detail,
				position: null,
				lede: section.description || section.detail,
				quotes: [],
				text: null,
				reading: null,
				visits: [{ label: section.label, spaceId: section.id }],
			})
			loose(hall, plaqueId)
			place(hall, plaqueId, { at: 'bay', bay: section.id })
			for (const t of taste.slice(0, TASTE)) {
				const id = `taste:${hall}:${section.id}:${t.room}`
				items.set(id, {
					id,
					kind: 'card',
					card: { title: t.title, date: section.label, tags: [], excerpt: t.excerpt },
					eyebrow: section.label,
					title: t.title,
					detail: t.detail,
					position: null,
					lede: t.excerpt,
					quotes: [],
					text: t.text ?? null,
					reading: null,
					visits: [
						{ label: t.title, spaceId: t.room },
						{ label: section.label, spaceId: section.id },
					],
				})
				place(hall, id, { at: 'bay', bay: section.id })
				addLink({
					id: `${hall}~${section.id}~${t.room}`,
					a: hall,
					b: t.room,
					itemA: id,
					itemB: null,
					styleA: style(ACCENT.way),
					styleB: style(ACCENT.way),
					upFor: null,
					taste: true,
					labelA: t.title,
					labelB: t.title,
					descriptionA: `Through to ${t.title}.`,
					descriptionB: '',
				})
			}
			return { id: section.id, label: section.label }
		}
		const genLabel = (g: WorldGroup) =>
			record.generations.find((x) => x.generation === g.generation)?.label ?? 'group'
		/** A group's topics, direct and down its sub-groups, by reach. */
		const topicsUnder = (groupId: number): WorldTopic[] => {
			const under = new Set<number>([groupId])
			let grew = true
			while (grew) {
				grew = false
				for (const g of record.groups) {
					if (g.parentId != null && under.has(g.parentId) && !under.has(g.id)) {
						under.add(g.id)
						grew = true
					}
				}
			}
			return record.topics
				.filter((t) => {
					const primary = t.parents.find((p) => p.isPrimary) ?? t.parents[0]
					return primary ? under.has(primary.groupId) : false
				})
				.sort((a, b) => b.sources - a.sources)
		}
		const topicTaste = (t: WorldTopic) => ({
			room: topicSpace(t.id),
			title: t.title,
			detail: `Topic · ${plural(t.sources, nouns.entity, nouns.entities)}`,
			excerpt: clip(t.description),
		})
		const groupBay = (hall: string, g: WorldGroup): BaySpec =>
			introduce(
				hall,
				{
					id: groupSpace(g.id),
					label: g.title,
					eyebrow: cap(genLabel(g)),
					description: g.description ?? '',
					detail: `${plural(g.topics, 'topic', 'topics')} · ${plural(g.sources, nouns.entity, nouns.entities)}`,
				},
				topicsUnder(g.id).map(topicTaste),
			)
		/** A group's own topics — every topic that belongs to it, primary
		 *  member or not — in alphabetical ranges, as the alleys of its room
		 *  after its sub-groups' bays; a topic with no group is the hall's. */
		const directTopics = new Map<string, number[]>()
		for (const t of record.topics) {
			const ups = t.parents.length > 0 ? t.parents.map((p) => groupSpace(p.groupId)) : ['hall']
			for (const up of new Set(ups)) {
				const list = directTopics.get(up) ?? []
				list.push(t.id)
				directTopics.set(up, list)
			}
		}
		// By the index, not a search: this is called from inside a sort over a
		// hall's topics, and a record of thousands of topics made it the
		// whole cost of the build.
		const topicTitle = (id: number) => topicById.get(id)?.title ?? String(id)
		/** A hall's or group's topics in alphabetical ranges: sorted ONCE per
		 *  room and kept, as the ranges are asked for again by every topic
		 *  hung in them (a 276-topic record once re-sorted them seventeen
		 *  million comparisons' worth). */
		const rangesByUp = new Map<string, ReturnType<typeof rangeBays>>()
		const topicRanges = (up: string) => {
			const kept = rangesByUp.get(up)
			if (kept) return kept
			const ids = [...(directTopics.get(up) ?? [])].sort((a, b) =>
				topicTitle(a).localeCompare(topicTitle(b)),
			)
			const ranges = rangeBays(
				ids.map((id) => String(id)),
				(id) => topicTitle(Number(id)),
			)
			rangesByUp.set(up, ranges)
			return ranges
		}

		/* ── the Hall: hall, groups, topics ── */
		const hallRanges = topicRanges('hall')
		addNode({
			id: 'hall',
			kind: 'hall',
			label: 'The Hall of Topics',
			subtitle: `${plural(record.topics.length, 'topic', 'topics')}${record.groups.length ? ` in ${plural(record.groups.length, record.generations[0]?.label ?? 'group', record.generations[0]?.labelPlural ?? 'groups')}` : ''} · the chart table knows the way to each`,
			accent: ACCENT.hall,
			building: 'topics',
			looseItems: [],
			nave: {
				bays: [
					...record.groups.filter((g) => g.parentId == null).map((g) => groupBay('hall', g)),
					...hallRanges.bays,
				],
				rail: null,
				desk: 'chart',
			},
		})
		for (const g of record.groups) {
			const gen = record.generations.find((x) => x.generation === g.generation)
			const ranges = topicRanges(groupSpace(g.id))
			addNode({
				id: groupSpace(g.id),
				kind: 'group',
				label: g.title,
				subtitle: `${cap(gen?.label ?? 'group')} · ${plural(g.topics, 'topic', 'topics')} · ${plural(g.sources, nouns.entity, nouns.entities)}`,
				accent: ACCENT.group,
				building: 'topics',
				looseItems: [],
				// The group's room: its sub-groups' introducing bays, then its
				// own topics down alphabetical alleys.
				nave: {
					bays: [
						...record.groups
							.filter((child) => child.parentId === g.id)
							.map((child) => groupBay(groupSpace(g.id), child)),
						...ranges.bays,
					],
					rail: null,
				},
			})
			findables.push({
				id: groupSpace(g.id),
				title: g.title,
				what: cap(gen?.label ?? 'group'),
				space: groupSpace(g.id),
				meta: plural(g.topics, 'topic', 'topics'),
				...(g.description ? { terms: g.description } : {}),
				// The record's themes — its groups at the top — come first.
				highlight: g.parentId == null,
			})
			// Up: the parent group, else the hall — the door at the end of this
			// group's introducing bay there.
			const parent = g.parentId != null ? groupSpace(g.parentId) : 'hall'
			addLink({
				id: `${parent}--${groupSpace(g.id)}`,
				a: parent,
				b: groupSpace(g.id),
				itemA: null,
				itemB: null,
				styleA: style(ACCENT.group, true),
				styleB: style(ACCENT.way),
				upFor: groupSpace(g.id),
				bayDoor: groupSpace(g.id),
				labelA: g.title,
				labelB:
					parent === 'hall'
						? 'Back to the hall'
						: (groupById.get(g.parentId ?? -1)?.title ?? 'Back'),
				descriptionA: `${cap(gen?.label ?? 'group')}: ${plural(g.topics, 'topic', 'topics')}.`,
				descriptionB: 'The way back.',
			})
		}
		for (const t of record.topics) {
			const space = topicSpace(t.id)
			// The hallways: the cohorts with a strong source here, in the facet's
			// order (the unclassified last); the grades when no facet was analysed.
			const bays = firstFacet
				? [...(strongCohortsOf.get(t.id) ?? [])]
						.sort((a, b) => cohortRank(a) - cohortRank(b))
						.map((value) => ({ id: cohortBay(value), label: cohortBayLabel(value) }))
				: ['exemplar', 'high_value']
						.filter((grade) => strongGradesOf.get(t.id)?.has(grade))
						.map((grade) => ({
							id: gradeBay(grade),
							label: grade === 'exemplar' ? 'Exemplars' : 'High value',
						}))
			const node = addNode({
				id: space,
				kind: 'topic',
				label: t.title,
				subtitle: `Topic · ${plural(t.sources, nouns.entity, nouns.entities)} · ${plural(t.documents, nouns.document, nouns.documents)}`,
				accent: ACCENT.topic,
				building: 'topics',
				looseItems: [],
				nave: {
					bays,
					// its key points' headlines round the rail, written by its text
					rail: { title: t.title, panels: unwritten(t.keyPoints), anchors: 'plinth' },
				},
				text: { kind: 'topic', topicId: t.id },
				rail: { kind: 'points' },
			})
			findables.push({
				id: space,
				title: t.title,
				what: 'Topic',
				space,
				meta: plural(t.sources, nouns.entity, nouns.entities),
				terms: [
					...t.lenses.map((l) =>
						valueLabel(
							facetByKey.get(l.facet) ?? { key: l.facet, heading: l.facet, values: [] },
							l.value,
						),
					),
					t.description,
				].join(' '),
			})
			// The key points: one reading from the rail's plinth, every point
			// a panel round it.
			if (t.keyPoints > 0) {
				const id = `points:${t.id}`
				items.set(id, {
					id,
					kind: 'points',
					card: {
						title: t.title,
						date: plural(t.keyPoints, 'key point', 'key points'),
						tags: [],
						excerpt: clip(t.description),
					},
					eyebrow: 'Key points',
					title: t.title,
					detail: plural(t.keyPoints, 'key point', 'key points'),
					position: null,
					lede: t.description,
					quotes: [],
					text: null,
					reading: { kind: 'topic', topicId: t.id },
					visits: [],
				})
				node.looseItems.push(id)
				place(space, id, { at: 'rail' })
			}
			// Up: the primary group (else the hall); other groups by door. The
			// card for this topic hangs in its group's alphabetical alley.
			const primary = t.parents.find((p) => p.isPrimary) ?? t.parents[0]
			const up = primary ? groupSpace(primary.groupId) : 'hall'
			addLink({
				id: `${up}--${space}`,
				a: up,
				b: space,
				itemA: null,
				itemB: null,
				styleA: style(ACCENT.topic, primary?.isPrimary ?? false),
				styleB: style(ACCENT.way),
				upFor: space,
				labelA: t.title,
				labelB: primary ? (groupById.get(primary.groupId)?.title ?? 'Back') : 'Back to the hall',
				descriptionA: `Topic: ${plural(t.sources, nouns.entity, nouns.entities)}.`,
				descriptionB: 'The way back.',
			})
			const range = topicRanges(up).rangeOf.get(String(t.id))
			if (range) place(up, `card:${up}--${space}:a`, { at: 'bay', bay: range })
			for (const p of t.parents) {
				if (p === primary) continue
				const gs = groupSpace(p.groupId)
				addLink({
					id: `${gs}--${space}`,
					a: gs,
					b: space,
					itemA: null,
					itemB: null,
					styleA: style(ACCENT.topic),
					styleB: style(ACCENT.group),
					upFor: null,
					labelA: t.title,
					labelB: groupById.get(p.groupId)?.title ?? 'A group',
					descriptionA: `Also in this ${record.generations.find((x) => x.generation === groupById.get(p.groupId)?.generation)?.label ?? 'group'} (${p.membershipType ?? 'member'}).`,
					descriptionB: `This topic also belongs here (${p.membershipType ?? 'member'}).`,
				})
				// Its card hangs in that group's alphabetical alleys like any
				// member's: the group's ranges hold every topic that belongs to it.
				const also = topicRanges(gs).rangeOf.get(String(t.id))
				if (also) place(gs, `card:${gs}--${space}:a`, { at: 'bay', bay: also })
			}
		}

		/* ── the Record Office: office, cohorts, sources ── */
		/** A source's weight for a taste: how many topics it is strong in
		 *  (the record carries the strong memberships only). */
		const strongCount = new Map<string, number>()
		for (const m of record.memberships) {
			strongCount.set(m.sourceId, (strongCount.get(m.sourceId) ?? 0) + 1)
		}
		const sourceTaste = (s: WorldSource) => ({
			room: sourceSpace(s.id),
			title: s.name,
			detail: `${cap(nouns.entity)} · ${plural(s.documents.length, nouns.document, nouns.documents)}`,
			excerpt: clip(s.documents.map((d) => d.title).join(' · ')),
		})
		/** A cohort's threshold in the hall that introduces it: who they are,
		 *  how many, the weightiest few — through to its lobby. */
		const cohortThreshold = (hall: string, facet: WorldFacet, v: WorldFacet['values'][number]) =>
			introduce(
				hall,
				{
					id: cohortSpace(facet.key, v.value),
					label: v.label,
					eyebrow: facet.heading,
					description: '',
					detail: `${plural(v.sources, nouns.entity, nouns.entities)} read as ${v.label}`,
				},
				record.sources
					.filter((s) => (s.facets[facet.key] ?? []).includes(v.value))
					.sort((a, b) => (strongCount.get(b.id) ?? 0) - (strongCount.get(a.id) ?? 0))
					.map(sourceTaste),
			)
		addNode({
			id: 'office',
			kind: 'office',
			label: 'The Record Office',
			subtitle: `${plural(record.sources.length, nouns.entity, nouns.entities)} · a room each · the counter finds any of them`,
			accent: ACCENT.office,
			building: 'sources',
			looseItems: [],
			// The office's bays: with one analysed facet, a threshold per cohort
			// — who they are, how many, the weightiest few — through to its
			// lobby; with several, a threshold per FACET through to the facet's
			// hall, where its cohorts have theirs.
			nave: {
				bays: hasFacetHalls(record)
					? record.facets.map((facet) =>
							introduce(
								'office',
								{
									id: facetSpace(facet.key),
									label: facet.heading,
									eyebrow: 'By',
									description: '',
									detail: `${plural(facet.values.length, 'cohort', 'cohorts')} · ${plural(record.sources.length, nouns.entity, nouns.entities)} read by ${facet.heading.toLowerCase()}`,
								},
								[...facet.values]
									.sort((a, b) => b.sources - a.sources)
									.map((v) => ({
										room: cohortSpace(facet.key, v.value),
										title: v.label,
										detail: `${plural(v.sources, nouns.entity, nouns.entities)}`,
										excerpt: `${plural(v.sources, nouns.entity, nouns.entities)} read as ${v.label}.`,
									})),
							),
						)
					: record.facets.flatMap((facet) =>
							facet.values.map((v) => cohortThreshold('office', facet, v)),
						),
				rail: null,
				desk: 'chart',
			},
		})
		// A facet's hall, when the record has several: the cohorts' thresholds.
		if (hasFacetHalls(record)) {
			for (const facet of record.facets) {
				const hall = facetSpace(facet.key)
				addNode({
					id: hall,
					kind: 'fhall',
					label: facet.heading,
					subtitle: `${plural(facet.values.length, 'cohort', 'cohorts')} · ${plural(record.sources.length, nouns.entity, nouns.entities)} read by ${facet.heading.toLowerCase()}`,
					accent: ACCENT.office,
					building: 'sources',
					looseItems: [],
					nave: {
						bays: facet.values.map((v) => cohortThreshold(hall, facet, v)),
						rail: null,
					},
				})
				addLink({
					id: `office--${hall}`,
					a: 'office',
					b: hall,
					itemA: null,
					itemB: null,
					styleA: style(ACCENT.cohort, true),
					styleB: style(ACCENT.way),
					upFor: hall,
					bayDoor: hall,
					labelA: facet.heading,
					labelB: 'Back to the office',
					descriptionA: `${plural(record.sources.length, nouns.entity, nouns.entities)} by ${facet.heading.toLowerCase()}.`,
					descriptionB: 'The way back.',
				})
			}
		}
		for (const facet of record.facets) {
			for (const v of facet.values) {
				const space = cohortSpace(facet.key, v.value)
				// The cohort's LOBBY: on its west side the topics this cohort has
				// a lens on, as alleys by the run's own hierarchy (a family's
				// alley, its groups as cross-alleys, to any depth); on its east
				// side the cohort's sources in alphabetical ranges; the info desk
				// at its centre.
				const lensed = record.topics.filter((t) =>
					t.lenses.some((l) => l.facet === facet.key && l.value === v.value),
				)
				const topicsSide = hierarchyAlleys(lensed)
				cohortAlleys.set(space, topicsSide.alleyOfTopic)
				const members = record.sources
					.filter((s) => (s.facets[facet.key] ?? []).includes(v.value))
					.map((s) => s.id)
					.sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
				const sourcesSide = rangeBays(members, nameOf)
				cohortRanges.set(space, sourcesSide.rangeOf)
				// The lobby is a building of its own on the plan: the lobby and
				// the hans off it. The rooms its lenses and cards lead to are
				// items on its walls — lights on the plan, not rooms of it.
				addNode({
					id: space,
					kind: 'cohort',
					label: v.label,
					subtitle: `${facet.heading} · ${plural(v.sources, nouns.entity, nouns.entities)} · ${plural(lensed.length, 'topic', 'topics')} seen their way`,
					accent: ACCENT.cohort,
					building: space,
					looseItems: [],
					nave: {
						bays: [
							...topicsSide.bays.map((b) => ({ ...b, side: 'west' as const })),
							...sourcesSide.bays.map((b) => ({ ...b, side: 'east' as const })),
						],
						rail: null,
						desk: { scope: space, label: v.label },
					},
					text: { kind: 'cohort', facet: facet.key, value: v.value },
				})
				findables.push({
					id: space,
					title: v.label,
					what: facet.heading,
					space,
					meta: plural(v.sources, nouns.entity, nouns.entities),
				})
				// The way up: the facet's hall when the record has them, else the
				// office — the hall whose threshold carries this lobby's door.
				const above = hasFacetHalls(record) ? facetSpace(facet.key) : 'office'
				addLink({
					id: `${above}--${space}`,
					a: above,
					b: space,
					itemA: null,
					itemB: null,
					styleA: style(ACCENT.cohort),
					styleB: style(ACCENT.way),
					upFor: space,
					bayDoor: space,
					labelA: v.label,
					labelB: hasFacetHalls(record) ? `Back to ${facet.heading}` : 'Back to the office',
					descriptionA: `${facet.heading}: ${plural(v.sources, nouns.entity, nouns.entities)}.`,
					descriptionB: 'The way back.',
				})
			}
		}
		for (const s of record.sources) {
			const space = sourceSpace(s.id)
			const detail = sourceDetail(s.id)
			// The hallways: a family per family of the topics it engaged, in the
			// record's order; then its answers to each question task.
			const families = [...new Set((strongTopicsOf.get(s.id) ?? []).map(familyOf))].sort(
				(a, b) =>
					(a === null ? 999 : (familyOrder.get(a) ?? 999)) -
					(b === null ? 999 : (familyOrder.get(b) ?? 999)),
			)
			const familyBays = families.map((gid) => ({
				id: familyBay(gid),
				label: gid === null ? 'Topics' : (groupById.get(gid)?.title ?? 'Topics'),
				groupId: gid,
			}))
			const taskBays = (answeredTasksOf.get(s.id) ?? []).flatMap((taskId) => {
				const task = record.tasks.find((x) => x.id === taskId)
				return task ? [{ id: `task:${taskId}`, label: task.title, task }] : []
			})
			/** Its one document, when it has exactly one. */
			const sole = s.documents.length === 1 ? s.documents[0] : undefined
			const node = addNode({
				id: space,
				kind: 'source',
				label: s.name,
				subtitle: `${cap(nouns.entity)}${detail ? ` · ${detail}` : ''} · ${plural(s.documents.length, nouns.document, nouns.documents)}`,
				accent: ACCENT.source,
				building: 'sources',
				looseItems: [],
				nave: {
					bays: [...familyBays, ...taskBays].map(({ id, label }) => ({ id, label })),
					// The rail: a source with ONE document reads like a topic — that
					// document's key points round the ring (written by its text), one
					// reading from the plinth; with several, a panel per document, each
					// its own reading.
					rail: sole
						? { title: sole.title, panels: unwritten(sole.points), anchors: 'plinth' }
						: {
								title: s.name,
								panels: s.documents.map((d) => d.title),
								anchors: 'panels',
							},
				},
				text: { kind: 'source', sourceId: s.id },
				...(sole ? { rail: documentRail(sole.id) } : {}),
			})
			// A family's name and an analysis's name are painted on their
			// alleys' piers: labels for the grouping, not ways through (a way
			// with no way back, and not a need a reader here has).
			findables.push({
				id: space,
				title: s.name,
				what: cap(nouns.entity),
				space,
				...(detail ? { meta: detail } : {}),
				terms: [
					...facetsOfSource(s.id).map(({ facet, value }) => valueLabel(facet, value)),
					...s.documents.map((d) => d.title),
				].join(' '),
			})
			// Documents: a panel each on the rail.
			for (const d of s.documents) {
				const id = `document:${d.id}`
				items.set(id, {
					id,
					kind: 'document',
					card: {
						title: d.title,
						date: cap(nouns.document),
						tags: [],
						excerpt: d.points ? plural(d.points, 'key point', 'key points') : 'Not analysed.',
					},
					eyebrow: cap(nouns.document),
					title: d.title,
					detail: s.name,
					position: null,
					lede: d.points
						? `${plural(d.points, 'key point', 'key points')} the pipeline drew from it.`
						: 'The pipeline drew no key points from this document.',
					quotes: [],
					text: null,
					reading: d.points ? { kind: 'document', documentId: d.id } : null,
					visits: [],
				})
				node.looseItems.push(id)
				place(space, id, { at: 'rail' })
			}
			// Up: the first analysed facet's first value, else the office.
			const home = facetsOfSource(s.id)[0]
			const up = home ? cohortSpace(home.facet.key, home.value) : 'office'
			addLink({
				id: `${up}--${space}`,
				a: up,
				b: space,
				itemA: null,
				itemB: null,
				styleA: style(ACCENT.source),
				styleB: style(ACCENT.way),
				upFor: space,
				labelA: s.name,
				labelB: home ? valueLabel(home.facet, home.value) : 'Back to the office',
				descriptionA: `${cap(nouns.entity)}${detail ? ` · ${detail}` : ''}.`,
				descriptionB: 'The way back.',
			})
			// Other facet values: a door into each cohort, a plaque beside it.
			for (const { facet, value } of facetsOfSource(s.id).slice(1)) {
				const cs = cohortSpace(facet.key, value)
				const id = `plaque:${s.id}:${facet.key}:${slug(value)}`
				items.set(id, {
					id,
					kind: 'plaque',
					card: {
						title: valueLabel(facet, value),
						date: facet.heading,
						tags: [],
						excerpt: `${s.name} is read as ${valueLabel(facet, value)}.`,
					},
					eyebrow: facet.heading,
					title: valueLabel(facet, value),
					detail: s.name,
					position: null,
					lede: `The record classifies ${s.name} under ${valueLabel(facet, value)} (${facet.heading.toLowerCase()}).`,
					quotes: [],
					text: null,
					reading: null,
					visits: [{ label: `Everyone read as ${valueLabel(facet, value)}`, spaceId: cs }],
				})
				place(space, id, { at: 'byDoor' })
				addLink({
					id: `${cs}--${space}`,
					a: cs,
					b: space,
					itemA: null,
					itemB: id,
					styleA: style(ACCENT.source),
					styleB: style(ACCENT.cohort),
					upFor: null,
					labelA: s.name,
					labelB: valueLabel(facet, value),
					descriptionA: `${cap(nouns.entity)} · ${detail}.`,
					descriptionB: `${facet.heading}: the others read this way.`,
				})
			}
		}

		/* ── topic ↔ source: the voices ── */
		// Order a topic's voices by their cohort (first analysed facet) so each
		// hallway fills in order, then exemplars first.
		const voices = [...record.memberships].sort(
			(x, y) =>
				x.topicId - y.topicId ||
				cohortRank(cohortOf(x.sourceId)) - cohortRank(cohortOf(y.sourceId)) ||
				(x.grade === y.grade ? 0 : x.grade === 'exemplar' ? -1 : 1) ||
				(sourceById.get(x.sourceId)?.name ?? '').localeCompare(
					sourceById.get(y.sourceId)?.name ?? '',
				),
		)
		// A topic's bay for a voice: its cohort's alcove (or its grade's). A
		// cohort too big for its alcove overflows into a HAN — a wing of its
		// own — which the room assembly opens wherever an alley overflows.
		const topicBayOf = (m: (typeof voices)[number]) =>
			firstFacet ? cohortBay(cohortOf(m.sourceId)) : gradeBay(m.grade)
		for (const m of voices) {
			const t = topicById.get(m.topicId)
			const s = sourceById.get(m.sourceId)
			if (!t || !s) continue
			const p = perspectiveByPair.get(`${m.topicId}|${m.sourceId}`)
			const id = `perspective:${m.topicId}:${m.sourceId}`
			const detail = sourceDetail(s.id)
			const topicSide = topicSpace(t.id)
			items.set(id, {
				id,
				kind: 'perspective',
				card: {
					title: s.name,
					date: p ? p.position : gradeWord(m.grade),
					tags: [gradeWord(m.grade), ...(detail ? [detail] : [])],
					// a written stance's words are the room's text
					excerpt: p
						? ''
						: `${s.name} engaged this topic (${gradeWord(m.grade)}) without a written stance.`,
				},
				eyebrow: `${s.name} on this topic`,
				title: t.title,
				detail: [t.title, detail, gradeWord(m.grade)].filter(Boolean).join(' · '),
				position: p?.position ?? null,
				lede: '',
				quotes: [],
				text: p
					? {
							kind: 'perspective',
							ref: { kind: 'topic', topicId: t.id },
							topicId: t.id,
							sourceId: s.id,
						}
					: null,
				reading:
					p && (p.keyPoints > 0 || p.quotes > 0)
						? { kind: 'perspective', topicId: t.id, sourceId: s.id }
						: null,
				visits: [
					{ label: `${s.name}'s room`, spaceId: sourceSpace(s.id) },
					{ label: `The topic: ${t.title}`, spaceId: topicSpace(t.id) },
				],
			})
			// In the topic's room, down the source's cohort's alcove (or its
			// grade's); in the source's room, down the topic's family's.
			place(topicSide, id, { at: 'bay', bay: topicBayOf(m) })
			place(sourceSpace(s.id), id, { at: 'bay', bay: familyBay(familyOf(t.id)) })
			addLink({
				id: `${topicSide}--${sourceSpace(s.id)}`,
				a: topicSide,
				b: sourceSpace(s.id),
				itemA: id,
				itemB: id,
				styleA: style(ACCENT.source),
				styleB: style(ACCENT.topic),
				upFor: null,
				labelA: s.name,
				labelB: t.title,
				descriptionA: `${p ? `${p.position} · ` : ''}${gradeWord(m.grade)}${detail ? ` · ${detail}` : ''}. Through to their room.`,
				descriptionB: `${p ? `${p.position} · ` : ''}${gradeWord(m.grade)}. Through to the topic.`,
			})
		}

		/* ── topic ↔ cohort: the lenses ── */
		for (const t of record.topics) {
			for (const l of t.lenses) {
				const facet = facetByKey.get(l.facet)
				if (!facet) continue
				const cs = cohortSpace(facet.key, l.value)
				if (!nodes.has(cs)) continue
				const id = `lens:${t.id}:${facet.key}:${slug(l.value)}`
				const label = valueLabel(facet, l.value)
				items.set(id, {
					id,
					kind: 'lens',
					card: {
						title: `${label} on this`,
						date: l.position,
						tags: [facet.heading],
						// its analysis and quotes are the room's text
						excerpt: '',
					},
					eyebrow: `${facet.heading}: ${label}`,
					title: `${label} on ${t.title}`,
					detail: `${facet.heading} · ${l.position}`,
					position: l.position,
					lede: '',
					quotes: [],
					text: {
						kind: 'lens',
						ref: { kind: 'topic', topicId: t.id },
						topicId: t.id,
						facet: facet.key,
						value: l.value,
					},
					reading: null,
					visits: [
						{ label: `Everyone read as ${label}`, spaceId: cs },
						{ label: `The topic: ${t.title}`, spaceId: topicSpace(t.id) },
					],
				})
				// The first facet's lens heads its cohort's alcove when the
				// cohort has a strong source here; any other lens hangs at the
				// nave's end.
				const heads =
					firstFacet?.key === facet.key && strongCohortsOf.get(t.id)?.has(l.value) === true
				place(
					topicSpace(t.id),
					id,
					heads ? { at: 'heading', bay: cohortBay(l.value) } : { at: 'naveEnd' },
				)
				// In the cohort's lobby: down the alley of the topic's own group.
				place(cs, id, { at: 'bay', bay: cohortAlleys.get(cs)?.get(t.id) ?? 'topics' })
				addLink({
					id: `${topicSpace(t.id)}--${cs}`,
					a: topicSpace(t.id),
					b: cs,
					itemA: id,
					itemB: id,
					styleA: style(ACCENT.cohort),
					styleB: style(ACCENT.topic),
					upFor: null,
					labelA: label,
					labelB: t.title,
					descriptionA: `${facet.heading}: ${l.position}. Through to the ${label} gallery.`,
					descriptionB: `${label}: ${l.position}. Through to the topic.`,
				})
			}
		}

		/* ── the custom analyses ── */
		for (const task of record.tasks) {
			const hall = qhallSpace(task.id)
			const questionText = (text: string) => text.replace(/^\([a-z0-9]+\)\s*/i, '')
			/** The sources that answered a prompt, each once, first answer first. */
			const answerers = (q: WorldPrompt) => {
				const seen = new Set<string>()
				return q.answers.flatMap((a) => {
					if (seen.has(a.sourceId)) return []
					seen.add(a.sourceId)
					const s = sourceById.get(a.sourceId)
					return s ? [{ s, a }] : []
				})
			}
			/** Where an answer's words are: the task's text, by its prompt and document. */
			const answerText = (
				taskId: string,
				q: WorldPrompt,
				s: WorldSource,
				a: WorldAnswer,
			): ItemText => ({
				kind: 'answer',
				ref: { kind: 'task', taskId },
				taskId,
				promptKey: q.key,
				documentId: a.documentId,
				source: s.name,
				clause: q.clause,
				document: s.documents.find((d) => d.id === a.documentId)?.title ?? null,
			})
			/** A task's prompts are questions, or the criteria of an analysis. */
			const promptNoun =
				task.kind === 'question_response' ? ['question', 'questions'] : ['criterion', 'criteria']
			addNode({
				id: hall,
				kind: 'qhall',
				label: task.title,
				subtitle: isPromptTask(task)
					? `${plural(task.prompts.length, promptNoun[0] ?? 'prompt', promptNoun[1] ?? 'prompts')} the record was read against`
					: task.description || cap(task.kind.replace(/_/g, ' ')),
				accent: ACCENT.task,
				building: `analysis:${task.id}`,
				looseItems: [],
				// The hall's bays: a threshold per prompt — its clause on the
				// pier, its text on the plaque, the first few answers as a taste
				// (through to the answerers' rooms) — and the door to the prompt.
				nave: isPromptTask(task)
					? {
							bays: task.prompts.map((q) =>
								introduce(
									hall,
									{
										id: questionSpace(task.id, q.key),
										label: q.clause,
										eyebrow: q.group ?? task.title,
										description: questionText(q.text),
										detail: `${plural(new Set(q.answers.map((a) => a.sourceId)).size, nouns.entity, nouns.entities)} answered`,
									},
									answerers(q).map(({ s, a }) => ({
										room: sourceSpace(s.id),
										title: s.name,
										detail: q.clause,
										excerpt: `${s.name} addressed ${q.clause}.`,
										text: answerText(task.id, q, s, a),
									})),
								),
							),
							rail: null,
						}
					: null,
				text: { kind: 'task', taskId: task.id },
			})
			if (!isPromptTask(task)) continue
			for (const q of task.prompts) {
				const space = questionSpace(task.id, q.key)
				const sourcesAnswering = new Set(q.answers.map((a) => a.sourceId)).size
				// The question's room: the question itself on the plinth, its
				// answers down an alley per cohort (the first analysed facet).
				const answerCohorts = firstFacet
					? [...new Set(answerers(q).map(({ s }) => cohortOf(s.id)))].sort(
							(a, b) => cohortRank(a) - cohortRank(b),
						)
					: []
				addNode({
					id: space,
					kind: 'question',
					label: `${q.clause} ${clip(questionText(q.text), 60)}`,
					subtitle: `${plural(sourcesAnswering, nouns.entity, nouns.entities)} answered`,
					accent: ACCENT.question,
					building: `analysis:${task.id}`,
					looseItems: [],
					nave: {
						bays: firstFacet
							? answerCohorts.map((value) => ({
									id: cohortBay(value),
									label: cohortBayLabel(value),
								}))
							: [{ id: 'answers', label: 'Answers' }],
						rail: { title: q.clause, panels: [questionText(q.text)], anchors: 'plinth' },
					},
					text: { kind: 'task', taskId: task.id },
				})
				findables.push({
					id: space,
					title: `${q.clause} ${q.text.replace(/^\([a-z0-9]+\)\s*/i, '')}`,
					what: 'Question',
					space,
					meta: `${task.title} · ${plural(sourcesAnswering, nouns.entity, nouns.entities)} answered`,
				})
				addLink({
					id: `${hall}--${space}`,
					a: hall,
					b: space,
					itemA: null,
					itemB: null,
					styleA: style(ACCENT.question),
					styleB: style(ACCENT.way),
					upFor: space,
					bayDoor: space,
					labelA: `${q.clause} ${clip(q.text.replace(/^\([a-z0-9]+\)\s*/i, ''), 48)}`,
					labelB: `Back to ${task.title}`,
					descriptionA: `${plural(sourcesAnswering, nouns.entity, nouns.entities)} answered.`,
					descriptionB: 'The way back.',
				})
				// One door per answering source (its first answering document speaks).
				const seen = new Set<string>()
				for (const a of q.answers) {
					if (seen.has(a.sourceId)) continue
					seen.add(a.sourceId)
					const s = sourceById.get(a.sourceId)
					if (!s) continue
					const id = `answer:${task.id}:${slug(q.key)}:${s.id}`
					const doc = s.documents.find((d) => d.id === a.documentId)
					items.set(id, {
						id,
						kind: 'answer',
						// its lead and position are the room's text
						card: {
							title: s.name,
							date: 'Answered',
							tags: [q.clause],
							excerpt: `${s.name} addressed ${q.clause}.`,
						},
						eyebrow: `${s.name} on ${q.clause}`,
						title: `${s.name} on ${q.clause}`,
						detail: [q.clause, doc?.title].filter(Boolean).join(' · '),
						position: null,
						lede: q.text,
						quotes: [],
						text: answerText(task.id, q, s, a),
						reading:
							a.keyPoints > 0
								? { kind: 'answer', taskId: task.id, promptKey: q.key, documentId: a.documentId }
								: null,
						visits: [
							{ label: `${s.name}'s room`, spaceId: sourceSpace(s.id) },
							{ label: `The question ${q.clause}`, spaceId: space },
						],
					})
					place(sourceSpace(s.id), id, { at: 'bay', bay: `task:${task.id}` })
					place(space, id, {
						at: 'bay',
						bay: firstFacet ? cohortBay(cohortOf(s.id)) : 'answers',
					})
					addLink({
						id: `${space}--${sourceSpace(s.id)}`,
						a: space,
						b: sourceSpace(s.id),
						itemA: id,
						itemB: id,
						styleA: style(ACCENT.source),
						styleB: style(ACCENT.question),
						upFor: null,
						labelA: s.name,
						labelB: `${q.clause} ${clip(q.text.replace(/^\([a-z0-9]+\)\s*/i, ''), 40)}`,
						descriptionA: 'Through to their room.',
						descriptionB: 'Through to the question.',
					})
				}
			}
		}
	}

	/* ── every link is an item on each side that is not the way back ────── */
	// A link's item is the thing you read and jump through: a perspective, a
	// lens, an answer, a plaque. Where a side has none (a hall's way to a
	// family, a family's to a topic, a cohort's to a source), the room beyond
	// gets a CARD on this side — nothing to read, somewhere to jump.
	for (const link of links) {
		for (const side of ['a', 'b'] as const) {
			const nodeId = side === 'a' ? link.a : link.b
			const existing = side === 'a' ? link.itemA : link.itemB
			if (existing || link.upFor === nodeId) continue
			// A door in an alcove's back wall: the way itself, no card.
			if (side === 'a' && link.bayDoor) continue
			// A taste's far side hangs nothing: the way back is the room's own.
			if (side === 'b' && link.taste) continue
			const other = nodes.get(side === 'a' ? link.b : link.a)
			if (!other) continue
			const id = `card:${link.id}:${side}`
			const description = side === 'a' ? link.descriptionA : link.descriptionB
			items.set(id, {
				id,
				kind: 'card',
				card: {
					title: other.label,
					date: description.replace(/\.$/, ''),
					tags: [],
					excerpt: other.subtitle,
				},
				eyebrow: 'A room beyond',
				title: other.label,
				detail: other.subtitle,
				position: null,
				lede: description,
				quotes: [],
				text: null,
				reading: null,
				visits: [{ label: other.label, spaceId: other.id }],
			})
			if (side === 'a') link.itemA = id
			else link.itemB = id
			// In a cohort's lobby a source's card hangs in its alphabetical range.
			if (other.kind === 'source') {
				const range = cohortRanges.get(nodeId)?.get(other.id.replace(/^s:/, ''))
				if (range) place(nodeId, id, { at: 'bay', bay: range })
			}
		}
	}

	/* ── rooms from nodes and links: wings, plans, spaces ────────────────── */

	const linksOf = new Map<string, Link[]>()
	for (const link of links) {
		for (const end of [link.a, link.b]) {
			const list = linksOf.get(end) ?? []
			list.push(link)
			linksOf.set(end, list)
		}
	}
	/** Which space holds a node's end of a link (its door or its item):
	 *  `${linkId}|${nodeId}`. */
	const endSpace = new Map<string, string>()
	/** An alley of a nave room as built: its items, its cross-alleys, and
	 *  the door in its end wall on to its han when it overflowed. */
	interface Hallway {
		id: string
		label: string
		side?: 'west' | 'east'
		heading: string | null
		itemIds: string[]
		door: { link: Link; wingId: string } | null
		children: Hallway[]
	}
	interface NaveWing {
		hallways: Hallway[]
		byDoor: string[]
		naveEnd: string[]
		rail: { load: NaveRailLoad; plinthItem: string | null; panelItems: string[] } | null
		desk: { scope: string; label: string } | 'chart' | null
	}
	const everyHallway = (list: readonly Hallway[]): Hallway[] =>
		list.flatMap((h) => [h, ...everyHallway(h.children)])
	interface Wing {
		spaceId: string
		node: Node
		index: number
		count: number
		up: { doorId: string; to: string; label: string; description: string; style: DoorStyle } | null
		/** Everything hung in this wing, in hanging order (a list room). */
		itemIds: string[]
		/** The wing's structure, for a nave room. */
		nave: NaveWing | null
		/** The link each hung item is one end of, when it is. */
		linkOfItem: Map<string, { link: Link; side: 'a' | 'b' }>
		/** The next wing's door, when there is one. */
		onward: { doorId: string; to: string; label: string } | null
		parentSpace: string | null
	}
	const wings: Wing[] = []
	const isFront = (node: Node) =>
		node.kind === 'hall' || node.kind === 'office' || node.kind === 'qhall'
	// A list room hangs as many items as the largest room holds; the first
	// wing hangs the room's own cards first, then the links in their order. A
	// nave room holds so many hallways; the first wing has the rail, the
	// walls by the door and at the nave's end. A wing with another after it
	// keeps a door on.
	const capWithOnward = maxItemsFor({ upDoorId: 'up', onwardDoorId: 'on' })
	const capLast = maxItemsFor({ upDoorId: 'up', onwardDoorId: null })
	/** The link each item is one end of (an item is one end of one link;
	 *  a lens is both ends of its own, and is found on side a). A han hangs
	 *  items it moved from its alley's node, and finds their links here. */
	const linkOf = new Map<string, { link: Link; side: 'a' | 'b' }>()
	for (const link of links) {
		if (link.itemA && !linkOf.has(link.itemA)) linkOf.set(link.itemA, { link, side: 'a' })
		if (link.itemB && !linkOf.has(link.itemB)) linkOf.set(link.itemB, { link, side: 'b' })
	}
	// Nodes added while this runs (hans) are visited in their turn.
	for (const node of nodes.values()) {
		const mine = linksOf.get(node.id) ?? []
		const upLink = mine.find((l) => l.upFor === node.id) ?? null
		const side = (link: Link): 'a' | 'b' => (link.a === node.id ? 'a' : 'b')
		/** What hangs here, and whose link end each item is: this node's own
		 *  (`endNode` = this node), one a han holds for the alley's node it
		 *  overflowed from (`endNode` = that node), or a copy that is no end
		 *  at all (a han's plinth lens: the hub's copy is the link's end). */
		const hung: {
			id: string
			link: { link: Link; side: 'a' | 'b' } | null
			endNode: string | null
		}[] = [
			...node.looseItems.map((id) => {
				const from = node.origin.get(id)
				const found = linkOf.get(id)
				if (!found || !from) return { id, link: null, endNode: null }
				const s: 'a' | 'b' = found.link.a === from ? 'a' : 'b'
				const copy = node.placement.get(id)?.at === 'rail'
				return { id, link: { link: found.link, side: s }, endNode: copy ? null : from }
			}),
			...mine
				.filter((l) => l !== upLink)
				.flatMap((link) => {
					const s = side(link)
					const id = s === 'a' ? link.itemA : link.itemB
					return id ? [{ id, link: { link, side: s }, endNode: node.id }] : []
				}),
		]
		const hungById = new Map(hung.map((h) => [h.id, h]))
		/** The wings' contents: a list per wing, or a nave per wing. */
		const chunks: { itemIds: string[]; nave: NaveWing | null }[] = []
		if (node.nave) {
			const spec = node.nave
			const placed = (id: string): Place => node.placement.get(id) ?? { at: 'naveEnd' }
			/** An alley with everything placed in it, and its cross-alleys. */
			const build = (bay: BaySpec): Hallway | null => {
				const heading =
					hung.find((h) => {
						const p = placed(h.id)
						return p.at === 'heading' && p.bay === bay.id
					})?.id ?? null
				const itemIds = hung
					.filter((h) => {
						const p = placed(h.id)
						return p.at === 'bay' && p.bay === bay.id
					})
					.map((h) => h.id)
				const children = (bay.children ?? []).flatMap((c) => {
					const built = build(c)
					return built ? [built] : []
				})
				// A section's bay in a front hall ends in the door into the
				// section's room: the link that carries it says so.
				const doorLink = mine.find((l) => l.a === node.id && l.bayDoor === bay.id) ?? null
				if (!heading && itemIds.length === 0 && children.length === 0 && !doorLink) return null
				return {
					id: bay.id,
					label: bay.label,
					...(bay.side ? { side: bay.side } : {}),
					heading,
					itemIds,
					door: doorLink ? { link: doorLink, wingId: doorLink.b } : null,
					children,
				}
			}
			const everyItem = (h: Hallway): string[] => [
				...(h.heading ? [h.heading] : []),
				...h.itemIds,
				...h.children.flatMap(everyItem),
			]
			const toSpec = (h: Hallway): BaySpec => ({
				id: h.id,
				label: h.label,
				...(h.children.length > 0 ? { children: h.children.map(toSpec) } : {}),
			})
			const labelOfItem = (id: string): string => {
				const end = linkOf.get(id)
				const far = end ? nodes.get(end.side === 'a' ? end.link.b : end.link.a) : undefined
				return far?.label ?? items.get(id)?.title ?? id
			}
			/** Everything a han took from this node: it hangs there, and nowhere
			 *  here — not even at the nave's end as an item with no alley. */
			const movedToHans = new Set<string>()
			/** An alley that holds more than it can opens a door at its end
			 *  into its HAN: a wing holding its remaining cross-alleys and its
			 *  remaining cards in alphabetical ranges, the alley's heading on
			 *  the han's plinth. The han is a node of its own, chunked in its
			 *  turn (so a han can overflow into a han). */
			const resolve = (h: Hallway): Hallway => {
				const keptChildren = h.children.slice(0, HALLWAY_CHILDREN).map(resolve)
				const restChildren = h.children.slice(HALLWAY_CHILDREN)
				if (
					restChildren.length === 0 &&
					h.itemIds.length <= hallwayCapacity(keptChildren.length, h.door !== null)
				) {
					return { ...h, children: keptChildren }
				}
				if (h.door) {
					// An introducing bay already ends in its section's door; it
					// hangs a plaque and a taste, never more than fits.
					throw new Error(
						`[report-world] bay '${h.id}' of '${node.id}' holds ${h.itemIds.length} items beside its door`,
					)
				}
				const cap = hallwayCapacity(keptChildren.length, true)
				const kept = h.itemIds.slice(0, cap)
				const rest = [...h.itemIds.slice(cap)].sort((a, b) =>
					labelOfItem(a).localeCompare(labelOfItem(b)),
				)
				const hanId = `${node.id}:w:${slug(h.id)}`
				const ranges = rangeBays(rest, labelOfItem)
				const moved = [...rest, ...restChildren.flatMap(everyItem)]
				for (const id of moved) movedToHans.add(id)
				const headingItem = h.heading ? items.get(h.heading) : undefined
				// A lens heading the alley reads its quotes round the han's rail (its
				// text writes them; the record counts them).
				const headingLens = headingItem?.text?.kind === 'lens' ? headingItem.text : null
				const lensQuotes = headingLens
					? (record?.topics
							.find((t) => t.id === headingLens.topicId)
							?.lenses.find((l) => l.facet === headingLens.facet && l.value === headingLens.value)
							?.quotes ?? 0)
					: 0
				const han = addNode({
					id: hanId,
					kind: 'han',
					label: h.label,
					subtitle: `${node.label} · ${plural(moved.length, 'more', 'more')}`,
					accent: node.accent,
					building: node.building,
					looseItems: [],
					nave: {
						bays: [...restChildren.map(toSpec), ...ranges.bays],
						rail: headingItem
							? { title: headingItem.title, panels: unwritten(lensQuotes), anchors: 'plinth' }
							: null,
					},
					...(node.text ? { text: node.text } : {}),
					...(headingLens
						? {
								rail: lensRail(headingLens.topicId, headingLens.facet, headingLens.value),
							}
						: {}),
				})
				for (const id of moved) {
					han.looseItems.push(id)
					// The han holds this item's link end for the node it came from
					// (or for that node's own origin, when a han overflows).
					han.origin.set(id, node.origin.get(id) ?? node.id)
					const p = node.placement.get(id)
					if (p) han.placement.set(id, p)
				}
				for (const [id, range] of ranges.rangeOf) han.placement.set(id, { at: 'bay', bay: range })
				if (h.heading) {
					// The alley's heading again, on the han's plinth: a copy that
					// reads and goes through like the alley's, but is no link end.
					han.looseItems.push(h.heading)
					han.origin.set(h.heading, node.origin.get(h.heading) ?? node.id)
					han.placement.set(h.heading, { at: 'rail' })
				}
				const link: Link = {
					id: `${node.id}--${hanId}`,
					a: node.id,
					b: hanId,
					itemA: null,
					itemB: null,
					styleA: style(node.accent),
					styleB: style(ACCENT.way),
					upFor: hanId,
					bayDoor: h.id,
					labelA: `${h.label}: ${plural(moved.length, 'more', 'more')}`,
					labelB: `Back to ${node.label}`,
					descriptionA: `The rest of ${h.label}.`,
					descriptionB: 'The way back.',
				}
				addLink(link)
				for (const end of [link.a, link.b]) {
					const list = linksOf.get(end) ?? []
					list.push(link)
					linksOf.set(end, list)
				}
				return { ...h, itemIds: kept, children: keptChildren, door: { link, wingId: hanId } }
			}
			const hallways = spec.bays.flatMap((b) => {
				const built = build(b)
				return built ? [resolve(built)] : []
			})
			const bayIds = new Set(everyHallway(hallways).map((h) => h.id))
			const stays = hung.filter((h) => !movedToHans.has(h.id))
			const byDoor = stays.filter((h) => placed(h.id).at === 'byDoor').map((h) => h.id)
			const railItems = stays.filter((h) => placed(h.id).at === 'rail').map((h) => h.id)
			const naveEnd = stays
				.filter((h) => {
					const p = placed(h.id)
					return (
						p.at === 'naveEnd' || ((p.at === 'bay' || p.at === 'heading') && !bayIds.has(p.bay))
					)
				})
				.map((h) => h.id)
			const rail = spec.rail
				? {
						load: spec.rail,
						plinthItem: spec.rail.anchors === 'plinth' ? (railItems[0] ?? null) : null,
						panelItems: spec.rail.anchors === 'panels' ? railItems : [],
					}
				: null
			// Rooms: so many alleys a side; an alley keeps the side it asked
			// for, the others alternate.
			const west: Hallway[] = []
			const east: Hallway[] = []
			hallways.forEach((h, i) => {
				const side = h.side ?? (i % 2 === 0 ? 'west' : 'east')
				;(side === 'west' ? west : east).push({ ...h, side })
			})
			const rooms = Math.max(
				1,
				Math.ceil(west.length / HALLWAYS_PER_SIDE),
				Math.ceil(east.length / HALLWAYS_PER_SIDE),
			)
			for (let i = 0; i < rooms; i++) {
				const mine = [
					...west.slice(i * HALLWAYS_PER_SIDE, (i + 1) * HALLWAYS_PER_SIDE),
					...east.slice(i * HALLWAYS_PER_SIDE, (i + 1) * HALLWAYS_PER_SIDE),
				]
				chunks.push({
					itemIds: [
						...(i === 0 ? [...byDoor, ...naveEnd, ...railItems] : []),
						...everyHallway(mine).flatMap((h) => [...(h.heading ? [h.heading] : []), ...h.itemIds]),
					],
					nave: {
						hallways: mine,
						byDoor: i === 0 ? byDoor : [],
						naveEnd: i === 0 ? naveEnd : [],
						rail: i === 0 ? rail : null,
						desk: i === 0 ? (spec.desk ?? null) : null,
					},
				})
			}
		} else {
			let rest = hung.map((h) => h.id)
			while (true) {
				if (rest.length <= capLast) {
					chunks.push({ itemIds: rest, nave: null })
					break
				}
				chunks.push({ itemIds: rest.slice(0, capWithOnward), nave: null })
				rest = rest.slice(capWithOnward)
			}
		}
		const count = chunks.length
		for (let i = 0; i < count; i++) {
			const spaceId = i === 0 ? node.id : `${node.id}-${i + 1}`
			const chunk = chunks[i] ?? { itemIds: [], nave: null }
			const linkOfItem = new Map<string, { link: Link; side: 'a' | 'b' }>()
			for (const id of chunk.itemIds) {
				const h = hungById.get(id)
				if (!h?.link) continue
				linkOfItem.set(id, h.link)
				// The link's end is in THIS room: the end's own node's, or a
				// han's that holds it for that node. A copy is no end.
				if (h.endNode) endSpace.set(`${h.link.link.id}|${h.endNode}`, spaceId)
			}
			if (upLink && i === 0) endSpace.set(`${upLink.id}|${node.id}`, spaceId)
			// A han's way back lands at the room whose alley holds its door.
			for (const h of everyHallway(chunk.nave?.hallways ?? [])) {
				if (h.door) endSpace.set(`${h.door.link.id}|${node.id}`, spaceId)
			}
			const previous = i === 0 ? null : i === 1 ? node.id : `${node.id}-${i}`
			const upFromLink =
				upLink && i === 0
					? {
							doorId: `door:${upLink.id}`,
							to: '',
							label: side(upLink) === 'a' ? upLink.labelA : upLink.labelB,
							description: side(upLink) === 'a' ? upLink.descriptionA : upLink.descriptionB,
							style: side(upLink) === 'a' ? upLink.styleA : upLink.styleB,
						}
					: null
			wings.push({
				spaceId,
				node,
				index: i,
				count,
				up: previous
					? {
							doorId: `door:wing:${spaceId}:back`,
							to: previous,
							label: `${node.label} ${numeral(i - 1)}`,
							description: 'Back through the wing.',
							style: style(ACCENT.way),
						}
					: upFromLink,
				itemIds: chunk.itemIds,
				nave: chunk.nave,
				linkOfItem,
				onward:
					i + 1 < count
						? {
								doorId: `door:wing:${node.id}-${i + 2}:back`,
								to: `${node.id}-${i + 2}`,
								label: `${node.label} ${numeral(i + 1)}`,
							}
						: null,
				parentSpace: previous ?? (upLink ? (upLink.a === node.id ? upLink.b : upLink.a) : null),
			})
		}
	}
	const roomBuilds: ReportRoomBuild[] = []
	const spaces: ChessboardSpace[] = []
	const wingSpaces = new Map(wings.map((w) => [w.spaceId, w]))
	const buildingRooms = new Map<string, BuildingRoom[]>()

	for (const wing of wings) {
		const node = wing.node
		const upDoorId = wing.up
			? wing.up.doorId
			: isFront(node) && wing.index === 0
				? `door:entrance:${node.building}`
				: null
		const upStyle = wing.up?.style ?? style(ACCENT.way)
		const onwardDoorId = wing.onward?.doorId ?? null
		/** The plan, and where each item hangs on it. */
		let plan: RoomPlan
		const anchorOfItem = new Map<string, string>()
		const hangOn = (itemId: string | null | undefined, anchorId: string | undefined) => {
			if (!itemId) return
			if (!anchorId) {
				throw new Error(`[report-world] room '${wing.spaceId}' has no anchor for '${itemId}'`)
			}
			anchorOfItem.set(itemId, anchorId)
		}
		if (wing.nave) {
			const nave = wing.nave
			const toLoad = (h: Hallway): NaveBayLoad => ({
				id: h.id,
				label: h.label,
				heading: h.heading !== null,
				items: h.itemIds.length,
				...(h.side ? { side: h.side } : {}),
				...(h.door
					? { door: { doorId: `door:${h.door.link.id}`, style: h.door.link.styleA } }
					: {}),
				...(h.children.length > 0 ? { children: h.children.map(toLoad) } : {}),
			})
			const planned = planNaveRoom({
				id: wing.spaceId,
				upDoorId,
				upStyle,
				onwardDoorId,
				bays: nave.hallways.map(toLoad),
				byDoor: nave.byDoor.length,
				naveEnd: nave.naveEnd.length,
				rail: nave.rail?.load ?? null,
				desk: nave.desk !== null,
			})
			const hangAll = (ids: readonly string[], slots: readonly string[]) => {
				ids.forEach((id, i) => {
					hangOn(id, slots[i])
				})
			}
			hangAll(nave.byDoor, planned.slots.byDoor)
			hangAll(nave.naveEnd, planned.slots.naveEnd)
			if (nave.rail) {
				hangOn(nave.rail.plinthItem, planned.slots.rail.plinth ?? undefined)
				hangAll(nave.rail.panelItems, planned.slots.rail.panels)
			}
			for (const h of everyHallway(nave.hallways)) {
				const slot = planned.slots.bays.find((b) => b.id === h.id)
				hangOn(h.heading, slot?.heading ?? undefined)
				hangAll(h.itemIds, slot?.items ?? [])
			}
			plan = planned
		} else {
			const planned = planItemRoom({
				id: wing.spaceId,
				upDoorId,
				upStyle,
				onwardDoorId,
				itemIds: wing.itemIds,
				chart: isFront(node) && wing.index === 0 && node.kind !== 'qhall',
			})
			for (const id of wing.itemIds) hangOn(id, planned.anchorOfItem.get(id))
			plan = planned
		}
		const label = wing.count > 1 ? `${node.label} ${numeral(wing.index)}` : node.label
		roomBuilds.push({
			spaceId: wing.spaceId,
			label,
			subtitle:
				wing.count > 1
					? `${node.subtitle} · wing ${numeral(wing.index)} of ${wing.count}`
					: node.subtitle,
			accent: node.accent,
			building: node.building,
			plan,
			// A thing that leads somewhere is NAMED for where it leads, from the
			// room you stand in: in a topic's room a perspective wears the
			// source's name, in the source's room the topic's; a lens the cohort's
			// here and the topic's there; an answer the source's in the question's
			// room and the clause in the source's. The perspective's own title is
			// the reading sheet's.
			exhibits: wing.itemIds.flatMap((itemId) => {
				const item = items.get(itemId)
				const anchorId = anchorOfItem.get(itemId)
				if (!item || !anchorId) return []
				const end = wing.linkOfItem.get(itemId)
				const beyond = end ? nodes.get(end.side === 'a' ? end.link.b : end.link.a) : undefined
				const card = beyond ? { ...item.card, title: beyond.label } : item.card
				return [{ anchorId, card, itemId }]
			}),
			text: node.text,
			rail: wing.index === 0 ? node.rail : null,
		})
		const list = buildingRooms.get(node.building) ?? []
		list.push({
			spaceId: wing.spaceId,
			plan,
			parent: wing.parentSpace,
			upDoorId: wing.up ? wing.up.doorId : null,
		})
		buildingRooms.set(node.building, list)
	}

	/* ── the sky: every topic a star, for the table in the island's square ── */
	const stars = starsOf(record)

	/* ── floor plans per building, and the Hall's chart inlay ── */
	const plansOf = new Map<string, ChessboardMap>()
	for (const [building, rooms] of buildingRooms) plansOf.set(building, buildingPlan(rooms))
	const hallMap = plansOf.get('topics')
	if (hallMap) {
		const lights: ChartInlay['lights'] = []
		for (const build of roomBuilds) {
			if (build.building !== 'hall' || !build.spaceId.startsWith('t:')) continue
			const tile = hallMap.spaces.find((s) => s.id === build.spaceId)
			if (tile)
				lights.push({
					x: tile.rect.x + tile.rect.w / 2,
					y: tile.rect.y + tile.rect.h / 2,
					accent: ACCENT.topic,
				})
		}
		const inlay: ChartInlay = {
			map: hallMap,
			accents: roomBuilds
				.filter((b) => b.building === 'topics')
				.map((b) => ({ spaceId: b.spaceId, accent: b.accent })),
			lights,
		}
		const hall = roomBuilds.find((b) => b.spaceId === 'hall')
		if (hall) hall.chart = inlay
	}
	const officeMap = plansOf.get('sources')
	const office = roomBuilds.find((b) => b.spaceId === 'office')
	if (officeMap && office) {
		// The office's chart table: the Record Office's plan.
		office.chart = {
			map: officeMap,
			accents: roomBuilds
				.filter((b) => b.building === 'sources')
				.map((b) => ({ spaceId: b.spaceId, accent: b.accent })),
			lights: [],
		}
	}
	// A cohort lobby's info desk: the lobby's own plan — the lobby and its
	// hans — with a light for every lens and card where it hangs. The rooms
	// those lead to are not on this plan; they are the lights.
	for (const build of roomBuilds) {
		const desk = wingSpaces.get(build.spaceId)?.nave?.desk
		if (!desk || desk === 'chart') continue
		const map = plansOf.get(build.building)
		if (!map) continue
		const rooms = roomBuilds.filter((b) => b.building === build.building)
		build.chart = {
			map,
			accents: rooms.map((b) => ({ spaceId: b.spaceId, accent: b.accent })),
			lights: rooms.flatMap((room) => {
				const tile = map.spaces.find((s) => s.id === room.spaceId)
				if (!tile) return []
				return room.exhibits.flatMap((exhibit) => {
					const anchor = room.plan.anchors.find((a) => a.id === exhibit.anchorId)
					if (!anchor) return []
					return [
						{
							x: tile.rect.x + tile.rect.w / 2 + anchor.position[0],
							y: tile.rect.y + tile.rect.h / 2 + anchor.position[2],
							accent: exhibit.itemId.startsWith('lens:') ? ACCENT.topic : ACCENT.source,
						},
					]
				})
			}),
		}
	}

	/* ── spaces ── */
	const buildingByFront = new Map<string, IslandBuilding>()
	for (const b of plan.buildings) buildingByFront.set(b.id, b)
	const frontSpaceOfBuilding = (buildingId: string): string | null => {
		const b = buildingByFront.get(buildingId)
		if (!b) return null
		const section = sectionOfBuilding(b.id)
		if (!section) return null
		if (section.kind === 'topics') return nodes.has('hall') ? 'hall' : null
		if (section.kind === 'sources') return nodes.has('office') ? 'office' : null
		if (section.kind === 'analysis' && section.taskId)
			return nodes.has(qhallSpace(section.taskId)) ? qhallSpace(section.taskId) : null
		return null
	}
	/** The island's pin at a building's door (the base makes it, atlas
	 *  island/declared-world.ts: `door:<building>`), where its front room's
	 *  way back lands. */
	const islandEntryOf = (buildingId: string) => `door:${buildingId}`

	for (const build of roomBuilds) {
		const wing = wingSpaces.get(build.spaceId)
		const roomPlan = build.plan
		const doorPlanOf = (doorId: string) => {
			const found = roomPlan.doors.find((d) => d.doorId === doorId)
			if (!found) throw new Error(`[report-world] room '${build.spaceId}' has no door '${doorId}'`)
			return found
		}
		const entries: ChessboardSpace['entries'][number][] = []
		const interactables: ChessboardInteractable[] = []
		const addDoor = (
			doorId: string,
			label: string,
			description: string,
			to: { space: string; entry: string },
		) => {
			const d = doorPlanOf(doorId)
			entries.push({ id: doorId, position: d.entry, facing: d.facing })
			interactables.push({
				id: `exit:${doorId}`,
				label,
				description,
				kind: 'exit',
				position: d.glyph,
				approach: d.approach,
				exit: to,
			})
		}
		let defaultEntry = ''
		if (wing) {
			const node = wing.node
			if (wing.up) {
				const link = links.find((l) => `door:${l.id}` === wing.up?.doorId)
				// The way back lands before the card for this room on the other side
				// (or at that side's own door, when the other side is a wing's).
				const otherNode = link ? (link.a === node.id ? link.b : link.a) : null
				const otherItem = link ? (link.a === node.id ? link.itemB : link.itemA) : null
				const to =
					wing.up.to || (link && otherNode ? endSpace.get(`${link.id}|${otherNode}`) : undefined)
				// A door must lead somewhere: a way up with no room at its far end
				// is a fault in the build, never a door to nowhere.
				if (!to) {
					throw new Error(
						`[report-world] room '${build.spaceId}': its way up (${wing.up.doorId}, link '${link?.id ?? '?'}') has no room at '${otherNode ?? '?'}'`,
					)
				}
				addDoor(wing.up.doorId, wing.up.label, wing.up.description, {
					space: to,
					entry: wing.up.to ? wing.up.doorId : otherItem ? `item:${otherItem}` : wing.up.doorId,
				})
				defaultEntry = wing.up.doorId
			} else if (isFront(node)) {
				const doorId = `door:entrance:${node.building}`
				addDoor(doorId, 'Back outside', 'Through the doors to the island.', {
					space: 'island',
					entry: islandEntryOf(node.building),
				})
				defaultEntry = doorId
			}
			if (wing.onward) {
				addDoor(wing.onward.doorId, wing.onward.label, 'On through the wing.', {
					space: wing.onward.to,
					entry: wing.onward.doorId,
				})
			}
			// The doors at the alleys' ends: each on to its han, landing at
			// the han's own door.
			for (const h of everyHallway(wing.nave?.hallways ?? [])) {
				if (!h.door) continue
				const to = endSpace.get(`${h.door.link.id}|${h.door.wingId}`)
				if (!to) throw new Error(`[report-world] wing '${h.door.wingId}' has no room`)
				addDoor(`door:${h.door.link.id}`, h.door.link.labelA, h.door.link.descriptionA, {
					space: to,
					entry: `door:${h.door.link.id}`,
				})
			}
		} else {
			throw new Error(`[report] room ${build.spaceId} was built without a wing`)
		}
		// Items on the walls: each one read where it hangs, and the ones that
		// are one end of a link jumped through to the room at the other end —
		// landing before that end's own item, or at its door when the other
		// end is the way back.
		for (const exhibit of build.exhibits) {
			const anchor = roomPlan.anchors.find((a) => a.id === exhibit.anchorId)
			const item = items.get(exhibit.itemId)
			if (!anchor || !item) continue
			const end = wing?.linkOfItem.get(item.id)
			let exit: { space: string; entry: string } | undefined
			if (end?.link.taste) {
				// A taste goes through to the room itself, landing at its door.
				const room = end.link.b
				const upOf = links.find((l) => l.upFor === room)
				const roomNode = nodes.get(room)
				exit = {
					space: room,
					entry: upOf ? `door:${upOf.id}` : `door:entrance:${roomNode?.building ?? room}`,
				}
			} else if (end) {
				const { link, side } = end
				const otherNode = side === 'a' ? link.b : link.a
				const otherItem = side === 'a' ? link.itemB : link.itemA
				const to = endSpace.get(`${link.id}|${otherNode}`)
				if (!to) throw new Error(`[report-world] link '${link.id}' has no end in '${otherNode}'`)
				exit = { space: to, entry: otherItem ? `item:${otherItem}` : `door:${link.id}` }
			}
			const jump = exit
				? [
						{
							label: item.kind === 'card' ? 'Go through' : 'Jump in',
							action: { type: DIVE_ACTION },
						},
					]
				: []
			const read =
				item.kind === 'card'
					? []
					: [
							{
								// A document's reading is its key points, wherever it hangs.
								label:
									item.kind === 'points' || item.kind === 'document'
										? 'Read the key points'
										: 'Read it',
								action: { type: READ_ACTION, payload: { thing: item.id } },
							},
						]
			// The card as this room shows it: named for where it leads.
			const card = exhibit.card
			interactables.push({
				id: `item:${item.id}`,
				label: card.title,
				description: exhibitDescription(card, item, exit !== undefined),
				preview: { text: card.excerpt, tags: card.tags },
				kind: 'examine',
				position: anchor.position,
				approach: anchor.approach,
				...(exit ? { exit } : {}),
				dialogue: {
					lines: [
						{
							speaker: card.title,
							text: exhibitLine(card, item),
							choices: [...read, ...jump, { label: 'Move on' }],
						},
					],
				},
			})
			entries.push({
				id: `item:${item.id}`,
				position: anchor.approach,
				facing: [anchor.position[0] - anchor.approach[0], anchor.position[2] - anchor.approach[2]],
			})
		}
		// The table: finding, in a front hall or a cohort's lobby.
		const chart = roomPlan.fixtures.find((f) => f.kind === 'chart')
		if (chart && chart.kind === 'chart') {
			// A cohort lobby's INFO DESK: the same table, its finding held to
			// this cohort's sources and the topics it has a lens on.
			const table = wing?.nave?.desk ?? null
			const desk = table && table !== 'chart' ? table : null
			interactables.push({
				id: desk ? 'examine:info-desk' : 'examine:chart-table',
				label: desk ? 'The info desk' : 'The chart table',
				description: desk
					? `Everyone read as ${desk.label}, and every topic seen their way: find one and it will walk you there.`
					: 'The building in miniature: find any room and it will walk you there.',
				kind: 'examine',
				position: [chart.centre[0], GALLERY_FLOOR_TOP + 1.1, chart.centre[1] + chart.radius * 0.6],
				approach: [chart.centre[0], GALLERY_FLOOR_TOP, chart.centre[1] + chart.radius + 1.0],
				dialogue: {
					lines: [
						{
							speaker: desk ? 'The info desk' : 'The chart table',
							text: desk
								? `The ${desk.label} desk: every ${nouns.entity} read as ${desk.label}, down the ranges on the right, and every topic ${desk.label} has a view on, down the alleys on the left. Name one and the desk will walk you to it.`
								: `Every room of this building on the plan. Search for a topic, a ${nouns.entity} or a question and the table will walk you to it.`,
							choices: [
								{
									label: 'Find something',
									action: {
										type: FIND_ACTION,
										// The desk's scope, as the app holds finding to one
										// (atlas lens.ts WorldScope): the cohort's room.
										...(desk
											? { payload: { kind: 'cohort', id: desk.scope, label: desk.label } }
											: {}),
									},
								},
								{ label: 'Just looking, thanks.' },
							],
						},
					],
				},
			})
		}
		const longest = Math.max(roomPlan.width, roomPlan.depth)
		spaces.push({
			id: build.spaceId,
			label: build.label,
			subtitle: build.subtitle,
			// The hallways are the room's regions: the sign names the one you
			// stand in, the room list groups what hangs there. (A list room's
			// partition bays are unnamed and stay off the sign.)
			...(roomPlan.bays.some((bay) => bay.label)
				? {
						regions: roomPlan.bays
							.filter((bay) => bay.label)
							.map((bay) => ({ id: bay.id, label: bay.label, bounds: bay.bounds })),
					}
				: {}),
			view: { distance: Math.min(44, Math.max(26, longest * 1.05)), pitch: (56 * Math.PI) / 180 },
			defaultEntry,
			entries,
			interactables,
			// No map of its own: a room is drawn on its building's plan, which
			// the app asks for by the room (mapOf) — the plan is made once per
			// building. Carried on every room, the world's parse copied the
			// Archive's plan of 1,700 rooms into each of its 1,500 rooms: a
			// gigabyte and a half of one drawing.
		})
	}

	/* ── the island: the site as a class on the one base ── */
	const site_ = new ReportSite({
		key: island.slug,
		name: island.name,
		record,
		rooms: spaces,
		frontOf: frontSpaceOfBuilding,
	})
	const world = site_.world(islandPlanOfReport(plan, SURFACE_LEVEL, stars))

	/** A room as its text writes it up: each exhibit's card (still named for
	 *  where it leads), its rail's panels, and its things' words. */
	const withText = (spaceId: string, text: WorldText) => {
		const room = roomBuilds.find((r) => r.spaceId === spaceId)
		const space = spaces.find((s) => s.id === spaceId)
		if (!room || !space) return null
		const written = new Map<string, { item: ReportItem; card: ReportCard }>()
		const exhibits = room.exhibits.map((exhibit) => {
			const item = items.get(exhibit.itemId)
			if (!item) return exhibit
			const read = itemWithText(item, text)
			const card = { ...read.card, title: exhibit.card.title }
			written.set(exhibit.itemId, { item: read, card })
			return { ...exhibit, card }
		})
		const panels = room.rail ? railPanelsOf(room.rail, text) : null
		const roomPlan = panels
			? {
					...room.plan,
					fixtures: room.plan.fixtures.map((fixture) =>
						fixture.kind === 'rail'
							? {
									...fixture,
									panels: fixture.panels.map((panel, i) => ({
										...panel,
										text: panels[i] ?? panel.text,
									})),
								}
							: fixture,
					),
				}
			: room.plan
		const interactables = space.interactables.map((thing) => {
			const found = thing.id.startsWith('item:')
				? written.get(thing.id.slice('item:'.length))
				: null
			if (!found) return thing
			const { item, card } = found
			return {
				...thing,
				description: exhibitDescription(card, item, thing.exit !== undefined),
				preview: { text: card.excerpt, tags: card.tags },
				...(thing.dialogue
					? {
							dialogue: {
								...thing.dialogue,
								lines: thing.dialogue.lines.map((line, i) =>
									i === 0 ? { ...line, text: exhibitLine(card, item) } : line,
								),
							},
						}
					: {}),
			}
		})
		return { room: { ...room, exhibits, plan: roomPlan }, space: { ...space, interactables } }
	}

	const build: ReportWorldBuild = {
		world,
		plan,
		sky: { stars },
		rooms: roomBuilds,
		buildings: buildingRooms,
		items,
		findables,
		record,
		withText,
	}
	// Each room is found where it stands: in its building, as the map names it.
	return {
		...build,
		findables: findables.map((f) => {
			const where = buildingLabel(build, f.space)
			return where && where !== f.title ? { ...f, where } : f
		}),
	}
}
