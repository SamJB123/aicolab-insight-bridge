/**
 * Score bands: how an assessment's scores are read. A model scores in steps
 * finer than a reader thinks in (3.2, 3.7, 4.8), so every figure of an
 * assessment — its bar, its legend, its lens rows, the grid of two criteria
 * — counts documents by BAND, never by distinct score. A band is a named
 * range; a host may name its own (the audit corpus's assurance / material /
 * severe, as its site has always read severity); otherwise each whole point
 * of the criterion's scale is a band, holding the scores nearest it.
 */
import { z } from 'zod'

/** A range of scores: either end open (null) or bounded, the bound itself in or out. */
export const scoreRangeSchema = z.object({
	min: z.number().nullable(),
	max: z.number().nullable(),
	/** The minimum itself is outside the range (a score must be above it). */
	minOpen: z.boolean().optional(),
	/** The maximum itself is outside the range (a score must be below it). */
	maxOpen: z.boolean().optional(),
})
export type ScoreRange = z.infer<typeof scoreRangeSchema>

/** A named range of scores, in its scale's order, lowest first. */
export interface ScoreBand extends ScoreRange {
	label: string
	/** How the range reads beside the label ("≤ 2"), where the label does not say it. */
	note?: string
}

export const inRange = (range: ScoreRange, score: number): boolean =>
	(range.min === null || (range.minOpen ? score > range.min : score >= range.min)) &&
	(range.max === null || (range.maxOpen ? score < range.max : score <= range.max))

/** The most whole points a scale is read by before it is read in five equal bands instead. */
const MOST_POINTS = 7

/**
 * The bands of a scale with no host bands: each whole point, holding the
 * scores nearest it (a half rounds up), the ends open; a scale of more than
 * seven points in five equal bands.
 */
export function defaultBands([low, high]: [number, number]): ScoreBand[] {
	const first = Math.ceil(low)
	const last = Math.floor(high)
	if (last >= first && last - first + 1 <= MOST_POINTS)
		return Array.from({ length: last - first + 1 }, (_, i) => {
			const point = first + i
			return {
				label: String(point),
				min: point === first ? null : point - 0.5,
				max: point === last ? null : point + 0.5,
				maxOpen: true,
			}
		})
	const step = (high - low) / 5
	const at = (i: number) => Math.round((low + i * step) * 100) / 100
	return Array.from({ length: 5 }, (_, i) => ({
		label: `${at(i)}–${at(i + 1)}`,
		min: i === 0 ? null : at(i),
		max: i === 4 ? null : at(i + 1),
		maxOpen: true,
	}))
}

/** How many documents each band holds, from a distribution of exact scores. */
export const bandCounts = (
	bands: readonly ScoreBand[],
	distribution: readonly { score: number; documents: number }[],
): number[] =>
	bands.map((band) =>
		distribution.reduce((n, d) => (inRange(band, d.score) ? n + d.documents : n), 0),
	)
