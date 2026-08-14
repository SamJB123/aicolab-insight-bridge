/**
 * The navigator — the left rail as a CONTEXTUAL DRILL-DOWN (settled after a
 * UX research round, 2026-08-14): the panel always shows exactly ONE level —
 * the current context's children — with an anchored context header and an
 * explicit way back. Hub-and-spoke, the pattern that tests least confusing
 * on narrow panels; the 3D galaxy supplies the global context a drill-down
 * normally loses, and the panel's level is derived from (never parallel to)
 * the camera's semantic zoom: choosing a row both drills the panel and
 * flies the camera.
 *
 * Progressive disclosure rules the row count: 5–20 families/groups at root,
 * a family's handful of groups, a constellation's topics — never the whole
 * corpus. Rows carry information scent (child counts on containers, reach on
 * leaves). A type-to-filter field at the top cuts across all tiers for
 * known-item finding without leaving the panel.
 */

import { Eyebrow, RichListItem, Rule, TextInput, WorkspaceNavigationList } from '@aicolab/ui-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { primaryParents } from '../layout/cosmos.ts'
import type { IBGalaxy, IBNode, IBNodeId } from '../types.ts'
import { DEFAULT_GALAXY_SORT, GalaxySortControl, sortRows } from './sort-control.tsx'

const FILTER_LIMIT = 24

export interface GalaxyNavigatorProps {
	galaxy: IBGalaxy
	/** Corpus display name — the root context's title. */
	title: string
	focused: IBNode | null
	selected: IBNode | null
	/** Scene pointer hover, mirrored INTO the panel (the matching row tints). */
	hovered?: IBNode | null
	/** Drill + fly (the one gesture). */
	onChoose: (node: IBNode) => void
	/** Back to the whole galaxy. */
	onRoot: () => void
	/** Row hover, mirrored OUT to the scene (null on leave). */
	onHoverNode?: (id: IBNodeId | null) => void
}

