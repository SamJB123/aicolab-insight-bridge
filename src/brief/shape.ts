/**
 * What kind of corpus database is this, and what may the reading layer assume?
 *
 * WHY THIS EXISTS. These queries were written against a corpus that had already
 * been reduced to one clustering — the shape each app's `prepare-source.ts`
 * produces, which joins `run_current_build` and throws the rest away. Pointed at
 * a pipeline run's own store instead, the same queries counted every build that
 * had ever run and crashed on a star table that was never there. The assumption
 * was real and unwritten; this states it and checks it.
 *
 * THE PRECONDITION, in one sentence: the reading layer needs a database where
 * exactly one clustering is visible and every topic in it is live.
 *
 * Two shapes satisfy it, and `corpusShape` tells them apart:
 *
 *   REDUCED   — an app's prepared database. One build, already selected; no
 *               `run_current_build`, no `build_id`, no `retired_build_id`.
 *               Nothing to scope: what is there is what to read.
 *   VERSIONED — a pipeline run's own store. Every build is present and
 *               `run_current_build` names the one readers use, exactly as
 *               `topic_cluster.retired_build_id` names the topics that are gone.
 *               Reads must be scoped, and this is what makes them so.
 *
 * It is the same pointer-to-the-current-version pattern Iceberg and Delta use:
 * resolve it once, then scope every read to it — never read everything and hope.
 *
 * WHY A PROBE RATHER THAN A FLAG. A caller who forgets a flag gets silently
 * inflated numbers, which is the failure this is fixing. The database itself
 * already knows which shape it is, so it is asked.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { CorpusDb } from './schema.ts'

/** SQLite's own catalogue — always present, so asking it needs no error handling. */
const sqliteMaster = sqliteTable('sqlite_master', {
	name: text('name'),
	type: text('type'),
})

/** The pointer: one row naming the build a reader sees. Versioned databases only. */
const runCurrentBuild = sqliteTable('run_current_build', {
	singleton: integer('singleton').primaryKey(),
	buildId: integer('build_id').notNull(),
})

/** A build id no row can carry: a versioned corpus with nothing committed reads as empty. */
const NO_BUILD = -1

export interface CorpusShape {
	/**
	 * The build to scope every read to, or null for a database already reduced to
	 * one. Null does NOT mean "read everything unscoped" as a guess — it means the
	 * selecting was done upstream.
	 */
	build: number | null
	/** Whether a baked star layout is present; a corpus without one draws no constellation. */
	stars: boolean
}

/**
 * Probe a corpus once, at the top of a read, and pass the answer down.
 *
 * A versioned database that names NO current build is a run whose clustering has
 * not committed. It is scoped to a build id no row can carry, so the reading
 * comes back empty — which is the truth about such a run, and not the same thing
 * as reading every build at once and reporting inflated numbers. This is the
 * convention the pipeline zone's own reads already use (`explorer.ts`: "the
 * committed build, or -1 when nothing is clustered yet").
 */
export async function corpusShape(db: CorpusDb): Promise<CorpusShape> {
	const present = new Set(
		(
			await db
				.select({ name: sqliteMaster.name })
				.from(sqliteMaster)
				.where(
					and(
						eq(sqliteMaster.type, 'table'),
						inArray(sqliteMaster.name, ['run_current_build', 'topic_star']),
					),
				)
		).flatMap((row: { name: string | null }) => (row.name ? [row.name] : [])),
	)
	const stars = present.has('topic_star')
	if (!present.has('run_current_build')) return { build: null, stars }
	const rows = await db.select({ buildId: runCurrentBuild.buildId }).from(runCurrentBuild).limit(1)
	return { build: rows[0]?.buildId ?? NO_BUILD, stars }
}

/**
 * Scope a read to the corpus's current build.
 *
 * `undefined` for a reduced database means "add no predicate", which is what
 * drizzle's `and`/`where` ignore — so a caller writes the same query either way.
 *
 * The column is named in raw SQL rather than declared on the table objects in
 * `schema.ts` ON PURPOSE: those declare only the columns EVERY corpus has, and
 * `select()` fetches all of them, so declaring `build_id` there would break
 * every prepared database that does not carry it. Naming it here is safe because
 * it is only ever reached when the probe found the pointer beside it.
 */
export const atBuild = (shape: CorpusShape, table: string) =>
	shape.build === null ? undefined : sql.raw(`${table}.build_id = ${shape.build}`)

/**
 * Only topics that are still live.
 *
 * A rebuild never deletes a topic; it stamps `retired_build_id` on the ones it
 * dropped, so identity survives re-clustering. A reduced database has no such
 * column and no retired rows to exclude.
 */
export const liveTopics = (shape: CorpusShape) =>
	shape.build === null ? undefined : sql.raw('topic_cluster.retired_build_id IS NULL')
