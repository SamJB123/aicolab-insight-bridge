/// <reference types="node" />
/**
 * Prepare a run database for loading into a report's D1 — the one place
 * anything is added to the run before it reaches D1, so the web app, the MCP
 * server and the vector loader inherit the same facts from a single source.
 * Every report prepares through here; an app supplies its site's words and its
 * own layers (`extend`).
 *
 * THE RUN IS COPIED VERBATIM. The run database is copied whole — every
 * canonical table, every row, as the pipeline wrote it. Nothing is flattened,
 * filtered or re-derived: facets stay in `facet_assignment` with their
 * provenance, topics keep their junk verdicts and build scoping, quotes keep
 * the pipeline's own verification (the tolerant rule, re-checked in the run
 * itself with `step1_modular.reverify`; no app runs a check of its own).
 *
 * A v7 run from before the migrator is adopted by the Python pipeline first
 * (`db.sqlite_exporter` opens it and records its migration journal, then
 * `python -m db.run_meta <sqlite>` backfills its own row); a run that has not
 * been is refused.
 *
 * What the prepared copy CHANGES, and nothing else:
 *
 *   • chunk.embedding — blanked to `[]`. The vectors go to the report's vector
 *     index; D1 carries the text.
 *   • the tables beside the canon — the two derived tables every report
 *     carries (doc_dominant_topic, chunk_primary_topic: ./tables.ts) and the
 *     app's own — created by the app's own migrations, so the copy has
 *     exactly the D1's tables; the derived tables filled here.
 *   • run_meta.site — the site's words, a typed RunSite
 *     (@aicolab/insight-bridge-contracts/site).
 *   • whatever the app's `extend` adds: its own layers, keyed to canonical rows.
 *   • sqlite_stat1 — the query planner's statistics (ANALYZE). The D1 loader
 *     has D1 make its own (`PRAGMA optimize`, ./load.ts).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import * as canonical from '@aicolab/insight-bridge-contracts/schema'
import { RUN_SCHEMA_VERSION } from '@aicolab/insight-bridge-contracts/schema'
import type { RunSite } from '@aicolab/insight-bridge-contracts/site'
import { getTableName, is } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { migrate } from 'drizzle-orm/node-sqlite/migrator'
import { getViewConfig, SQLiteTable, SQLiteView } from 'drizzle-orm/sqlite-core'
import { chunkPrimaryTopic, docDominantTopic } from './tables.ts'

/** The canonical schema's migrations, as the contracts package ships them. */
const MIGRATIONS = resolve(
	dirname(createRequire(import.meta.url).resolve('@aicolab/insight-bridge-contracts/package.json')),
	'drizzle',
)

export type Row = Record<string, SQLOutputValue>
/** Every row a statement returns. */
export const rows = (db: DatabaseSync, sql: string, ...args: (string | number | null)[]): Row[] =>
	db.prepare(sql).all(...args)
/** The `n` of a statement's first row: a count. */
export const count = (db: DatabaseSync, sql: string, ...args: (string | number | null)[]) =>
	Number(rows(db, sql, ...args)[0]?.n ?? 0)

/** A path the run must name explicitly: an old local run must never be selected implicitly. */
export function requiredPath(name: string, what: string): string {
	const value = process.env[name]
	if (!value) throw new Error(`Set ${name} to ${what}`)
	if (!existsSync(value)) throw new Error(`${name} names ${value}, which does not exist`)
	return value
}

/** The canonical tables, by name: what the contracts' migrations create. */
const CANONICAL_TABLES: ReadonlySet<string> = new Set(
	Object.values(canonical).flatMap((v) => (is(v, SQLiteTable) ? [getTableName(v)] : [])),
)
/** The canonical views, by name. */
const CANONICAL_VIEWS: ReadonlySet<string> = new Set(
	Object.values(canonical).flatMap((v) => (is(v, SQLiteView) ? [getViewConfig(v).name] : [])),
)

/** The first backquoted name after `pattern` in a statement. */
const named = (statement: string, pattern: RegExp) => statement.match(pattern)?.[1]

