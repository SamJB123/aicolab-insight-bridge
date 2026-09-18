/**
 * The reading site's figure primitives — the ones every corpus explorer's
 * landing and analytical pages draw with, and that carry no corpus in them.
 *
 * Promoted from First Resort's `src/components/charts.tsx`, where Longform
 * keeps a near-identical copy. No chart library: bars animate through CSS
 * keyframes over a custom property, entrances through scroll-driven reveal
 * (site.css). Every visual encoding is doubled by text — a number, a label or a
 * title — so colour is never the only channel.
 *
 * NOT promoted, because the package already has them on `/brief`: PositionBar
 * and PositionLegend, which take a run's declared scale rather than assuming
 * the pipeline's six labels.
 */
import type { JSX } from '@solidjs/web'
import { For, Show } from 'solid-js'

const fmt = (n: number) => n.toLocaleString('en-AU')

/** A row of headline figures. `note` is the quiet second line under the label. */
export function StatTiles(props: { items: { n: string; l: string; note?: string }[] }) {
	return (
		<div class="tiles">
			<For each={props.items}>
				{(t) => (
					<div class="tile reveal">
						<div class="tn">{t.n}</div>
						<div class="tl">{t.l}</div>
						<Show when={t.note}>
							<div class="tnote">{t.note}</div>
						</Show>
					</div>
				)}
			</For>
		</div>
	)
}

export type BarRow = {
	label: JSX.Element
	value: number
	/** Overrides the list's colour for this row. */
	color?: string
	/** Overrides the formatted value shown at the end of the row. */
	display?: string
	tip?: string
	/** Makes the row a button — used where a bar opens the record. */
	onClick?: () => void
}

/** A labelled horizontal bar list. `max` defaults to the largest value present. */
export function BarList(props: {
	rows: BarRow[]
	max?: number
	labelWidth?: number
	color?: string
}) {
	const max = () => props.max ?? Math.max(1, ...props.rows.map((r) => r.value))
	return (
		<div class="bars" style={{ '--lbl': `${props.labelWidth ?? 190}px` }}>
			<For each={props.rows}>
				{(r) => {
					const inner = (
						<>
							<div class="bl">{r.label}</div>
							<div class="bt">
								<div
									class="bf"
									style={{
										'--w': `${Math.min(100, (r.value / max()) * 100).toFixed(1)}%`,
										background: r.color ?? props.color ?? 'var(--color-primary)',
									}}
								/>
							</div>
							<div class="bv">{r.display ?? fmt(r.value)}</div>
						</>
					)
					return (
						<Show
							when={r.onClick}
							fallback={
								<div class="brow" title={r.tip}>
									{inner}
								</div>
							}
						>
							<button type="button" class="brow brow-btn" title={r.tip} onClick={r.onClick}>
								{inner}
							</button>
						</Show>
					)
				}}
			</For>
		</div>
	)
}

/** A section's heading and its standfirst. */
export function SectionHead(props: { title: string; sub?: JSX.Element; id?: string }) {
	return (
		<div id={props.id}>
			<h3 class="sec-h">{props.title}</h3>
			<Show when={props.sub}>
				<p class="sec-sub">{props.sub}</p>
			</Show>
		</div>
	)
}

/**
 * One card of the landing's doorway grid — the way into a deep view.
 *
 * The host wraps it in its own router link (the package cannot know a route),
 * so this renders the card's insides only: an eyebrow, a title, the blurb the
 * host passes as children, and the call to action.
 */
export function DoorCard(props: { eyebrow: string; title: string; go: string; children?: JSX.Element }) {
	return (
		<>
			<div class="door-k">{props.eyebrow}</div>
			<div class="door-t">{props.title}</div>
			{props.children}
			<div class="door-go">{props.go}</div>
		</>
	)
}
