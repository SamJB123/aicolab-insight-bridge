// The report world, built from a record: every topic and source a room,
// every doorway with its counterpart, every room within the planner's cap.
// The island alone (no record) is what the relay builds. Rooms are declared
// by name and built on entry; the checks here build them all, and hold
// each room's ways out, read unbuilt, to the ways it has once built.
//
// A real record is used when REPORT_FIXTURE names one (the JSON `/api/world`
// serves); without it the test builds a small synthetic record.

import { readFileSync } from 'node:fs'
import { maxItemsFor } from '@aicolab/atlas/chessboard/content/item-room-plan.ts'
import type { ChessboardSpace } from '@aicolab/kolo/chessboard/content'
import { describe, expect, it } from 'vitest'
import { type WorldRecord, worldRecordSchema } from '../world/index.ts'
import { syntheticRecord, syntheticText } from './synthetic-record.ts'
import { buildReportWorld, everyRoom, itemWithText, type ReportWorldBuild } from './world.ts'

const synthetic = (): WorldRecord => syntheticRecord()

const fixture = (): WorldRecord | null => {
	const path = process.env.REPORT_FIXTURE
	if (!path) return null
	return worldRecordSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}

/** The world with every room built, as a visitor entering each finds it:
 *  the rooms as built, and the world's spaces with each room in full. */
const whole = (built: ReportWorldBuild) => {
	const every = everyRoom(built)
	const full = new Map(every.map((b) => [b.space.id, b.space]))
	return {
		rooms: every.map((b) => b.room),
		spaces: built.world.spaces.map((s): ChessboardSpace => full.get(s.id) ?? s),
	}
}