/**
 * Create the tables the app keeps beside the canon — core's derived tables and
 * its own layers — from the app's migrations (drizzle-kit generates them from
 * the app's schema, the one definition), so the prepared copy has exactly the
 * D1's tables. Every statement on a table that is not canonical is run, in the
 * migrations' order (a later migration may alter or rebuild one); statements on
 * canonical tables are the contracts' migrations' business and are skipped.
 * Tables of that kind left in the copy from before are dropped first.
 */
function createOwnTables(db: DatabaseSync, migrations: string): string[] {
	if (!existsSync(migrations)) throw new Error(`the app's migrations are not at ${migrations}`)
	const statements = readdirSync(migrations, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort()
		.flatMap((dir) =>
			readFileSync(resolve(migrations, dir, 'migration.sql'), 'utf8').split(
				'--> statement-breakpoint',
			),
		)
		// a statement's own comment lines (a hand-written migration explains itself) are not SQL to match
		.map((s) =>
			s
				.split('\n')
				.filter((line) => !line.trim().startsWith('--'))
				.join('\n')
				.trim(),
		)
		.filter(Boolean)
	// A canonical table rebuilt through a stand-in (`CREATE TABLE x_next …
	// RENAME TO x`) is the canon's own change: the stand-in is canonical too.
	const canon = new Set<string>(CANONICAL_TABLES)
	for (const statement of statements) {
		const from = named(statement, /^ALTER TABLE `([^`]+)` RENAME TO/)
		const to = named(statement, /RENAME TO `([^`]+)`/)
		if (from && to && CANONICAL_TABLES.has(to)) canon.add(from)
	}
	const own = new Set<string>()
	const indexes = new Map<string, string>()
	const run: string[] = []
	for (const statement of statements) {
		if (/^PRAGMA /.test(statement)) continue
		const view =
			named(statement, /^CREATE VIEW `([^`]+)`/) ??
			named(statement, /^DROP VIEW (?:IF EXISTS )?`([^`]+)`/)
		if (view) {
			if (CANONICAL_VIEWS.has(view)) continue
			throw new Error(`the app's migrations name a view the canon does not: ${view}`)
		}
		const table =
			named(statement, /^CREATE TABLE `([^`]+)`/) ??
			named(statement, /^ALTER TABLE `([^`]+)`/) ??
			named(statement, /^DROP TABLE (?:IF EXISTS )?`([^`]+)`/) ??
			named(statement, /^INSERT INTO `([^`]+)`/) ??
			named(statement, /^CREATE (?:UNIQUE )?INDEX `[^`]+` ON `([^`]+)`/) ??
			indexes.get(named(statement, /^DROP INDEX (?:IF EXISTS )?`([^`]+)`/) ?? '')
		if (!table)
			throw new Error(
				`a statement of the app's migrations names no table: ${statement.slice(0, 120)}`,
			)
		const index = named(statement, /^CREATE (?:UNIQUE )?INDEX `([^`]+)`/)
		if (index) indexes.set(index, table)
		if (canon.has(table)) continue
		if (statement.startsWith('CREATE TABLE')) own.add(table)
		const renamed = named(statement, /RENAME TO `([^`]+)`/)
		if (renamed) own.add(renamed)
		run.push(statement)
	}
	for (const table of own) db.exec(`DROP TABLE IF EXISTS \`${table}\``)
	for (const statement of run) db.exec(statement)
	const present = new Set(
		rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r.name)),
	)
	return [...own].filter((t) => present.has(t))
}

export interface PrepareOptions {
	/** The run database (the pipeline's `.sqlite`). */
	source: string
	/** The prepared copy to write. */
	out: string
	/** The app's drizzle migrations folder: its own tables are created from them. */
	migrations: string
	/** The site's words, written into the run's own row. */
	site: RunSite
	/** The app's own layers, written after the common steps; given the copy and its committed build. */
	extend?: (db: DatabaseSync, build: number) => void | Promise<void>
}

