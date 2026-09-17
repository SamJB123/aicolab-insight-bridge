/**
 * The source record — ONE browsable page for every corpus.
 *
 * Everything a reader touches lives here: the free-text search, one select per
 * declared facet, the active-filter summary, the counts line and the pager
 * above and below the list. The whole of the reader's place is in the URL, so
 * a pasted link restores exactly what the sender was looking at and the back
 * button steps through filter states.
 *
 * What the page does NOT own is how a row reads. A submitter, an episode and
 * an oversight body want different chrome, and that is genuine per-corpus
 * content rather than deviation, so it arrives as the `row` render prop with
 * the canonical `SourceRow` to draw from.
 */
import type { JSX } from '@solidjs/web'
import { For, Show } from 'solid-js'
import './sources.css'
import { SourcesSurfaceContext, useSourcesSurface } from './surface.tsx'
import type { SourceRow, SourcesResult, SourcesSurface } from './types.ts'

const n = (v: number) => v.toLocaleString('en-US')

/** A group heading reads by the grouping facet's own value labels. */
const groupLabel = (d: SourcesResult, value: string) =>
	d.facets.find((f) => f.key === d.groupBy)?.labels?.[value] ?? value

/** The page window: first, last, and a span either side of where the reader is. */
type Step = { kind: 'page'; page: number } | { kind: 'gap' }

function pageWindow(page: number, pages: number, span = 2): Step[] {
	const out: Step[] = []
	let last = 0
	for (let p = 1; p <= pages; p++) {
		if (p !== 1 && p !== pages && Math.abs(p - page) > span) continue
		if (last && p - last > 1) out.push({ kind: 'gap' })
		out.push({ kind: 'page', page: p })
		last = p
	}
	return out
}

function Pager(props: { page: number; pages: number; label: string }) {
	const s = useSourcesSurface()
	const go = (page: number) => s.onSearch({ page: page > 1 ? page : undefined }, 'page')
	return (
		<Show when={props.pages > 1}>
			<nav class="ib-src-pager" aria-label={`${props.label} pages`}>
				<button type="button" class="ib-src-pager-b" disabled={props.page <= 1} onClick={() => go(props.page - 1)}>
					← Prev
				</button>
				<For each={pageWindow(props.page, props.pages)}>
					{(step) => (
						<Show when={step.kind === 'page' ? step : undefined} fallback={<span class="ib-src-pager-gap">…</span>}>
							{(p) => (
								<button
									type="button"
									class={['ib-src-pager-b', { 'ib-src-on': p().page === props.page }]}
									aria-current={p().page === props.page ? 'page' : undefined}
									onClick={() => go(p().page)}
								>
									{p().page}
								</button>
							)}
						</Show>
					)}
				</For>
				<button type="button" class="ib-src-pager-b" disabled={props.page >= props.pages} onClick={() => go(props.page + 1)}>
					Next →
				</button>
			</nav>
		</Show>
	)
}

function Filters(props: { d: SourcesResult }) {
	const s = useSourcesSurface()
	const chosen = (key: string) => {
		const v = s.search[key]
		return typeof v === 'string' ? v : ''
	}
	const active = () => [
		...(s.search.q ? [`“${s.search.q}”`] : []),
		...props.d.facets.map((f) => chosen(f.key)).filter((v) => v !== ''),
	]
	return (
		<div class="ib-src-filters">
			<input
				class="ib-src-input ib-src-search"
				type="search"
				placeholder={`Search ${props.d.grandTotal.toLocaleString()} ${s.vocabulary.sources} by name…`}
				value={typeof s.search.q === 'string' ? s.search.q : ''}
				onChange={(e) => s.onSearch({ q: e.currentTarget.value || undefined }, 'filter')}
				aria-label="Search"
			/>
			<For each={props.d.facets}>
				{(f) => (
					<select
						class="ib-src-input"
						aria-label={f.label}
						value={chosen(f.key)}
						onChange={(e) => s.onSearch({ [f.key]: e.currentTarget.value || undefined }, 'filter')}
					>
						<option value="">All {f.label.toLowerCase()}</option>
						<For each={f.values}>
							{(v) => (
								<option value={v.value} selected={chosen(f.key) === v.value}>
									{f.labels?.[v.value] ?? v.value} ({n(v.sources)})
								</option>
							)}
						</For>
					</select>
				)}
			</For>
			<Show when={active().length}>
				<button type="button" class="ib-src-clear" onClick={() => s.onSearch({}, 'filter')}>
					Clear {active().length} filter{active().length === 1 ? '' : 's'}
				</button>
			</Show>
		</div>
	)
}

function Counts(props: { d: SourcesResult }) {
	const s = useSourcesSurface()
	const from = () => (props.d.page - 1) * props.d.pageSize + 1
	const to = () => Math.min(props.d.page * props.d.pageSize, props.d.total)
	return (
		<p class="ib-src-counts">
			<Show
				when={props.d.total > 0}
				fallback={<>No {s.vocabulary.sources} match this filter. Try clearing one.</>}
			>
				Showing{' '}
				<strong class="ib-src-counts-n">
					{n(from())}–{n(to())}
				</strong>{' '}
				of {n(props.d.total)} matching {s.vocabulary.sources}
				<Show when={props.d.total !== props.d.grandTotal}> (of {n(props.d.grandTotal)})</Show>.
				<Show when={s.vocabulary.countsNote}>{(note) => <> {note()}</>}</Show>
			</Show>
		</p>
	)
}

export function SourcesPage(props: {
	d: SourcesResult
	surface: SourcesSurface
	/** How ONE row reads. The only per-corpus content on the page. */
	row: (row: SourceRow) => JSX.Element
}) {
	return (
		<SourcesSurfaceContext value={props.surface}>
			<div class="ib-sources">
				<header class="ib-src-head">
					<p class="ib-src-eyebrow">§ The record</p>
					<h1 class="ib-src-title">{props.surface.vocabulary.title}</h1>
					<Show when={props.surface.vocabulary.standfirst}>
						{(stand) => <p class="ib-src-stand">{stand()}</p>}
					</Show>
				</header>

				<section class="ib-src-browse">
					<h2 class="ib-src-h2">Browse &amp; filter</h2>
					<Show when={props.surface.vocabulary.filterNote}>
						{(note) => <p class="ib-src-note">{note()}</p>}
					</Show>

					<Filters d={props.d} />
					<Counts d={props.d} />
					<Pager page={props.d.page} pages={props.d.pages} label={props.surface.vocabulary.sources} />

					<div class="ib-src-list">
						<For each={props.d.groups}>
							{(group) => (
								<section class="ib-src-group">
									<Show when={group.value ?? (props.d.groupBy ? 'Unclassified' : undefined)}>
										{(value) => (
											<header class="ib-src-group-head">
												<span class="ib-src-group-name">{groupLabel(props.d, value())}</span>
												<span class="ib-src-group-n">
													{n(group.rows.length)} {group.rows.length === 1 ? props.surface.vocabulary.source : props.surface.vocabulary.sources} on this page
												</span>
											</header>
										)}
									</Show>
									<div class="ib-src-rows">
										<For each={group.rows}>
											{(row) => (
												<button type="button" class="ib-src-row" onClick={() => props.surface.openSource(row.entityId)}>
													{props.row(row)}
												</button>
											)}
										</For>
									</div>
								</section>
							)}
						</For>
					</div>

					<Pager page={props.d.page} pages={props.d.pages} label={props.surface.vocabulary.sources} />
				</section>
			</div>
		</SourcesSurfaceContext>
	)
}
