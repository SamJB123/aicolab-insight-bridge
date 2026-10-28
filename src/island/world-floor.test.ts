// Nothing hangs off the alleys that an alley holds elsewhere. A family
// with more lensed groups than an alley opens cross-alleys for sends the
// rest to its han — and the lobby must not hang their lenses again on its
// own end wall. A topic that also belongs to a second group hangs its card
// in that group's alphabetical alleys, not on the group's floor.

import { describe, expect, it } from 'vitest'
import { type WorldRecord, worldRecordSchema } from '../world/index.ts'
import { syntheticRecord } from './synthetic-record.ts'
import { buildReportWorld, everyRoom } from './world.ts'

/** The synthetic record grown by one family of seven groups, each with a
 *  topic lensed for the Academia cohort, and one topic that also belongs
 *  to Group A1 as a non-primary member. */
function wideRecord(): WorldRecord {
	const base = syntheticRecord()
	const groups = [...base.groups, { ...base.groups[0], id: 20, title: 'Family B' }]
	const topics = [...base.topics]
	for (let k = 0; k < 7; k++) {
		const id = 21 + k
		groups.push({ ...base.groups[1], id, title: `Group B${k + 1}`, parentId: 20, generation: 1 })
		topics.push({
			...base.topics[0],
			id: 100 + k,
			title: `Topic ${100 + k}: in B${k + 1}`,
			parents: [{ groupId: id, isPrimary: true, membershipType: 'exemplar', similarity: 0.9 }],
		})
	}
	// Topic 1 (primary in Group A1) also belongs to Group B1.
	topics[0] = {
		...topics[0],
		parents: [
			...topics[0].parents,
			{ groupId: 21, isPrimary: false, membershipType: 'member', similarity: 0.5 },
		],
	}
	return worldRecordSchema.parse({ ...base, groups, topics })
}

/** Exhibits of a room that hang on no alley, rail or plinth. */
const offAlleys = (build: ReturnType<typeof buildReportWorld>, spaceId: string) => {
	const room = build.roomAt(spaceId)?.room
	if (!room) throw new Error(`no room ${spaceId}`)
	return room.exhibits.filter(
		(e) =>
			!e.anchorId.startsWith('anchor:bay:') &&
			!e.anchorId.startsWith('anchor:rail') &&
			!e.anchorId.startsWith('anchor:plinth'),
	)
}

describe('items that an alley holds elsewhere hang nowhere else', () => {
	const build = buildReportWorld(wideRecord())

	it('a lobby hangs none of the lenses its hans hold', () => {
		const lobby = 'c:sector:academia'
		expect(build.rooms.some((r) => r.spaceId === lobby)).toBe(true)
		const han = build.rooms.find((r) => r.spaceId.startsWith(`${lobby}:w:`))
		expect(han).toBeDefined()
		expect(offAlleys(build, lobby).map((e) => e.itemId)).toEqual([])
		// Every lens the lobby's topics carry hangs exactly once across the
		// lobby and its hans.
		const hung = everyRoom(build)
			.map((r) => r.room)
			.filter((r) => r.spaceId === lobby || r.spaceId.startsWith(`${lobby}:w:`))
			.flatMap((r) => r.exhibits.map((e) => e.itemId))
			.filter((id) => id.startsWith('lens:'))
		expect(new Set(hung).size).toBe(hung.length)
	})

	it('a group room hangs a non-primary member’s card in its alleys', () => {
		const group = 'g:21'
		const cards = build.roomAt(group)?.room.exhibits.filter((e) => e.itemId === 'card:g:21--t:1:a')
		expect(cards?.length).toBe(1)
		expect(cards?.[0]?.anchorId.startsWith('anchor:bay:')).toBe(true)
		expect(offAlleys(build, group)).toEqual([])
	})
})
