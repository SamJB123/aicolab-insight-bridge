/**
 * What every custom analysis view shares: the page's head (the task, what the
 * model was asked, how much it read), the lens's words, a strip of lens cells,
 * a "show more" for long lists, and the loader every drill-down reads through.
 */
import type { LensBase, ReportTask } from '@aicolab/insight-bridge-contracts/explorer'
import { Button, Eyebrow } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { createEffect, createSignal, For, Show, untrack } from 'solid-js'
import { fmt, type ReportSurface, useReportSurface } from '../surface.tsx'

/** Each kind of custom analysis, as a reader meets it. */
export const KIND_LABEL: Record<ReportTask['kind'], string> = {
	metadata_tagging: 'Tagging',
	question_response: 'Questions',
	perspective_analysis: 'Perspectives',
	criteria_assessment: 'Assessment',
	metrics_evaluation: 'Metrics',
}

/** A task kind's label from the run's words, where the kind is a plain string. */
export const kindLabel = (kind: string) =>
	Object.entries(KIND_LABEL).find(([k]) => k === kind)?.[1] ?? 'Analysis'

/** The lens's heading and each value's short word, from the run's own words. */
export function lensWords(s: ReportSurface) {
	const facet = s.words.lens
	return {
		heading: facet ? (s.words.facets[facet]?.heading ?? facet) : null,
		label: (value: string | null) =>
			value === null
				? 'Unclassified'
				: facet
					? (s.words.facets[facet]?.values[value] ?? value)
					: value,
	}
}

/** The page's head: the task's name, the kind of reading it is, what was asked, and how much was read. */
export function AnalysisHead(props: { task: ReportTask; lede: JSX.Element }) {
	const s = useReportSurface()
	return (
		<header class="view-head">
			<Eyebrow>{`§ ${KIND_LABEL[props.task.kind]} · ${fmt(props.task.documents)} ${s.words.nouns.documents} read`}</Eyebrow>
			<h1 class="view-title">{props.task.title}</h1>
			<p class="view-stand">{props.lede}</p>
			<Show when={props.task.description}>
				{(asked) => (
					<details class="ib-report-an-asked">
						<summary>What the model was asked</summary>
						<p>{asked()}</p>
					</details>
				)}
			</Show>
		</header>
	)
}

/**
 * A row of lens cells: each value's share of its own documents or sources,
 * shaded by how far it sits above or below the share across the whole task.
 */
export function LensStrip(props: {
	lens: readonly LensBase[]
	counts: readonly number[]
	/** Which base each count is of. */
	of: 'documents' | 'sources'
	/** The share across the task, as a fraction: the even line. */
	overall: number
	label: (value: string | null) => string
	noun: string
}) {
	return (
		<span class="ib-report-an-strip" role="img" aria-label={`By ${props.noun}`}>
			<For each={props.lens}>
				{(l, i) => {
					const base = l[props.of]
					const count = props.counts[i()] ?? 0
					const share = base ? count / base : 0
					const lift = props.overall ? share / props.overall : 0
					return (
						<span
							class="ib-report-an-strip-cell"
							style={{
								'--share': String(Math.round(share * 100)),
								'--lift': String(Math.max(0, Math.min(2, lift))),
							}}
							title={`${props.label(l.value)}: ${count} of ${base} (${Math.round(share * 100)}%; across all: ${Math.round(props.overall * 100)}%)`}
						/>
					)
				}}
			</For>
		</span>
	)
}

/** The lens strip's key: each cell's value in order, and what the shading means. */
export function LensKey(props: {
	lens: readonly LensBase[]
	label: (value: string | null) => string
	heading: string
}) {
	return (
		<p class="fig-note ib-report-an-key">
			<span>{`Cells, left to right, are each ${props.heading.toLowerCase()}: ${props.lens.map((l) => props.label(l.value)).join(' · ')}.`}</span>
			<span class="ib-report-an-key-scale">
				<span class="ib-report-an-strip-cell" style={{ '--lift': '0.2' }} /> below the overall share
				<span class="ib-report-an-strip-cell" style={{ '--lift': '1' }} /> at it
				<span class="ib-report-an-strip-cell" style={{ '--lift': '2' }} /> above it
			</span>
		</p>
	)
}

/** "Show more" under a long list: how many are shown of how many, and the next page. */
export function MoreButton(props: {
	shown: number
	total: number
	busy: boolean
	onMore: () => void
	noun: string
}) {
	return (
		<div class="ib-report-an-more">
			<span class="fig-note">{`${fmt(props.shown)} of ${fmt(props.total)} ${props.noun}`}</span>
			<Show when={props.shown < props.total}>
				<Button variant="outline" disabled={props.busy} onClick={() => props.onMore()}>
					{props.busy ? 'Loading…' : 'Show more'}
				</Button>
			</Show>
		</div>
	)
}

/**
 * A drill-down's pages, fetched when the reader asks: `key` names what is
 * open (null: nothing), each key starts again from its first page, and
 * `more` appends the next.
 */
export function usePaged<K, T, R extends { total: number }>(
	key: () => K | null,
	load: (key: K, offset: number) => Promise<R | null>,
	rows: (page: R) => T[],
) {
	const [items, setItems] = createSignal<T[]>([])
	const [total, setTotal] = createSignal(0)
	const [busy, setBusy] = createSignal(false)
	const [failed, setFailed] = createSignal<string | null>(null)
	let generation = 0
	const fetchPage = (k: K, offset: number) => {
		const mine = ++generation
		setBusy(true)
		setFailed(null)
		load(k, offset).then(
			(page) => {
				if (mine !== generation) return
				setItems((held) => [...(offset ? held : []), ...(page ? rows(page) : [])])
				setTotal(page?.total ?? 0)
				setBusy(false)
			},
			(e: unknown) => {
				if (mine !== generation) return
				setFailed(e instanceof Error ? e.message : String(e))
				setBusy(false)
			},
		)
	}
	createEffect(key, (k) => {
		setItems([])
		setTotal(0)
		if (k === null) {
			generation++
			setBusy(false)
			return
		}
		// the loader is read once per key: the key, not the loader, decides a fetch
		untrack(() => fetchPage(k, 0))
	})
	return {
		items,
		total,
		busy,
		failed,
		more: () => {
			const k = key()
			if (k !== null) fetchPage(k, items().length)
		},
	}
}

/** A value's share as a whole percentage. */
export const pctOf = (part: number, whole: number) => (whole ? Math.round((100 * part) / whole) : 0)
