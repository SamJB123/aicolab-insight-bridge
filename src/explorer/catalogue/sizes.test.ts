/// <reference types="node" />
/**
 * What the report catalogue promises, measured against a real run database: every read
 * this run serves answers its own examples in the shape its output schema declares, and
 * every answer fits a model's context — 48 KB for a detail or a page (the overview, one
 * topic, one source, one document, the Brief, the galaxy, the readings…), 24 KB for the
 * rest — with the table of sizes printed so a growth is seen before a host sees it
 * (settled 2026-10-24). The database is a run file on disk, opened with drizzle's
 * node:sqlite driver, as data.test.ts opens it; the test is skipped without one:
 *
 *   EXPLORER_DB=/path/to/run.sqlite pnpm vitest run src/explorer/catalogue
 *
 * A report app's local D1 is such a file (.wrangler/state/v3/d1/miniflare-D1DatabaseObject/
 * <hash>.sqlite), so each report is measured by pointing this at its own.
 */
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { AnyOperation, Call } from '@aicolab/app-kit/api/define'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { beforeAll, describe, expect, it } from 'vitest'
import type { z } from 'zod'
import * as x from '../data.ts'
import { requestReader } from '../reader.ts'
import type { ReportCtx } from './context.ts'
import { type ReportCatalogue, reportCatalogue, reportInstructions, toolContext } from './index.ts'
import { documentMarkdown, sourceMarkdown, topicMarkdown } from './shapes.ts'

const file = process.env.EXPLORER_DB

/** The budget a read's answer must fit: a detail or a page, or a listing. */
const DETAIL_KB = 48
const LISTING_KB = 24
const DETAILS = new Set([
	'corpus_overview',
	'fetch',
	'get_topic',
	'topic_perspectives',
	'source_perspectives',
	'question_answers',
	'get_source',
	'get_document',
	'list_vocabularies',
	'task_results',
	'report_overview',
	'brief',
	'chapter_reading',
	'sources_record',
	'galaxy',
	'method',
	'analysis',
	'analysis_drill',
	'topic_reading',
	'group_reading',
	'source_reading',
	'document_reading',
	'reading_list',
	'draft_brief',
	'compare_sources',
])

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

/** A handler's call with nothing to report to. */
const call: Call = {
	signal: new AbortController().signal,
	progress: () => {},
	log: () => {},
}

/** Run one operation's handler with its input validated, as a surface would, and return the result. */
async function run(
	operation: AnyOperation<ReportCtx>,
	input: Record<string, unknown>,
	ctx: ReportCtx,
): Promise<unknown> {
	const produced = operation.handler(operation.input.parse(input), ctx, call)
	if (Symbol.asyncIterator in produced) {
		let last: unknown
		for await (const event of produced) last = event
		return last
	}
	return produced
}

/** The example on an input field, as the Connect console reads it off the published schema. */
const exampleOf = (field: z.ZodType): unknown => {
	const examples = field.meta()?.examples
	return Array.isArray(examples) ? examples[0] : undefined
}

