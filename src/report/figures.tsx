/**
 * The report pages' own figures, beyond the site frame's (site/figures.tsx):
 * a row of stat cards, and a matrix cell whose fill is its share. Moved from
 * Training Data's components/charts.tsx (2026-10-21).
 */
import type { JSX } from '@solidjs/web'
import { For, Show } from 'solid-js'

/** A row of figures: each a number and what it counts. */
export function StatRow(props: { items: { n: JSX.Element; l: JSX.Element }[] }) {
	return (
		<div class="ib-report-statrow">
			<For each={props.items}>
				{(s) => (
					<div class="ib-report-stat reveal">
						<div class="ib-report-stat-n">{s.n}</div>
						<div class="ib-report-stat-l">{s.l}</div>
					</div>
				)}
			</For>
		</div>
	)
}

/** One cell of a heat matrix: its share as a fill, a button when it opens something. */
export function HeatCell(props: {
	pct: number
	n?: number
	d?: number
	onClick?: () => void
	active?: boolean
	title?: string
}) {
	const title = () =>
		props.title ??
		(props.n != null && props.d != null
			? `${props.n} of ${props.d} (${props.pct}%)`
			: `${props.pct}%`)
	return (
		<td
			class={[
				'ib-report-heat-cell',
				{ 'ib-report-on': !!props.active, 'ib-report-click': !!props.onClick },
			]}
			style={{ '--pct': String(props.pct) }}
			title={title()}
		>
			<Show when={props.onClick} fallback={<span>{props.pct}</span>}>
				{(onClick) => (
					<button
						type="button"
						class="ib-report-heat-btn"
						onClick={() => onClick()()}
						aria-pressed={props.active ? 'true' : 'false'}
						aria-label={title()}
					>
						{props.pct}
					</button>
				)}
			</Show>
		</td>
	)
}
