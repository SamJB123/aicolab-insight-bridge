/**
 * The Brief's chapters as its own contents list names them: the topics when the run
 * built no grouping tree, else its root families, each with the anchor its heading
 * carries on the page (`t-<id>` for a topic or a single generation's theme, `f-<id>`
 * for a family). The Brief's contents (./brief-page.tsx) and any host listing the
 * chapters beside the page read this one definition. Pure, and typed without Solid.
 */
import type { BriefData } from './types.ts'

/** One chapter: its words, and the anchor of its heading on the page. */
export interface BriefChapter {
	label: string
	anchor: string
}

/** What the chapters are called: topics, themes, or families. */
export const briefChaptersLabel = (d: BriefData): string =>
	d.flat ? 'Topics' : d.singleGeneration ? 'Themes' : 'Families'

export function briefChapters(d: BriefData): BriefChapter[] {
	return d.flat
		? d.topicOrder.map((id) => ({ label: d.topics[id]?.subject ?? '', anchor: `t-${id}` }))
		: d.families.map((family) => ({
				label: family.subject,
				anchor: d.singleGeneration ? `t-${family.id}` : `f-${family.id}`,
			}))
}
