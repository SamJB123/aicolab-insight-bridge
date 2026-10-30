// A report island's places (@aicolab/atlas island-places.ts), read from
// its declaration and laid on its built world: its sections are its
// buildings, every room behind a door its section's, the sky table in the
// galaxy's own cell the galaxy's home. Each thing is named as its hex
// island's destination declares it (kolo's landmark feature id).

import {
	islandPlacesOf,
	placeOfSpace,
	standOf,
} from '@aicolab/atlas/chessboard/content/island/island-places.ts'
import { describe, expect, it } from 'vitest'
import { realiseReportHex } from './hex-island.ts'
import { reportIsland } from './registry.ts'
import { syntheticRecord } from './synthetic-record.ts'
import { buildReportWorld } from './world.ts'

describe("a report island's places", () => {
	it('its sections are its buildings, every room behind a door its section’s', () => {
		const island = reportIsland('training-data')
		const record = syntheticRecord()
		const realised = realiseReportHex(record, island)
		const { world, waysOf } = buildReportWorld(record, island, realised.plan)
		const places = islandPlacesOf(realised, world, world.start, waysOf)
		expect(places.island).toBe('training-data')
		expect(places.spaces.get(world.start)).toBe('')
		// A building's home is the room behind its door; a landmark's the
		// outdoors, standing at it, where the base pins a link to land.
		expect(places.stands.get('')).toEqual({ space: world.start })
		expect(places.stands.get('topics')).toEqual({ space: 'hall' })
		expect(places.stands.get('sources')).toEqual({ space: 'office' })
		expect(places.stands.get('analysis:terms')).toEqual({ space: 'q:terms' })
		for (const landmark of ['method', 'connect', 'search']) {
			expect(places.stands.get(landmark)).toEqual({
				space: world.start,
				mark: `examine:landmark:${landmark}`,
				entry: `at:landmark:${landmark}`,
			})
		}
		expect(places.stands.get('galaxy')).toEqual({
			space: world.start,
			mark: 'examine:landmark:galaxy',
			entry: 'at:landmark:galaxy',
		})
		for (const topic of record.topics) expect(places.spaces.get(`t:${topic.id}`)).toBe('topics')
		for (const source of record.sources) {
			expect(places.spaces.get(`s:${source.id}`)).toBe('sources')
		}
		expect(places.marks.get('examine:landmark:galaxy')).toBe('galaxy')
		expect(places.regions.get('plaza')).toBe('')
		// Each space as a host reads it: the outdoors and a section's front
		// room are the places' own; a room deeper in is its section's, named
		// below it — an uncharted space, stood in.
		const at = (local: string) => placeOfSpace(places, world.start, local)
		expect(at(world.start)).toEqual({ place: '', own: true })
		expect(at('hall')).toEqual({ place: 'topics', own: true })
		expect(at('office')).toEqual({ place: 'sources', own: true })
		expect(at('q:terms')).toEqual({ place: 'analysis:terms', own: true })
		const topic = record.topics[0]
		if (!topic) throw new Error('the record has no topic')
		expect(at(`t:${topic.id}`)).toEqual({ place: 'topics', own: false })
		expect(standOf(places, `topics/t:${topic.id}`)).toEqual({ space: `t:${topic.id}` })
		// A room no thing's door leads to, or any room before the island's
		// places are known, is the island's own, named below it.
		expect(at('nowhere')).toEqual({ place: '', own: false })
		expect(placeOfSpace(undefined, world.start, 'hall')).toEqual({ place: '', own: false })
	})
})
