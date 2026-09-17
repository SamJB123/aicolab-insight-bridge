/**
 * The Brief's figures — every one drawn from BriefData at render time, every
 * one linked to the prose around it: hovering or focusing a topic in one
 * figure lights the same topic in the others and in any chip on the page (a
 * shared Hover), and clicking opens the topic.
 *
 *   PositionBar        the stance mix as a thin stacked strip
 *   ReachBars          topics ranked by how many contributors engage them
 *   Constellation      the same topics as a still of the galaxy sky, from the
 *                      positions baked once per run into `topic_star`
 *   FacetMatrix        who says what: one row per topic, one column per
 *                      position, the facet's values stacked in their cell.
 *                      Rendered once per DECLARED facet, so a run that
 *                      computed two gets two.
 *   FacetDistribution  an ordinal facet (era, period) as a sparkline of where
 *                      the contributors sit along it
 */
import { createMemo, createSignal, For, Show } from 'solid-js'
import { useBriefSurface } from './surface.tsx'
import type { BriefData, BriefStar, BriefTopic, FacetPin, FacetShare } from './types.ts'

export type Hover = { active: () => number | null; set: (id: number | null) => void }
export function createHover(): Hover {
	const [active, set] = createSignal<number | null>(null)
	return { active, set }
}

export const topicsOf = (d: BriefData, ids: number[]): BriefTopic[] => {
	const out: BriefTopic[] = []
	for (const id of ids) {
		const t = d.topics[id]
		if (t) out.push(t)
	}
	return out
}

/** Contested share of a topic's written positions, 0..1. */
export const contestShare = (t: { contesting: number; stances: number }) =>
	t.stances ? t.contesting / t.stances : 0

/* ── position bar ───────────────────────────────────────────────────────── */

export function PositionBar(props: { positions: Record<string, number>; height?: string }) {
	const s = useBriefSurface()
	const total = () => s.positions.reduce((a, p) => a + (props.positions[p] ?? 0), 0) || 1
	return (
		<span class="ib-bp-bar" style={{ height: props.height ?? '8px' }}>
			<For each={s.positions}>
				{(p) => (
					<Show when={props.positions[p]}>
						<span
							style={{
								width: `${(100 * (props.positions[p] ?? 0)) / total()}%`,
								background: s.positionColors[p],
							}}
							title={`${p}: ${props.positions[p]}`}
						/>
					</Show>
				)}
			</For>
		</span>
	)
}

export function PositionLegend() {
	const s = useBriefSurface()
	return (
		<ul class="ib-bp-legend" aria-label="Positions">
			<For each={s.positions}>
				{(p) => (
					<li>
						<span class="ib-bp-legend-dot" style={{ background: s.positionColors[p] }} />
						{p}
					</li>
				)}
			</For>
		</ul>
	)
}

/* ── reach bars ─────────────────────────────────────────────────────────── */

export function ReachBars(props: {
	d: BriefData
	ids: number[]
	hover?: Hover
	limit?: number
	title?: string
}) {
	const s = useBriefSurface()
	const limit = () => props.limit ?? 10
	const topics = createMemo(() => topicsOf(props.d, props.ids))
	const shown = createMemo(() => topics().slice(0, limit()))
	const max = () => Math.max(1, ...shown().map((t) => t.sources))
	return (
		<figure class="ib-bp-rb">
			<Show when={props.title}>
				<figcaption class="ib-bp-fig-k">{props.title}</figcaption>
			</Show>
			<div class="ib-bp-rb-rows">
				<For each={shown()}>
					{(t) => (
						<div
							class={['ib-bp-rb-row', { 'is-active': props.hover?.active() === t.id }]}
							onMouseEnter={() => props.hover?.set(t.id)}
							onMouseLeave={() => props.hover?.set(null)}
						>
							<button
								type="button"
								class="ib-bp-rb-label"
								onClick={() => s.openTopic(t.id)}
								onFocus={() => props.hover?.set(t.id)}
								onBlur={() => props.hover?.set(null)}
								title={t.claim}
							>
								{t.subject}
							</button>
							{/* One bar: its length is reach; on hover the engaged part shows how the positions divide. */}
							<span
								class="ib-bp-rb-track"
								title={`${t.sources} ${s.vocabulary.sources} · ${t.stances} positions`}
							>
								<span class="ib-bp-rb-fill" style={{ width: `${(100 * t.sources) / max()}%` }}>
									<span class="ib-bp-rb-mix" aria-hidden="true">
										<PositionBar positions={t.positions} height="100%" />
									</span>
								</span>
							</span>
							<span class="ib-bp-rb-n">{t.sources}</span>
						</div>
					)}
				</For>
			</div>
			<Show when={topics().length > limit()}>
				<div class="ib-bp-rb-more">
					{topics().length - limit()} more topics, all in the reading below
				</div>
			</Show>
		</figure>
	)
}