describe('the report world', () => {
	it('builds the island alone without a record', () => {
		const { world } = buildReportWorld(null)
		expect(world.start).toBe('island')
		const island = world.spaces.find((s) => s.id === 'island')
		expect(island?.guide?.id).toBe('guide:docent')
		// The buildings stand, but with no record their doors lead nowhere yet.
		expect(island?.interactables.some((i) => i.id === 'exit:chart')).toBe(true)
	})

	it('declares each room by name and way in, and reads its ways out unbuilt as built', () => {
		const built = buildReportWorld(fixture() ?? synthetic())
		for (const declared of built.world.spaces) {
			const room = built.roomAt(declared.id)
			if (!room) continue
			// Declared light: nothing on its walls until it is entered.
			expect(declared.interactables, declared.id).toEqual([])
			expect(declared.defaultEntry).toBe(room.space.defaultEntry)
			expect(room.space.entries.some((e) => e.id === declared.defaultEntry)).toBe(true)
			expect([declared.label, declared.subtitle]).toEqual([room.space.label, room.space.subtitle])
			// Its ways, read unbuilt, are the built room's own, in its order.
			const ways = (space: ChessboardSpace) =>
				built
					.waysOf(space)
					.flatMap((w) => (w.exit ? [{ id: w.id, kind: w.kind, exit: w.exit }] : []))
			expect(ways(declared), declared.id).toEqual(
				room.space.interactables.flatMap((i) =>
					i.exit ? [{ id: i.id, kind: i.kind, exit: i.exit }] : [],
				),
			)
		}
	})

	it('gives every topic and source a room, every doorway its counterpart', () => {
		const record = fixture() ?? synthetic()
		const built = buildReportWorld(record)
		const { rooms, spaces } = whole(built)
		const ids = new Set(spaces.map((s) => s.id))
		for (const t of record.topics) expect(ids.has(`t:${t.id}`)).toBe(true)
		for (const s of record.sources) expect(ids.has(`s:${s.id}`)).toBe(true)
		for (const g of record.groups) expect(ids.has(`g:${g.id}`)).toBe(true)
		expect(ids.has('hall')).toBe(true)
		expect(ids.has('office')).toBe(true)
		// The sky is on the table in the galaxy's own cell, not in a room.
		expect(ids.has('map-room')).toBe(false)
		const island = spaces.find((s) => s.id === 'island')
		expect(island?.interactables.some((i) => i.id === 'examine:landmark:galaxy')).toBe(true)
		// Every exit's target entry exists. A traversable item lands before an
		// item of the other room that leads back here (or at that room's door),
		// so the dive can be reversed — except a bay's heading card, the
		// one-way into a family's or a task's front room, which lands at that
		// room's own door.
		let traversable = 0
		for (const space of spaces) {
			for (const item of space.interactables) {
				if (!item.exit || 'leave' in item.exit) continue
				const link = item.exit
				const target = spaces.find((s) => s.id === link.space)
				expect(target, `${space.id} → ${link.space}`).toBeDefined()
				expect(
					target?.entries.some((e) => e.id === link.entry),
					`${item.id} → ${link.space} ${link.entry}`,
				).toBe(true)
				if (item.kind !== 'examine') continue
				traversable++
				const landing = target?.interactables.find(
					(i) =>
						`item:${i.id.replace(/^item:/, '')}` === link.entry || `exit:${link.entry}` === i.id,
				)
				expect(landing, `${item.id} lands before nothing in ${target?.id}`).toBeDefined()
				// A front hall's taste goes through to a room and leaves you at
				// that room's own door: the way back is the room's, not the hall's.
				if (item.id.startsWith('item:taste:')) continue
				// The way back lands in this room — or in the room this one is a
				// han of (the alley's own copy of a lens is the two-way one).
				const back = landing?.exit
				const backSpace = back && !('leave' in back) ? back.space : null
				const hubOf = space.id.replace(/:w:.*$/, '')
				expect(
					backSpace === space.id || backSpace === hubOf ? space.id : backSpace,
					`no way back from ${target?.id} for ${item.id}`,
				).toBe(space.id)
			}
		}
		expect(traversable).toBeGreaterThan(0)
		// A room has one way back, at most one way on, every exhibit on an
		// anchor of its own, and a list room no more items than the planner
		// hangs.
		for (const room of rooms) {
			// One way back, at most one way on, and a nave room's doors into
			// its cohorts' wings.
			expect(room.plan.doors.length).toBeLessThanOrEqual(
				2 + (room.plan.character === 'nave' ? room.plan.bays.length : 0),
			)
			const anchors = new Set(room.exhibits.map((e) => e.anchorId))
			expect(anchors.size, `${room.spaceId} hangs two items on one anchor`).toBe(
				room.exhibits.length,
			)
			for (const id of anchors) {
				expect(
					room.plan.anchors.some((a) => a.id === id),
					`${room.spaceId}: ${id}`,
				).toBe(true)
			}
			if (room.plan.character !== 'nave') {
				expect(room.exhibits.length).toBeLessThanOrEqual(
					maxItemsFor({ upDoorId: 'up', onwardDoorId: null }),
				)
			}
		}
		// A topic's room is a nave: its key points one reading from the rail's
		// plinth with a panel per point, a hallway per cohort (the first
		// analysed facet) as a named region, the cohort's lens at its mouth.
		const firstFacet = record.facets[0]
		for (const t of record.topics) {
			const room = rooms.find((r) => r.spaceId === `t:${t.id}`)
			expect(room?.plan.character, `t:${t.id}`).toBe('nave')
			const rail = room?.plan.fixtures.find((f) => f.kind === 'rail')
			expect(rail?.kind === 'rail' ? rail.panels.length : -1).toBe(t.keyPoints)
			const space = spaces.find((s) => s.id === `t:${t.id}`)
			if (t.keyPoints > 0) {
				expect(space?.interactables.some((i) => i.id === `item:points:${t.id}`)).toBe(true)
			}
			const strong = record.memberships.filter((m) => m.topicId === t.id)
			const cohorts = new Set(
				strong.map((m) =>
					firstFacet
						? (record.sources.find((s) => s.id === m.sourceId)?.facets[firstFacet.key]?.[0] ?? null)
						: m.grade,
				),
			)
			const regions = new Set(
				spaces
					.filter((s) => s.id === `t:${t.id}` || s.id.startsWith(`t:${t.id}-`))
					.flatMap((s) => (s.regions ?? []).map((r) => r.id.replace(/:\d+$/, ''))),
			)
			expect(regions.size, `t:${t.id} hallways`).toBe(cohorts.size)
			// A cohort with more strong sources than an alcove holds has its own
			// wing: the hub keeps its first few, the wing the rest in ranges, and
			// no cohort is cut anywhere else.
			for (const value of cohorts) {
				const members = strong.filter((m) =>
					firstFacet
						? (record.sources.find((s) => s.id === m.sourceId)?.facets[firstFacet.key]?.[0] ??
								null) === value
						: m.grade === value,
				)
				const bay = firstFacet
					? `cohort:${
							value === null
								? 'none'
								: String(value)
										.toLowerCase()
										.replace(/[^a-z0-9]+/g, '-')
										.replace(/^-|-$/g, '')
						}`
					: `grade:${value}`
				const wingPrefix = `t:${t.id}:w:`
				const inHub = spaces
					.filter((s) => s.id === `t:${t.id}` || s.id.startsWith(`t:${t.id}-`))
					.flatMap((s) => s.interactables)
					.filter((i) => members.some((m) => i.id === `item:perspective:${t.id}:${m.sourceId}`))
				const wings = spaces.filter((s) => s.id.startsWith(wingPrefix + bay.replace(/:/g, '-')))
				if (members.length <= 12) {
					expect(inHub.length, `t:${t.id} ${bay} all in the hub`).toBe(members.length)
					expect(wings.length, `t:${t.id} ${bay} needs no wing`).toBe(0)
				} else {
					expect(inHub.length, `t:${t.id} ${bay} leading voices in the hub`).toBe(10)
					expect(wings.length, `t:${t.id} ${bay} has a wing`).toBeGreaterThan(0)
					const inWings = wings
						.flatMap((s) => s.interactables)
						.filter((i) => members.some((m) => i.id === `item:perspective:${t.id}:${m.sourceId}`))
					expect(inWings.length, `t:${t.id} ${bay} the rest in its wing`).toBe(members.length - 10)
				}
			}
			for (const l of t.lenses) {
				if (l.facet !== firstFacet?.key || !cohorts.has(l.value)) continue
				const heading = rooms
					.filter((r) => r.spaceId === `t:${t.id}` || r.spaceId.startsWith(`t:${t.id}-`))
					.flatMap((r) => r.exhibits)
					.find((e) => e.itemId.startsWith(`lens:${t.id}:`) && e.anchorId.endsWith(':head'))
				expect(heading, `t:${t.id} lens for ${l.value} heads no hallway`).toBeDefined()
			}
		}
		// A cohort's room is a LOBBY: a nave with the info desk at its centre,
		// the topics it has a lens on down alleys by the run's hierarchy (a
		// group's alley a cross-alley of its family's), the cohort's sources in
		// ranges, and nothing one-way.
		for (const facet of record.facets) {
			for (const v of facet.values) {
				const cs = `c:${facet.key}:${String(v.value)
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-|-$/g, '')}`
				const room = rooms.find((r) => r.spaceId === cs)
				if (!room) continue
				expect(room.plan.character, cs).toBe('nave')
				expect(
					room.plan.fixtures.some((f) => f.kind === 'chart'),
					`${cs} info desk`,
				).toBe(true)
				const space = spaces.find((s) => s.id === cs)
				expect(
					space?.interactables.some((i) => i.id === 'examine:info-desk'),
					`${cs} desk`,
				).toBe(true)
				const regions = new Set((space?.regions ?? []).map((r) => r.id))
				const lensed = record.topics.filter((t) =>
					t.lenses.some((l) => l.facet === facet.key && l.value === v.value),
				)
				for (const t of lensed) {
					const primary = t.parents.find((p) => p.isPrimary) ?? t.parents[0]
					const alley = primary ? `g:${primary.groupId}` : 'topics'
					// The lens hangs in the lobby (or its han), in its topic's own group's alley.
					const lobbyRooms = rooms.filter(
						(r) =>
							r.spaceId === cs ||
							r.spaceId.startsWith(`${cs}-`) ||
							r.spaceId.startsWith(`${cs}:w:`),
					)
					const hung = lobbyRooms
						.flatMap((r) => r.exhibits)
						.find((e) => e.itemId.startsWith(`lens:${t.id}:`))
					expect(hung, `${cs} lens for topic ${t.id}`).toBeDefined()
					const anchor = lobbyRooms
						.flatMap((r) => r.plan.anchors)
						.find((a) => a.id === hung?.anchorId)
					if (lobbyRooms.length === 1) expect(anchor?.bay, `${cs} lens ${t.id} alley`).toBe(alley)
					if (lobbyRooms.length === 1)
						expect(regions.has(alley), `${cs} alley ${alley} is a region`).toBe(true)
				}
			}
		}
		// The synthetic run's lobby for Academia: Group A1's alley is a cross-alley
		// of Family A's, and the room's outline steps for it.
		if (!process.env.REPORT_FIXTURE) {
			const lobby = spaces.find((s) => s.id === 'c:sector:academia')
			const ids = (lobby?.regions ?? []).map((r) => r.id)
			expect(ids).toContain('g:10')
			expect(ids).toContain('g:11')
			expect(ids).toContain('topics')
			const room = rooms.find((r) => r.spaceId === 'c:sector:academia')
			expect((room?.plan.outline?.length ?? 0) > 8, 'a stepped outline with a cross-alley').toBe(
				true,
			)
		}
		// A source's room: with one document, that document's key points round
		// the rail and the document read from the plinth; with several, a panel
		// and a reading per document. Its family and analysis alleys are named
		// by painted signs, not cards.
		for (const s of record.sources) {
			const room = rooms.find((r) => r.spaceId === `s:${s.id}`)
			expect(room?.plan.character, `s:${s.id}`).toBe('nave')
			expect(
				room?.exhibits.some((e) => e.itemId.startsWith('card:')),
				`s:${s.id} hangs no one-way card`,
			).toBe(false)
			for (const bay of room?.plan.bays ?? []) {
				expect(
					room?.plan.fixtures.some((f) => f.kind === 'sign' && f.id === `sign:${bay.id}`),
					`s:${s.id} ${bay.id} is signed`,
				).toBe(true)
			}
			const rail = room?.plan.fixtures.find((f) => f.kind === 'rail')
			const only = s.documents.length === 1 ? s.documents[0] : undefined
			if (only) {
				expect(rail?.kind === 'rail' ? rail.panels.length : -1, `s:${s.id} panels`).toBe(
					only.points,
				)
				const plinth = room?.exhibits.find((e) => e.anchorId === 'anchor:rail')
				expect(plinth?.itemId, `s:${s.id} plinth`).toBe(`document:${only.id}`)
			} else {
				const onRail = room?.exhibits.filter((e) => e.anchorId.startsWith('anchor:rail:')) ?? []
				expect(onRail.length, `s:${s.id} documents`).toBe(s.documents.length)
			}
		}
		// Every strong membership hangs in the topic's room — or in the topic's
		// wing for its cohort — as a traversable item.
		for (const m of record.memberships) {
			const topicRooms = spaces.filter(
				(s) =>
					s.id === `t:${m.topicId}` ||
					s.id.startsWith(`t:${m.topicId}-`) ||
					s.id.startsWith(`t:${m.topicId}:w:`),
			)
			const found = topicRooms.some((s) =>
				s.interactables.some(
					(i) => i.id === `item:perspective:${m.topicId}:${m.sourceId}` && i.exit !== undefined,
				),
			)
			expect(found, `no way from topic ${m.topicId} to ${m.sourceId}`).toBe(true)
		}
		console.info(
			`[report-world] ${spaces.length} spaces, ${rooms.length} rooms, ${built.items.size} items, ${built.findables.length} findables; ` +
				`largest room ${Math.max(...rooms.map((r) => r.plan.width))}×${Math.max(...rooms.map((r) => r.plan.depth))}; ` +
				`wings ${rooms.filter((r) => /-\d+$/.test(r.spaceId)).length}; world JSON ${Math.round(JSON.stringify(built.world).length / 1024)} KB`,
		)
	})

	it('writes a room up from its text: the rail, the cards and what they say', () => {
		const built = buildReportWorld(synthetic())
		const railOf = (room: { plan: { fixtures: readonly { kind: string }[] } } | undefined) => {
			const rail = room?.plan.fixtures.find((f) => f.kind === 'rail')
			return rail && 'panels' in rail && Array.isArray(rail.panels)
				? rail.panels.map((p: { text: string }) => p.text)
				: null
		}
		// Each room names whose text it carries; a hall, a group and the office carry none.
		const roomOf = (id: string) => built.roomAt(id)?.room
		expect(roomOf('t:1')?.text).toEqual({ kind: 'topic', topicId: 1 })
		expect(roomOf('s:alpha')?.text).toEqual({ kind: 'source', sourceId: 'alpha' })
		expect(roomOf('c:sector:academia')?.text).toEqual({
			kind: 'cohort',
			facet: 'sector',
			value: 'Academia',
		})
		expect(roomOf('q:terms')?.text).toEqual({ kind: 'task', taskId: 'terms' })
		expect(roomOf('hall')?.text).toBeNull()
		// Before its text, the rail is planned and blank, and the card says nothing of the stance.
		expect(railOf(roomOf('t:1'))).toEqual([''])
		const stance = 'item:perspective:1:alpha'
		const topicRoom = built.roomAt('t:1')
		if (!topicRoom) throw new Error('no room t:1')
		const before = topicRoom.space.interactables.find((i) => i.id === stance)
		expect(before?.preview?.text).toBe('')
		// Its text writes them.
		const ref = topicRoom.room.text
		if (!ref) throw new Error('t:1 carries no text')
		const topic = built.withText(topicRoom, syntheticText(ref))
		expect(railOf(topic.room)).toEqual(['A point'])
		const after = topic.space.interactables.find((i) => i.id === stance)
		expect(after?.preview?.text).toBe('Alpha supports topic 1.')
		expect(after?.dialogue?.lines[0]?.text).toBe('Alpha supports topic 1.')
		expect(topic.room.exhibits.find((e) => e.itemId === 'perspective:1:alpha')?.card.excerpt).toBe(
			'Alpha supports topic 1.',
		)
		// A one-document source's rail is its document's headlines; its answer reads its lead.
		const sourceRoom = built.roomAt('s:alpha')
		if (!sourceRoom) throw new Error('no room s:alpha')
		const source = built.withText(sourceRoom, syntheticText({ kind: 'source', sourceId: 'alpha' }))
		expect(railOf(source.room)).toEqual(['One', 'Two', 'Three'])
		const answer = source.room.exhibits.find((e) => e.itemId.startsWith('answer:terms:'))
		expect(answer?.card.excerpt).toBe('Source alpha: Alpha answers (a).')
		// The sheet's item, as the text writes it.
		const item = built.items.get('perspective:1:alpha')
		if (!item) throw new Error('no stance item')
		const read = itemWithText(item, syntheticText(ref))
		expect([read.title, read.lede]).toEqual(['Alpha on 1', 'Alpha supports topic 1.'])
	})
})
