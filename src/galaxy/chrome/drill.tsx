/**
 * The drill — the inspector's RESTING surface (settled 2026-08-16, IA
 * reform): the proven contextual drill-down (one level at a time, anchored
 * context header, ‹ back, type-to-filter) moved from the left rail into the
 * right bar, now covering BOTH navigation structures:
 *
 *   topics mode:  families → superclusters → topics
 *   sources mode: facets → values → sources
 *
 * Drill state lives in GalaxyMap and SURVIVES selection — the reader
 * replaces this surface while a node is selected, and "Back to overview"
 * returns here exactly where you left it. Camera coupling is full: every
 * row press reports upward and GalaxyMap flies/selects/spotlights.
 *
 * Ordering follows the de-ranking convention: topic-structure lists carry
 * the reversible A–Z/Reach control; the source list is filter-only A–Z.
 */

import { Eyebrow, RichListItem, Rule, TextInput, WorkspaceNavigationList } from '@aicolab/ui-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { facetPalette, facetValues } from '../facets.ts'
import { primaryParents } from '../layout/cosmos.ts'
import type { IBGalaxy, IBNode, IBNodeId, IBSourceFacet } from '../types.ts'
import type { GalaxyMode } from './menu.tsx'
import { DEFAULT_GALAXY_SORT, GalaxySortControl, sortRows } from './sort-control.tsx'

const FILTER_LIMIT = 24

export interface TopicPath {
	family: IBNodeId | null
	group: IBNodeId | null
}
export interface SourcePath {
	facet: string | null
	value: string | null
}

