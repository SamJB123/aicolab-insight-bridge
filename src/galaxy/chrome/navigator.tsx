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
import { primaryParents } from '../layout/spiral-seed.ts'
import type { IBGalaxy, IBNode, IBNodeId } from '../types.ts'

const FILTER_LIMIT = 24

export interface GalaxyNavigatorProps {
	galaxy: IBGalaxy
	/** Corpus display name — the root context's title. */
	title: string
	focused: IBNode | null
	selected: IBNode | null
	/** Drill + fly (the one gesture). */
	onChoose: (node: IBNode) => void
	/** Back to the whole galaxy. */
	onRoot: () => void
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
	const tierPlural = (tier: number): string =>
		props.galaxy.tiers.find((entry) => entry.tier === tier)?.labelPlural ?? ''
	const tierSingular = (tier: number): string =>
		props.galaxy.tiers.find((entry) => entry.tier === tier)?.label ?? ''

	/** The current drill level, derived from the camera/selection state. */
	const level = createMemo((): { kind: 'root' | 'family' | 'topics'; anchor: IBNode | null } => {
		if (props.focused) return { kind: 'topics', anchor: props.focused }
		if (props.selected?.tier === 2) return { kind: 'family', anchor: props.selected }
		return { kind: 'root', anchor: null }
	})

	const rows = createMemo((): IBNode[] => {
		const current = level()
		const byWeight = (a: IBNode, b: IBNode) => b.weight - a.weight
		if (current.kind === 'topics') {
			return props.galaxy.nodes
				.filter((node) => node.tier === 0 && parents().get(node.id) === current.anchor?.id)
				.sort(byWeight)
		}
		if (current.kind === 'family') {
			return props.galaxy.nodes
				.filter((node) => node.tier === 1 && parents().get(node.id) === current.anchor?.id)
				.sort(byWeight)
		}
		const rootTier = hasFamilies() ? 2 : 1
		return props.galaxy.nodes.filter((node) => node.tier === rootTier).sort(byWeight)
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
		return `${node.weight} ${props.galaxy.weightLabel}${score}`
	}

	const back = (): void => {
		const current = level()
		if (current.kind === 'topics' && current.anchor) {
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
		if (current.kind === 'topics' && current.anchor) {
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
									: tierPlural(level().kind === 'family' ? 1 : 0)}
							</Eyebrow>
							<strong>{level().anchor?.title ?? props.title}</strong>
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
											class="ui-workspace-navigation-item"
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
											class="ui-workspace-navigation-item"
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
