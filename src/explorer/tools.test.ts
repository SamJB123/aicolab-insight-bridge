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
