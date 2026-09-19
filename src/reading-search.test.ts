import { assert, test } from 'vitest'
import { expandedSearch, readingSearch } from './reading-search'

test('source links retain document and section without consuming page filters', () => {
	const input = {
		detail: 's:submission-167',
		document: 'document-1',
		section: 'Documents',
		q: 'Screenrights',
	}
	assert.deepEqual(readingSearch(input), {
		detail: input.detail,
		document: input.document,
		section: input.section,
	})
	assert.strictEqual(input.q, 'Screenrights')
})

test('malformed or orphaned reading parameters fall back to the page', () => {
	for (const detail of [
		't:0',
		't:-2',
		't:1.5',
		'g:Infinity',
		't:9007199254740992',
		's:',
		'other:1',
		{},
		['t:1'],
	]) {
		assert.deepEqual(readingSearch({ detail, document: 'doc', section: 'Documents' }), {
			detail: undefined,
			document: undefined,
			section: undefined,
		})
	}
	assert.deepEqual(readingSearch({ detail: 't:3', document: 'doc', section: 'Key points' }), {
		detail: 't:3',
		document: undefined,
		section: 'Key points',
	})
})

test('expanded chapter links ignore malformed values and duplicate keys', () => {
	assert.deepEqual(expandedSearch(['t-25', 't-25', 'f-30', 't--1', {}, 2]), ['t-25', 'f-30'])
	assert.strictEqual(expandedSearch('t-25'), undefined)
	assert.strictEqual(expandedSearch([]), undefined)
})

test('legacy family and body selections retain their string keys', () => {
	for (const detail of ['f:governance', 'b:Department of Finance', 's:report:2026'])
		assert.strictEqual(readingSearch({ detail }).detail, detail)
})

test('legacy Galaxy group levels survive URL validation', () => {
	for (const detail of ['g1:221', 'g2:300']) {
		assert.deepEqual(readingSearch({ detail, section: 'Topics' }), {
			detail,
			document: undefined,
			section: 'Topics',
		})
	}
	for (const detail of ['g1:0', 'g2:-1', 'g2:9007199254740992', 'g3:1'])
		assert.strictEqual(readingSearch({ detail }).detail, undefined)
})
