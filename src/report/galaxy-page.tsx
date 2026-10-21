/**
 * Galaxy — the record as a night sky, for every Insight Bridge report: core's
 * GalaxyMap over core's one galaxy read (explorer/pages `galaxy`), its
 * positions in core's palette, its title and document noun the run's own
 * words. The host supplies what only it has: how a node's reading loads (its
 * drawer's readings), where navigation lives in its URL, its poster and its
 * way back out.
 *
 * The cosmos is a dark instrument in both schemes, so the page forces dark
 * (`ui-theme theme-dark` re-derives the ui-solid ladder under it), and it
 * carries `ib-palette` so the palette's defaults reach it even in a host with
 * no `.ib-site` (the pipeline's console). Moved from Training Data's
 * routes/galaxy.tsx and the pipeline's GalaxyResults (2026-10-21).
 */
import type { GalaxyData } from '@aicolab/insight-bridge-contracts/explorer'
import { omit } from 'solid-js'
import { galaxyFromData } from '../galaxy/from-data.ts'
import { GalaxyMap, type GalaxyMapProps } from '../galaxy/GalaxyMap.tsx'
import type { ReportSurface } from './surface.tsx'

export type GalaxyPageProps = {
	data: GalaxyData
	surface: ReportSurface
} & Omit<GalaxyMapProps, 'galaxy' | 'title' | 'documentLabel' | 'class'>

export function GalaxyPage(props: GalaxyPageProps) {
	const map = omit(props, 'data', 'surface')
	const words = () => props.surface.words
	const documentLabel = () => {
		const noun = words().nouns.document
		return noun.charAt(0).toUpperCase() + noun.slice(1)
	}
	return (
		<div class="ui-theme theme-dark galaxy-shell ib-palette">
			<GalaxyMap
				{...map}
				galaxy={galaxyFromData(props.data, props.surface.positionColors)}
				title={words().title}
				documentLabel={documentLabel()}
			/>
		</div>
	)
}
