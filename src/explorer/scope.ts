/**
 * A reader's scope over the record: what a report's own rules make of its
 * sources for this request. Every explorer read takes one (optional — none
 * reads the record as written).
 *
 *   exclude   sources left out altogether: every count and every list reads
 *             as if they were absent (High Water's "collapse copies" switch
 *             leaves out a campaign's copies).
 *   withhold  sources whose own words are withheld: they stay in every count
 *             and keep their name, facets, titles and one-word labels, but
 *             every text of theirs — passages, quotes, key points, answers,
 *             findings, stance explanations, tag evidence — reads `notice`
 *             instead, marked `withheld` (High Water's ICIP gate, closed).
 *   annotate  sources whose words are shown with `notice` beside them (the
 *             gate open, with its cultural notice).
 *
 * The rule that decides who is in which set is the host's; the record is
 * never altered.
 */
import type { AnyColumn, SQL } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

export interface ReadScope {
	exclude?: ReadonlySet<string>
	withhold?: { entities: ReadonlySet<string>; notice: string }
	annotate?: { entities: ReadonlySet<string>; notice: string }
}

/** The excluded sources as one SQL parameter: a JSON array a query reads with json_each (one binding, whatever the count). */
const excludedJson = (scope: ReadScope | undefined) =>
	scope?.exclude?.size ? JSON.stringify([...scope.exclude]) : null

/** A predicate keeping `column`'s source unless the scope excludes it; undefined (dropped by `and`) when nothing is. */
export function keepSources(
	column: AnyColumn | SQL,
	scope: ReadScope | undefined,
): SQL | undefined {
	const json = excludedJson(scope)
	return json === null ? undefined : sql`${column} NOT IN (SELECT value FROM json_each(${json}))`
}

/** The same for a raw query: ` AND column NOT IN …`, or nothing. */
export function andKept(column: SQL, scope: ReadScope | undefined): SQL {
	const json = excludedJson(scope)
	return json === null ? sql`` : sql` AND ${column} NOT IN (SELECT value FROM json_each(${json}))`
}

/** Whether a source counts in this scope. */
export const isKept = (scope: ReadScope | undefined, entityUuid: string | null | undefined) =>
	!entityUuid || !scope?.exclude?.has(entityUuid)

/** How a source's words read here: withheld behind the notice, shown with a notice, or as written (empty). */
export function wordsOf(
	scope: ReadScope | undefined,
	entityUuid: string | null | undefined,
): { withheld?: true; notice?: string } {
	if (!entityUuid) return {}
	if (scope?.withhold?.entities.has(entityUuid))
		return { withheld: true, notice: scope.withhold.notice }
	if (scope?.annotate?.entities.has(entityUuid)) return { notice: scope.annotate.notice }
	return {}
}

/** A source's text in this scope: the notice when withheld, else the text. */
export const textOf = (
	scope: ReadScope | undefined,
	entityUuid: string | null | undefined,
	text: string,
) => (wordsOf(scope, entityUuid).withheld ? (scope?.withhold?.notice ?? '') : text)
