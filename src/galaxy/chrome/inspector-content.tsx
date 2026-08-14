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

import { Eyebrow, InspectorHeader, Meter, RichList, RichListItem, Rule } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { createMemo, Errored, For, Loading, Show } from 'solid-js'
import type {
	IBContentSection,
	IBGalaxy,
	IBNode,
	IBNodeContent,
	IBNodeId,
} from '../types.ts'

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

function SectionBody(props: { section: IBContentSection }) {
	const section = props.section
	if (section.kind === 'points') {
		return (
			<div class="ib-galaxy-points">
				<For each={section.points}>
					{(point) => (
						<div class="ib-galaxy-point">
							<Show when={point.text.length > 0}>
								<p>{point.text}</p>
							</Show>
							<For each={point.quotes ?? []}>
								{(quote) => (
									<blockquote>
										{quote.text}
										<Show when={quote.source}>
											{(source) => <cite>{source()}</cite>}
										</Show>
									</blockquote>
								)}
							</For>
						</div>
					)}
				</For>
			</div>
		)
	}
	if (section.kind === 'facets') {
		return (
			<RichList label={section.title}>
				<For each={section.rows}>
					{(row) => (
						<RichListItem
							title={row.label}
							description={row.analysis}
							trailing={
								<span class="ib-galaxy-facet-trailing">
									<Show when={row.badge}>
										{(badge) => (
											<span
												class="ib-galaxy-badge"
												style={
													row.badgeColor
														? { background: row.badgeColor, color: '#fff' }
														: undefined
												}
											>
												{badge()}
											</span>
										)}
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
}) {
	return (
		<div class="ib-galaxy-reader-related">
			<For each={props.entries}>
				{(entry) => (
					<button
						type="button"
						class="ib-galaxy-related-chip"
						onClick={() => props.onVisit(entry.id)}
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
	onVisit: (id: IBNodeId) => void
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
	const largest = createMemo(() =>
		props.galaxy.nodes
			.filter((node) => node.tier === 1)
			.sort((a, b) => b.weight - a.weight)
			.slice(0, 6)
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
				<Rule label={`Largest ${midTier().toLowerCase()}`} />
				<JumpChips entries={largest()} onVisit={props.onVisit} />
			</section>
			<Show when={hottest().length > 0}>
				<section class="ib-galaxy-reader-section">
					<Rule label="Hottest topics" />
					<JumpChips entries={hottest()} onVisit={props.onVisit} />
				</section>
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
	/** Host slot — "open the full drawer" links etc. */
	action?: (node: IBNode) => JSX.Element
}) {
	const tierLabel = createMemo(
		() => props.galaxy.tiers.find((tier) => tier.tier === props.node.tier)?.label ?? '',
	)
	return (
		<>
			<InspectorHeader eyebrow={<Eyebrow>{tierLabel()}</Eyebrow>} title={props.node.title}>
				<p class="ib-galaxy-node-stats">
					{props.node.weight} {props.galaxy.weightLabel}
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
													<SectionBody section={section} />
												</section>
											)}
										</For>
										<Show when={(content().related?.length ?? 0) > 0}>
											<section class="ib-galaxy-reader-section">
												<Rule label="Related" />
												<JumpChips entries={content().related ?? []} onVisit={props.onVisit} />
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
