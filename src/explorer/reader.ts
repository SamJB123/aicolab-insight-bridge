/**
 * @aicolab/insight-bridge/explorer/reader — one request's reader over one
 * record, and what it may keep.
 *
 * A report's pages and tools read the record's invariants several times in
 * one request — the run's words, the grouping tree, the facet caches, the
 * current memberships and stances, the per-document counts — and read them
 * again on the next request. Measured on the deployed apps (2026-10-23) those
 * repeats were most of a page's time. Two memos, both opt-in by the host:
 *
 *   per request   `requestReader(db)` marks a drizzle instance as one
 *                 request's reader; a read wrapped in `perRequest` then runs
 *                 once for that instance's life. A host makes one instance per
 *                 request (an app's server function, a store door) and never
 *                 marks an instance that outlives a write, so a pipeline step
 *                 reads as it always did.
 *   per record    `requestReader(db, record)` also names the record the
 *                 reader is over — the D1 binding — and a read wrapped in
 *                 `perRecord` is kept across requests, under the record's
 *                 version (`recordVersion`: the committed build, the appends,
 *                 the documents, the newest ids), until that version changes.
 *                 An app's D1 changes only when it is re-prepared, so the
 *                 version holds for the isolate's life; a run store, whose
 *                 record changes under it, names no record and gets the
 *                 per-request memo alone.
 *
 * An unmarked instance (a test's, a pipeline step's) is never memoised.
 */
import type { CorpusDb } from '@aicolab/insight-bridge-contracts/schema'
import { sql } from 'drizzle-orm'

const readers = new WeakMap<CorpusDb, { record: object | null }>()

/** Mark `db` as one request's reader, over `record` when the host's record is immutable between deploys. */
export function requestReader<Db extends CorpusDb>(db: Db, record?: object): Db {
	readers.set(db, { record: record ?? null })
	return db
}

/**
 * A read that runs once per request's reader, per `key` of its arguments
 * (the default key memoises the read regardless of arguments: use it for
 * reads that take none, or whose arguments the key names).
 */
export function perRequest<A extends unknown[], T>(
	read: (db: CorpusDb, ...args: A) => Promise<T>,
	key: (...args: A) => string = () => '',
): (db: CorpusDb, ...args: A) => Promise<T> {
	const memo = new WeakMap<CorpusDb, Map<string, Promise<T>>>()
	return (db, ...args) => {
		if (!readers.has(db)) return read(db, ...args)
		let held = memo.get(db)
		if (!held) {
			held = new Map()
			memo.set(db, held)
		}
		const k = key(...args)
		const found = held.get(k)
		if (found) return found
		const value = read(db, ...args)
		held.set(k, value)
		return value
	}
}

/**
 * What a record's version is made of: the run's row (its name and stamp), the
 * committed build, the committed appends, the documents and the newest ids of
 * the evidence tables. One statement of indexed lookups; read once per request.
 */
export const recordVersion = perRequest(async (db: CorpusDb): Promise<string> => {
	const [v] = await db.all<{
		name: string | null
		updated: number | null
		build: number | null
		appends: number
		documents: number
		points: number | null
		quotes: number | null
		chunks: number | null
	}>(sql`
		SELECT (SELECT name FROM run_meta WHERE singleton = 1) AS name,
			(SELECT updated_at FROM run_meta WHERE singleton = 1) AS updated,
			(SELECT build_id FROM run_current_build WHERE singleton = 1) AS build,
			(SELECT COUNT(*) FROM append WHERE committed_at IS NOT NULL) AS appends,
			(SELECT COUNT(*) FROM document) AS documents,
			(SELECT MAX(key_point_id) FROM key_point) AS points,
			(SELECT MAX(key_quote_id) FROM key_quote) AS quotes,
			(SELECT MAX(rowid) FROM chunk) AS chunks`)
	return [v?.name, v?.updated, v?.build, v?.appends, v?.documents, v?.points, v?.quotes, v?.chunks]
		.map((part) => String(part ?? ''))
		.join('|')
})

/**
 * A read kept across requests for a named record while its version holds;
 * for a reader over no named record, once per request. A read that fails
 * is not kept.
 */
export function perRecord<A extends unknown[], T>(
	read: (db: CorpusDb, ...args: A) => Promise<T>,
	key: (...args: A) => string = () => '',
): (db: CorpusDb, ...args: A) => Promise<T> {
	const kept = new WeakMap<object, Map<string, { version: string; value: Promise<T> }>>()
	const once = perRequest(read, key)
	return async (db, ...args) => {
		const record = readers.get(db)?.record
		if (!record) return once(db, ...args)
		const version = await recordVersion(db)
		let held = kept.get(record)
		if (!held) {
			held = new Map()
			kept.set(record, held)
		}
		const k = key(...args)
		const found = held.get(k)
		if (found && found.version === version) return found.value
		const value = read(db, ...args)
		held.set(k, { version, value })
		value.catch(() => {
			if (held.get(k)?.value === value) held.delete(k)
		})
		return value
	}
}
