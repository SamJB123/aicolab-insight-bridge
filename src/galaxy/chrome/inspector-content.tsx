/**
 * Inspector content — what the workspace's ResponsiveInspector shows.
 *
 * RESTING (nothing selected): the corpus at a glance — census, the largest
 * groups and (where the corpus has a real score) the hottest topics as jump
 * links that fly the camera.
 *
 * BOUND (a node selected): the reading surface — InspectorHeader, stats,
 * stance mix, flags, then the real drawer content through the IBNodeContent
 * contract (key points with verbatim quotes, lens tables, entity lists,
 * related links), loaded under a Loading boundary.
 */

import {
	Accordion,
	AccordionItem,
	Eyebrow,
	InspectorHeader,
	Meter,
	RichList,
	RichListItem,
	Rule,
} from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { createMemo, createSignal, Errored, For, Loading, Show } from 'solid-js'
import { facetPalette, facetValues } from '../facets.ts'
import type {
	IBContentSection,
	IBGalaxy,
	IBNode,
	IBNodeContent,
	IBNodeId,
	IBPoint,
	IBQuote,
} from '../types.ts'
import { DEFAULT_GALAXY_SORT, GalaxySortControl, sortRows } from './sort-control.tsx'

function MixBar(props: { galaxy: IBGalaxy; node: IBNode }) {
	const segments = () => {
		const mix = props.node.mix
		if (!mix) return []
		const order = props.galaxy.mixOrder ?? Object.keys(mix)
		const total = order.reduce((sum, key) => sum + (mix[key] ?? 0), 0)
		if (total === 0) return []
		return order
			.filter((key) => (mix[key] ?? 0) > 0)
			.map((key) => ({
				key,
				share: ((mix[key] ?? 0) / total) * 100,
				color: props.galaxy.mixColors?.[key] ?? 'var(--color-base-content-faint)',
			}))
	}
	return (
		<Show when={segments().length > 0}>
			<div class="ib-galaxy-mix" role="img" aria-label="Stance mix">
				<For each={segments()}>
					{(segment) => (
						<span
							style={{ 'inline-size': `${segment.share}%`, background: segment.color }}
							title={segment.key}
						/>
					)}
				</For>
			</div>
		</Show>
	)
}

function Quotes(props: { quotes: IBQuote[] | undefined }) {
	return (
		<For each={props.quotes ?? []}>
			{(quote) => (
				<blockquote>
					{quote.text}
					<Show when={quote.source}>{(source) => <cite>{source()}</cite>}</Show>
				</blockquote>
			)}
		</For>
	)
}

/** Key points as an exclusive-open accordion — headline as the summary, the
 * elaboration and that point's verbatim quotes inside; the first point
 * starts open so something is always readable without a click (settled
 * 2026-08-15). */
function PointsSection(props: { points: IBPoint[]; label: string }) {
	return (
		<Accordion density="compact" spacing="joined" label={props.label}>
			<For each={props.points}>
				{(point, at) => (
					<Show
						when={point.text.length > 0}
						fallback={
							<div class="ib-galaxy-point">
								<Quotes quotes={point.quotes} />
							</div>
						}
					>
						<AccordionItem summary={point.text} open={at() === 0}>
							<div class="ib-galaxy-point">
								<Show when={point.detail}>{(detail) => <p>{detail()}</p>}</Show>
								<Quotes quotes={point.quotes} />
							</div>
						</AccordionItem>
					</Show>
				)}
			</For>
		</Accordion>
	)
}

function FacetBadge(props: { badge: string; badgeColor?: string }) {
	return (
		<span
			class="ib-galaxy-badge"
			style={props.badgeColor ? { background: props.badgeColor, color: '#fff' } : undefined}
		>
			{props.badge}
		</span>
	)
}

/** Actionable child-node rows with the reader's A–Z/reach ordering — never
 * pre-ranked (the Respect principles). Choosing a row flies there; hovering
 * highlights its body in the scene. */
