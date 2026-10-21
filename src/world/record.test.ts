/// <reference types="node" />
/**
 * The world record in the reader's scope, over a real canonical run database
 * (as explorer/scope.test.ts, skipped without one):
 *
 *   EXPLORER_DB=/path/to/run.sqlite pnpm vitest run src/world
 *
 * An excluded source is absent from the record and every count; a withheld
 * source keeps every count, its name and its one-word positions, and none of
 * its own words are anywhere in the record or its readings.
 */
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ReadScope } from '../explorer/scope.ts'
import { CANONICAL_RUN_SHAPE, worldReading, worldRecord } from './record.ts'

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
		for (const topic of less.topics)
			for (const point of topic.keyPoints)
				expect(point.quotes.some((q) => q.source === source.slug)).toBe(false)
		const reading = await worldReading(
			db,
			{ kind: 'document', documentId: source.documentId },
			CANONICAL_RUN_SHAPE,
			{ exclude: new Set([source.uuid]) },
		)
		expect(reading.keyPoints).toEqual([])
	})

	it('a withheld source keeps every count, and none of its words are in the record', async () => {
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
		// the notice where its words were
		const stance = held.perspectives.find(
			(p) => p.sourceId === source.slug && p.topicId === source.topicId,
		)
		expect(stance?.title).toBe(NOTICE)
		expect(stance?.analysis).toBe('')
		expect(stance?.quotes).toEqual([])
		for (const d of held.sources.find((s) => s.id === source.slug)?.documents ?? [])
			expect(d.points).toEqual([NOTICE])
		// none of its own texts anywhere: passages' key points, stances, quotes, answers
		const json = JSON.stringify(held)
		const named = held.sources.find((s) => s.id === source.slug)
		const kept = new Set([named?.name ?? '', ...(named?.documents ?? []).map((d) => d.title)])
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
		for (const t of theirs) expect(json.includes(JSON.stringify(t).slice(1, -1))).toBe(false)
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
		for (const r of readings)
			expect(r.keyPoints).toEqual([{ point: NOTICE, details: '', quotes: [] }])
	})
})
