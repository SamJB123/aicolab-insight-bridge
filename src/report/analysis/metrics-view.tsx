/**
 * A metrics evaluation's page: a catalogue of the measures the documents
 * proposed or implied, grouped by name (case and spacing aside), with how
 * many documents named each and whether they named it outright or implied
 * it. Opening a metric lists its entries: whose, what it measures, the data
 * it would take to collect, and — where the task named north stars — which
 * goal it serves and how. North stars appear only when the run has them; a
 * declared north star no metric serves is shown as such.
 */
import type {
	MetricEntries,
	MetricEntry,
	MetricsOverview,
} from '@aicolab/insight-bridge-contracts/explorer'
import { TextInput } from '@aicolab/ui-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { fmt, useReportSurface } from '../surface.tsx'
import { AnalysisHead, lensWords, MoreButton, usePaged } from './common.tsx'

export type MetricEntriesLoader = (options: {
	offset: number
	name?: string
	northStar?: string
}) => Promise<MetricEntries | null>

export function MetricsView(props: {
	overview: MetricsOverview
	metricEntries: MetricEntriesLoader
}) {
	const s = useReportSurface()
	const ov = () => props.overview
	const [filter, setFilter] = createSignal('')
	const [open, setOpen] = createSignal<{ name?: string; northStar?: string } | null>(null)
	const shown = createMemo(() => {
		const needle = filter().trim().toLowerCase()
		return needle ? ov().metrics.filter((m) => m.name.toLowerCase().includes(needle)) : ov().metrics
	})
	const max = () => Math.max(1, ...ov().metrics.map((m) => m.documents))
	return (
		<div class="view-wrap ib-report-view-wide">
			<AnalysisHead
				task={ov().task}
				lede={`The measures the ${s.words.nouns.documents} proposed or implied, as the model found them: ${fmt(ov().metrics.length)} distinct metrics, grouped by name. Open a metric to read each ${s.words.nouns.document}'s version of it and the data it would take to collect.`}
			/>
			<Show when={ov().northStars.length}>
				<section class="sec" style={{ 'border-top': 'none' }}>
					<h2 class="sec-h">North stars</h2>
					<p class="fig-note">
						The goals the task named, with the metrics aligned to each. A goal no metric serves is a
						gap in what was proposed.
					</p>
					<ul class="ib-report-an-stars">
						<For each={ov().northStars}>
							{(n) => (
								<li>
									<button
										type="button"
										class={[
											'ib-report-an-star',
											{
												'ib-report-an-star-gap': n.metrics === 0,
												'ib-report-on': open()?.northStar === n.name,
											},
										]}
										disabled={n.metrics === 0}
										onClick={() =>
											setOpen(open()?.northStar === n.name ? null : { northStar: n.name })
										}
									>
										<span>{n.name}</span>
										<span class="ib-report-an-n">
											{n.metrics === 0
												? 'no metric aligned'
												: `${fmt(n.metrics)} metrics · ${fmt(n.documents)} ${s.words.nouns.documents}`}
										</span>
									</button>
								</li>
							)}
						</For>
					</ul>
					<Show when={open()?.northStar}>
						{(star) => (
							<Entries options={{ northStar: star() }} metricEntries={props.metricEntries} />
						)}
					</Show>
				</section>
			</Show>
			<section class="sec" style={ov().northStars.length ? undefined : { 'border-top': 'none' }}>
				<h2 class="sec-h">Metrics</h2>
				<div class="ib-report-an-controls">
					<TextInput
						type="search"
						aria-label="Find a metric"
						placeholder="Find a metric"
						value={filter()}
						onInput={(e) => setFilter(e.currentTarget.value)}
					/>
				</div>
				<ul class="ib-report-an-metrics">
					<For each={shown()}>
						{(m) => (
							<li class={['ib-report-an-metric', { 'ib-report-on': open()?.name === m.name }]}>
								<button
									type="button"
									class="ib-report-an-metric-head"
									aria-expanded={open()?.name === m.name ? 'true' : 'false'}
									onClick={() => setOpen(open()?.name === m.name ? null : { name: m.name })}
								>
									<span class="ib-report-an-metric-name">
										{m.name}
										<small class="ib-report-an-chip">{m.type}</small>
									</span>
									<span
										class="ib-report-an-bar"
										title={`${m.documents} ${s.words.nouns.documents}`}
									>
										<span
											class="ib-report-an-bar-fill"
											style={{ '--w': `${(100 * m.documents) / max()}%` }}
										/>
									</span>
									<span class="ib-report-an-n">
										{`${fmt(m.documents)} ${s.words.nouns.documents}`}
										<small>{` · ${m.explicit} explicit, ${m.implicit} implied`}</small>
									</span>
								</button>
								<Show when={open()?.name === m.name}>
									<Entries options={{ name: m.name }} metricEntries={props.metricEntries} />
								</Show>
							</li>
						)}
					</For>
				</ul>
			</section>
		</div>
	)
}

function Entries(props: {
	options: { name?: string; northStar?: string }
	metricEntries: MetricEntriesLoader
}) {
	const s = useReportSurface()
	const paged = usePaged(
		() => props.options,
		(k, offset) => props.metricEntries({ offset, ...k }),
		(page) => page.entries,
	)
	return (
		<div class="ib-report-an-drill">
			<Show when={paged.failed()}>
				{(e) => (
					<p class="fig-note" role="alert">
						{e()}
					</p>
				)}
			</Show>
			<ul class="ib-report-an-evidence">
				<For each={paged.items()}>{(m) => <EntryRow m={m} />}</For>
			</ul>
			<MoreButton
				shown={paged.items().length}
				total={paged.total()}
				busy={paged.busy()}
				onMore={paged.more}
				noun={s.words.nouns.documents}
			/>
		</div>
	)
}

function EntryRow(props: { m: MetricEntry }) {
	const s = useReportSurface()
	const lens = () => lensWords(s)
	return (
		<li class="ib-report-an-evidence-row">
			<div class="ib-report-an-evidence-who">
				<button
					type="button"
					class="dw-inline-link"
					onClick={() => s.open({ kind: 'source', key: props.m.documentId })}
				>
					{props.m.entityName}
				</button>
				<Show when={s.words.lens}>
					<small class="ib-report-an-chip">{lens().label(props.m.lensValue)}</small>
				</Show>
				<small class="ib-report-an-chip">{props.m.explicitness}</small>
			</div>
			<p class="ib-report-an-leaf">{props.m.name}</p>
			<Show when={props.m.description}>{(d) => <p>{d()}</p>}</Show>
			<Show when={props.m.requirements.length}>
				<p class="fig-note">{`To collect: ${props.m.requirements.join('; ')}`}</p>
			</Show>
			<For each={props.m.alignments}>
				{(a) => (
					<p class="fig-note">
						<strong>{a.northStar}</strong>
						{`: ${a.how}`}
					</p>
				)}
			</For>
		</li>
	)
}