function NodesSection(props: {
	section: Extract<IBContentSection, { kind: 'nodes' }>
	onVisit: (id: IBNodeId) => void
	onHoverNode?: (id: IBNodeId | null) => void
}) {
	const [sort, setSort] = createSignal(DEFAULT_GALAXY_SORT)
	const rows = createMemo(() =>
		sortRows(props.section.rows, sort(), (row) => row.label, (row) => row.weight ?? 0),
	)
	return (
		<>
			<div class="ib-galaxy-nodes-head">
				<GalaxySortControl sort={sort()} onChange={setSort} />
			</div>
			<RichList label={props.section.title}>
				<For each={rows()}>
					{(row) => (
						<RichListItem
							title={row.label}
							description={row.detail}
							onSelect={() => props.onVisit(row.id)}
							onHoverChange={(hovering) => props.onHoverNode?.(hovering ? row.id : null)}
						/>
					)}
				</For>
			</RichList>
		</>
	)
}

function SectionBody(props: {
	section: IBContentSection
	onVisit: (id: IBNodeId) => void
	onHoverNode?: (id: IBNodeId | null) => void
}) {
	const section = props.section
	if (section.kind === 'points') {
		return <PointsSection points={section.points} label={section.title} />
	}
	if (section.kind === 'nodes') {
		return (
			<NodesSection section={section} onVisit={props.onVisit} onHoverNode={props.onHoverNode} />
		)
	}
	if (section.kind === 'facets') {
		// Rows carrying analysis read as an accordion (badge in the summary,
		// analysis inside, first open); badge-only rows stay a plain list.
		if (section.rows.some((row) => row.analysis)) {
			return (
				<Accordion density="compact" spacing="joined" label={section.title}>
					<For each={section.rows}>
						{(row, at) => (
							<AccordionItem
								summary={() => (
									<span class="ib-galaxy-acc-summary">
										<span class="ib-galaxy-acc-label">{row.label}</span>
										<Show when={row.badge}>
											{(badge) => <FacetBadge badge={badge()} badgeColor={row.badgeColor} />}
										</Show>
									</span>
								)}
								open={at() === 0}
							>
								<div class="ib-galaxy-point">
									<Show when={row.analysis}>{(analysis) => <p>{analysis()}</p>}</Show>
								</div>
							</AccordionItem>
						)}
					</For>
				</Accordion>
			)
		}
		return (
			<RichList label={section.title}>
				<For each={section.rows}>
					{(row) => (
						<RichListItem
							title={row.label}
							trailing={
								<span class="ib-galaxy-facet-trailing">
									<Show when={row.badge}>
										{(badge) => <FacetBadge badge={badge()} badgeColor={row.badgeColor} />}
									</Show>
									<Show when={row.share !== undefined}>
										<Meter value={(row.share ?? 0) * 100} max={100} />
									</Show>
								</span>
							}
						/>
					)}
				</For>
			</RichList>
		)
	}
	const max = Math.max(1, ...section.rows.map((row) => row.max ?? row.count ?? 0))
	return (
		<RichList label={section.title}>
			<For each={section.rows}>
				{(row) => (
					<RichListItem
						title={row.label}
						description={row.detail}
						trailing={
							<Show when={row.count !== undefined}>
								<span class="ib-galaxy-entity-trailing">
									<span>{row.count}</span>
									<Meter value={row.count ?? 0} max={row.max ?? max} />
								</span>
							</Show>
						}
					/>
				)}
			</For>
		</RichList>
	)
}

