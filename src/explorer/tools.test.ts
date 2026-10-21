/// <reference types="node" />
/**
 * Core's MCP tool table over a real run database (as data.test.ts, skipped
 * without one):
 *
 *   EXPLORER_DB=/path/to/run.sqlite pnpm vitest run src/explorer
 *
 * Every tool the run serves answers its own examples without an error; dissent
 * sorts first; a withheld source's words read the notice in the tools too.
 */
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as x from './data.ts'
import { EXPLORER_TOOLS, runExplorerTool, type ToolContext, toolContext } from './tools.ts'

const file = process.env.EXPLORER_DB

describe.skipIf(!file || !existsSync(file))('the explorer tool table', () => {
	const sqlite = new DatabaseSync(file ?? ':memory:', { readOnly: true })
	const db = drizzle({ client: sqlite })
	let context: ToolContext
	beforeAll(async () => {
		context = await toolContext(db)
	})

	/** A tool's arguments: its examples, then a real value for any required input the examples leave out. */
	const argsFor = async (name: string): Promise<Record<string, unknown>> => {
		const t = EXPLORER_TOOLS[name]
		const args: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(t?.examples?.(context) ?? {}))
			if (value !== undefined && value !== null) args[key] = value
		if (name === 'find_documents' && !args.query) args.query = 'the'
		if (['get_concept', 'entities_for_concept', 'documents_for_concept'].includes(name)) {
			const [vocabulary] = await x.vocabularySummary(db)
			args.facet = vocabulary?.category
			args.concept = vocabulary?.tags[0]?.path
		}
		return args
	}

	it('every tool the run serves answers its examples', async () => {
		const served = Object.entries(EXPLORER_TOOLS).filter(([, t]) => !t.when || t.when(context))
		expect(served.length).toBeGreaterThan(15)
		for (const [name] of served) {
			const result = await runExplorerTool(db, name, await argsFor(name))
			const failed = z.object({ error: z.string() }).safeParse(result)
			expect(failed.success ? `${name}: ${failed.data.error}` : name).toBe(name)
		}
	}, 120_000)

	it('a search ranks the passages a host’s index returns, best first, with their topics', async () => {
		const ids = sqlite.prepare('SELECT id FROM published_chunk ORDER BY id LIMIT 5').all()
		const nearest: [string, number][] = ids.map((r, i) => [String(r.id), 0.9 - i / 10])
		const hits = z
			.array(z.object({ passage_id: z.string(), score: z.number() }))
			.parse(await runExplorerTool(db, 'search_passages', { query: 'any', top_k: 5 }, { nearest }))
		expect(hits.map((h) => h.passage_id)).toEqual(nearest.map(([id]) => id))
		const topics = z
			.array(z.object({ topic_id: z.number(), relevance: z.number() }))
			.parse(await runExplorerTool(db, 'find_topics', { query: 'any' }, { nearest }))
		for (const t of topics) expect(t.relevance).toBeGreaterThan(0)
	})

	it('a facet filter keeps every source holding the value, and passages only of those sources', async () => {
		const lens = context.words.lens
		if (!lens) return
		const sources = z.array(z.object({ source_id: z.string(), lensValue: z.string().nullable() }))
		const all = sources.parse(await runExplorerTool(db, 'list_sources', { limit: 200 }))
		const value = all.find((s) => s.lensValue)?.lensValue
		if (!value) return
		const byLens = sources.parse(
			await runExplorerTool(db, 'list_sources', { lens_value: value, limit: 200 }),
		)
		const byFacet = sources.parse(
			await runExplorerTool(db, 'list_sources', { facet: lens, value, limit: 200 }),
		)
		// the lens filter reads a source's first lens value; the facet filter keeps a
		// source holding the value among several, so it keeps at least as many
		const kept = new Set(byFacet.map((s) => s.source_id))
		for (const s of byLens) expect(kept.has(s.source_id)).toBe(true)
		const ids = sqlite.prepare('SELECT id FROM published_chunk ORDER BY id LIMIT 150').all()
		const nearest: [string, number][] = ids.map((r, i) => [String(r.id), 1 - i / 1000])
		const passages = z
			.array(z.object({ source_id: z.string().nullable() }))
			.parse(
				await runExplorerTool(
					db,
					'search_passages',
					{ query: 'any', top_k: 50, facet: lens, value },
					{ nearest },
				),
			)
		for (const p of passages) expect(kept.has(p.source_id ?? '')).toBe(true)
		// one without the other is refused
		expect(
			z
				.object({ error: z.string() })
				.safeParse(await runExplorerTool(db, 'list_sources', { facet: lens })).success,
		).toBe(true)
	})

	it('a facet the profile derives is listed and pivots like any other', async () => {
		const [meta] = sqlite.prepare('SELECT profile FROM run_meta WHERE singleton = 1').all()
		const profile = z
			.object({ facets: z.array(z.object({ name: z.string(), derive: z.unknown().optional() })) })
			.safeParse(JSON.parse(String(meta?.profile ?? '{}')))
		const derived = profile.success
			? profile.data.facets.filter((f) => f.derive).map((f) => f.name)
			: []
		if (!derived.length) return
		for (const name of derived) {
			const listed = z
				.object({ facet: z.string(), tags: z.array(z.object({ tag: z.string() })) })
				.parse(await runExplorerTool(db, 'list_tags', { category: name }))
			expect(listed.facet).toBe(name)
			expect(listed.tags.length).toBeGreaterThan(0)
			const pivot = await runExplorerTool(db, 'tag_pivot', { category: name })
			expect(z.object({ error: z.string() }).safeParse(pivot).success).toBe(false)
		}
	})

	it('dissent sorts first: the contesting positions lead a topic’s stances', async () => {
		const scale = context.words.scale
		if (!scale.contesting.length || context.examples.topicId === null) return
		const read = z.object({ perspectives: z.array(z.object({ position: z.string() })) }).parse(
			await runExplorerTool(db, 'source_perspectives', {
				topic_id: context.examples.topicId,
				limit: 120,
			}),
		)
		const contesting = read.perspectives.map((p) => scale.contesting.includes(p.position))
		// once a non-contesting stance appears, no contesting one follows it
		const firstOther = contesting.indexOf(false)
		if (firstOther >= 0) expect(contesting.slice(firstOther).includes(true)).toBe(false)
	})

	it('a withheld source’s words read the notice in the tools', async () => {
		// the narrowest topic with a written stance, so every stance on it comes back
		const [narrow] = (await x.topics(db))
			.map((t) => ({ t, stances: Object.values(t.positions).reduce((a, n) => a + n, 0) }))
			.filter((t) => t.stances > 0)
			.sort((t1, t2) => t1.stances - t2.stances)
		if (!narrow) return
		const topicId = narrow.t.topicClusterId
		const held = (await x.topicById(db, topicId))?.entityPerspectives[0]
		if (!held) return
		const notice = 'Withheld for this test.'
		const read = z
			.object({
				perspectives: z.array(
					z.object({
						source_id: z.string(),
						framing: z.string(),
						withheld: z.boolean().optional(),
					}),
				),
			})
			.parse(
				await runExplorerTool(
					db,
					'source_perspectives',
					{ topic_id: topicId, limit: 120 },
					{ scope: { withhold: { entities: new Set([held.entityUuid]), notice } } },
				),
			)
		const mine = read.perspectives.find((p) => p.source_id === held.entityId)
		expect(mine?.framing).toBe(notice)
		expect(mine?.withheld).toBe(true)
	})
})
