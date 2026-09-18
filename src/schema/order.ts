/**
 * Every table the run store has, in dependency order — DERIVED from the
 * declarations in tables.ts, never listed by hand.
 *
 * Four things need this order: the SQL dump writes tables parents-first so a
 * restore satisfies every foreign key as it reads; the import door allows
 * exactly these names; a wipe deletes children-first (the order reversed) so
 * no foreign key refuses a delete; and the Python pipeline's DDL is emitted in
 * it. Until 2026-09-18 the list was parsed out of hand-written DDL with a
 * regular expression; now it is the schema itself, walked.
 *
 * Order: a topological sort over the foreign keys drizzle knows about, with
 * declaration order as the tie-break so the result is stable from one run to
 * the next. A self-reference (topic_cluster.merged_into, concept.replaced_by_id)
 * is not a dependency on another table and is ignored.
 */
import { getTableName, is } from 'drizzle-orm'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import * as tables from './tables.ts'

// The module also exports `zodJson` and the types; only the tables are wanted,
// and drizzle's `is` decides which values those are.
const declared = Object.values<unknown>(tables).filter((value): value is SQLiteTable =>
	is(value, SQLiteTable),
)

function inDependencyOrder(all: readonly SQLiteTable[]): SQLiteTable[] {
	const byName = new Map(all.map((t) => [getTableName(t), t]))
	const parentsOf = new Map<string, string[]>()
	for (const table of all) {
		const name = getTableName(table)
		const parents = getTableConfig(table)
			.foreignKeys.map((fk) => getTableName(fk.reference().foreignTable))
			.filter((parent) => parent !== name && byName.has(parent))
		parentsOf.set(name, [...new Set(parents)])
	}
	const placed = new Set<string>()
	const out: SQLiteTable[] = []
	const place = (name: string, trail: string[]): void => {
		if (placed.has(name)) return
		if (trail.includes(name))
			throw new Error(`[schema] tables ${[...trail, name].join(' → ')} depend on each other in a cycle`)
		for (const parent of parentsOf.get(name) ?? []) place(parent, [...trail, name])
		placed.add(name)
		const table = byName.get(name)
		if (table) out.push(table)
	}
	for (const table of all) place(getTableName(table), [])
	return out
}

/** The run store's tables, parents before children. */
export const RUN_STORE_TABLE_OBJECTS: readonly SQLiteTable[] = inDependencyOrder(declared)

/** The same, by name. */
export const RUN_STORE_TABLES: readonly string[] = RUN_STORE_TABLE_OBJECTS.map((t) => getTableName(t))
