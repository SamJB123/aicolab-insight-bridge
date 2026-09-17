/**
 * The Brief's building blocks: a node's claim and description as the pipeline
 * wrote them, a facts strip of live figures, and the chips that open the
 * record. Reader vocabulary comes from the surface, never from the database.
 */
import { For, Show } from 'solid-js'
import { FacetDistribution, type Hover, PositionBar } from './figures.tsx'
import { n, plural, useBriefSurface } from './surface.tsx'
import type { BriefData, BriefNode, BriefTopic } from './types.ts'

/** A topic chip: subject only, opens the topic, lights with the page's hover. */
export function TopicChip(props: { d: BriefData; id: number; hover?: Hover; full?: boolean }) {
	const s = useBriefSurface()
	const t = () => props.d.topics[props.id]
	return (
		<Show when={t()}>
			{(t) => (
				<button
					type="button"
					class={[
						'ib-bp-chip ib-bp-chip-topic',
						{ 'is-active': props.hover?.active() === props.id },
					]}
					onMouseEnter={() => props.hover?.set(props.id)}
					onMouseLeave={() => props.hover?.set(null)}
					onClick={() => s.openTopic(props.id)}
					title={`${t().title} · ${plural(t().sources, s.vocabulary.source)}`}
				>
					{props.full ? t().title : t().subject}
				</button>
			)}
		</Show>
	)
}

export function SourceChip(props: { id: string; name: string; detail?: string | null }) {
	const s = useBriefSurface()
	return (
		<button
			type="button"
			class="ib-bp-chip ib-bp-chip-source"
			onClick={() => s.openSource(props.id)}
			title={props.detail ?? undefined}
		>
			{props.name}
		</button>
	)
}

/** The pipeline's title, split: subject as the heading, claim as the line beneath. */
export function Claim(props: { node: BriefNode | BriefTopic }) {
	return (
		<Show when={props.node.claim} fallback={<p class="ib-bp-claim is-empty">{props.node.title}</p>}>
			<p class="ib-bp-claim">{props.node.claim}</p>
		</Show>
	)
}

/**
 * Live facts for any node: the position mix, then ONE row per declared facet,
 * then the most-cited contributors. An ordinal facet draws as a distribution
 * and a nominal one as shares, which is why a corpus with an era gets a
 * sparkline without the app asking for one.
 */
export function FactsStrip(props: { d: BriefData; node: BriefNode; compact?: boolean }) {
	const sharesFor = (key: string) => props.node.facets.filter((f) => f.facet === key)
	return (
		<dl class={['ib-bp-facts', { 'is-compact': !!props.compact }]}>
			<div class="ib-bp-fact">
				<dt>Positions</dt>
				<dd>
					<span class="ib-bp-fact-bar">
						<PositionBar positions={props.node.positions} height="7px" />
					</span>
					{/* Only a run whose positions are about agreement gets this
					    sentence; for any other scale the bar and its legend are
					    the whole truth. */}
					<Show when={props.d.agreementAxis} fallback={<span>{plural(props.node.stances, 'position')}</span>}>
						<span>
							{props.node.supportivePct}% supportive · {n(props.node.contesting)} contesting ·{' '}
							{n(props.node.unclear)} unclear
						</span>
					</Show>
				</dd>
			</div>
			<For each={props.d.facets}>
				{(f) => {
					const shares = () => sharesFor(f.key)
					const shown = () => shares().slice(0, props.compact ? 2 : 3)
					return (
						<Show when={shares().length}>
							<div class="ib-bp-fact">
								<dt>{f.label}</dt>
								<dd>
									<Show when={!f.ordinal} fallback={<FacetDistribution shares={shares()} />}>
										<For each={shown()}>
											{(v, i) => (
												<>
													{i() > 0 ? ' · ' : ''}
													{v.value} <span class="ib-bp-fact-pct">{v.pct}%</span>
												</>
											)}
										</For>
										<Show when={shares().length > shown().length}>
											{' '}
											<span class="ib-bp-fact-more">+{shares().length - shown().length}</span>
										</Show>
									</Show>
								</dd>
							</div>
						</Show>
					)
				}}
			</For>
			<Show when={!props.compact && props.node.contributors.length}>
				<div class="ib-bp-fact">
					<dt>Most-cited</dt>
					<dd class="ib-bp-fact-chips">
						<For each={props.node.contributors.slice(0, 3)}>
							{(c) => (
								<SourceChip
									id={c.entityId}
									name={c.name.length > 56 ? `${c.name.slice(0, 54)}…` : c.name}
									detail={c.detail}
								/>
							)}
						</For>
						<Show when={props.node.contributorTotal > 3}>
							<span class="ib-bp-fact-more">+{props.node.contributorTotal - 3}</span>
						</Show>
					</dd>
				</div>
			</Show>
		</dl>
	)
}

/** The scale line under a heading: "12 themes · 187 topics · 1,488 sources · 8,705 positions". */
export function ScaleLine(props: { node: BriefNode; themes?: number; kicker?: string }) {
	const s = useBriefSurface()
	return (
		<div class="ib-bp-scale">
			<Show when={props.kicker}>
				<span class="ib-bp-scale-kicker">{props.kicker}</span>
			</Show>
			<Show when={props.themes != null}>
				<span>{plural(props.themes ?? 0, 'theme')}</span>
			</Show>
			<Show when={props.node.kind !== 'topic'}>
				<span>{plural(props.node.topics, 'topic')}</span>
			</Show>
			<span>{plural(props.node.sources, s.vocabulary.source, s.vocabulary.sources)}</span>
			<span>{plural(props.node.stances, 'position')}</span>
		</div>
	)
}