describe.skipIf(!file || !existsSync(file))('the report catalogue over a run database', () => {
	const sqlite = new DatabaseSync(file ?? ':memory:', { readOnly: true })
	// one reader for the whole test, over one record: the per-record memos hold across reads
	const db = requestReader(drizzle({ client: sqlite }), {})
	let catalogue: ReportCatalogue
	let ctx: ReportCtx
	const rows: string[] = []

	beforeAll(async () => {
		const runFacts = await toolContext(db)
		catalogue = reportCatalogue(runFacts)
		ctx = {
			db,
			run: runFacts,
			origin: 'https://report.example.aicolab.org',
			host: { slug: 'test' },
		}
	})

	/** An operation's arguments: its fields' examples, then a real value for any required input the examples leave out. */
	async function argsFor(operation: AnyOperation<ReportCtx>): Promise<Record<string, unknown>> {
		const args: Record<string, unknown> = {}
		for (const [key, field] of Object.entries(operation.input.shape)) {
			const example = exampleOf(field)
			if (example !== undefined) args[key] = example
		}
		const examples = ctx.run.examples
		/** A real value the run has, or nothing: a flat run has no group to name. */
		const given = (key: string, value: unknown) => {
			if (value !== null && value !== undefined) args[key] = value
		}
		if (operation.name === 'find_documents' && !args.query) args.query = 'the'
		if (['get_concept', 'entities_for_concept', 'documents_for_concept'].includes(operation.name)) {
			const [vocabulary] = await x.vocabularySummary(db)
			given('facet', vocabulary?.category)
			given('concept', vocabulary?.tags[0]?.path)
		}
		if (operation.name === 'chapter_reading')
			given('chapter_id', examples.groupId ?? examples.topicId)
		if (operation.name === 'topic_reading') given('topic_id', examples.topicId)
		if (operation.name === 'group_reading') given('supercluster_id', examples.groupId)
		if (operation.name === 'source_reading') given('source', examples.sourceId)
		if (operation.name === 'document_reading') given('document_id', examples.documentId)
		if (operation.name === 'analysis') given('task_id', Object.keys(ctx.run.words.tasks)[0])
		if (operation.name === 'compare_sources') {
			const two = (await x.entities(db)).filter((e) => e.topics > 0).slice(0, 2)
			given(
				'sources',
				two.map((e) => e.entityId),
			)
		}
		if (operation.name === 'analysis_drill') {
			const tasks = Object.entries(ctx.run.words.tasks)
			const perspectiveTask = tasks.find(([, task]) => task.type === 'perspective_analysis')
			const taggingTask = tasks.find(([, task]) => task.type === 'metadata_tagging')
			if (perspectiveTask) {
				args.request = { kind: 'perspectiveDocuments', taskId: perspectiveTask[0], offset: 0 }
			} else if (taggingTask) {
				const [tag] = sqlite
					.prepare(
						'SELECT a.facet, a.facet_value AS path FROM facet_assignment a JOIN doc_custom_analysis d ON d.custom_analysis_id = a.custom_analysis_id WHERE d.task_id = ? LIMIT 1',
					)
					.all(taggingTask[0])
				args.request = {
					kind: 'tagDocuments',
					taskId: taggingTask[0],
					category: String(tag?.facet),
					path: String(tag?.path),
					offset: 0,
				}
			}
		}
		return args
	}

	it('every read this run serves answers its examples, in its declared shape, within its budget', async () => {
		expect(catalogue.operations.length).toBeGreaterThan(20)
		for (const operation of catalogue.operations) {
			const args = await argsFor(operation)
			if (operation.name === 'analysis_drill' && !args.request) continue
			const result = await run(operation, args, ctx)
			const parsed = operation.output.safeParse(result)
			expect(parsed.success ? operation.name : `${operation.name}: ${parsed.error.message}`).toBe(
				operation.name,
			)
			const size = JSON.stringify(result).length
			const limit = (DETAILS.has(operation.name) ? DETAIL_KB : LISTING_KB) * 1024
			rows.push(
				`${operation.name.padEnd(24)} ${kb(size).padStart(9)}  (budget ${kb(limit)})  ${JSON.stringify(args).slice(0, 70)}`,
			)
			expect(
				size,
				`${operation.name} is ${kb(size)}, over its budget of ${kb(limit)}`,
			).toBeLessThanOrEqual(limit)
		}
	}, 600_000)

	it('the three Markdown resources fit a context too, and the galaxy with its dust is the whole sky', async () => {
		const { reads, readers } = catalogue
		const examples = ctx.run.examples
		const words = ctx.run.words
		if (examples.topicId !== null) {
			const topic = reads.get_topic.output.parse(
				await run(reads.get_topic, { topic_id: examples.topicId }, ctx),
			)
			const text = topicMarkdown(topic, words)
			rows.push(
				`${'report://topics/{id}'.padEnd(24)} ${kb(text.length).padStart(9)}  (budget ${kb(DETAIL_KB * 1024)})`,
			)
			expect(text.length).toBeLessThanOrEqual(DETAIL_KB * 1024)
		}
		if (examples.sourceId !== null) {
			const source = reads.get_source.output.parse(
				await run(reads.get_source, { source: examples.sourceId }, ctx),
			)
			const text = sourceMarkdown(source, words)
			rows.push(
				`${'report://sources/{id}'.padEnd(24)} ${kb(text.length).padStart(9)}  (budget ${kb(DETAIL_KB * 1024)})`,
			)
			expect(text.length).toBeLessThanOrEqual(DETAIL_KB * 1024)
		}
		if (examples.documentId !== null) {
			const document = reads.get_document.output.parse(
				await run(reads.get_document, { document_id: examples.documentId }, ctx),
			)
			const text = documentMarkdown(document, words)
			rows.push(
				`${'report://documents/{id}'.padEnd(24)} ${kb(text.length).padStart(9)}  (budget ${kb(DETAIL_KB * 1024)})`,
			)
			expect(text.length).toBeLessThanOrEqual(DETAIL_KB * 1024)
			// the whole text, with include_text, stays under its own cap
			const whole = reads.get_document.output.parse(
				await run(
					reads.get_document,
					{ document_id: examples.documentId, include_text: true },
					ctx,
				),
			)
			expect(whole.text.length).toBeLessThanOrEqual(40_000 + 1)
			// the text pages: the first page's passages are the document's first
			const page = reads.document_text.output.parse(
				await run(reads.document_text, { document_id: examples.documentId }, ctx),
			)
			expect(page.total).toBeGreaterThanOrEqual(page.returned)
		}
		const sky = readers.galaxy.output.parse(
			await run(readers.galaxy, { include_dust: true, all_edges: true }, ctx),
		)
		const stars = readers.galaxy.output.parse(await run(readers.galaxy, {}, ctx))
		expect(sky.nodes.length).toBeGreaterThanOrEqual(stars.nodes.length)
		expect(sky.edges.length).toBeGreaterThanOrEqual(stars.edges.length)
		expect(stars.nodes.every((n) => n.tier >= 0)).toBe(true)
		expect(stars.edges.every((e) => e.isPrimary)).toBe(true)
		rows.push(
			`${'galaxy (with dust)'.padEnd(24)} ${kb(JSON.stringify(sky).length).padStart(9)}  (no budget: a host's page read)`,
		)
		// biome-ignore lint/suspicious/noConsole: the table of sizes is this test's report
		console.log(`\n${ctx.run.words.title}\n${rows.join('\n')}\n`)
	}, 600_000)

	it('a page follows its total: the second page of topics is the rest', async () => {
		const { reads } = catalogue
		const first = reads.list_topics.output.parse(await run(reads.list_topics, { limit: 5 }, ctx))
		const second = reads.list_topics.output.parse(
			await run(reads.list_topics, { offset: 5, limit: 5 }, ctx),
		)
		expect(first.total).toBe(second.total)
		expect(first.returned).toBe(Math.min(5, first.total))
		expect(second.returned).toBe(Math.max(0, Math.min(5, first.total - 5)))
		const ids = new Set(first.topics.map((t) => t.topic_id))
		for (const t of second.topics) expect(ids.has(t.topic_id)).toBe(false)
	})

	it('a facet filter given by half is refused by the input, and an unknown topic by the read', async () => {
		const { reads } = catalogue
		expect(reads.list_sources.input.safeParse({ facet: 'sector' }).success).toBe(false)
		await expect(run(reads.get_topic, { topic_id: -1 }, ctx)).rejects.toThrow(/No topic/)
	})

	it('every operation has a distinct name and a REST path, and the instructions read', () => {
		const names = catalogue.operations.map((operation) => operation.name)
		expect(new Set(names).size).toBe(names.length)
		const paths = catalogue.operations.map(
			(operation) => `${operation.rest.method} ${operation.rest.path}`,
		)
		expect(new Set(paths).size).toBe(paths.length)
		for (const operation of catalogue.operations)
			expect(operation.rest.path.startsWith('/')).toBe(true)
		expect(reportInstructions(ctx.run)).toContain(ctx.run.words.title)
	})
})
