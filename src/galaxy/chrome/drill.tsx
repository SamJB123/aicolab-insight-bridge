/**
 * The drill — the inspector's RESTING surface, rebuilt as a pure FACE over
 * the GalaxyNavCore (headless-core rewrite, 2026-08-16): every level is
 * derived from `core.level()` and every row press is a core action. The
 * anatomy is uniform with the readers (settled 2026-08-16):
 *
 *   ‹ {destination}    — the named up-control (hidden at root)
 *   EYEBROW / Title    — the "you are here" header, at EVERY level
 *   rows               — the level's children (A–Z/Reach for topic tiers,
 *                        filter-only A–Z for sources; de-ranking convention)
 *
 * topics mode:  families → superclusters → topics
 * sources mode: facets → values → sources
 */

import {
	Eyebrow,
	InspectorHeader,
	RichListItem,
	Rule,
	TextInput,
	WorkspaceNavigationList,
} from '@aicolab/ui-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { facetPalette, facetValues } from '../facets.ts'
import type { GalaxyNavCore } from '../nav-core.ts'
import type { IBGalaxy, IBNode, IBNodeId } from '../types.ts'
import { DEFAULT_GALAXY_SORT, GalaxySortControl, sortRows } from './sort-control.tsx'

const FILTER_LIMIT = 24

