import { expect, test } from 'vitest'
import { looksLikeQuote, parseNodeId, pickQuotes } from './readings.ts'

test('node ids: the reader’s, the galaxy’s grouping ids, and a source by slug or uuid', () => {
	expect(parseNodeId('t:12')).toEqual({ kind: 'topic', key: 12 })
	expect(parseNodeId('g:7')).toEqual({ kind: 'group', key: 7 })
	expect(parseNodeId('g2:7')).toEqual({ kind: 'group', key: 7 })
	expect(parseNodeId('s:submission-167')).toEqual({ kind: 'source', key: 'submission-167' })
	expect(parseNodeId('t:x')).toBeNull()
	expect(parseNodeId('s:')).toBeNull()
	expect(parseNodeId('nothing')).toBeNull()
})

test('a quote is a sentence, never a file name or a title', () => {
	expect(looksLikeQuote('Submission 12 - attachment.pdf')).toBe(false)
	expect(looksLikeQuote('The Australian Government Response to the Inquiry Report')).toBe(false)
	expect(
		looksLikeQuote('we think the regulator should be given the powers it needs to act on the evidence it has'),
	).toBe(true)
})

test('quotes prefer a different source each, then fill from the rest', () => {
	const sentence = (n: number) =>
		`this is the ${n}th time the committee has been told that the scheme is not working as it was meant to`
	const picked = pickQuotes(
		[
			{ text: sentence(1), source: 'A' },
			{ text: sentence(2), source: 'A' },
			{ text: sentence(3), source: 'B' },
		],
		2,
	)
	expect(picked.map((q) => q.source)).toEqual(['A', 'B'])
	expect(pickQuotes([{ text: sentence(1), source: 'A' }, { text: sentence(2), source: 'A' }], 2)).toHaveLength(2)
})
