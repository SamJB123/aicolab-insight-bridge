/**
 * The Insight Bridge family as APPLETS of the platform (app-kit applet/define.ts): the
 * family itself, one of the platform's own ring, and a report per corpus of the
 * registry (./corpora.ts) under it — each report by its slug, with its name, its
 * words and its site as the registry has them, and the door its Worker serves
 * (`ReportService.getApplet`). A host lists these; nothing about a report is written
 * by a host.
 */

import { defineApplet } from '@aicolab/app-kit/applet'
import { CORPORA } from './corpora.ts'

export type { CorpusSlug } from './corpora.ts'
export { isCorpusSlug } from './corpora.ts'

/** The family: where its reports stand in a host's tree and on its chart. */
export const INSIGHT_BRIDGE_APPLET = defineApplet({
	id: 'insight-bridge',
	label: 'Insight Bridge',
	direction: 2,
})

/** One applet per corpus, in the registry's order, each under the family. */
export const REPORT_APPLETS = CORPORA.map((corpus) =>
	defineApplet({
		id: corpus.slug,
		parent: INSIGHT_BRIDGE_APPLET.id,
		label: corpus.name,
		blurb: corpus.blurb,
		site: corpus.url,
		door: true,
	}),
)