export function GalaxyNavigator(props: GalaxyNavigatorProps) {
	const [query, setQuery] = createSignal('')

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
	const hasSources = createMemo(() => props.galaxy.nodes.some((node) => node.tier === -1))
	/** ALL member sources per topic (every membership edge, not just primary). */
	const sourcesOf = createMemo(() => {
		const map = new Map<IBNodeId, IBNode[]>()
		if (!hasSources()) return map
		const byId = nodesById()
		for (const edge of props.galaxy.edges) {
			const child = byId.get(edge.child)
			if (child?.tier !== -1) continue
			const list = map.get(edge.parent)
			if (list) list.push(child)
			else map.set(edge.parent, [child])
		}
		return map
	})
	const tierPlural = (tier: number): string =>
		props.galaxy.tiers.find((entry) => entry.tier === tier)?.labelPlural ?? ''
	const tierSingular = (tier: number): string =>
		props.galaxy.tiers.find((entry) => entry.tier === tier)?.label ?? ''

	/** The current drill level, derived from the camera/selection state.
	 * Choosing a topic drills one further, into its member sources (any
	 * membership, not just primary) — when the corpus carries sources. */
	const level = createMemo(
		(): { kind: 'root' | 'family' | 'topics' | 'sources'; anchor: IBNode | null } => {
			if (hasSources()) {
				if (props.selected?.tier === 0) return { kind: 'sources', anchor: props.selected }
				if (props.selected?.tier === -1) {
					const topicId = parents().get(props.selected.id)
					const topic = topicId !== undefined ? nodesById().get(topicId) : undefined
					if (topic) return { kind: 'sources', anchor: topic }
				}
			}
			if (props.focused) return { kind: 'topics', anchor: props.focused }
			if (props.selected?.tier === 2) return { kind: 'family', anchor: props.selected }
			return { kind: 'root', anchor: null }
		},
	)

	// The reader's ordering — never weight-descending by default (the Respect
	// principles: reach must not be the implicit ranking).
	const [sort, setSort] = createSignal(DEFAULT_GALAXY_SORT)
	const rows = createMemo((): IBNode[] => {
		const current = level()
		const ordered = (list: IBNode[]): IBNode[] =>
			sortRows(list, sort(), (node) => node.title, (node) => node.weight)
		if (current.kind === 'sources') {
			const anchor = current.anchor
			return ordered(anchor ? (sourcesOf().get(anchor.id) ?? []) : [])
		}
		if (current.kind === 'topics') {
			return ordered(
				props.galaxy.nodes.filter(
					(node) => node.tier === 0 && parents().get(node.id) === current.anchor?.id,
				),
			)
		}
		if (current.kind === 'family') {
			return ordered(
				props.galaxy.nodes.filter(
					(node) => node.tier === 1 && parents().get(node.id) === current.anchor?.id,
				),
			)
		}
		const rootTier = hasFamilies() ? 2 : 1
		return ordered(props.galaxy.nodes.filter((node) => node.tier === rootTier))
	})

	/** The row's DESCRIPTION line — information scent in the rich-list's own
	 * single-column anatomy (its ink comes from the resolver, so contrast is
	 * the DS's problem, not ours). Containers advertise what's inside via the
	 * DIRECT-children count, computed here (adapters' childCount may count a
	 * different tier — legal's families carry their topic totals); leaves
	 * advertise reach plus the corpus score where one exists. */
	const meta = (node: IBNode): string => {
		if (node.tier > 0) {
			const count = childCounts().get(node.id) ?? node.childCount ?? 0
			const label = count === 1 ? tierSingular(node.tier - 1) : tierPlural(node.tier - 1)
			return `${count} ${label.toLowerCase()}`
		}
		const score = node.intensityLabel ? ` · ${node.intensityLabel}` : ''
		const weightLabel =
			props.galaxy.tiers.find((meta) => meta.tier === node.tier)?.weightLabel ??
			props.galaxy.weightLabel
		return `${node.weight} ${weightLabel}${score}`
	}

	const back = (): void => {
		const current = level()
		if ((current.kind === 'topics' || current.kind === 'sources') && current.anchor) {
			const parentId = parents().get(current.anchor.id)
			const parent = parentId !== undefined ? nodesById().get(parentId) : undefined
			if (parent) {
				props.onChoose(parent)
				return
			}
		}
		props.onRoot()
	}
	const backLabel = createMemo((): string => {
		const current = level()
		if ((current.kind === 'topics' || current.kind === 'sources') && current.anchor) {
			const parentId = parents().get(current.anchor.id)
			const parent = parentId !== undefined ? nodesById().get(parentId) : undefined
			if (parent) return parent.title
		}
		return props.title
	})

	const matches = createMemo(() => {
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
			.filter((node) => node.title.toLowerCase().includes(needle))
			.sort((a, b) => b.tier - a.tier || b.weight - a.weight)
			.slice(0, FILTER_LIMIT)
			.map((node) => ({ node, ancestry: ancestry(node) }))
	})
	const choose = (node: IBNode): void => {
		setQuery('')
		props.onChoose(node)
	}

	return (
		<div class="ib-galaxy-navigator">
			<TextInput
				type="search"
				value={query()}
				onInput={(event) => setQuery(event.currentTarget.value)}
				placeholder="Filter the corpus…"
				aria-label="Filter the corpus"
			/>
			<Show
				when={matches()}
				fallback={
					<>
						<Show when={level().kind !== 'root'}>
							<button type="button" class="ib-galaxy-nav-back" onClick={back}>
								<span aria-hidden="true">‹</span> {backLabel()}
							</button>
						</Show>
						<div class="ib-galaxy-nav-context">
							<Eyebrow>
								{level().kind === 'root'
									? tierPlural(hasFamilies() ? 2 : 1)
									: tierPlural(
											level().kind === 'family' ? 1 : level().kind === 'topics' ? 0 : -1,
										)}
							</Eyebrow>
							<strong>{level().anchor?.title ?? props.title}</strong>
						</div>
						<div class="ib-galaxy-nav-sort">
							<GalaxySortControl sort={sort()} onChange={setSort} />
						</div>
						<Rule />
						<div class="ib-galaxy-nav-rows">
							<WorkspaceNavigationList label="Current level">
								<For each={rows()}>
									{(node) => (
										<RichListItem
											title={node.title}
											description={meta(node)}
											selected={
												props.selected?.id === node.id || props.focused?.id === node.id
											}
											onSelect={() => props.onChoose(node)}
											onHoverChange={(hovering) =>
												props.onHoverNode?.(hovering ? node.id : null)
											}
											class={{
												'ui-workspace-navigation-item': true,
												'ib-galaxy-nav-hot': props.hovered?.id === node.id,
											}}
										/>
									)}
								</For>
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
											description={entry.ancestry ? `${entry.ancestry} · ${meta(entry.node)}` : meta(entry.node)}
											onSelect={() => choose(entry.node)}
											onHoverChange={(hovering) =>
												props.onHoverNode?.(hovering ? entry.node.id : null)
											}
											class={{
												'ui-workspace-navigation-item': true,
												'ib-galaxy-nav-hot': props.hovered?.id === entry.node.id,
											}}
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