export function GalaxyDrill(props: {
	galaxy: IBGalaxy
	title: string
	core: GalaxyNavCore
	hoveredId: IBNodeId | null
	/** The named up-destination (null = at root, control hidden). */
	upLabel: string | null
}) {
	const [query, setQuery] = createSignal('')
	const [sort, setSort] = createSignal(DEFAULT_GALAXY_SORT)

	const childCounts = createMemo(() => {
		const counts = new Map<IBNodeId, number>()
		for (const node of props.galaxy.nodes) {
			const parent = props.core.parentOf(node.id)
			if (parent !== undefined) counts.set(parent.id, (counts.get(parent.id) ?? 0) + 1)
		}
		return counts
	})
	const hasFamilies = createMemo(() => props.galaxy.nodes.some((node) => node.tier === 2))
	const tierPlural = (tier: number): string =>
		props.galaxy.tiers.find((entry) => entry.tier === tier)?.labelPlural ?? ''
	const tierSingular = (tier: number): string =>
		props.galaxy.tiers.find((entry) => entry.tier === tier)?.label ?? ''
	const weightLabelFor = (tier: number): string =>
		props.galaxy.tiers.find((meta) => meta.tier === tier)?.weightLabel ?? props.galaxy.weightLabel

	const meta = (node: IBNode): string => {
		if (node.tier > 0) {
			const count = childCounts().get(node.id) ?? node.childCount ?? 0
			const label = count === 1 ? tierSingular(node.tier - 1) : tierPlural(node.tier - 1)
			return `${count} ${label.toLowerCase()}`
		}
		const score = node.intensityLabel ? ` · ${node.intensityLabel}` : ''
		return `${node.weight} ${weightLabelFor(node.tier)}${score}`
	}

	const level = createMemo(() => props.core.level())
	const mode = createMemo(() => props.core.mode())

	// ── The uniform "you are here" header (settled 2026-08-16) ────────────
	const contextEyebrow = createMemo((): string => {
		const current = level()
		if (current.kind === 'children') return tierSingular(current.anchor.tier)
		if (current.kind === 'values') return 'Facet'
		if (current.kind === 'cohort') return props.core.facetLabelOf(current.facet)
		return 'Corpus'
	})
	const contextTitle = createMemo((): string => {
		const current = level()
		if (current.kind === 'children') return current.anchor.title
		if (current.kind === 'values') return props.core.facetLabelOf(current.facet)
		if (current.kind === 'cohort') return current.value
		return props.title
	})

	const topicRows = createMemo((): IBNode[] => {
		const current = level()
		const ordered = (list: IBNode[]): IBNode[] =>
			sortRows(
				list,
				sort(),
				(node) => node.title,
				(node) => node.weight,
			)
		if (mode() !== 'topics') return []
		if (current.kind === 'children') {
			const anchor = current.anchor
			return ordered(
				props.galaxy.nodes.filter(
					(node) => node.tier === anchor.tier - 1 && props.core.parentOf(node.id)?.id === anchor.id,
				),
			)
		}
		if (current.kind === 'root') {
			// families › groups › topics: a single-level corpus lists its topics.
			const rootTier = hasFamilies() ? 2 : props.galaxy.nodes.some((node) => node.tier === 1) ? 1 : 0
			return ordered(props.galaxy.nodes.filter((node) => node.tier === rootTier))
		}
		return []
	})

	const valueRows = createMemo((): Array<{ value: string; swatch: string; count: number }> => {
		const current = level()
		if (current.kind !== 'values') return []
		const counts = new Map<string, number>()
		for (const node of props.galaxy.nodes) {
			if (node.tier !== -1) continue
			const value = node.facets?.[current.facet]
			if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1)
		}
		const palette = facetPalette(facetValues(props.galaxy, current.facet))
		return [...counts.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([value, count]) => ({ value, swatch: palette.get(value) ?? '#888', count }))
	})

	const sourceRows = createMemo((): IBNode[] => {
		const current = level()
		if (current.kind !== 'cohort') return []
		const needle = query().trim().toLowerCase()
		return props.galaxy.nodes
			.filter(
				(node) =>
					node.tier === -1 &&
					node.facets?.[current.facet] === current.value &&
					(needle.length < 2 || node.title.toLowerCase().includes(needle)),
			)
			.sort((a, b) => a.title.localeCompare(b.title))
	})

	/** Cross-tier filter for topic mode (the known-item path). */
	const topicMatches = createMemo(() => {
		if (mode() !== 'topics') return null
		const needle = query().trim().toLowerCase()
		if (needle.length < 2) return null
		const ancestry = (node: IBNode): string => {
			const chain: string[] = []
			let cursor: IBNode | undefined = node
			for (let hop = 0; hop < 3 && cursor; hop++) {
				cursor = props.core.parentOf(cursor.id)
				if (cursor) chain.unshift(cursor.title)
			}
			return chain.join(' › ')
		}
		return props.galaxy.nodes
			.filter((node) => node.tier >= 0 && node.title.toLowerCase().includes(needle))
			.sort((a, b) => b.tier - a.tier || a.title.localeCompare(b.title))
			.slice(0, FILTER_LIMIT)
			.map((node) => ({ node, ancestry: ancestry(node) }))
	})

	const chooseFiltered = (node: IBNode): void => {
		setQuery('')
		props.core.openNode(node.id)
	}
	const rowClass = (id: IBNodeId): Record<string, boolean> => ({
		'ui-workspace-navigation-item': true,
		'ib-galaxy-nav-hot': props.hoveredId === id,
	})

	return (
		<div class="ib-galaxy-drill">
			<Show when={props.upLabel}>
				{(label) => (
					<button type="button" class="ib-galaxy-nav-up" onClick={() => props.core.upOneLevel()}>
						<span aria-hidden="true">‹</span> {label()}
					</button>
				)}
			</Show>
			<InspectorHeader eyebrow={<Eyebrow>{contextEyebrow()}</Eyebrow>} title={contextTitle()} />
			<Show when={mode() === 'topics' || level().kind === 'cohort'}>
				<TextInput
					type="search"
					value={query()}
					onInput={(event) => setQuery(event.currentTarget.value)}
					placeholder={mode() === 'topics' ? 'Filter the corpus…' : 'Filter sources…'}
					aria-label={mode() === 'topics' ? 'Filter the corpus' : 'Filter sources'}
				/>
			</Show>
			<Show
				when={topicMatches()}
				fallback={
					<>
						<Show when={mode() === 'topics'}>
							<div class="ib-galaxy-nav-sort">
								<GalaxySortControl sort={sort()} onChange={setSort} />
							</div>
						</Show>
						<Rule />
						<div class="ib-galaxy-nav-rows">
							<WorkspaceNavigationList label="Current level">
								<Show when={level().kind === 'facets'}>
									<For each={props.galaxy.sourceFacets ?? []}>
										{(facet) => (
											<RichListItem
												title={facet.label}
												description={`${facetValues(props.galaxy, facet.key).length} values`}
												onSelect={() => props.core.openFacet(facet.key)}
												class="ui-workspace-navigation-item"
											/>
										)}
									</For>
								</Show>
								<Show when={level().kind === 'values'}>
									<For each={valueRows()}>
										{(row) => (
											<RichListItem
												title={row.value}
												description={`${row.count} ${tierPlural(-1).toLowerCase()}`}
												leading={
													<span
														class="ib-galaxy-facet-swatch"
														style={{ background: row.swatch }}
														aria-hidden="true"
													/>
												}
												onSelect={() => {
													const current = level()
													if (current.kind === 'values') {
														props.core.openValue(current.facet, row.value)
													}
												}}
												class="ui-workspace-navigation-item"
											/>
										)}
									</For>
								</Show>
								<Show when={level().kind === 'cohort'}>
									<For each={sourceRows()}>
										{(node) => (
											<RichListItem
												title={node.title}
												description={meta(node)}
												onSelect={() => props.core.openNode(node.id)}
												onHoverChange={(hovering) =>
													props.core.setHighlight(hovering ? node.id : null)
												}
												class={rowClass(node.id)}
											/>
										)}
									</For>
								</Show>
								<Show when={mode() === 'topics'}>
									<For each={topicRows()}>
										{(node) => (
											<RichListItem
												title={node.title}
												description={meta(node)}
												onSelect={() => props.core.openNode(node.id)}
												onHoverChange={(hovering) =>
													props.core.setHighlight(hovering ? node.id : null)
												}
												class={rowClass(node.id)}
											/>
										)}
									</For>
								</Show>
							</WorkspaceNavigationList>
						</div>
					</>
				}
			>
				{(found) => (
					<div class="ib-galaxy-nav-rows">
						<WorkspaceNavigationList label="Filter matches">
							<Show
								when={found().length > 0}
								fallback={<p class="ib-galaxy-nav-empty">No titles match.</p>}
							>
								<For each={found()}>
									{(entry) => (
										<RichListItem
											title={entry.node.title}
											description={
												entry.ancestry
													? `${entry.ancestry} · ${meta(entry.node)}`
													: meta(entry.node)
											}
											onSelect={() => chooseFiltered(entry.node)}
											onHoverChange={(hovering) =>
												props.core.setHighlight(hovering ? entry.node.id : null)
											}
											class={rowClass(entry.node.id)}
										/>
									)}
								</For>
							</Show>
						</WorkspaceNavigationList>
					</div>
				)}
			</Show>
		</div>
	)
}
