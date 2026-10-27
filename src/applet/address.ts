/**
 * A report's address vocabulary, for every host that embeds a report (the hub's places,
 * a report's own site): what a reader's place in a report IS, and how it is spelled as
 * segments below the report and a query — the hive's address contract, for reports.
 *
 *   <section>                 one of core's sections (`overview`, `galaxy`, `topics`,
 *                             `sources`, `search`, `method`, `connect`), or an analysis
 *                             task's page as `analysis:<taskId>`
 *   <section>/<node>          a reading open on the section's page, by the reader's node
 *                             id (`t:12`, `g:3`, `s:<slug>`); `?document=` the document of
 *                             a multi-document source read on its own, `?section=` the
 *                             reading's tab (the site's reading-url keys)
 *   ?…                        what the page keeps of its own: the record's filters and
 *                             page, a search's `query`, the Brief's folded chapters
 *
 * Pure, and typed without Solid.
 */
import { parseNodeId, type ReadingTarget } from '../explorer/readings.ts'
import type { ReportSection } from '../report/surface.tsx'

const ANALYSIS = 'analysis:'

/** Which section a place is, and for an analysis which task. */
export interface SectionRef {
	section: ReportSection
	taskId?: string
}

/** The segment that names a section under its report; an analysis task's carries the task. */
export const sectionId = (section: ReportSection, taskId?: string): string =>
	section === 'analysis' ? `${ANALYSIS}${taskId ?? ''}` : section

/** The section a segment names, or null. */
export function sectionOfId(id: string): SectionRef | null {
	if (id.startsWith(ANALYSIS)) {
		const taskId = id.slice(ANALYSIS.length)
		return taskId ? { section: 'analysis', taskId } : null
	}
	switch (id) {
		case 'overview':
		case 'galaxy':
		case 'topics':
		case 'sources':
		case 'search':
		case 'method':
		case 'connect':
			return { section: id }
		default:
			return null
	}
}

/** The keys of a reading open on the page, beside the page's own (the site's reading-url). */
const READING_KEYS: ReadonlySet<string> = new Set(['document', 'section'])

const text = (value: unknown): string | undefined =>
	typeof value === 'string' && value ? value : undefined

/** Where a reader is in a report: a section, a reading open on it, and what the page keeps of its own. */
export interface ReportTarget extends SectionRef {
	/** The reading open on the page, or null. */
	reading: ReadingTarget | null
	/** Of a source's reading: the one document read on its own. */
	document?: string
	/** The reading's tab. */
	tab?: string
	/** The page's own query: the record's filters and page, a search's query, the Brief's folds. */
	page: Readonly<Record<string, unknown>>
}

/** The address of a target: the segments below the report, and the query they ride in. */
export interface ReportAddress {
	segments: string[]
	search: Record<string, unknown>
}

/** The reader's node id as the address spells it (the reader's own: `t:12`, `g:3`, `s:<slug>`). */
export const nodeIdOf = (target: ReadingTarget): string =>
	`${target.kind === 'topic' ? 't' : target.kind === 'group' ? 'g' : 's'}:${target.key}`

export function addressOf(target: ReportTarget): ReportAddress {
	return {
		segments: [
			sectionId(target.section, target.taskId),
			...(target.reading ? [nodeIdOf(target.reading)] : []),
		],
		search: {
			...target.page,
			...(target.reading && target.document ? { document: target.document } : {}),
			...(target.reading && target.tab ? { section: target.tab } : {}),
		},
	}
}

/** The page's own keys of a query: everything but a reading's. */
export const pageSearchOf = (search: Readonly<Record<string, unknown>>): Record<string, unknown> =>
	Object.fromEntries(Object.entries(search).filter(([key]) => !READING_KEYS.has(key)))

/** The target the segments below a report and the query name, or null when they name no section. */
export function targetOf(
	segments: readonly string[],
	search: Readonly<Record<string, unknown>>,
): ReportTarget | null {
	const [id, node, ...rest] = segments
	if (id === undefined || rest.length > 0) return null
	const section = sectionOfId(id)
	if (!section) return null
	const reading = node === undefined ? null : parseNodeId(node)
	if (node !== undefined && !reading) return null
	const document = reading ? text(search.document) : undefined
	const tab = reading ? text(search.section) : undefined
	return {
		...section,
		reading,
		...(document ? { document } : {}),
		...(tab ? { tab } : {}),
		page: pageSearchOf(search),
	}
}
