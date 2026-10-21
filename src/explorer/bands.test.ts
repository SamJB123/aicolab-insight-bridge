import { describe, expect, it } from 'vitest'
import { bandCounts, defaultBands, inRange, type ScoreBand } from './bands.ts'

describe('score bands', () => {
	it('a 1–5 scale reads in its five whole points, each holding the scores nearest it', () => {
		const bands = defaultBands([1, 5])
		expect(bands.map((b) => b.label)).toEqual(['1', '2', '3', '4', '5'])
		const counts = bandCounts(bands, [
			{ score: 1, documents: 10 },
			{ score: 1.5, documents: 1 },
			{ score: 3.2, documents: 2 },
			{ score: 3.5, documents: 3 },
			{ score: 4.8, documents: 4 },
			{ score: 5, documents: 5 },
		])
		// a half rounds up; nothing is lost at either end
		expect(counts).toEqual([10, 1, 2, 3, 9])
	})

	it('a wide scale reads in five equal bands, not a hundred points', () => {
		expect(defaultBands([0, 100])).toHaveLength(5)
	})

	it('a host’s bands keep their bounds exactly: ≤ 2, between, ≥ 4', () => {
		const severity: ScoreBand[] = [
			{ label: 'Assurance', min: null, max: 2 },
			{ label: 'Material', min: 2, max: 4, minOpen: true, maxOpen: true },
			{ label: 'Severe', min: 4, max: null },
		]
		expect([2, 2.5, 3.9, 4].map((s) => severity.findIndex((b) => inRange(b, s)))).toEqual([
			0, 1, 1, 2,
		])
	})
})