/* ── constellation still ────────────────────────────────────────────────── */

type Placed = { t: BriefTopic; star: BriefStar }

export function Constellation(props: {
	d: BriefData
	ids: number[]
	hover?: Hover
	ratio?: number
	label?: string
	lit?: (id: number) => boolean
}) {
	const s = useBriefSurface()
	const W = 100
	const H = () => 100 / (props.ratio ?? 1.25)
	const placed = createMemo(() => {
		const out: Placed[] = []
		for (const t of topicsOf(props.d, props.ids)) if (t.star) out.push({ t, star: t.star })
		if (out.length === 0)
			return { pts: [] as { p: Placed; x: number; y: number; r: number }[], h: H() }
		let x0 = 1
		let x1 = 0
		let y0 = 1
		let y1 = 0
		for (const { star } of out) {
			x0 = Math.min(x0, star.x)
			x1 = Math.max(x1, star.x)
			y0 = Math.min(y0, star.y)
			y1 = Math.max(y1, star.y)
		}
		const m = 9
		const dx = Math.max(x1 - x0, 0.02)
		const dy = Math.max(y1 - y0, 0.02)
		const scale = Math.min((W - 2 * m) / dx, (H() - 2 * m) / dy)
		const ox = (W - scale * dx) / 2
		const oy = (H() - scale * dy) / 2
		const maxR = Math.max(0.05, ...out.map(({ star }) => star.r))
		// Star size scales with the crowd: a sky of 120 topics draws small stars,
		// a sky of 7 draws large ones, and √reach separates them within a figure.
		const base = Math.min(3, Math.max(0.75, 11 / Math.sqrt(out.length)))
		const pts = out.map((p) => ({
			p,
			x: ox + (p.star.x - x0) * scale,
			y: oy + (p.star.y - y0) * scale,
			r: base * (0.3 + 0.7 * Math.sqrt(p.star.r / maxR)),
		}))
		pts.sort((a, b) => b.r - a.r)
		return { pts, h: H() }
	})
	const pointed = createMemo(() => {
		const id = props.hover?.active()
		return id == null ? undefined : placed().pts.find((q) => q.p.t.id === id)
	})
	return (
		<span class="ib-bp-cst-wrap">
			<svg
				class="ib-bp-cst"
				viewBox={`0 0 ${W} ${placed().h}`}
				role="img"
				aria-label={props.label ?? 'The topics as stars in the galaxy'}
			>
				<For each={placed().pts}>
					{({ p, x, y, r }) => {
						const c = contestShare(p.t)
						const lit = () => (props.lit ? props.lit(p.t.id) : true)
						return (
							<g
								class={[
									'ib-bp-cst-star',
									{ 'is-active': props.hover?.active() === p.t.id, 'is-dim': !lit() },
								]}
								tabindex="0"
								role="button"
								aria-label={p.t.subject}
								onMouseEnter={() => props.hover?.set(p.t.id)}
								onMouseLeave={() => props.hover?.set(null)}
								onFocus={() => props.hover?.set(p.t.id)}
								onBlur={() => props.hover?.set(null)}
								onClick={() => s.openTopic(p.t.id)}
								onKeyDown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault()
										s.openTopic(p.t.id)
									}
								}}
							>
								<circle class="ib-bp-cst-halo" cx={x} cy={y} r={r * 2.1} />
								<circle
									class="ib-bp-cst-core"
									cx={x}
									cy={y}
									r={r}
									style={{
										fill: `color-mix(in oklab, var(--ib-bp-star) ${Math.round(100 - 85 * c)}%, var(--ib-bp-star-hot))`,
									}}
								/>
							</g>
						)
					}}
				</For>
			</svg>
			<Show when={pointed()}>
				{(q) => (
					<span
						class="ib-bp-cst-tip"
						role="status"
						style={{
							'--tip-x': `${(100 * q().x) / W}%`,
							'--tip-y': `${(100 * q().y) / placed().h}%`,
							'--tip-r': `${(100 * q().r) / placed().h}%`,
						}}
					>
						{q().p.t.subject}
					</span>
				)}
			</Show>
		</span>
	)
}