function JumpChips(props: {
	entries: Array<{ id: IBNodeId; label: string }>
	onVisit: (id: IBNodeId) => void
	/** Chip hover mirrored into the scene (null on leave). */
	onHoverNode?: (id: IBNodeId | null) => void
}) {
	return (
		<div class="ib-galaxy-reader-related">
			<For each={props.entries}>
				{(entry) => (
					<button
						type="button"
						class="ib-galaxy-related-chip"
						onClick={() => props.onVisit(entry.id)}
						onPointerEnter={() => props.onHoverNode?.(entry.id)}
						onPointerLeave={() => props.onHoverNode?.(null)}
					>
						{entry.label}
					</button>
				)}
			</For>
		</div>
	)
}

export function GalaxyInspectorOverview(props: {
	galaxy: IBGalaxy
	title: string
	/** Bench/status note (e.g. "fixture data"). */
	note?: string
	/** The active colour-by lens — its value swatches key the source dust. */
	activeFacet?: string
	onVisit: (id: IBNodeId) => void
	onHoverNode?: (id: IBNodeId | null) => void
}) {
	const census = createMemo(() =>
		props.galaxy.tiers
			.map((tier) => {
				const count = props.galaxy.nodes.filter((node) => node.tier === tier.tier).length
				return `${count} ${tier.labelPlural.toLowerCase()}`
			})
			.join(' · '),
	)
	const midTier = createMemo(
		() => props.galaxy.tiers.find((tier) => tier.tier === 1)?.labelPlural ?? 'Groups',
	)
	// Entry points under the READER'S ordering, never "largest first" — the
	// Respect principles bar the package from pre-ranking by popularity.
	const [themeSort, setThemeSort] = createSignal(DEFAULT_GALAXY_SORT)
	const themeEntries = createMemo(() =>
		sortRows(
			props.galaxy.nodes.filter((node) => node.tier === 1),
			themeSort(),
			(node) => node.title,
			(node) => node.weight,
		)
			.slice(0, 8)
			.map((node) => ({ id: node.id, label: node.title })),
	)
	const hottest = createMemo(() => {
		if (props.galaxy.intensityLabel === undefined) return []
		return props.galaxy.nodes
			.filter((node) => node.tier === 0 && node.intensity !== undefined)
			.sort((a, b) => (b.intensity ?? 0) - (a.intensity ?? 0))
			.slice(0, 5)
			.map((node) => ({ id: node.id, label: node.title }))
	})
	// The active lens's key: value → swatch, matching the dust colours exactly
	// (same palette function the engine uses).
	const facetKey = createMemo(() => {
		const key = props.activeFacet
		if (key === undefined) return null
		const label = props.galaxy.sourceFacets?.find((facet) => facet.key === key)?.label
		const palette = [...facetPalette(facetValues(props.galaxy, key)).entries()]
		if (palette.length === 0) return null
		return { label: label ?? key, palette }
	})
	return (
		<>
			<InspectorHeader eyebrow={<Eyebrow>Corpus</Eyebrow>} title={props.title}>
				<p class="ib-galaxy-node-stats">{census()}</p>
				<p class="ib-galaxy-node-stats">
					size — {props.galaxy.weightLabel}
					<Show when={props.galaxy.intensityLabel !== undefined}>
						{' '}
						· heat — {props.galaxy.intensityLabel}
					</Show>
				</p>
				<Show when={props.note}>{(note) => <p class="ib-galaxy-overview-note">{note()}</p>}</Show>
			</InspectorHeader>
			<section class="ib-galaxy-reader-section">
				<Rule label={midTier()} />
				<div class="ib-galaxy-nodes-head">
					<GalaxySortControl sort={themeSort()} onChange={setThemeSort} />
				</div>
				<JumpChips
					entries={themeEntries()}
					onVisit={props.onVisit}
					onHoverNode={props.onHoverNode}
				/>
			</section>
			<Show when={hottest().length > 0}>
				<section class="ib-galaxy-reader-section">
					<Rule label="Hottest topics" />
					<JumpChips entries={hottest()} onVisit={props.onVisit} onHoverNode={props.onHoverNode} />
				</section>
			</Show>
			<Show when={facetKey()}>
				{(legend) => (
					<section class="ib-galaxy-reader-section">
						<Rule label={`Sources by ${legend().label.toLowerCase()}`} />
						<ul class="ib-galaxy-facet-legend">
							<For each={legend().palette}>
								{([value, swatch]) => (
									<li>
										<span
											class="ib-galaxy-facet-swatch"
											style={{ background: swatch }}
											aria-hidden="true"
										/>
										{value}
									</li>
								)}
							</For>
						</ul>
					</section>
				)}
			</Show>
		</>
	)
}

