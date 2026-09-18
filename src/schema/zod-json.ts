/**
 * A column that IS a zod schema.
 *
 * Every JSON-valued column in the canonical schema is declared with this, so
 * the column's TypeScript type is `z.output` of its schema and nothing else:
 * no `$type<T>()` claim to keep in line with a parse at every read site, no
 * `JSON.parse` scattered through the callers. The schema is the one definition.
 *
 * Validated in BOTH directions at the driver boundary, which is where drizzle
 * puts the conversion (orm.drizzle.team/docs/custom-types): a write that is not
 * the declared shape never reaches SQLite, and a row that no longer matches the
 * current contract fails loudly at the read instead of somewhere later. That
 * second property is deliberate — a stale row is a real defect, not something
 * to read around.
 *
 * SQL type `text`, which is what drizzle-kit writes into migrations and what
 * SQLite's JSON functions operate on (a `blob` would refuse them).
 */
import { customType } from 'drizzle-orm/sqlite-core'
import type { z } from 'zod'

export const zodJson = <S extends z.ZodType>(schema: S) =>
	customType<{ data: z.output<S>; driverData: string }>({
		dataType: () => 'text',
		toDriver: (value) => JSON.stringify(schema.parse(value)),
		fromDriver: (value) => schema.parse(JSON.parse(value)),
	})
