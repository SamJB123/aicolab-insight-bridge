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
	perspectiveDocumentsSchema,
	perspectiveGroupsSchema,
	questionDetailSchema,
	questionsOverviewSchema,
	reportOverviewSchema,
	runWordsSchema,
	topicDetailSchema,
} from '@aicolab/insight-bridge-contracts/explorer'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { beforeAll, describe, expect, it } from 'vitest'
import * as analysis from './analysis.ts'
import * as x from './data.ts'
import { derivedValue, loadFacetCache } from './facets.ts'
import * as pages from './pages.ts'
import { documentReading, groupReading, sourceReading, topicReading } from './readings.ts'

const file = process.env.EXPLORER_DB

describe('a derived facet', () => {
	const rule = {
		from_facet: 'year',
		unknown_label: 'Unknown',
		buckets: [
			{ min: null, max: 2014, label: 'Foundations' },
			{ min: 2015, max: 2022, label: 'Automation' },
			{ min: 2026, max: null, label: 'Current' },
		],
	}
	it('places a year in its bucket, open ends included; else the unknown label', () => {
		expect(derivedValue(rule, '1998')).toBe('Foundations')
		expect(derivedValue(rule, '2015-03-01')).toBe('Automation')
		expect(derivedValue(rule, '2031')).toBe('Current')
		expect(derivedValue(rule, '2024')).toBe('Unknown')
		expect(derivedValue(rule, 'n.d.')).toBe('Unknown')
		expect(derivedValue(rule, undefined)).toBe('Unknown')
	})
})

describe('a reader’s words as a LIKE pattern', () => {
	const bytes = (s: string) => new TextEncoder().encode(s).length
	it('fits D1’s 50-byte cap, by bytes, at a character boundary', () => {
		const long = 'Water-quality pressures remain significant, while overlapping provisions'
		expect(bytes(x.likePattern(long))).toBeLessThanOrEqual(50)
		const wide = 'Ngarrindjeri Ruwe · Kurangk — the Coorong, the Lakes and the Murray Mouth'
		const pattern = x.likePattern(wide)
		expect(bytes(pattern)).toBeLessThanOrEqual(50)
		expect(wide.startsWith(pattern.slice(1, -1))).toBe(true)
	})
	it('drops LIKE’s wildcards and its escape from the words', () => {
		expect(x.likePattern('  100%_of \\ water  ')).toBe('%100  of   water%')
	})
})

