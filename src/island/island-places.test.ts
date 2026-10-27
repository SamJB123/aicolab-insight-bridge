// A report island's places (@aicolab/atlas island-places.ts), read from
// its declaration and laid on its built world: its sections are its
// buildings, every room behind a door its section's, the sky table the
// galaxy's home.

import {
	islandPlacesOf,
	placeOfSpace,
} from '@aicolab/atlas/chessboard/content/island/island-places.ts'
import { describe, expect, it } from 'vitest'
import { reportDeclaration } from './declaration.ts'
import { realiseReportIsland } from './plan.ts'
import { reportIsland } from './registry.ts'
import { syntheticRecord } from './synthetic-record.ts'
import { buildReportWorld } from './world.ts'

describe("a report island's places", () => {
	it('its sections are its buildings, every room behind a door its section’s', () => {
		const island = reportIsland('training-data')
		const record = syntheticRecord()
		const realised = realiseReportIsland(reportDeclaration(record, island))
		const { world } = buildReportWorld(record, () => realised.reportPlan, island)
		const places = islandPlacesOf(realised.document, world, world.start)
		expect(places.island).toBe('training-data')
		expect(places.spaces.get(world.start)).toBe('')
		// A building's home is the room behind its door; a landmark's the
		// outdoors, standing at it, where the base pins a link to land.
		expect(places.homes.get('')).toEqual({ space: world.start })
		expect(places.homes.get('topics')).toEqual({ space: 'hall' })
		expect(places.homes.get('sources')).toEqual({ space: 'office' })
		expect(places.homes.get('analysis:terms')).toEqual({ space: 'q:terms' })
		for (const landmark of ['method', 'connect', 'search']) {
			expect(places.homes.get(landmark)).toEqual({
				space: world.start,
				mark: `examine:${landmark}`,
				entry: `at:${landmark}`,
			})
		}
		expect(places.homes.get('galaxy')).toEqual({
			space: world.start,
			mark: 'examine:sky-table',
			entry: 'at:sky-table',
		})
		for (const topic of record.topics) expect(places.spaces.get(`t:${topic.id}`)).toBe('topics')
		for (const source of record.sources) {
			expect(places.spaces.get(`s:${source.id}`)).toBe('sources')
		}
		expect(places.marks.get('examine:sky-table')).toBe('galaxy')
		expect(places.regions.get('plaza')).toBe('')
		// Each space as a host reads it: the outdoors and a section's front
		// room are homes; a room deeper in is its section's, named below it.
		const at = (local: string) => placeOfSpace(places, world.start, local)
		expect(at(world.start)).toEqual({ place: '', home: true })
		expect(at('hall')).toEqual({ place: 'topics', home: true })
		expect(at('office')).toEqual({ place: 'sources', home: true })
		expect(at('q:terms')).toEqual({ place: 'analysis:terms', home: true })
		const topic = record.topics[0]
		if (!topic) throw new Error('the record has no topic')
		expect(at(`t:${topic.id}`)).toEqual({ place: 'topics', home: false })
		// A room no thing's door leads to, or any room before the island's
		// places are known, is the island's own, named below it.
		expect(at('nowhere')).toEqual({ place: '', home: false })
		expect(placeOfSpace(undefined, world.start, 'hall')).toEqual({ place: '', home: false })
	})
})
