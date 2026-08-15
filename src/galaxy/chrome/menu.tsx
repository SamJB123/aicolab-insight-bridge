/**
 * The left rail (settled 2026-08-16, IA reform): a CONVENTIONAL menu, not a
 * drill — the drill moved into the inspector's resting state. Three groups:
 *
 *   • EXPLORE — the navigation modes (topic structure vs source facets),
 *     labelled with the corpus's own tier vocabulary;
 *   • LENSES — the colour-by facet and membership-weighting controls,
 *     relocated from the floating stage chrome (they are navigation
 *     config, and the stage declutters);
 *   • the corpus CENSUS card at the bottom.
 *
 * On mobile this rail becomes the BottomNavigation (modes as bar items) +
 * the radial fan (see GalaxyMap) — the left-bar ⇄ mobile-nav convention.
 */

import {
	Eyebrow,
	Segmented,
	WorkspaceNavigationGroup,
	WorkspaceNavigationItem,
	WorkspaceNavigationList,
} from '@aicolab/ui-solid'
import { createMemo, For, Show } from 'solid-js'
import type { IBGalaxy, IBIntensityMode, IBSourceFacet } from '../types.ts'

export type GalaxyMode = 'topics' | 'sources'

export function GalaxyMenu(props: {
	galaxy: IBGalaxy
	mode: GalaxyMode
	onMode: (mode: GalaxyMode) => void
	facets: IBSourceFacet[]
	activeFacet?: string
	onFacet: (key: string) => void
	hasSoftScores: boolean
	intensityMode: IBIntensityMode
	onIntensityMode: (mode: IBIntensityMode) => void
	/** Bench/status note (e.g. "fixture data"), under the census. */
	note?: string
}) {
	const tierPlural = (tier: number): string =>
		props.galaxy.tiers.find((entry) => entry.tier === tier)?.labelPlural ?? ''
	const hasSources = createMemo(() =>
		props.galaxy.nodes.some((node) => node.tier === -1),
	)
	const census = createMemo(() =>
		props.galaxy.tiers.map((tier) => ({
			label: tier.labelPlural,
			count: props.galaxy.nodes.filter((node) => node.tier === tier.tier).length,
		})),
	)
	return (
		<div class="ib-galaxy-menu">
			<WorkspaceNavigationGroup id="ib-galaxy-menu-explore" label="Explore">
				<WorkspaceNavigationList label="Navigation modes">
					<WorkspaceNavigationItem
						label={tierPlural(0) || 'Topics'}
						mark={<span aria-hidden="true">✦</span>}
						current={props.mode === 'topics'}
						onSelect={() => props.onMode('topics')}
					/>
					<Show when={hasSources()}>
						<WorkspaceNavigationItem
							label={tierPlural(-1) || 'Sources'}
							mark={<span aria-hidden="true">◍</span>}
							current={props.mode === 'sources'}
							onSelect={() => props.onMode('sources')}
						/>
					</Show>
				</WorkspaceNavigationList>
			</WorkspaceNavigationGroup>
			<Show when={props.facets.length > 1 || props.hasSoftScores}>
				<WorkspaceNavigationGroup id="ib-galaxy-menu-lenses" label="Lenses">
					<div class="ib-galaxy-menu-lenses">
						<Show when={props.facets.length > 1}>
							<div class="ib-galaxy-lens">
								<Eyebrow>Colour sources by</Eyebrow>
								<Segmented
									label="Colour sources by facet"
									options={props.facets.map((facet) => ({
										id: facet.key,
										label: facet.label,
									}))}
									value={props.activeFacet ?? ''}
									onChange={props.onFacet}
								/>
							</div>
						</Show>
						<Show when={props.hasSoftScores}>
							<div class="ib-galaxy-lens">
								<Eyebrow>Membership weighting</Eyebrow>
								<Segmented
									label="Membership weighting"
									options={[
										{ id: 'grades', label: 'Graded' },
										{ id: 'soft', label: 'Continuous' },
									]}
									value={props.intensityMode}
									onChange={props.onIntensityMode}
								/>
							</div>
						</Show>
					</div>
				</WorkspaceNavigationGroup>
			</Show>
			<div class="ib-galaxy-menu-census">
				<Eyebrow>Corpus</Eyebrow>
				<dl>
					<For each={census()}>
						{(row) => (
							<div>
								<dt>{row.label}</dt>
								<dd>{row.count}</dd>
							</div>
						)}
					</For>
				</dl>
				<Show when={props.note}>
					{(note) => <p class="ib-galaxy-menu-note">{note()}</p>}
				</Show>
			</div>
		</div>
	)
}
