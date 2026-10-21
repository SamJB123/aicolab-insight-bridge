/// <reference types="node" />
/**
 * Bulk seed of a report's D1 from its PREPARED sqlite (`prepareRun`, then the
 * star bake) — every report loads through here; an app supplies its own tables.
 *
 * THE TABLE LIST IS THE SCHEMA. Every table and every column comes from the
 * drizzle schema (the canonical run tables in their dependency order, then
 * the two derived tables every report carries, then the app's own), walked
 * with drizzle's own table helpers — nothing is listed by hand, so a schema
 * change is a load change. Tables load parents-first and clear
 * children-first, which is what lets D1 keep foreign keys on.
 *
 * Rows are written as literal INSERT statements (named columns, so the dump
 * never depends on D1's physical column order) in shard files that `wrangler
 * d1 execute --file` loads. D1 caps one statement at 100 KB, and a run's own
 * row is bigger than that (`run_meta.records` carries every manifest record):
 * a value longer than the cap is inserted empty and then grown in pieces with
 * `UPDATE … SET col = col || '…'`, keyed by the table's primary key — so any
 * row of any size loads through the same door.
 *
 *   … --remote          load the cloud D1 (else the app's local state)
 *   … --only=a,b        reload a subset (after a re-bake, say)
 *   … --skip-generate   reuse the dump files already written
 *   … --generate-only   write the dump files, load nothing
 */
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, statSync, writeSync } from 'node:fs'
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import { RUN_STORE_TABLE_OBJECTS } from '@aicolab/insight-bridge-contracts/schema'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import { chunkPrimaryTopic, docDominantTopic } from './tables.ts'

export interface SeedOptions {
	/** The prepared sqlite. */
	prepared: string
	/** The D1 database's name. */
	database: string
	/** The app's own tables, after the canon and the derived tables (they reference both). */
	extensions?: readonly SQLiteTable[]
	/** Where the dump files are written. */
	dumpDir: string
	/** The app's local wrangler state (`--persist-to`), for a local load. */
	localState: string
	/** The app's wrangler binary. */
	wrangler: string
	/** The command line: --remote, --only=…, --skip-generate, --generate-only. */
	argv: readonly string[]
}

/** Rows per dump file — a shard stays well inside D1's per-batch limits. */
const SHARD = 4000
/** D1's statement cap is 100 KB; a literal longer than this is grown in pieces. */
const PIECE = 60_000

type Table = { name: string; cols: string[]; pk: string[] }

const describe = (t: SQLiteTable): Table => {
	const cfg = getTableConfig(t)
	const columns = Object.values(getTableColumns(t))
	const pkFromTable = cfg.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name))
	const pk = pkFromTable.length ? pkFromTable : columns.filter((c) => c.primary).map((c) => c.name)
	if (!pk.length)
		throw new Error(
			`${getTableName(t)} has no primary key; the loader keys its oversized rows by it`,
		)
	return { name: getTableName(t), cols: columns.map((c) => c.name), pk }
}

/** A SQL literal D1 accepts: '' escaping for text, bare numbers, NULL, X'…' for blobs. A text
 *  holding a NUL (a few extracted passages do) is written as its exact UTF-8 bytes cast back to
 *  text: a raw NUL in the dump file ends the statement where wrangler reads it. */
const literal = (v: SQLOutputValue | undefined): string => {
	if (v === null || v === undefined) return 'NULL'
	if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
	if (typeof v === 'bigint') return v.toString()
	if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`
	if (v.includes('\u0000')) return `CAST(X'${Buffer.from(v, 'utf8').toString('hex')}' AS TEXT)`
	return `'${v.replace(/'/g, "''")}'`
}

/** Cut a string into pieces small enough for one statement each, never splitting a surrogate pair. */
function pieces(s: string): string[] {
	const out: string[] = []
	let i = 0
	while (i < s.length) {
		let end = Math.min(s.length, i + PIECE)
		const code = s.charCodeAt(end - 1)
		if (end < s.length && code >= 0xd800 && code <= 0xdbff) end -= 1
		out.push(s.slice(i, end))
		i = end
	}
	return out
}

