/// <reference types="node" />
/**
 * The explorer reads over a real run database: every read answers, in the
 * shape its contract declares, and the counts hold together. The database is
 * a run file on disk, opened with drizzle's node:sqlite driver (a
 * `SQLiteAsyncDatabase`, as D1's and a Durable Object's are); the test is
 * skipped without one:
 *
 *   EXPLORER_DB=/path/to/run.sqlite pnpm vitest run src/explorer
 *
 * The run must be at the canonical schema (v11: the current_* and published_*
 * views), as the pipeline's opener leaves it.
 */
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
	documentDetailSchema,
	entityDetailSchema,
	galaxyDataSchema,
	groupDetailSchema,
	landscapeSchema,
	methodDataSchema,
	overviewSchema,
	questionDetailSchema,
	questionsOverviewSchema,
	reportOverviewSchema,
	runWordsSchema,
	topicDetailSchema,
} from '@aicolab/insight-bridge-contracts/explorer'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { beforeAll, describe, expect, it } from 'vitest'
import * as x from './data.ts'
import * as pages from './pages.ts'
import { documentReading, groupReading, sourceReading, topicReading } from './readings.ts'

const file = process.env.EXPLORER_DB

describe.skipIf(!file || !existsSync(file))('explorer reads over a run database', () => {
	const sqlite = new DatabaseSync(file ?? ':memory:', { readOnly: true })
	const db = drizzle({ client: sqlite })

	let topics: Awaited<ReturnType<typeof x.topics>>
	beforeAll(async () => {
		topics = await x.topics(db)
	})

	it('the overview counts published evidence', async () => {
		const overview = overviewSchema.parse(await x.overview(db))
		const published = sqlite.prepare('SELECT COUNT(*) AS n FROM published_document').get()
		expect(overview.documents).toBe(Number(published?.n))
		expect(overview.clusters).toBeGreaterThanOrEqual(topics.length)
	})

	it('a topic reads whole: members by grade, lineage, perspectives', async () => {
		const first = topics[0]
		expect(first).toBeDefined()
		if (!first) return
		const topic = topicDetailSchema.parse(await x.topicById(db, first.topicClusterId))
		// the topic counts its strong links; its members list every grade, each under its own
		expect(
			topic.members.filter(
				(m) => m.membershipType === 'exemplar' || m.membershipType === 'high_value',
			).length,
		).toBe(first.entities)
		const stanceHolders = new Set(topic.entityPerspectives.map((p) => p.entityUuid))
		for (const uuid of stanceHolders)
			expect(topic.members.some((m) => m.entityUuid === uuid)).toBe(true)
		for (const node of topic.lineage) expect(node.generation).toBeGreaterThan(0)
	})

	it('every grouping node reads, and its reach is its topics’ reach', async () => {
		const h = await x.hierarchy(db)
		const groups = h.nodes.filter((n) => n.generation > 0)
		for (const node of groups.slice(0, 12)) {
			const group = groupDetailSchema.parse(await x.groupById(db, node.superclusterId))
			expect(group.topicCount).toBeGreaterThan(0)
			for (const t of group.topics) expect(group.entities).toBeGreaterThanOrEqual(t.entities)
		}
		expect(await x.groupById(db, -1)).toBeNull()
	})

	it('a source and its documents read, with document facets', async () => {
		const [source] = (await x.entities(db)).filter((e) => e.documents > 0)
		expect(source).toBeDefined()
		if (!source) return
		const detail = entityDetailSchema.parse(await x.entityByKey(db, source.entityId))
		expect(detail.documentItems.length).toBe(source.documents)
		const [doc] = detail.documentItems
		if (!doc) return
		const document = documentDetailSchema.parse(await x.documentById(db, doc.documentId))
		expect(document.keyPointItems.length).toBe(doc.keyPoints)
	})

	it('the run says its words, and every reading reads from them', async () => {
		const words = runWordsSchema.parse(await x.runWords(db))
		const c = { words, positionColors: {} }
		const first = topics[0]
		if (!first) return
		const topic = await x.topicById(db, first.topicClusterId)
		if (!topic) throw new Error('the first topic did not read')
		const view = topicReading(topic, c)
		expect(view.title).toBe(first.title)
		expect(view.content.contributors?.reduce((n, g) => n + g.rows.length, 0)).toBe(
			topic.members.length,
		)
		const [node] = (await x.hierarchy(db)).nodes.filter((n) => n.generation > 0)
		if (node) {
			const group = await x.groupById(db, node.superclusterId)
			if (!group) throw new Error('a grouping node did not read')
			expect(groupReading(group, c).content.sections[0]?.kind).toBe('nodes')
		}
		const [source] = (await x.entities(db)).filter((e) => e.documents > 0)
		if (!source) return
		const detail = await x.entityByKey(db, source.entityId)
		if (!detail) throw new Error('the source did not read')
		const docs = await Promise.all(
			detail.documentItems.map((d) => x.documentById(db, d.documentId)),
		)
		const read = docs.flatMap((d) => (d ? [d] : []))
		expect(sourceReading(detail, read, c).title).toBe(detail.entityName)
		const [doc] = read
		if (doc) expect(documentReading(doc, c).detail).toBe(doc.entityName)
	})

	it('the pages read: overview, landscape, questions and the method’s facts hold together', async () => {
		const words = runWordsSchema.parse(await x.runWords(db))
		const overview = reportOverviewSchema.parse(await pages.reportOverview(db, words))
		const land = landscapeSchema.parse(await pages.landscape(db, words))
		expect(overview.topics).toBe(topics.length)
		expect(land.topics.length).toBe(topics.length)
		expect(overview.groups).toBe(land.groups.length)
		expect(overview.lensValues.reduce((a, v) => a + v.sources, 0)).toBe(overview.sources)
		for (const g of land.groups) expect(g.topics).toBeGreaterThan(0)
		const questions = questionsOverviewSchema.parse(await pages.questionsOverview(db, words))
		expect(questions.questions.length).toBe(overview.questions)
		const [first] = questions.questions
		if (first) {
			const detail = questionDetailSchema.parse(
				await pages.questionDetail(db, words, first.questionId),
			)
			expect(detail.byLensValue.reduce((a, v) => a + v.answers.length, 0)).toBe(first.responses)
		}
		const method = methodDataSchema.parse(await pages.methodData(db, words))
		expect(method.junk.length).toBe(overview.junkTopics)
		expect(method.unanalysed.length).toBe(overview.unanalysedDocuments)
	})

	it('search, vocabularies, questions, task results and the galaxy answer', async () => {
		expect(Array.isArray(await x.searchText(db, 'the', 5))).toBe(true)
		expect(Array.isArray(await x.vocabularySummary(db))).toBe(true)
		expect(Array.isArray(await x.questionSummary(db))).toBe(true)
		expect(Array.isArray(await x.taskResults(db))).toBe(true)
		const galaxy = galaxyDataSchema.parse(
			await pages.galaxy(db, await x.runWords(db), { facets: [], seed: 1 }),
		)
		expect(galaxy.nodes.filter((n) => n.tier === 0).length).toBe(topics.length)
		// every node an edge names is drawn, and the dust is strong links only
		const ids = new Set(galaxy.nodes.map((n) => n.id))
		expect(galaxy.edges.every((e) => ids.has(e.child) && ids.has(e.parent))).toBe(true)
		expect(
			galaxy.edges
				.filter((e) => e.child.startsWith('s:'))
				.every((e) => e.membershipType === 'exemplar' || e.membershipType === 'high_value'),
		).toBe(true)
	})
})
