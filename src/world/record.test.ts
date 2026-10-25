/// <reference types="node" />
/**
 * The world record in the reader's scope, over a real canonical run database
 * (as explorer/scope.test.ts, skipped without one):
 *
 *   EXPLORER_DB=/path/to/run.sqlite pnpm vitest run src/world
 *
 * An excluded source is absent from the record and every count; a withheld
 * source keeps every count, its name and its one-word positions, and none of
 * its own words are anywhere in the record, a room's text or its readings.
 * The record carries no writing at all: a room's text holds the words its
 * walls show, counted as the record counts them.
 */
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ReadScope } from '../explorer/scope.ts'
import { CANONICAL_RUN_SHAPE, worldReading, worldRecord, worldText } from './record.ts'

const file = process.env.EXPLORER_DB
const NOTICE = 'Withheld for this test.'
// a run without run_meta must say its title and nouns; these do not touch what is tested
const WORDS = {
	title: 'Test run',
	nouns: { entity: 'source', entities: 'sources', document: 'document', documents: 'documents' },
}

describe.skipIf(!file || !existsSync(file))('the world record in the reader’s scope', () => {
	const sqlite = new DatabaseSync(file ?? ':memory:', { readOnly: true })
	const db = drizzle({ client: sqlite })
	const record = (scope?: ReadScope) =>
		worldRecord(db, { slug: 'test', shape: CANONICAL_RUN_SHAPE, words: WORDS, scope })

	/** A source with documents and a strong written stance (and an answer, where the run asked questions). */
	let source: { uuid: string; slug: string; documentId: string; topicId: number }
	let all: Awaited<ReturnType<typeof record>>
	beforeAll(async () => {
		const rows = sqlite
			.prepare(
				`SELECT e.id AS uuid, e.entity_id AS slug, d.document_id AS documentId, p.topic_cluster_id AS topicId
				 FROM entity e
				 JOIN published_document d ON d.entity_uuid = e.id
				 JOIN cluster_entity_perspective p ON p.entity_uuid = e.id
				 JOIN current_entity_membership m ON m.entity_uuid = e.id AND m.topic_cluster_id = p.topic_cluster_id
				 JOIN current_topic t ON t.topic_cluster_id = p.topic_cluster_id
				 WHERE m.membership_type IN ('exemplar', 'high_value')
				 ORDER BY EXISTS (SELECT 1 FROM published_question_response r WHERE r.document_id = d.document_id AND r.addressed = 1) DESC
				 LIMIT 1`,
			)
			.all()
		const row = rows[0]
		if (!row) throw new Error('the run has no source with a document and a strong written stance')
		source = {
			uuid: String(row.uuid),
			slug: String(row.slug),
			documentId: String(row.documentId),
			topicId: Number(row.topicId),
		}
		all = await record()
	})

	it('every analysed facet has sources behind its values (a derived facet included)', () => {
		for (const facet of all.facets) {
			expect(facet.values.length).toBeGreaterThan(0)
			expect(facet.values.reduce((a, v) => a + v.sources, 0)).toBeGreaterThan(0)
		}
	})

	it('a room’s text holds the words the record counts', async () => {
		const topic = all.topics.find((t) => t.id === source.topicId)
		const named = all.sources.find((s) => s.id === source.slug)
		const [topicText, sourceText] = await Promise.all([
			worldText(db, { kind: 'topic', topicId: source.topicId }, CANONICAL_RUN_SHAPE),
			worldText(db, { kind: 'source', sourceId: source.slug }, CANONICAL_RUN_SHAPE),
		])
		expect(topicText.points.length).toBe(topic?.keyPoints)
		// every lens the record names has its words in the topic's text, its quotes counted alike
		for (const lens of topic?.lenses ?? [])
			expect(
				topicText.lenses.find((l) => l.facet === lens.facet && l.value === lens.value)?.quotes
					.length,
			).toBe(lens.quotes)
		// the source's stance on the topic, from both rooms
		const stance = (text: typeof topicText) =>
			text.perspectives.find((p) => p.sourceId === source.slug && p.topicId === source.topicId)
		expect(stance(topicText)?.title).toBeTruthy()
		expect(stance(sourceText)).toEqual(stance(topicText))
		for (const d of named?.documents ?? [])
			expect(sourceText.documents.find((t) => t.id === d.id)?.points.length).toBe(d.points)
		const reading = await worldReading(
			db,
			{ kind: 'topic', topicId: source.topicId },
			CANONICAL_RUN_SHAPE,
		)
		expect(reading.keyPoints.map((p) => p.point)).toEqual(topicText.points)
	})

	it('an excluded source is absent, and every count leaves it out', async () => {
		const less = await record({ exclude: new Set([source.uuid]) })
		expect(less.sources.some((s) => s.id === source.slug)).toBe(false)
		expect(less.memberships.some((m) => m.sourceId === source.slug)).toBe(false)
		expect(less.perspectives.some((p) => p.sourceId === source.slug)).toBe(false)
		const before = all.topics.find((t) => t.id === source.topicId)
		const after = less.topics.find((t) => t.id === source.topicId)
		expect(after?.sources).toBe((before?.sources ?? 0) - 1)
		expect(Object.values(after?.positions ?? {}).reduce((a, n) => a + n, 0)).toBe(
			Object.values(before?.positions ?? {}).reduce((a, n) => a + n, 0) - 1,
		)
		for (const task of less.tasks)
			if ('prompts' in task)
				for (const prompt of task.prompts)
					expect(prompt.answers.some((a) => a.sourceId === source.slug)).toBe(false)
		const out: ReadScope = { exclude: new Set([source.uuid]) }
		const [topicReading, reading, topicText, sourceText] = await Promise.all([
			worldReading(db, { kind: 'topic', topicId: source.topicId }, CANONICAL_RUN_SHAPE, out),
			worldReading(
				db,
				{ kind: 'document', documentId: source.documentId },
				CANONICAL_RUN_SHAPE,
				out,
			),
			worldText(db, { kind: 'topic', topicId: source.topicId }, CANONICAL_RUN_SHAPE, out),
			worldText(db, { kind: 'source', sourceId: source.slug }, CANONICAL_RUN_SHAPE, out),
		])
		for (const point of topicReading.keyPoints)
			expect(point.quotes.some((q) => q.source === source.slug)).toBe(false)
		expect(reading.keyPoints).toEqual([])
		expect(topicText.perspectives.some((p) => p.sourceId === source.slug)).toBe(false)
		for (const lens of topicText.lenses)
			expect(lens.quotes.some((q) => q.source === source.slug)).toBe(false)
		expect(sourceText).toEqual({
			ref: { kind: 'source', sourceId: source.slug },
			points: [],
			documents: [],
			perspectives: [],
			lenses: [],
			answers: [],
		})
	})

	it('a withheld source keeps every count, and none of its words are served', async () => {
		const scope: ReadScope = { withhold: { entities: new Set([source.uuid]), notice: NOTICE } }
		const held = await record(scope)
		// every count and every position as before
		expect(held.sources.length).toBe(all.sources.length)
		expect(held.memberships).toEqual(all.memberships)
		expect(held.topics.map((t) => [t.id, t.sources, t.documents, t.positions])).toEqual(
			all.topics.map((t) => [t.id, t.sources, t.documents, t.positions]),
		)
		expect(held.perspectives.map((p) => [p.topicId, p.sourceId, p.position, p.keyPoints])).toEqual(
			all.perspectives.map((p) => [p.topicId, p.sourceId, p.position, p.keyPoints]),
		)
		// the notice where its words were, in its rooms' text
		const texts = await Promise.all([
			worldText(db, { kind: 'topic', topicId: source.topicId }, CANONICAL_RUN_SHAPE, scope),
			worldText(db, { kind: 'source', sourceId: source.slug }, CANONICAL_RUN_SHAPE, scope),
			...held.tasks.map((task) =>
				worldText(db, { kind: 'task', taskId: task.id }, CANONICAL_RUN_SHAPE, scope),
			),
		])
		const [topicText, sourceText] = texts
		const stance = topicText?.perspectives.find(
			(p) => p.sourceId === source.slug && p.topicId === source.topicId,
		)
		expect(stance?.title).toBe(NOTICE)
		expect(stance?.analysis).toBe('')
		expect(
			held.perspectives.find((p) => p.sourceId === source.slug && p.topicId === source.topicId)
				?.quotes,
		).toBe(0)
		for (const d of sourceText?.documents ?? []) expect(d.points).toEqual([NOTICE])
		// none of its own texts anywhere: passages' key points, stances, quotes, answers. Each is a value of
		// its own in what is served, so every string is gathered once (a body of 951 reports has thousands
		// of texts; a search of everything per text cost the test seconds)
		const heldTexts = new Set<string>()
		const gather = (value: unknown): void => {
			if (typeof value === 'string') heldTexts.add(value.trim())
			else if (Array.isArray(value)) for (const v of value) gather(v)
			else if (value && typeof value === 'object') for (const v of Object.values(value)) gather(v)
		}
		gather(held)
		gather(texts)
		gather(
			await worldReading(
				db,
				{ kind: 'topic', topicId: source.topicId },
				CANONICAL_RUN_SHAPE,
				scope,
			),
		)
		const named = held.sources.find((s) => s.id === source.slug)
		const kept = new Set([named?.name ?? '', ...(named?.documents ?? []).map((d) => d.title)])
		const saidByAnother = sqlite.prepare(
			`WITH others AS (SELECT document_id FROM published_document WHERE entity_uuid <> ?1)
			 SELECT 1 FROM published_key_quote q
			   JOIN published_key_point k ON k.key_point_id = q.key_point_id
			   WHERE k.document_id IN (SELECT document_id FROM others) AND instr(q.quote, ?2) > 0
			 UNION ALL SELECT 1 FROM published_key_point k
			   WHERE k.document_id IN (SELECT document_id FROM others) AND instr(k.key_point, ?3) > 0
			 UNION ALL SELECT 1 FROM cluster_key_point_quote c
			   WHERE c.entity_uuid <> ?1 AND instr(c.quote_text, ?4) > 0
			 UNION ALL SELECT 1 FROM cluster_key_point p WHERE instr(p.key_point || ' ' || p.details, ?2) > 0
			 UNION ALL SELECT 1 FROM topic_cluster t WHERE instr(t.title || ' ' || t.description, ?2) > 0
			 LIMIT 1`,
		)
		const theirs = [
			...sqlite
				.prepare(
					'SELECT key_point AS t FROM published_key_point WHERE document_id IN (SELECT document_id FROM published_document WHERE entity_uuid = ?)',
				)
				.all(source.uuid),
			...sqlite
				.prepare(
					'SELECT quote AS t FROM published_key_quote WHERE key_point_id IN (SELECT key_point_id FROM published_key_point WHERE document_id IN (SELECT document_id FROM published_document WHERE entity_uuid = ?))',
				)
				.all(source.uuid),
			...sqlite
				.prepare(
					'SELECT position_analysis AS t FROM cluster_entity_perspective WHERE entity_uuid = ?',
				)
				.all(source.uuid),
			...sqlite
				.prepare('SELECT title AS t FROM cluster_entity_perspective WHERE entity_uuid = ?')
				.all(source.uuid),
			...sqlite
				.prepare(
					'SELECT quote_text AS t FROM cluster_entity_perspective_quote WHERE cluster_entity_perspective_id IN (SELECT cluster_entity_perspective_id FROM cluster_entity_perspective WHERE entity_uuid = ?)',
				)
				.all(source.uuid),
			...sqlite
				.prepare('SELECT quote_text AS t FROM cluster_key_point_quote WHERE entity_uuid = ?')
				.all(source.uuid),
			...sqlite
				.prepare(
					'SELECT position AS t FROM published_question_response WHERE document_id IN (SELECT document_id FROM published_document WHERE entity_uuid = ?)',
				)
				.all(source.uuid),
		]
			.map((r) => String(r.t ?? '').trim())
			// long enough to be its own words, not a phrase every source might share; and not its
			// name or a document's title, which are kept (a paper's stance may be titled as the paper)
			.filter((t) => t.length >= 40 && !kept.has(t))
		expect(theirs.length).toBeGreaterThan(0)
		// Any of its texts found in the record must be words said elsewhere too: one body's report
		// may quote another's verbatim (the audit corpus's Inspector-General quoting the ANAO), and
		// a topic's own synthesis may use a source's phrase word for word; the record keeps both.
		// (Found first, then checked: the check reads every quote.) A failure names the text.
		const found = theirs.filter((t) => heldTexts.has(t))
		expect(found.filter((t) => !saidByAnother.get(source.uuid, t, t, t))).toEqual([])
		// its readings are the notice
		const readings = await Promise.all([
			worldReading(
				db,
				{ kind: 'document', documentId: source.documentId },
				CANONICAL_RUN_SHAPE,
				scope,
			),
			worldReading(
				db,
				{ kind: 'perspective', topicId: source.topicId, sourceId: source.slug },
				CANONICAL_RUN_SHAPE,
				scope,
			),
		])
		for (const r of readings) {
			expect(r.keyPoints).toEqual([{ point: NOTICE, details: '', quotes: [] }])
			expect(r.quotes).toEqual([])
		}
	})
})