export function GalaxyInspectorNode(props: {
	galaxy: IBGalaxy
	node: IBNode
	/** An async computation's read (a memo over the host's loadContent):
	 * not-ready reads suspend into the Loading boundary below. */
	content: () => IBNodeContent | null
	onVisit: (id: IBNodeId) => void
	onClear: () => void
	onHoverNode?: (id: IBNodeId | null) => void
	/** Host slot — "open the full drawer" links etc. */
	action?: (node: IBNode) => JSX.Element
}) {
	const tierMeta = createMemo(() =>
		props.galaxy.tiers.find((tier) => tier.tier === props.node.tier),
	)
	const tierLabel = createMemo(() => tierMeta()?.label ?? '')
	return (
		<>
			<InspectorHeader eyebrow={<Eyebrow>{tierLabel()}</Eyebrow>} title={props.node.title}>
				<p class="ib-galaxy-node-stats">
					{props.node.weight} {tierMeta()?.weightLabel ?? props.galaxy.weightLabel}
					<Show when={props.node.intensityLabel !== undefined}>
						{' '}
						· {props.node.intensityLabel}
					</Show>
				</p>
				<MixBar galaxy={props.galaxy} node={props.node} />
				<Show when={(props.node.flags?.length ?? 0) > 0}>
					<div class="ib-galaxy-node-flags">
						<For each={props.node.flags}>
							{(flag) => (
								<span class={['ib-galaxy-flag', { 'ib-galaxy-flag-hot': flag.hot === true }]}>
									{flag.label}
								</span>
							)}
						</For>
					</div>
				</Show>
				<div class="ib-galaxy-inspector-actions">
					{props.action?.(props.node)}
					<button
						type="button"
						class="ib-galaxy-related-chip"
						onClick={() => props.onClear()}
					>
						Back to overview
					</button>
				</div>
			</InspectorHeader>
			<Errored
				fallback={(err) => (
					<p class="ib-galaxy-reader-error">Couldn't load this node: {String(err())}</p>
				)}
			>
				<Loading fallback={<p class="ib-galaxy-reader-pending">Reading the corpus…</p>}>
					{(() => {
						const value = props.content()
						return (
							<Show when={value}>
								{(content) => (
									<>
										<Show when={content().lede}>
											{(lede) => <p class="ib-galaxy-reader-lede">{lede()}</p>}
										</Show>
										<Show when={(content().stats?.length ?? 0) > 0}>
											<div class="ib-galaxy-reader-stats">
												<For each={content().stats}>
													{(stat) => (
														<span class="ib-galaxy-badge">
															<strong>{stat.value}</strong> {stat.label}
														</span>
													)}
												</For>
											</div>
										</Show>
										<For each={content().sections}>
											{(section) => (
												<section class="ib-galaxy-reader-section">
													<Rule label={section.title} />
													<SectionBody
														section={section}
														onVisit={props.onVisit}
														onHoverNode={props.onHoverNode}
													/>
												</section>
											)}
										</For>
										<Show when={(content().related?.length ?? 0) > 0}>
											<section class="ib-galaxy-reader-section">
												<Rule label="Related" />
												<JumpChips
													entries={content().related ?? []}
													onVisit={props.onVisit}
													onHoverNode={props.onHoverNode}
												/>
											</section>
										</Show>
									</>
								)}
							</Show>
						)
					})()}
				</Loading>
			</Errored>
		</>
	)
}
