// A report island's WORLD READS kept in the browser (settled 2026-10-28):
// the island record, each room's text and each item's reading, in IndexedDB
// under the report and the version of the record its door says it is
// (`worldVersion`), so a reload or a revisit reads its own copy while the
// record is the same. Only the latest version is kept: a read stored under a
// version deletes the report's entries under any other. Where the browser
// keeps nothing (no IndexedDB, a private window that refuses it, a Worker),
// or the door says no version, every read goes to the door as before.
//
// What is kept is what the door answered, as it answered it; each reader
// parses it as it parses the door's answer.

const DATABASE = 'insight-bridge-world'
const STORE = 'reads'
/** The index of the store's entries by the report they are of. */
const BY_REPORT = 'report'

interface Entry {
	id: string
	report: string
	version: string
	value: unknown
}

const isEntry = (value: unknown): value is Entry =>
	typeof value === 'object' &&
	value !== null &&
	'id' in value &&
	'report' in value &&
	'version' in value &&
	typeof value.version === 'string' &&
	'value' in value

let opened: Promise<IDBDatabase | null> | null = null

/** The database, opened once for the page; null where the browser keeps none. */
function database(): Promise<IDBDatabase | null> {
	opened ??= new Promise((resolve) => {
		if (typeof indexedDB === 'undefined') {
			resolve(null)
			return
		}
		try {
			const request = indexedDB.open(DATABASE, 1)
			request.onupgradeneeded = () => {
				request.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex(BY_REPORT, 'report')
			}
			request.onsuccess = () => resolve(request.result)
			request.onerror = () => resolve(null)
			request.onblocked = () => resolve(null)
		} catch {
			resolve(null)
		}
	})
	return opened
}

/** The entry stored under `id`, if there is one. */
function entryOf(db: IDBDatabase, id: string): Promise<Entry | undefined> {
	return new Promise((resolve) => {
		const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
		request.onsuccess = () => {
			const found: unknown = request.result
			resolve(isEntry(found) ? found : undefined)
		}
		request.onerror = () => resolve(undefined)
	})
}

/** The reports whose entries under other versions this page has let go, by the version kept. */
const prunedFor = new Map<string, string>()

/** Store an entry, and — the first time this page stores under its version — let go of the
 *  report's entries under any other. */
function store(db: IDBDatabase, entry: Entry): Promise<void> {
	return new Promise((resolve) => {
		const tx = db.transaction(STORE, 'readwrite')
		const reads = tx.objectStore(STORE)
		reads.put(entry)
		tx.oncomplete = () => resolve()
		tx.onerror = () => resolve()
		tx.onabort = () => resolve()
		if (prunedFor.get(entry.report) === entry.version) return
		prunedFor.set(entry.report, entry.version)
		const cursor = reads.index(BY_REPORT).openCursor(IDBKeyRange.only(entry.report))
		cursor.onsuccess = () => {
			const at = cursor.result
			if (!at) return
			const kept: unknown = at.value
			if (isEntry(kept) && kept.version !== entry.version) at.delete()
			at.continue()
		}
	})
}

/**
 * One of a report island's reads: the browser's copy when it holds one under this version,
 * else asked of the door (`ask`) and kept. Keeping never fails the read: a copy that cannot
 * be stored is simply not kept.
 */
export async function keptRead(
	report: string,
	version: string | null,
	read: string,
	key: string,
	ask: () => Promise<unknown>,
): Promise<unknown> {
	if (version === null) return ask()
	const db = await database()
	if (!db) return ask()
	const id = JSON.stringify([report, read, key])
	const found = await entryOf(db, id).catch(() => undefined)
	if (found && found.version === version) return found.value
	const value = await ask()
	try {
		await store(db, { id, report, version, value })
	} catch {
		// Not storable (the browser's own limits): asked again next time.
	}
	return value
}
