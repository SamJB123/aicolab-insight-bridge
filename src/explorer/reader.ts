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
 *                 reader is over — the D1 binding, and the record's name in
 *                 the data centre's cache — and a read wrapped in
 *                 `perRecord` is kept across requests, under the record's
 *                 version (`recordVersion`: the committed build, the appends,
 *                 the documents, the newest ids), until that version changes.
 *                 An app's D1 changes only when it is re-prepared, so the
 *                 version holds for the isolate's life; a run store, whose
 *                 record changes under it, names no record and gets the
 *                 per-request memo alone.
 *   shared        a `perRecord` read given a name and a schema is also kept
 *                 in the data centre's cache (the Workers Cache API), under
 *                 the record's version. An isolate is short-lived and a
 *                 service binding runs its callee on the caller's server, so
 *                 the isolate memo is mostly empty when a door opens; every
 *                 server in a data centre shares its cache. An entry read
 *                 back is checked against the schema, and one that fails is
 *                 read again. Entries expire after an hour, which also bounds
 *                 how long a deploy that changes what a read computes, over
 *                 an unchanged record, can be answered from before it.
 *   the version   is kept in that cache too, under the record's name, so an
 *                 open asks D1 nothing before its reads. Each request reads it
 *                 from D1 as well, without waiting, and stores what it finds;
 *                 so after a re-prepare the first request in a data centre
 *                 reads the record as it was, and the ones after see the new
 *                 version (the user's choice, 2026-10-27, over a 30-second
 *                 expiry or a D1 read on every open: the read is 0.3 ms inside
 *                 D1, 16–34 ms from the worker, and queues behind any heavy
 *                 read on the same database, measured up to 1.3 s).
 *
 * An unmarked instance (a test's, a pipeline step's) is never memoised.
 */
import type { CorpusDb } from '@aicolab/insight-bridge-contracts/schema'
import { sql } from 'drizzle-orm'
import type { z } from 'zod'

/** The record a reader is over: its binding, kept by identity per isolate, and its name in the data centre's cache. */
export interface NamedRecord {
	binding: object
	name: string
}

const readers = new WeakMap<CorpusDb, { record: NamedRecord | null }>()

/** Mark `db` as one request's reader, over `record` when the host's record is immutable between deploys. */
export function requestReader<Db extends CorpusDb>(db: Db, record?: NamedRecord): Db {
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
 * The record's version, once per request: from the data centre's cache for a
 * reader over a named record, with D1 read alongside and its answer stored
 * for the next request; else from D1.
 */
export const recordVersion = perRequest(async (db: CorpusDb): Promise<string> => {
	const record = readers.get(db)?.record
	if (!record || typeof caches === 'undefined') return readVersion(db)
	const cache = await caches.open(SHARED_CACHE).catch(() => null)
	if (!cache) return readVersion(db)
	const entry = `https://${SHARED_CACHE}.local/version/${encodeURIComponent(record.name)}`
	const fresh = readVersion(db).then(async (version) => {
		await cache
			.put(
				entry,
				new Response(version, {
					headers: { 'content-type': 'text/plain', 'cache-control': `max-age=${SHARED_SECONDS}` },
				}),
			)
			.catch(() => undefined)
		return version
	})
	const hit = await cache.match(entry).catch(() => undefined)
	const kept = hit ? await hit.text().catch(() => '') : ''
	if (!kept) return fresh
	// The cached version answers; D1's, read alongside, refreshes the entry.
	fresh.catch(() => undefined)
	return kept
})

/**
 * What a record's version is made of: the run's row (its name and stamp), the
 * committed build, the committed appends, the documents and the newest ids of
 * the evidence tables. One statement of indexed lookups.
 */
async function readVersion(db: CorpusDb): Promise<string> {
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
}

/** How a per-record read is also kept in the data centre's cache. */
export interface SharedRead<T> {
	/** The read's own name in the cache key, one per read. */
	name: string
	/** What an entry read back must parse as. */
	schema: z.ZodType<T>
}

const SHARED_CACHE = 'insight-bridge-record'
const SHARED_SECONDS = 3600

/**
 * The read from the data centre's cache when an entry for this version is
 * there and parses, else read and stored. The cache failing never fails the
 * read. Outside a Worker (no Cache API) it is the read.
 */
async function sharedRead<T>(
	shared: SharedRead<T>,
	version: string,
	key: string,
	read: () => Promise<T>,
): Promise<T> {
	if (typeof caches === 'undefined') return read()
	const entry = `https://${SHARED_CACHE}.local/${[shared.name, version, key].map(encodeURIComponent).join('/')}`
	const cache = await caches.open(SHARED_CACHE).catch(() => null)
	if (!cache) return read()
	const hit = await cache.match(entry).catch(() => undefined)
	if (hit) {
		const parsed = shared.schema.safeParse(await hit.json().catch(() => undefined))
		if (parsed.success) return parsed.data
	}
	const value = await read()
	await cache
		.put(
			entry,
			new Response(JSON.stringify(value), {
				headers: {
					'content-type': 'application/json',
					'cache-control': `max-age=${SHARED_SECONDS}`,
				},
			}),
		)
		.catch(() => undefined)
	return value
}

/**
 * A read kept across requests for a named record while its version holds;
 * for a reader over no named record, once per request. Given `shared`, also
 * kept in the data centre's cache under the version. A read that fails is
 * not kept.
 */
export function perRecord<A extends unknown[], T>(
	read: (db: CorpusDb, ...args: A) => Promise<T>,
	key: (...args: A) => string = () => '',
	shared?: SharedRead<T>,
): (db: CorpusDb, ...args: A) => Promise<T> {
	const kept = new WeakMap<object, Map<string, { version: string; value: Promise<T> }>>()
	const once = perRequest(read, key)
	return async (db, ...args) => {
		const record = readers.get(db)?.record
		if (!record) return once(db, ...args)
		const version = await recordVersion(db)
		let held = kept.get(record.binding)
		if (!held) {
			held = new Map()
			kept.set(record.binding, held)
		}
		const k = key(...args)
		const found = held.get(k)
		if (found && found.version === version) return found.value
		const value = shared
			? sharedRead(shared, version, k, () => read(db, ...args))
			: read(db, ...args)
		held.set(k, { version, value })
		value.catch(() => {
			if (held.get(k)?.value === value) held.delete(k)
		})
		return value
	}
}
