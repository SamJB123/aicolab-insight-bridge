/**
 * A perspective task's page: what each source said against each criterion
 * the task set. There is nothing to score — the findings ARE the result — so
 * the page is a register of documents (the user's choices, 2026-10-22). A
 * task's criteria are answered from one document in one pass, so a document's
 * entries read together: a claim beside the evidence, timeframe and people
 * its document gives for it. Where the run numbered its findings (schema v12),
 * each item reads whole; where it did not, a criterion with one entry is said
 * to speak for all the document's entries above it.
 *
 * Finding a subset, as faceted search and the framework matrix do it:
 *
 *   search and lens   each lens value says how many documents it leaves under
 *                     the search; values that leave none are not offered;
 *   group by          the lens, any tag vocabulary (by its first tier) or the
 *                     run's topics (a document under each it is strongly
 *                     linked to): collapsible groups headed by their counts,
 *                     each document a one-line row until it is opened;
 *   cards or matrix   documents as cards, or as a framework matrix — rows the
 *                     documents, columns the criteria, each cell its key points
 *                     opening to their details and quotes — read across a
 *                     document or down a criterion, one matrix per group.
 */
import type {
	PerspectiveDocument,
	PerspectiveDocuments,
	PerspectiveGroups,
	PerspectiveOverview,
} from '@aicolab/insight-bridge-contracts/explorer'
import { Segmented, SelectControl, TextInput } from '@aicolab/ui-solid'
import { createEffect, createSignal, For, Show } from 'solid-js'
import { cap } from '../../grammar.ts'
import { fmt, useReportSurface } from '../surface.tsx'
import {
	AnalysisHead,
	lensWords,
	MoreButton,
	usePaged,
	WordsNotice,
	wordsClass,
} from './common.tsx'

/** What narrows the documents: the reader's words, a lens value, one group. */
export interface PerspectiveFilter {
	query?: string
	lensValue?: string | null
	group?: { by: string; value: string | null }
}

export type PerspectiveDocumentsLoader = (
	options: PerspectiveFilter & { offset: number },
) => Promise<PerspectiveDocuments | null>

export type PerspectiveGroupsLoader = (options: {
	query?: string
	lensValue?: string | null
	groupBy?: string | null
}) => Promise<PerspectiveGroups | null>

type Criteria = readonly { criterionId: number; text: string }[]
type Layout = 'cards' | 'matrix'

export function PerspectiveView(props: {
	overview: PerspectiveOverview
	perspectiveDocuments: PerspectiveDocumentsLoader
	perspectiveGroups: PerspectiveGroupsLoader
}) {
	const s = useReportSurface()
	const lens = () => lensWords(s)
	const ov = () => props.overview
	const [query, setQuery] = createSignal('')
	const [applied, setApplied] = createSignal('')
	const [lensAt, setLensAt] = createSignal('all')
	const [groupBy, setGroupBy] = createSignal<string | null>(null)
	const [layout, setLayout] = createSignal<Layout>('cards')
	const lensValue = () =>
		lensAt() === 'all' ? undefined : (ov().lens[Number(lensAt())]?.value ?? undefined)
	// the groups and the lens counts under the reader's search, read again as it changes
	const [groups, setGroups] = createSignal<PerspectiveGroups | null>(null)
	let asked = 0
	createEffect(
		() => ({ query: applied() || undefined, lensValue: lensValue(), groupBy: groupBy() }),
		(k) => {
			const mine = ++asked
			props.perspectiveGroups(k).then(
				(g) => mine === asked && setGroups(g),
				() => mine === asked && setGroups(null),
			)
		},
	)
	const lensCount = (value: string | null) =>
		groups()?.lens.find((l) => l.value === value)?.documents ?? 0
	const base = (): PerspectiveFilter => ({ query: applied() || undefined, lensValue: lensValue() })
	return (
		<div class="view-wrap ib-report-view-wide">
			<AnalysisHead
				task={ov().task}
				lede={`What each ${s.words.nouns.entity} said against each of the task's criteria, as the model found it in their ${s.words.nouns.documents}, with the words they used: each ${s.words.nouns.document} whole, every finding beside the rest of what it said. Nothing here is scored or ranked.`}
			/>
			<section class="sec" style={{ 'border-top': 'none' }}>
				<form
					class="ib-report-an-controls"
					onSubmit={(e) => {
						e.preventDefault()
						setApplied(query().trim())
					}}
				>
					<TextInput
						type="search"
						aria-label={`Search the ${s.words.nouns.documents}' findings`}
						placeholder="Search the findings and quotes"
						value={query()}
						onInput={(e) => setQuery(e.currentTarget.value)}
					/>
					<Show when={ov().lens.length > 1}>
						<SelectControl
							aria-label={lens().heading ?? 'Group'}
							value={lensAt()}
							onChange={(e) => setLensAt(e.currentTarget.value)}
						>
							<option value="all" selected={lensAt() === 'all'}>{`Every ${(
								lens().heading ?? 'group'
							).toLowerCase()} (${fmt(groups()?.lens.reduce((a, l) => a + l.documents, 0) ?? 0)})`}</option>
							<For each={ov().lens}>
								{(l, i) => (
									<Show when={lensCount(l.value) > 0 || lensAt() === String(i())}>
										<option value={String(i())} selected={lensAt() === String(i())}>
											{`${lens().label(l.value)} (${fmt(lensCount(l.value))})`}
										</option>
									</Show>
								)}
							</For>
						</SelectControl>
					</Show>
					<SelectControl
						aria-label="Group by"
						value={groupBy() ?? ''}
						onChange={(e) => setGroupBy(e.currentTarget.value || null)}
					>
						<option value="" selected={groupBy() === null}>
							No grouping
						</option>
						<For each={groups()?.groupings ?? []}>
							{(g) => (
								<option value={g.key} selected={groupBy() === g.key}>
									{`Group by ${g.label.toLowerCase()}`}
								</option>
							)}
						</For>
					</SelectControl>
					<Segmented
						label="Show"
						options={[
							{ id: 'cards', label: 'Cards' },
							{ id: 'matrix', label: 'Matrix' },
						]}
						value={layout()}
						onChange={(id) => setLayout(id === 'matrix' ? 'matrix' : 'cards')}
					/>
				</form>
				<p class="fig-note">
					{`${fmt(groups()?.total ?? 0)} ${s.words.nouns.documents}`}
					<Show when={groups()?.groupBy}>{` in ${fmt(groups()?.groups.length ?? 0)} groups`}</Show>
				</p>
				<Show
					when={groups()?.groupBy}
					fallback={
						<DocumentList
							filter={base}
							layout={layout()}
							criteria={ov().criteria}
							load={props.perspectiveDocuments}
						/>
					}
				>
					{(by) => (
						<div class="ib-report-an-groups">
							<For each={groups()?.groups ?? []}>
								{(g) => (
									<Group
										label={g.label}
										documents={g.documents}
										filter={() => ({ ...base(), group: { by: by(), value: g.value } })}
										layout={layout()}
										criteria={ov().criteria}
										load={props.perspectiveDocuments}
									/>
								)}
							</For>
						</div>
					)}
				</Show>
			</section>
		</div>
	)
}