/* ── who says what ──────────────────────────────────────────────────────── */

/** A matrix: one row per topic, one column per position, each cell the facet
 *  values the pipeline placed there. Reads left to right from agreement to
 *  opposition; an empty column is as informative as a full one. */
export function FacetMatrix(props: {
	d: BriefData
	ids: number[]
	pins: FacetPin[]
	facet: string
	label: string
	hover?: Hover
}) {
	const s = useBriefSurface()
	const rows = createMemo(() =>
		topicsOf(props.d, props.ids)
			.map((t) => ({
				t,
				pins: props.pins.filter((p) => p.topicId === t.id && p.facet === props.facet),
			}))
			.filter((r) => r.pins.length > 0),
	)
	const at = (pins: FacetPin[], position: string) =>
		pins.filter((p) => p.position === position).map((p) => p.value)
	return (
		<Show when={rows().length}>
			<div class="ib-bp-vs-wrap">
				<div
					class="ib-bp-vs"
					role="table"
					aria-label={`Each ${props.label}'s position on each topic's claim`}
				>
					<div class="ib-bp-vs-row ib-bp-vs-head" role="row">
						<span class="ib-bp-vs-corner" role="columnheader">
							Topic
						</span>
						<For each={s.positions}>
							{(p) => (
								<span class="ib-bp-vs-col" role="columnheader">
									<span
										class="ib-bp-vs-dot"
										style={{ background: s.positionColors[p] }}
										aria-hidden="true"
									/>
									{p}
								</span>
							)}
						</For>
					</div>
					<For each={rows()}>
						{(row) => (
							<div
								class={['ib-bp-vs-row', { 'is-active': props.hover?.active() === row.t.id }]}
								role="row"
								onMouseEnter={() => props.hover?.set(row.t.id)}
								onMouseLeave={() => props.hover?.set(null)}
							>
								<button
									type="button"
									class="ib-bp-vs-topic"
									role="rowheader"
									onClick={() => s.openTopic(row.t.id)}
									title={row.t.claim}
								>
									{row.t.subject}
								</button>
								<For each={s.positions}>
									{(p) => {
										const labels = () => at(row.pins, p)
										return (
											<span
												class={['ib-bp-vs-cell', { 'is-full': labels().length > 0 }]}
												role="cell"
												style={{ '--vs-c': s.positionColors[p] }}
											>
												<span class="ib-bp-vs-cell-label" aria-hidden="true">
													{p}
												</span>
												<For each={labels()}>{(l) => <span class="ib-bp-vs-tag">{l}</span>}</For>
											</span>
										)
									}}
								</For>
							</div>
						)}
					</For>
				</div>
			</div>
		</Show>
	)
}

/* ── an ordinal facet as a distribution ─────────────────────────────────── */

/** Where a node's contributors sit along an ORDERED facet — era, period,
 *  decade. Nominal facets get shares in the facts strip instead; this is the
 *  one rendering that depends on a facet being ordered, which is why
 *  ordinality is declared rather than guessed. */
export function FacetDistribution(props: { shares: FacetShare[]; w?: number; h?: number }) {
	const w = () => props.w ?? 130
	const h = () => props.h ?? 24
	const max = () => Math.max(1, ...props.shares.map((s) => s.stances))
	const title = () => props.shares.map((s) => `${s.value}: ${s.stances}`).join(' · ')
	return (
		<Show
			when={props.shares.length > 1}
			fallback={<span class="ib-bp-dist-one">{props.shares[0]?.value ?? '—'}</span>}
		>
			<span class="ib-bp-dist" title={title()}>
				<svg
					width={w()}
					height={h()}
					viewBox={`0 0 ${w()} ${h()}`}
					role="img"
					aria-label={`Distribution: ${title()}`}
					preserveAspectRatio="none"
				>
					<For each={props.shares}>
						{(s, i) => {
							const bw = () => w() / props.shares.length
							const bh = () => Math.max(1, (h() - 2) * (s.stances / max()))
							return (
								<rect
									x={i() * bw() + 0.5}
									y={h() - bh()}
									width={Math.max(1, bw() - 1)}
									height={bh()}
								/>
							)
						}}
					</For>
				</svg>
				<span class="ib-bp-dist-axis" aria-hidden="true">
					<span>{props.shares[0]?.value}</span>
					<span>{props.shares[props.shares.length - 1]?.value}</span>
				</span>
			</span>
		</Show>
	)
}
