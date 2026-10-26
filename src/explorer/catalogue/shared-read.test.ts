/// <reference types="node" />
/**
 * The reads kept in the data centre's cache (../reader's `shared`) come back
 * from it exactly as they were read: an entry is stored as JSON and parsed
 * with the read's schema, which drops any field the schema does not name. So
 * a fresh read, sent through JSON and the schema, must equal itself. Over a
 * real run database, skipped without one:
 *
 *   EXPLORER_DB=/path/to/run.sqlite pnpm vitest run src/explorer/catalogue/shared-read
 */
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { embeddingModelSchema } from '@aicolab/insight-bridge-contracts/models'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { describe, expect, it } from 'vitest'
import { runEmbeddingModel } from '../embed.ts'
import { toolContext, toolContextSchema } from './support.ts'

const file = process.env.EXPLORER_DB

/** What the cache hands back: the value as JSON, parsed again. */
const throughCache = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe.skipIf(!file || !existsSync(file))('reads kept in the data centre’s cache', () => {
	const db = drizzle({ client: new DatabaseSync(file ?? ':memory:', { readOnly: true }) })

	it('the run’s facts come back from the cache as they were read', async () => {
		const read = await toolContext(db)
		expect(toolContextSchema.parse(throughCache(read))).toStrictEqual(read)
	})

	it('the embedding model comes back from the cache as it was read', async () => {
		const read = await runEmbeddingModel(db)
		expect(embeddingModelSchema.parse(throughCache(read))).toBe(read)
	})
})