/** One group: its heading and count; its documents read when it is opened, each a one-line row. */
function Group(props: {
	label: string
	documents: number
	filter: () => PerspectiveFilter
	layout: Layout
	criteria: Criteria
	load: PerspectiveDocumentsLoader
}) {
	const s = useReportSurface()
	const [open, setOpen] = createSignal(false)
	return (
		<details class="ib-report-an-group" onToggle={(e) => setOpen(e.currentTarget.open)}>
			<summary>
				<span class="ib-report-an-group-label">{props.label}</span>
				<span class="ib-report-an-group-n">{`${fmt(props.documents)} ${s.words.nouns.documents}`}</span>
			</summary>
			<Show when={open()}>
				<DocumentList
					filter={props.filter}
					layout={props.layout}
					criteria={props.criteria}
					load={props.load}
					compact
				/>
			</Show>
		</details>
	)
}

/** A filter's documents, a page at a time: as cards (rows that open, in a group) or as a matrix. */
function DocumentList(props: {
	filter: () => PerspectiveFilter
	layout: Layout
	criteria: Criteria
	load: PerspectiveDocumentsLoader
	compact?: boolean
}) {
	const s = useReportSurface()
	const paged = usePaged(
		() => props.filter(),
		(k, offset) => props.load({ ...k, offset }),
		(page) => page.documents,
	)
	return (
		<>
			<Show when={paged.failed()}>
				{(e) => (
					<p class="fig-note" role="alert">
						{e()}
					</p>
				)}
			</Show>
			<Show
				when={props.layout === 'matrix'}
				fallback={
					<ul class="ib-report-an-findings">
						<For each={paged.items()}>
							{(d) =>
								props.compact ? (
									<DocumentRow d={d} criteria={props.criteria} />
								) : (
									<li class={['ib-report-an-finding', wordsClass(d)]}>
										<DocumentBody d={d} criteria={props.criteria} />
									</li>
								)
							}
						</For>
					</ul>
				}
			>
				<Matrix documents={paged.items()} criteria={props.criteria} />
			</Show>
			<MoreButton
				shown={paged.items().length}
				total={paged.total()}
				busy={paged.busy()}
				onMore={paged.more}
				noun={s.words.nouns.documents}
			/>
		</>
	)
}

/** A document as one line — its source, its title, its first finding — opening to the whole card. */
function DocumentRow(props: { d: PerspectiveDocument; criteria: Criteria }) {
	const first = () => props.d.entries[0]?.keyPoint ?? ''
	return (
		<li class={['ib-report-an-finding', 'ib-report-an-row', wordsClass(props.d)]}>
			<details>
				<summary>
					<strong>{props.d.entityName}</strong>
					<Show when={(props.d.documentTitle ?? props.d.fileName) !== props.d.entityName}>
						<span class="fig-note">{` · ${props.d.documentTitle ?? props.d.fileName}`}</span>
					</Show>
					<span class="ib-report-an-row-first">{first()}</span>
				</summary>
				<DocumentBody d={props.d} criteria={props.criteria} />
			</details>
		</li>
	)
}