export function GalaxyDrill(props: {
	galaxy: IBGalaxy
	title: string
	mode: GalaxyMode
	topicPath: TopicPath
	sourcePath: SourcePath
	hovered: IBNode | null
	/** Structure rows: drill + fly (family/group) or select (topic/source). */
	onPickNode: (node: IBNode) => void
	onPickFacet: (facet: IBSourceFacet) => void
	onPickValue: (value: string) => void
	onBack: () => void
	onHoverNode: (id: IBNodeId | null) => void
}) {
	const [query, setQuery] = createSignal('')
	const [sort, setSort] = createSignal(DEFAULT_GALAXY_SORT)

	const parents = createMemo(() => primaryParents(props.galaxy))
	const nodesById = createMemo(() => {
		const map = new Map<IBNodeId, IBNode>()
		for (const node of props.galaxy.nodes) map.set(node.id, node)
		return map
	})
	const childCounts = createMemo(() => {
		const counts = new Map<IBNodeId, number>()
		for (const node of props.galaxy.nodes) {
			const parent = parents().get(node.id)
			if (parent !== undefined) counts.set(parent, (counts.get(parent) ?? 0) + 1)
		}
		return counts
	})
	const hasFamilies = createMemo(() => props.galaxy.nodes.some((node) => node.tier === 2))
	const tierPlural = (tier: number): string =>
		props.galaxy.tiers.find((entry) => entry.tier === tier)?.labelPlural ?? ''
	const tierSingular = (tier: number): string =>
		props.galaxy.tiers.find((entry) => entry.tier === tier)?.label ?? ''
	const weightLabelFor = (tier: number): string =>
		props.galaxy.tiers.find((meta) => meta.tier === tier)?.weightLabel ??
		props.galaxy.weightLabel

	const meta = (node: IBNode): string => {
		if (node.tier > 0) {
			const count = childCounts().get(node.id) ?? node.childCount ?? 0
			const label = count === 1 ? tierSingular(node.tier - 1) : tierPlural(node.tier - 1)
			return `${count} ${label.toLowerCase()}`
		}
		const score = node.intensityLabel ? ` · ${node.intensityLabel}` : ''
		return `${node.weight} ${weightLabelFor(node.tier)}${score}`
	}

	/** The active level, derived from mode + path. */
	const level = createMemo(():
		| { kind: 'families' | 'groups' | 'topics'; anchor: IBNode | null }
		| { kind: 'facets' }
		| { kind: 'values'; facet: IBSourceFacet }
		| { kind: 'sources'; facet: IBSourceFacet; value: string } => {
		if (props.mode === 'sources') {
			const facet = props.galaxy.sourceFacets?.find(
				(entry) => entry.key === props.sourcePath.facet,
			)
			if (!facet) return { kind: 'facets' }
			if (props.sourcePath.value === null) return { kind: 'values', facet }
			return { kind: 'sources', facet, value: props.sourcePath.value }
		}
		const group =
			props.topicPath.group !== null ? nodesById().get(props.topicPath.group) : undefined
		if (group) return { kind: 'topics', anchor: group }
		const family =
			props.topicPath.family !== null ? nodesById().get(props.topicPath.family) : undefined
		if (family) return { kind: 'groups', anchor: family }
		return { kind: hasFamilies() ? 'families' : 'groups', anchor: null }
	})

	const contextTitle = createMemo((): string => {
		const current = level()
		if (current.kind === 'facets') return props.title
		if (current.kind === 'values') return current.facet.label
		if (current.kind === 'sources') return current.value
		return current.anchor?.title ?? props.title
	})
	const contextEyebrow = createMemo((): string => {
		const current = level()
		if (current.kind === 'facets') return 'Facets'
		if (current.kind === 'values') return `${current.facet.label} values`
		if (current.kind === 'sources') return tierPlural(-1)
		if (current.kind === 'families') return tierPlural(2)
		if (current.kind === 'groups') return tierPlural(1)
		return tierPlural(0)
	})
	const showBack = createMemo(() => {
		const current = level()
		if (current.kind === 'facets') return false
		if (current.kind === 'families') return false
		if (current.kind === 'groups') return current.anchor !== null
		return true
	})

	const topicRows = createMemo((): IBNode[] => {
		const current = level()
		const ordered = (list: IBNode[]): IBNode[] =>
			sortRows(list, sort(), (node) => node.title, (node) => node.weight)
		if (current.kind === 'topics') {
			return ordered(
				props.galaxy.nodes.filter(
					(node) => node.tier === 0 && parents().get(node.id) === current.anchor?.id,
				),
			)
		}
		if (current.kind === 'groups') {
			return ordered(
				props.galaxy.nodes.filter(
					(node) =>
						node.tier === 1 &&
						(current.anchor === null || parents().get(node.id) === current.anchor.id),
				),
			)
		}
		if (current.kind === 'families') {
			return ordered(props.galaxy.nodes.filter((node) => node.tier === 2))
		}
		return []
	})

	const valueRows = createMemo((): Array<{ value: string; swatch: string; count: number }> => {
		const current = level()
		if (current.kind !== 'values') return []
		const counts = new Map<string, number>()
		for (const node of props.galaxy.nodes) {
			if (node.tier !== -1) continue
			const value = node.facets?.[current.facet.key]
			if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1)
		}
		const palette = facetPalette(facetValues(props.galaxy, current.facet.key))
		return [...counts.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([value, count]) => ({ value, swatch: palette.get(value) ?? '#888', count }))
	})

	const sourceRows = createMemo((): IBNode[] => {
		const current = level()
		if (current.kind !== 'sources') return []
		const needle = query().trim().toLowerCase()
		return props.galaxy.nodes
			.filter(
				(node) =>
					node.tier === -1 &&
					node.facets?.[current.facet.key] === current.value &&
					(needle.length < 2 || node.title.toLowerCase().includes(needle)),
			)
			.sort((a, b) => a.title.localeCompare(b.title))
	})

	/** Cross-tier filter for topic mode (the old navigator's known-item path). */
	const topicMatches = createMemo(() => {
		if (props.mode !== 'topics') return null
		const needle = query().trim().toLowerCase()
		if (needle.length < 2) return null
		const ancestry = (node: IBNode): string => {
			const chain: string[] = []
			let cursor: IBNode | undefined = node
			for (let hop = 0; hop < 3 && cursor; hop++) {
				const parentId = parents().get(cursor.id)
				cursor = parentId !== undefined ? nodesById().get(parentId) : undefined
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
		props.onPickNode(node)
	}
	const rowClass = (id: IBNodeId): Record<string, boolean> => ({
		'ui-workspace-navigation-item': true,
		'ib-galaxy-nav-hot': props.hovered?.id === id,
	})

	return (
		<div class="ib-galaxy-drill">
			<Show when={props.mode === 'topics' || level().kind === 'sources'}>
				<TextInput
					type="search"
					value={query()}
					onInput={(event) => setQuery(event.currentTarget.value)}
					placeholder={props.mode === 'topics' ? 'Filter the corpus…' : 'Filter sources…'}
					aria-label={props.mode === 'topics' ? 'Filter the corpus' : 'Filter sources'}
				/>
			</Show>
			<Show
				when={topicMatches()}
				fallback={
					<>
						<Show when={showBack()}>
							<button type="button" class="ib-galaxy-nav-back" onClick={() => props.onBack()}>
								<span aria-hidden="true">‹</span> Back
							</button>
						</Show>
						<div class="ib-galaxy-nav-context">
							<Eyebrow>{contextEyebrow()}</Eyebrow>
							<strong>{contextTitle()}</strong>
						</div>
						<Show when={props.mode === 'topics'}>
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
												onSelect={() => props.onPickFacet(facet)}
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
												onSelect={() => props.onPickValue(row.value)}
												class="ui-workspace-navigation-item"
											/>
										)}
									</For>
								</Show>
								<Show when={level().kind === 'sources'}>
									<For each={sourceRows()}>
										{(node) => (
											<RichListItem
												title={node.title}
												description={meta(node)}
												onSelect={() => props.onPickNode(node)}
												onHoverChange={(hovering) =>
													props.onHoverNode(hovering ? node.id : null)
												}
												class={rowClass(node.id)}
											/>
										)}
									</For>
								</Show>
								<Show when={props.mode === 'topics'}>
									<For each={topicRows()}>
										{(node) => (
											<RichListItem
												title={node.title}
												description={meta(node)}
												onSelect={() => props.onPickNode(node)}
												onHoverChange={(hovering) =>
													props.onHoverNode(hovering ? node.id : null)
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
												props.onHoverNode(hovering ? entry.node.id : null)
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
