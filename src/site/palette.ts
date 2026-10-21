/**
 * Which colour each position of a run's stance scale is drawn in — one
 * definition for every report (decided 2026-10-21; Training Data's
 * charts.tsx and the pipeline's PositionBar each derived it their own way).
 *
 * The colours are site.css's palette tokens, so a host's theme decides what
 * they look like and this decides only which position takes which:
 *
 *   • A scale with an agreement reading (some positions agree with a topic's
 *     claim, some push back): the supportive positions take the cool end in
 *     order, the contesting ones the hot end with the furthest from agreement
 *     hottest, the unclear one grey; any other position grey.
 *   • A scale without one (an audit grading severity, say): nothing is warm or
 *     cool by meaning, so each position takes the next of eight order colours.
 */
import type { RunWords } from '@aicolab/insight-bridge-contracts/explorer'

/** A run's stance scale: its positions in order and, when it has one, its agreement reading. */
export type PositionScale = RunWords['scale']

const SUPPORTIVE = ['var(--p-supports)', 'var(--p-builds)'] as const
const CONTESTING = ['var(--p-mixed)', 'var(--p-redirects)', 'var(--p-opposes)'] as const
const ORDER_COLOURS = 8
const UNCLEAR = 'var(--p-unclear)'

/** One colour per position of the scale, as a CSS value. */
export function positionColors(scale: PositionScale): Record<string, string> {
	const out: Record<string, string> = {}
	if (scale.supportive.length === 0 && scale.contesting.length === 0) {
		scale.order.forEach((p, i) => {
			out[p] = p === scale.unclear ? UNCLEAR : `var(--p-order-${(i % ORDER_COLOURS) + 1})`
		})
		return out
	}
	scale.supportive.forEach((p, i) => {
		out[p] = SUPPORTIVE[Math.min(i, SUPPORTIVE.length - 1)] ?? 'var(--p-supports)'
	})
	// the last contesting position is the furthest from agreement, so it takes the hottest colour
	const n = scale.contesting.length
	scale.contesting.forEach((p, i) => {
		const fromEnd = n - 1 - i
		out[p] = CONTESTING[Math.max(0, CONTESTING.length - 1 - fromEnd)] ?? 'var(--p-opposes)'
	})
	if (scale.unclear) out[scale.unclear] = UNCLEAR
	for (const p of scale.order) out[p] ??= UNCLEAR
	return out
}