/** An entry's words: the key point as its line, the details, its verbatim quotes. */
function EntryWords(props: { keyPoint: string; details: string; quotes: string[] }) {
	return (
		<>
			<p>
				<strong>{props.keyPoint}</strong> {props.details}
			</p>
			<For each={props.quotes}>
				{(quote) => <blockquote class="ib-report-an-quote">{quote}</blockquote>}
			</For>
		</>
	)
}

/** The criterion text by its id. */
const textIn = (criteria: Criteria, criterionId: number) =>
	criteria.find((c) => c.criterionId === criterionId)?.text ?? ''

/**
 * One document's findings, every criterion at once, in the task's order. A
 * numbered item reads whole (its entries together); the rest read by
 * criterion, and a criterion with a single entry beside several entries of
 * the first is said to cover all of them, as the run recorded it.
 */
function DocumentBody(props: { d: PerspectiveDocument; criteria: Criteria }) {
	const s = useReportSurface()
	const lens = () => lensWords(s)
	/** The numbered items, each with its entries in the task's order. */
	const items = () => {
		const out = new Map<number, PerspectiveDocument['entries']>()
		for (const e of props.d.entries)
			if (e.item !== null) out.set(e.item, [...(out.get(e.item) ?? []), e])
		return [...out].sort(([a], [b]) => a - b)
	}
	/** The unnumbered entries, by criterion, in the task's order. */
	const groups = () =>
		props.criteria
			.map((c) => ({
				criterionId: c.criterionId,
				entries: props.d.entries.filter((e) => e.item === null && e.criterionId === c.criterionId),
			}))
			.filter((g) => g.entries.length)
	const lead = () => groups()[0]?.entries.length ?? 0
	return (
		<>
			<div class="ib-report-an-evidence-who">
				<button
					type="button"
					class="dw-inline-link"
					onClick={() => s.open({ kind: 'source', key: props.d.documentId })}
				>
					{props.d.entityName}
				</button>
				<Show when={s.words.lens}>
					<small class="ib-report-an-chip">{lens().label(props.d.lensValue)}</small>
				</Show>
				<small class="fig-note">{props.d.documentTitle ?? props.d.fileName}</small>
			</div>
			<WordsNotice of={props.d} />
			<For each={items()}>
				{([, entries]) => (
					<dl class="ib-report-an-alongside">
						<For each={entries}>
							{(e) => (
								<>
									<dt>{textIn(props.criteria, e.criterionId)}</dt>
									<dd>
										<EntryWords {...e} />
									</dd>
								</>
							)}
						</For>
					</dl>
				)}
			</For>
			<Show when={groups().length}>
				<dl class="ib-report-an-alongside">
					<For each={groups()}>
						{(g, i) => (
							<>
								<dt>
									{textIn(props.criteria, g.criterionId)}
									<Show when={i() > 0 && g.entries.length === 1 && lead() > 1}>
										<small class="fig-note">{` · for all ${lead()} above`}</small>
									</Show>
								</dt>
								<dd>
									<For each={g.entries}>{(e) => <EntryWords {...e} />}</For>
								</dd>
							</>
						)}
					</For>
				</dl>
			</Show>
		</>
	)
}

/**
 * The framework matrix: a row per document, a column per criterion, each cell
 * the document's key points under that criterion, each opening to its details
 * and quotes. Read across a row for one document whole, down a column for one
 * criterion across them. Scrolls sideways where the columns do not fit.
 */
function Matrix(props: { documents: readonly PerspectiveDocument[]; criteria: Criteria }) {
	const s = useReportSurface()
	return (
		<div class="ib-report-an-matrix-wrap">
			<table class="ib-report-an-matrix">
				<thead>
					<tr>
						<th scope="col">{cap(s.words.nouns.document)}</th>
						<For each={props.criteria}>
							{(c) => (
								<th scope="col" title={c.text}>
									{c.text}
								</th>
							)}
						</For>
					</tr>
				</thead>
				<tbody>
					<For each={props.documents}>
						{(d) => (
							<tr class={wordsClass(d)}>
								<th scope="row">
									<button
										type="button"
										class="dw-inline-link"
										onClick={() => s.open({ kind: 'source', key: d.documentId })}
									>
										{d.entityName}
									</button>
									<Show when={(d.documentTitle ?? d.fileName) !== d.entityName}>
										<small class="fig-note">{d.documentTitle ?? d.fileName}</small>
									</Show>
								</th>
								<For each={props.criteria}>
									{(c) => (
										<td>
											<For each={d.entries.filter((e) => e.criterionId === c.criterionId)}>
												{(e) => (
													<details class="ib-report-an-cell">
														<summary>{e.keyPoint}</summary>
														<p>{e.details}</p>
														<For each={e.quotes}>
															{(quote) => (
																<blockquote class="ib-report-an-quote">{quote}</blockquote>
															)}
														</For>
													</details>
												)}
											</For>
										</td>
									)}
								</For>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	)
}