export async function prepareRun(options: PrepareOptions): Promise<void> {
	const { source, out, site } = options
	if (!existsSync(source)) throw new Error(`source sqlite not found: ${source}`)
	mkdirSync(dirname(out), { recursive: true })
	rmSync(out, { force: true })
	copyFileSync(source, out)
	const db = new DatabaseSync(out)
	db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA foreign_keys = ON;')
	console.info(`\n▶ preparing ${out}\n  from ${source} (copied verbatim)\n`)

	// The copy is brought to the canonical schema by its own migrations (the
	// contracts' drizzle/, the journal both pipelines keep); a run from before
	// the migrator has no journal and is adopted by the pipeline first.
	if (!rows(db, "SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'").length)
		throw new Error(
			'the run has no migration journal: open it with the current pipeline (python db.sqlite_exporter) first',
		)
	migrate(drizzle({ client: db }), { migrationsFolder: MIGRATIONS })
	db.prepare("UPDATE pipeline_state SET value = ? WHERE key = 'schema_version'").run(
		String(RUN_SCHEMA_VERSION),
	)
	const journal = rows(db, 'SELECT name FROM __drizzle_migrations ORDER BY id').map((r) =>
		String(r.name),
	)
	console.info(
		`  · schema version ${RUN_SCHEMA_VERSION}; migrations recorded: ${journal.join(', ')}`,
	)
	// The run's views (current_*, published_*) come with those migrations.
	const views = new Set(
		rows(db, "SELECT name FROM sqlite_master WHERE type = 'view'").map((r) => String(r.name)),
	)
	const missing = [...CANONICAL_VIEWS].filter((name) => !views.has(name))
	if (missing.length)
		throw new Error(
			`the run lacks the canonical views ${missing.join(', ')}: open it with the current pipeline (python db.sqlite_exporter) first`,
		)
	const build = count(db, 'SELECT build_id AS n FROM run_current_build WHERE singleton = 1')
	if (!build) throw new Error('the run has no committed build (run_current_build is empty)')
	console.info(`  · committed build ${build}`)

	/* ── 1. the run's own row: write the site ── */
	const [meta] = rows(
		db,
		'SELECT name, profile IS NOT NULL AS hasProfile, run_config IS NOT NULL AS hasConfig, records IS NOT NULL AS hasRecords FROM run_meta WHERE singleton = 1',
	)
	if (!meta)
		throw new Error('run_meta is empty: the run has no row of its own (see python/db/run_meta.py)')
	if (!meta.hasProfile || !meta.hasConfig)
		throw new Error(
			'run_meta.profile / run_config are NULL: backfill the run (python -m db.run_meta <sqlite>) before preparing',
		)
	const tasks = new Set(
		rows(db, 'SELECT DISTINCT task_id AS id FROM doc_custom_analysis').map((r) => String(r.id)),
	)
	const unnamed = Object.keys(site.tasks).filter((id) => !tasks.has(id))
	if (unnamed.length)
		throw new Error(`the site names tasks this run never performed: ${unnamed.join(', ')}`)
	db.prepare('UPDATE run_meta SET site = ?, updated_at = ? WHERE singleton = 1').run(
		JSON.stringify(site),
		Date.now(),
	)
	console.info(
		`  · run_meta: "${String(meta.name)}" — profile ✓ run_config ✓ records ${meta.hasRecords ? '✓' : '✗'}; site written (${site.title ?? 'the run’s name'})`,
	)

	/* ── 2. embeddings out (they live in the vector index) ── */
	const withVectors = count(db, "SELECT COUNT(*) AS n FROM chunk WHERE embedding NOT IN ('', '[]')")
	db.exec("UPDATE chunk SET embedding = '[]'")
	console.info(
		`  · chunk: ${count(db, 'SELECT COUNT(*) AS n FROM chunk')} passages, ${withVectors} embeddings blanked (the vector index holds them)`,
	)

	/* ── 3. the tables beside the canon, as the app's own migrations create them ── */
	const own = createOwnTables(db, options.migrations)
	console.info(`  · created from the app's migrations: ${own.join(', ')}`)
	for (const name of [getTableName(docDominantTopic), getTableName(chunkPrimaryTopic)])
		if (!own.includes(name))
			throw new Error(
				`the app's migrations do not create ${name}: its schema must re-export core's derived tables (@aicolab/insight-bridge/prepare/tables)`,
			)

	/* ── 4. the derived tables: top-1 substantive topic per document and per passage ── */
	db.prepare(
		`INSERT INTO doc_dominant_topic
		 WITH dc AS (
			SELECT c.document_id, m.topic_cluster_id, m.soft_score,
				ROW_NUMBER() OVER (PARTITION BY c.document_id ORDER BY m.soft_score DESC, m.topic_cluster_id) rn
			FROM chunk_topic_cluster_membership m
			JOIN chunk c ON c.id = m.chunk_id
			JOIN topic_cluster t ON t.topic_cluster_id = m.topic_cluster_id AND t.junk_status <> 'confirmed' AND t.retired_build_id IS NULL
			WHERE m.build_id = ?)
		 SELECT document_id, topic_cluster_id, ROUND(soft_score, 4) FROM dc WHERE rn = 1`,
	).run(build)
	db.prepare(
		`INSERT INTO chunk_primary_topic
		 WITH cc AS (
			SELECT m.chunk_id, m.topic_cluster_id,
				ROW_NUMBER() OVER (PARTITION BY m.chunk_id ORDER BY m.soft_score DESC, m.topic_cluster_id) rn
			FROM chunk_topic_cluster_membership m
			JOIN topic_cluster t ON t.topic_cluster_id = m.topic_cluster_id AND t.junk_status <> 'confirmed' AND t.retired_build_id IS NULL
			WHERE m.build_id = ?)
		 SELECT chunk_id, topic_cluster_id FROM cc WHERE rn = 1`,
	).run(build)
	console.info(
		`  · doc_dominant_topic: ${count(db, 'SELECT COUNT(*) AS n FROM doc_dominant_topic')} documents; chunk_primary_topic: ${count(db, 'SELECT COUNT(*) AS n FROM chunk_primary_topic')} passages`,
	)

	/* ── 5. the app's own layers ── */
	await options.extend?.(db, build)

	/* ── 6. the facts, as the run holds them (nothing here is changed) ── */
	const topics = count(
		db,
		"SELECT COUNT(*) AS n FROM topic_cluster WHERE retired_build_id IS NULL AND junk_status <> 'confirmed'",
	)
	const junk = count(
		db,
		"SELECT COUNT(*) AS n FROM topic_cluster WHERE retired_build_id IS NULL AND junk_status = 'confirmed'",
	)
	const quotes = count(db, 'SELECT COUNT(*) AS n FROM key_quote')
	const verified = count(db, 'SELECT COUNT(*) AS n FROM key_quote_verification WHERE verified = 1')
	console.info(
		`  · ${count(db, 'SELECT COUNT(*) AS n FROM entity')} sources · ${count(db, 'SELECT COUNT(*) AS n FROM document')} documents · ` +
			`${count(db, 'SELECT COUNT(*) AS n FROM key_point')} key points · ${quotes} quotes (${verified} verified by the pipeline, ${((100 * verified) / (quotes || 1)).toFixed(2)}%)`,
	)
	console.info(
		`  · ${topics} topics (${junk} confirmed junk, excluded) · ${count(db, 'SELECT COUNT(*) AS n FROM supercluster WHERE generation > 0 AND build_id = ?', build)} groups · ` +
			`${count(db, 'SELECT COUNT(*) AS n FROM cluster_entity_perspective')} stances · ${count(db, 'SELECT COUNT(*) AS n FROM cluster_key_perspective')} lens rows · ` +
			`${count(db, 'SELECT COUNT(*) AS n FROM question_response WHERE addressed = 1')} answers · ${count(db, 'SELECT COUNT(*) AS n FROM criterion_analysis')} criterion findings`,
	)

	db.exec('VACUUM')
	/* ── 7. the planner's statistics: without them SQLite takes every table for a large one and can
	   read a one-row table (run_current_build) last, so a view cannot enter its build-keyed index ── */
	db.exec('ANALYZE')
	console.info(
		`  · statistics for the query planner: ${count(db, 'SELECT COUNT(DISTINCT tbl) AS n FROM sqlite_stat1')} tables analysed`,
	)
	db.close()
	console.info('\n✅ prepared — now `pnpm db:stars`, then `pnpm db:load:local`\n')
}
