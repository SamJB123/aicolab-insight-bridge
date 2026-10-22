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
 *   unserved  sources whose PASSAGES are not served (Legal AI's restricted
 *             distribution: paywalled or login-only works): a document's
 *             text reads empty with `notice` on the document, and no text or
 *             semantic search returns their passages; every analysis, stance,
 *             key point and quote of theirs reads as written.
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
	unserved?: { entities: ReadonlySet<string>; notice: string }
}

/** Whether a source's passages are served in this scope. */
export const passagesServed = (
	scope: ReadScope | undefined,
	entityUuid: string | null | undefined,
) => !entityUuid || !scope?.unserved?.entities.has(entityUuid)

/** The sources whose passages are not served, as one JSON parameter, or null when there are none. */
const unservedJson = (scope: ReadScope | undefined) =>
	scope?.unserved?.entities.size ? JSON.stringify([...scope.unserved.entities]) : null

/** A predicate keeping `column`'s source's passages unless they are not served; undefined (dropped by `and`) when all are. */
export function servedSources(
	column: AnyColumn | SQL,
	scope: ReadScope | undefined,
): SQL | undefined {
	const json = unservedJson(scope)
	return json === null ? undefined : sql`${column} NOT IN (SELECT value FROM json_each(${json}))`
}

/** The same for a raw query: ` AND column NOT IN …`, or nothing. */
export function andServed(column: SQL, scope: ReadScope | undefined): SQL {
	const json = unservedJson(scope)
	return json === null ? sql`` : sql` AND ${column} NOT IN (SELECT value FROM json_each(${json}))`
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

/** A scope as a string, the same for equal scopes: what a memo keyed by the reader's scope is kept under. */
export function scopeKey(scope?: ReadScope): string {
	if (!scope) return ''
	const ids = (set: ReadonlySet<string> | undefined) => (set ? [...set].sort() : [])
	return JSON.stringify([
		ids(scope.exclude),
		scope.withhold ? [ids(scope.withhold.entities), scope.withhold.notice] : null,
		scope.annotate ? [ids(scope.annotate.entities), scope.annotate.notice] : null,
		scope.unserved ? [ids(scope.unserved.entities), scope.unserved.notice] : null,
	])
}

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
