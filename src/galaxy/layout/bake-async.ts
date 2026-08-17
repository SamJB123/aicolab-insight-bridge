/**
 * Off-main-thread layout bake with a persistent cache.
 *
 * The bake is deterministic (seeded simulation over static corpus data), so
 * its result is cacheable exactly: first visit runs the simulation in a
 * Worker (page stays responsive), repeat visits read the coordinates from
 * IndexedDB and skip the simulation entirely. The cache key hashes the full
 * galaxy payload + bake options + LAYOUT_CACHE_VERSION — bump the version
 * whenever cosmos.ts changes the algorithm, or stale layouts persist.
 *
 * Falls back to the synchronous inline bake when Workers or IndexedDB are
 * unavailable (SSR guards live in the caller — the engine only runs with a
 * canvas in hand).
 */
import type { IBGalaxy } from '../types.ts'
import type { BakeRequest, BakeResponse } from './bake-worker.ts'
import { bakeGalaxyLayout, type CosmosBakeOptions, type GalaxyLayout } from './cosmos.ts'

/** Bump when bakeGalaxyLayout's algorithm or defaults change. */
const LAYOUT_CACHE_VERSION = 1
const DB_NAME = 'ib-galaxy-layout'
const STORE = 'layouts'
/** Lazy prune keeps the store from growing without bound across corpora. */
const MAX_ENTRIES = 12

interface CachedLayout {
	positions: Float32Array
	radii: Float32Array
	nicheThreshold: number
	storedAt: number
}

function isCachedLayout(value: unknown): value is CachedLayout {
	return (
		typeof value === 'object' &&
		value !== null &&
		'positions' in value &&
		value.positions instanceof Float32Array &&
		'radii' in value &&
		value.radii instanceof Float32Array &&
		'nicheThreshold' in value &&
		typeof value.nicheThreshold === 'number' &&
		'storedAt' in value &&
		typeof value.storedAt === 'number'
	)
}

function storedAtOf(value: unknown): number {
	return typeof value === 'object' &&
		value !== null &&
		'storedAt' in value &&
		typeof value.storedAt === 'number'
		? value.storedAt
		: 0
}

/** FNV-1a over the deterministic JSON of every bake input. */
function bakeKey(galaxy: IBGalaxy, options: CosmosBakeOptions): string {
	const text = JSON.stringify({ v: LAYOUT_CACHE_VERSION, options, galaxy })
	let hash = 0x811c9dc5
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i)
		hash = Math.imul(hash, 0x01000193)
	}
	return `${(hash >>> 0).toString(36)}:${text.length.toString(36)}`
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1)
		request.onupgradeneeded = () => request.result.createObjectStore(STORE)
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'))
	})
}

async function readCache(key: string): Promise<CachedLayout | undefined> {
	const db = await openDb()
	try {
		return await new Promise((resolve, reject) => {
			const request = db.transaction(STORE).objectStore(STORE).get(key)
			request.onsuccess = () => {
				const value: unknown = request.result
				resolve(isCachedLayout(value) ? value : undefined)
			}
			request.onerror = () => reject(request.error ?? new Error('indexedDB read failed'))
		})
	} finally {
		db.close()
	}
}

async function writeCache(key: string, value: CachedLayout): Promise<void> {
	const db = await openDb()
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite')
			const store = tx.objectStore(STORE)
			store.put(value, key)
			// Prune oldest entries beyond the cap, in the same transaction.
			const keysRequest = store.getAllKeys()
			keysRequest.onsuccess = () => {
				const keys = keysRequest.result
				if (keys.length <= MAX_ENTRIES) return
				const withAge: Array<{ key: IDBValidKey; storedAt: number }> = []
				const all = store.getAll()
				all.onsuccess = () => {
					all.result.forEach((entry: unknown, i) => {
						const k = keys[i]
						if (k !== undefined) withAge.push({ key: k, storedAt: storedAtOf(entry) })
					})
					withAge
						.sort((a, b) => a.storedAt - b.storedAt)
						.slice(0, withAge.length - MAX_ENTRIES)
						.forEach((entry) => store.delete(entry.key))
				}
			}
			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(tx.error ?? new Error('indexedDB write failed'))
		})
	} finally {
		db.close()
	}
}

function bakeInWorker(galaxy: IBGalaxy, options: CosmosBakeOptions): Promise<BakeResponse> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./bake-worker.ts', import.meta.url), { type: 'module' })
		worker.onmessage = (event: MessageEvent<BakeResponse>) => {
			worker.terminate()
			resolve(event.data)
		}
		worker.onerror = (event) => {
			worker.terminate()
			reject(new Error(`layout worker failed: ${event.message}`))
		}
		const request: BakeRequest = { galaxy, options }
		worker.postMessage(request)
	})
}

function toLayout(galaxy: IBGalaxy, baked: BakeResponse): GalaxyLayout {
	const index = new Map(galaxy.nodes.map((node, i) => [node.id, i]))
	return {
		positions: baked.positions,
		radii: baked.radii,
		index,
		nicheThreshold: baked.nicheThreshold,
	}
}

/**
 * Cache-first, worker-second, inline-last. Any cache/worker failure falls
 * through to the next path silently — the inline bake is always correct,
 * just blocking.
 */
export async function bakeGalaxyLayoutAsync(
	galaxy: IBGalaxy,
	options: CosmosBakeOptions = {},
): Promise<GalaxyLayout> {
	const hasWorker = typeof Worker !== 'undefined'
	const hasIdb = typeof indexedDB !== 'undefined'
	const key = hasIdb ? bakeKey(galaxy, options) : ''

	if (hasIdb) {
		try {
			const cached = await readCache(key)
			if (cached) return toLayout(galaxy, cached)
		} catch {
			// Unreadable cache (private browsing, quota) — just bake.
		}
	}

	let baked: BakeResponse
	if (hasWorker) {
		try {
			baked = await bakeInWorker(galaxy, options)
		} catch {
			baked = bakeGalaxyLayout(galaxy, options)
		}
	} else {
		baked = bakeGalaxyLayout(galaxy, options)
	}

	if (hasIdb) {
		void writeCache(key, {
			positions: baked.positions,
			radii: baked.radii,
			nicheThreshold: baked.nicheThreshold,
			storedAt: Date.now(),
		}).catch(() => {})
	}
	return toLayout(galaxy, baked)
}
