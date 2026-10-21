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
import { drizzle } from 'drizzle-orm/node-sqlite'
import { beforeAll, describe, expect, it } from 'vitest'
import {
	documentDetailSchema,
	entityDetailSchema,
	groupDetailSchema,
	overviewSchema,
	topicDetailSchema,
} from '@aicolab/insight-bridge-contracts/explorer'
import * as x from './data.ts'

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
		expect(topic.members.length).toBe(first.entities)
		const stanceHolders = new Set(topic.entityPerspectives.map((p) => p.entityUuid))
		for (const uuid of stanceHolders) expect(topic.members.some((m) => m.entityUuid === uuid)).toBe(true)
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

	it('search, vocabularies, questions, task results and the galaxy answer', async () => {
		expect(Array.isArray(await x.searchText(db, 'the', 5))).toBe(true)
		expect(Array.isArray(await x.vocabularySummary(db))).toBe(true)
		expect(Array.isArray(await x.questionSummary(db))).toBe(true)
		expect(Array.isArray(await x.taskResults(db))).toBe(true)
		const galaxy = await x.galaxy(db, {
			entityNoun: 'source',
			entityNounPlural: 'sources',
			documentNounPlural: 'documents',
			facets: [],
			stanceLabels: [],
			seed: 1,
		})
		expect(galaxy.nodes.filter((n) => n.tier === 0).length).toBe(topics.length)
	})
})