/** The statements that write one row: one INSERT, then any oversized text value grown in pieces. */
function rowStatements(t: Table, row: Record<string, SQLOutputValue>): string[] {
	const big = new Map<string, string>()
	const values = t.cols.map((c) => {
		const v = row[c]
		if (typeof v === 'string' && v.length > PIECE) {
			big.set(c, v)
			return "''"
		}
		return literal(v)
	})
	const out = [`INSERT INTO ${t.name} (${t.cols.join(', ')}) VALUES(${values.join(',')});`]
	if (big.size) {
		const where = t.pk.map((c) => `${c} = ${literal(row[c])}`).join(' AND ')
		for (const [col, text] of big)
			for (const piece of pieces(text))
				out.push(`UPDATE ${t.name} SET ${col} = ${col} || ${literal(piece)} WHERE ${where};`)
	}
	return out
}

/** Every row of a table as dump files of at most SHARD rows, ordered by rowid so pages never overlap or skip. */
function dumpTable(db: DatabaseSync, t: Table, dumpDir: string): string[] {
	const files: string[] = []
	let shard = 0
	let inShard = 0
	let fd: number | null = null
	const open = () => {
		const f = `${dumpDir}/${t.name}.${String(shard).padStart(3, '0')}.sql`
		fd = openSync(f, 'w')
		files.push(f)
	}
	open()
	for (const row of db
		.prepare(`SELECT ${t.cols.join(', ')} FROM ${t.name} ORDER BY rowid`)
		.iterate()) {
		if (inShard >= SHARD) {
			if (fd !== null) closeSync(fd)
			shard += 1
			inShard = 0
			open()
		}
		if (fd !== null) writeSync(fd, `${rowStatements(t, row).join('\n')}\n`)
		inShard += 1
	}
	if (fd !== null) closeSync(fd)
	return files
}

export function seedD1(options: SeedOptions): void {
	const { prepared, database, dumpDir, argv } = options
	const remote = argv.includes('--remote')
	const skipGen = argv.includes('--skip-generate')
	const genOnly = argv.includes('--generate-only')
	const only = argv
		.find((a) => a.startsWith('--only='))
		?.slice('--only='.length)
		.split(',')
	const target = remote ? ['--remote'] : ['--local', '--persist-to', options.localState]
	const sh = (args: string[]) =>
		execFileSync(options.wrangler, args, { stdio: 'inherit', maxBuffer: 1 << 30 })

	/** Parents before children: the canon in its declared dependency order, the derived tables, then the app's own. */
	const tables: Table[] = [
		...RUN_STORE_TABLE_OBJECTS,
		docDominantTopic,
		chunkPrimaryTopic,
		...(options.extensions ?? []),
	].map(describe)

	if (!existsSync(prepared))
		throw new Error(`prepared sqlite not found: ${prepared} — run pnpm db:prepare first`)
	mkdirSync(dumpDir, { recursive: true })
	const chosen = tables.filter((t) => !only || only.includes(t.name))
	if (only)
		for (const name of only)
			if (!tables.some((t) => t.name === name))
				throw new Error(`--only names ${name}, which is not a table of the schema`)
	console.info(
		`\n▶ seeding D1 '${database}' (${target.join(' ')}) from ${prepared}: ${chosen.length} tables\n`,
	)
	const db = new DatabaseSync(prepared, { readOnly: true })

	// Clear children first, so no foreign key refuses a delete …
	if (!genOnly)
		for (const t of [...chosen].reverse())
			sh(['d1', 'execute', database, ...target, '--yes', '--command', `DELETE FROM ${t.name};`])

	// … then load parents first.
	for (const t of chosen) {
		let files: string[]
		if (!skipGen) {
			process.stdout.write(`  · ${t.name} … `)
			files = dumpTable(db, t, dumpDir)
			const bytes = files.reduce((a, f) => a + statSync(f).size, 0)
			console.info(
				`${files.length} file${files.length === 1 ? '' : 's'}, ${(bytes / 1e6).toFixed(1)} MB`,
			)
		} else {
			files = []
			for (let i = 0; ; i++) {
				const f = `${dumpDir}/${t.name}.${String(i).padStart(3, '0')}.sql`
				if (existsSync(f)) files.push(f)
				else break
			}
			if (!files.length)
				throw new Error(
					`--skip-generate: no dump files for ${t.name} — run without --skip-generate first`,
				)
		}
		for (const f of files) {
			if (statSync(f).size === 0) continue
			console.info(`    ↑ load ${f.split('/').pop()}`)
			if (!genOnly) sh(['d1', 'execute', database, ...target, '--yes', '--file', f])
		}
	}
	db.close()
	console.info('\n✅ D1 seed complete\n')
}
