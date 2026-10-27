// A record that analysed SEVERAL facets gets a hall per facet inside the
// Sources building: the office introduces each facet, the facet's hall
// introduces its cohorts, a cohort's way back is its facet's hall, and the
// map draws a facet hall with its cohorts. A record with ONE analysed
// facet keeps the office introducing the cohorts itself.

import { describe, expect, it } from 'vitest'
import { type WorldRecord, worldRecordSchema } from '../world/index.ts'
import { syntheticRecord } from './synthetic-record.ts'
import { buildReportWorld, mapOf } from './world.ts'

/** The synthetic record with a second analysed facet, era, on every
 *  source and a lens for it on every topic. */
function twoFacetRecord(): WorldRecord {
	const base = syntheticRecord()
	const eras = ['Early', 'Late']
	return worldRecordSchema.parse({
		...base,
		facets: [
			...base.facets,
			{
				key: 'era',
				heading: 'Era',
				values: eras.map((value) => ({ value, label: value, sources: 2 })),
			},
		],
		sources: base.sources.map((s, i) => ({
			...s,
			facets: { ...s.facets, era: [eras[i % 2] ?? 'Early'] },
		})),
		topics: base.topics.map((t) => ({
			...t,
			lenses: [...t.lenses, { facet: 'era', value: 'Early', position: 'Supports', quotes: 0 }],
		})),
	})
}

const plaques = (build: ReturnType<typeof buildReportWorld>, spaceId: string) =>
	build.rooms
		.find((r) => r.spaceId === spaceId)
		?.exhibits.map((e) => e.itemId)
		.filter((id) => id.startsWith('plaque:')) ?? []

describe('a hall per analysed facet', () => {
	const build = buildReportWorld(twoFacetRecord())

	it('the office introduces the facets, not the cohorts', () => {
		expect(plaques(build, 'office').sort()).toEqual([
			'plaque:office:f:era',
			'plaque:office:f:sector',
		])
	})

	it('each facet hall introduces its cohorts', () => {
		expect(plaques(build, 'f:era').sort()).toEqual([
			'plaque:f:era:c:era:early',
			'plaque:f:era:c:era:late',
		])
		expect(plaques(build, 'f:sector').length).toBe(2)
	})

	it('a cohort’s way back is its facet’s hall, and the map draws the hall with its cohorts', () => {
		const lobby = build.rooms.find((r) => r.spaceId === 'c:era:early')
		expect(lobby?.plan.doors.some((d) => d.doorId === 'door:f:era--c:era:early')).toBe(true)
		const map = mapOf(build, 'f:era')
		const drawn = new Set(map?.spaces.map((s) => s.id))
		expect(drawn.has('f:era')).toBe(true)
		expect(drawn.has('c:era:early')).toBe(true)
		expect(drawn.has('office')).toBe(true)
	})
})

describe('one analysed facet keeps the flat office', () => {
	it('the office introduces the cohorts and there is no facet hall', () => {
		const build = buildReportWorld(syntheticRecord())
		expect(build.rooms.some((r) => r.spaceId.startsWith('f:'))).toBe(false)
		expect(plaques(build, 'office').sort()).toEqual([
			'plaque:office:c:sector:academia',
			'plaque:office:c:sector:company',
		])
	})
})
