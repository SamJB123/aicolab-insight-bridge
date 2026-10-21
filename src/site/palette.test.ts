/**
 * Which position takes which colour is a claim about meaning, so the thing
 * worth proving is that warm and cool appear only where the scale says
 * something agrees or pushes back, and nowhere else.
 */
import { describe, expect, it } from 'vitest'
import { positionColors } from './palette.ts'

describe('positionColors', () => {
	it("gives a scale with an agreement reading its roles' colours, hottest furthest from agreement", () => {
		// Training Data's scale, as its run's words state it
		const colors = positionColors({
			order: ['Supports', 'Builds on', 'Unclear', 'Mixed', 'Redirects', 'Opposes'],
			supportive: ['Supports', 'Builds on'],
			contesting: ['Mixed', 'Redirects', 'Opposes'],
			unclear: 'Unclear',
		})
		expect(colors).toEqual({
			Supports: 'var(--p-supports)',
			'Builds on': 'var(--p-builds)',
			Unclear: 'var(--p-unclear)',
			Mixed: 'var(--p-mixed)',
			Redirects: 'var(--p-redirects)',
			Opposes: 'var(--p-opposes)',
		})
	})

	it('puts a short contesting side at the hot end', () => {
		const colors = positionColors({
			order: ['Agrees', 'Disagrees'],
			supportive: ['Agrees'],
			contesting: ['Disagrees'],
			unclear: null,
		})
		expect(colors).toEqual({ Agrees: 'var(--p-supports)', Disagrees: 'var(--p-opposes)' })
	})

	it('greys a position the agreement reading does not place', () => {
		const colors = positionColors({
			order: ['Agrees', 'Off topic', 'Disagrees'],
			supportive: ['Agrees'],
			contesting: ['Disagrees'],
			unclear: null,
		})
		expect(colors['Off topic']).toBe('var(--p-unclear)')
	})

	it('colours a scale without an agreement reading by order, warm and cool meaning nothing', () => {
		// an audit grading severity: no end of it agrees with anything
		const order = ['Assurance', 'Minor', 'Moderate', 'Significant', 'Systemic']
		const colors = positionColors({ order, supportive: [], contesting: [], unclear: null })
		expect(order.map((p) => colors[p])).toEqual([
			'var(--p-order-1)',
			'var(--p-order-2)',
			'var(--p-order-3)',
			'var(--p-order-4)',
			'var(--p-order-5)',
		])
	})

	it('wraps the order colours past eight and keeps an unclear position grey', () => {
		const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'Unclear']
		const colors = positionColors({ order, supportive: [], contesting: [], unclear: 'Unclear' })
		expect(colors.i).toBe('var(--p-order-1)')
		expect(colors.Unclear).toBe('var(--p-unclear)')
	})
})
