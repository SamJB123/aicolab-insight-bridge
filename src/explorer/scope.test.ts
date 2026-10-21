/// <reference types="node" />
/**
 * The reader's scope over a real run database (as data.test.ts, skipped
 * without one):
 *
 *   EXPLORER_DB=/path/to/run.sqlite pnpm vitest run src/explorer
 *
 * An empty scope reads as no scope; excluding a source takes it out of every
 * count and list; withholding a source keeps every count and puts the notice
 * where its words were.
 */
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { beforeAll, describe, expect, it } from 'vitest'
import { analysisTasks } from './analysis.ts'
import * as x from './data.ts'
import * as pages from './pages.ts'
import { sourceReading } from './readings.ts'
import type { ReadScope } from './scope.ts'

const file = process.env.EXPLORER_DB
const NOTICE = 'Withheld for this test.'

describe.skipIf(!file || !existsSync(file))('the reader’s scope', () => {
	const sqlite = new DatabaseSync(file ?? ':memory:', { readOnly: true })
	const db = drizzle({ client: sqlite })

	/** A source with documents, strong links and a written stance: the one the scopes act on. */
	let source: Awaited<ReturnType<typeof x.entities>>[number]
	let topicId: number
	beforeAll(async () => {
		const sources = await x.entities(db)
		const stances = sqlite
			.prepare(
				`SELECT p.entity_uuid AS uuid, p.topic_cluster_id AS topic FROM cluster_entity_perspective p
				 JOIN current_entity_membership m ON m.entity_uuid = p.entity_uuid AND m.topic_cluster_id = p.topic_cluster_id
				 JOIN current_topic t ON t.topic_cluster_id = p.topic_cluster_id
				 WHERE m.membership_type IN ('exemplar', 'high_value')`,
			)
			.all()
		const chosen = sources.find(
			(e) => e.documents > 0 && stances.some((s) => s.uuid === e.entityUuid),
		)
		if (!chosen) throw new Error('the run has no source with documents and a written stance')
		source = chosen
		topicId = Number(stances.find((s) => s.uuid === chosen.entityUuid)?.topic)
	})

	const exclude = (): ReadScope => ({ exclude: new Set([source.entityUuid]) })
	const withhold = (): ReadScope => ({
		withhold: { entities: new Set([source.entityUuid]), notice: NOTICE },
	})

	it('an empty scope reads as no scope', async () => {
		const words = await x.runWords(db)
		const empty: ReadScope = { exclude: new Set() }
		expect(await x.overview(db, empty)).toEqual(await x.overview(db))
		expect(await pages.landscape(db, words, empty)).toEqual(await pages.landscape(db, words))
		expect(await pages.reportOverview(db, words, {}, empty)).toEqual(
			await pages.reportOverview(db, words),
		)
	})

	it('an excluded source leaves every count and every list', async () => {
		const words = await x.runWords(db)
		const scope = exclude()
		const [all, less] = [await x.overview(db), await x.overview(db, scope)]
		expect(less.entities).toBe(all.entities - 1)
		expect(less.documents).toBe(all.documents - source.documents)
		expect(await x.entityByKey(db, source.entityId, scope)).toBeNull()
		expect((await x.entities(db, scope)).some((e) => e.entityUuid === source.entityUuid)).toBe(
			false,
		)
		const topic = (await x.topics(db, false)).find((t) => t.topicClusterId === topicId)
		const scoped = await x.topicById(db, topicId, scope)
		expect(scoped?.entities).toBe((topic?.entities ?? 0) - 1)
		expect(scoped?.members.some((m) => m.entityUuid === source.entityUuid)).toBe(false)
		expect(scoped?.entityPerspectives.some((p) => p.entityUuid === source.entityUuid)).toBe(false)
		for (const kp of scoped?.keyPointItems ?? [])
			expect(kp.quotes.some((q) => q.entityUuid === source.entityUuid)).toBe(false)
		const report = [
			await pages.reportOverview(db, words),
			await pages.reportOverview(db, words, {}, scope),
		]
		expect(report[1]?.sources).toBe((report[0]?.sources ?? 0) - 1)
		expect(report[1]?.documents).toBe((report[0]?.documents ?? 0) - source.documents)
		const land = (await pages.landscape(db, words, scope)).topics.find(
			(t) => t.topicClusterId === topicId,
		)
		expect(land?.sources).toBe((topic?.entities ?? 0) - 1)
		const galaxy = await pages.galaxy(db, words, { facets: [], seed: 1 }, scope)
		expect(galaxy.nodes.some((n) => n.id === `s:${source.entityId}`)).toBe(false)
		const [tasksAll, tasksLess] = [
			await analysisTasks(db, words),
			await analysisTasks(db, words, scope),
		]
		expect(tasksLess.reduce((a, t) => a + t.documents, 0)).toBeLessThanOrEqual(
			tasksAll.reduce((a, t) => a + t.documents, 0),
		)
	})

	it('a withheld source keeps every count, and the notice stands where its words were', async () => {
		const words = await x.runWords(db)
		const scope = withhold()
		expect(await x.overview(db, scope)).toEqual(await x.overview(db))
		expect(await pages.landscape(db, words, scope)).toEqual(await pages.landscape(db, words))
		const detail = await x.entityByKey(db, source.entityId, scope)
		expect(detail?.withheld).toBe(true)
		expect(detail?.notice).toBe(NOTICE)
		for (const t of detail?.topicItems ?? []) {
			expect(t.positionAnalysis).toBeNull()
			expect(t.quotes).toEqual([])
			if (t.position !== null) expect(t.perspectiveTitle).toBe(NOTICE)
		}
		const topic = await x.topicById(db, topicId, scope)
		const stance = topic?.entityPerspectives.find((p) => p.entityUuid === source.entityUuid)
		expect(stance?.title).toBe(NOTICE)
		expect(stance?.positionAnalysis).toBe('')
		expect(stance?.position).toBeTruthy()
		for (const kp of topic?.keyPointItems ?? [])
			for (const q of kp.quotes.filter((q) => q.entityUuid === source.entityUuid)) {
				expect(q.text).toBe(NOTICE)
				expect(q.withheld).toBe(true)
			}
		const [doc] = detail?.documentItems ?? []
		const document = doc ? await x.documentById(db, doc.documentId, scope) : null
		expect(document?.withheld).toBe(true)
		expect(document?.text).toBe('')
		expect(document?.keyPointItems).toEqual([])
		if (detail && document) {
			const view = sourceReading(detail, [document], { words, positionColors: {} })
			expect(view.content.sections[0]?.kind).toBe('notice')
		}
	})

	it('a withheld answer reads the notice: its prose and its key points are the source’s words', async () => {
		const words = await x.runWords(db)
		// an answer with prose, in a run that asked questions (a run without any has nothing to withhold here)
		const answer = sqlite
			.prepare(
				`SELECT d.entity_uuid AS uuid, r.document_id AS documentId, r.question_id AS questionId
				 FROM published_question_response r JOIN published_document d ON d.document_id = r.document_id
				 WHERE r.addressed = 1 AND length(r.position) > 0 LIMIT 1`,
			)
			.get()
		if (!answer) return
		const uuid = String(answer.uuid)
		const scope: ReadScope = { withhold: { entities: new Set([uuid]), notice: NOTICE } }
		const document = await x.documentById(db, String(answer.documentId), scope)
		for (const r of document?.questionResponses ?? []) {
			expect(r.position).toBe('')
			expect(r.keyPoints).toEqual([])
		}
		const question = await pages.questionDetail(db, words, Number(answer.questionId), scope)
		const theirs =
			question?.byLensValue.flatMap((v) => v.answers).filter((a) => a.entityUuid === uuid) ?? []
		expect(theirs.length).toBeGreaterThan(0)
		for (const a of theirs) {
			expect(a.position).toBe(NOTICE)
			expect(a.keyPoints).toEqual([])
			expect(a.withheld).toBe(true)
		}
		for (const q of await x.questionSummary(db, scope))
			for (const p of q.positions.filter((p) => p.documentId === answer.documentId))
				expect(p.position).toBe(NOTICE)
	})
})