describe.skipIf(!file || !existsSync(file))('explorer reads over a run database', () => {
	const sqlite = new DatabaseSync(file ?? ':memory:', { readOnly: true })
	const db = drizzle({ client: sqlite })

	let topics: Awaited<ReturnType<typeof x.topics>>
	beforeAll(async () => {
		topics = await x.topics(db)
	})

	it('every source carries the facets its profile derives, from the facet they come from', async () => {
		const [meta] = sqlite.prepare('SELECT profile FROM run_meta WHERE singleton = 1').all()
		const profile = meta?.profile ? JSON.parse(String(meta.profile)) : null
		const derived: { name: string; derive: Parameters<typeof derivedValue>[0] }[] = (
			profile?.facets ?? []
		).filter(
			(f: { derive?: unknown; granularity?: string }) =>
				f.derive && (f.granularity ?? 'entity') === 'entity',
		)
		const facets = await loadFacetCache(db, 'entity')
		for (const { name, derive } of derived)
			for (const values of facets.values())
				expect(values[name]).toEqual([derivedValue(derive, values[derive.from_facet]?.[0])])
		// asked for alone, a facet reads exactly as in the whole read, and nothing else comes with it
		for (const name of [...derived.map((d) => d.name), 'distribution', 'voice']) {
			const alone = await loadFacetCache(db, 'entity', [name])
			for (const [subject, values] of alone) {
				expect(Object.keys(values).every((key) => key === name)).toBe(true)
				expect(values[name]).toEqual(facets.get(subject)?.[name])
			}
		}
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
		// a topic's members are its strong links, as its count is
		expect(topic.members.length).toBe(first.entities)
		for (const m of topic.members) expect(['exemplar', 'high_value']).toContain(m.membershipType)
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
		// a source reads its own document's detail only when it has one document (readings.ts sourceReading)
		const [item] = detail.documentItems
		const doc = item ? await x.documentById(db, item.documentId) : null
		expect(sourceReading(detail, doc, c).title).toBe(detail.entityName)
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
		const tasks = await analysis.analysisTasks(db, words)
		const questionTask = tasks.find((t) => t.kind === 'question_response')
		const method = methodDataSchema.parse(await pages.methodData(db, words))
		expect(method.junk.length).toBe(overview.junkTopics)
		expect(method.unanalysed.length).toBe(overview.unanalysedDocuments)
		// a run that put no questions to its documents counts none
		if (!questionTask) {
			expect(overview.questions).toBe(0)
			return
		}
		const questions = questionsOverviewSchema.parse(
			await analysis.questionsOverview(db, words, questionTask.taskId),
		)
		expect(questions.questions.length).toBe(overview.questions)
		expect(questions.task.documents).toBe(questionTask.documents)
		const [first] = questions.questions
		if (first) {
			const detail = questionDetailSchema.parse(
				await pages.questionDetail(db, words, first.questionId),
			)
			expect(detail.byLensValue.reduce((a, v) => a + v.answers.length, 0)).toBe(first.responses)
		}
	})

	it('a perspective task reads by document: every finding on its document’s card, search narrowing', async () => {
		const words = runWordsSchema.parse(await x.runWords(db))
		const task = (await analysis.analysisTasks(db, words)).find(
			(t) => t.kind === 'perspective_analysis',
		)
		if (!task) return
		const overview = await analysis.perspectiveOverview(db, words, task.taskId)
		if (!overview) throw new Error('the perspective task did not read')
		const all = perspectiveDocumentsSchema.parse(
			await analysis.perspectiveDocuments(db, words, task.taskId, { limit: 100 }),
		)
		// the documents the task found something in: a document analysed to no finding has no card
		expect(all.total).toBeGreaterThan(0)
		expect(all.total).toBeLessThanOrEqual(task.documents)
		// a page of cards holds every finding of its documents, under the task's criteria
		const criteria = new Set(overview.criteria.map((c) => c.criterionId))
		for (const d of all.documents) {
			expect(d.entries.length).toBeGreaterThan(0)
			for (const e of d.entries) expect(criteria.has(e.criterionId)).toBe(true)
		}
		// pages together account for every finding the task made
		let entries = 0
		for (let offset = 0; offset < all.total; offset += 100)
			for (const d of perspectiveDocumentsSchema.parse(
				await analysis.perspectiveDocuments(db, words, task.taskId, { offset, limit: 100 }),
			).documents)
				entries += d.entries.length
		expect(entries).toBe(overview.criteria.reduce((a, c) => a + c.findings, 0))
		// every grouping: a group's count is what choosing it leaves; every document is in some group
		const plain = perspectiveGroupsSchema.parse(
			await analysis.perspectiveGroups(db, words, task.taskId),
		)
		expect(plain.total).toBe(all.total)
		expect(plain.lens.reduce((a, l) => a + l.documents, 0)).toBe(all.total)
		for (const grouping of plain.groupings) {
			const grouped = perspectiveGroupsSchema.parse(
				await analysis.perspectiveGroups(db, words, task.taskId, { groupBy: grouping.key }),
			)
			expect(grouped.groupBy).toBe(grouping.key)
			expect(grouped.groups.reduce((a, g) => a + g.documents, 0)).toBeGreaterThanOrEqual(all.total)
			for (const g of grouped.groups.slice(0, 3)) {
				const inGroup = perspectiveDocumentsSchema.parse(
					await analysis.perspectiveDocuments(db, words, task.taskId, {
						group: { by: grouping.key, value: g.value },
						limit: 1,
					}),
				)
				expect(inGroup.total).toBe(g.documents)
			}
		}
		// a search narrows to the documents whose findings mention it
		const word = all.documents[0]?.entries[0]?.keyPoint.split(/\s+/).find((w) => w.length > 6)
		if (word) {
			const found = perspectiveDocumentsSchema.parse(
				await analysis.perspectiveDocuments(db, words, task.taskId, { query: word, limit: 100 }),
			)
			expect(found.total).toBeGreaterThan(0)
			expect(found.total).toBeLessThanOrEqual(all.total)
		}
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
