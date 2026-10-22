/**
 * A perspective task's page: what each source said against each criterion
 * the task set. There is nothing to score — the findings ARE the result — so
 * the page is a register of documents (the user's choice, 2026-10-22): one
 * card per document, every entry it has under every criterion, in the task's
 * order, so a claim reads beside the evidence, timeframe and people its
 * document gives for it. A task's criteria are answered from one document in
 * one pass, so they read together; a criterion read alone across the record
 * would lose that. Where the run numbered its findings (schema v12), each
 * item reads whole; where it did not, a criterion with one entry is said to
 * speak for all the document's entries above it. Searchable, and narrowed to
 * one lens value.
 */
import type {
	PerspectiveDocument,
	PerspectiveDocuments,
	PerspectiveOverview,
} from '@aicolab/insight-bridge-contracts/explorer'
import { SelectControl, TextInput } from '@aicolab/ui-solid'
import { createSignal, For, Show } from 'solid-js'
import { useReportSurface } from '../surface.tsx'
import {
	AnalysisHead,
	lensWords,
	MoreButton,
	usePaged,
	WordsNotice,
	wordsClass,
} from './common.tsx'

export type PerspectiveDocumentsLoader = (options: {
	offset: number
	lensValue?: string | null
	query?: string
}) => Promise<PerspectiveDocuments | null>

export function PerspectiveView(props: {
	overview: PerspectiveOverview
	perspectiveDocuments: PerspectiveDocumentsLoader
}) {
	const s = useReportSurface()
	const lens = () => lensWords(s)
	const ov = () => props.overview
	const [query, setQuery] = createSignal('')
	const [applied, setApplied] = createSignal('')
	const [lensAt, setLensAt] = createSignal('all')
	const lensValue = () =>
		lensAt() === 'all' ? undefined : (ov().lens[Number(lensAt())]?.value ?? undefined)
	const paged = usePaged(
		() => ({ lensValue: lensValue(), query: applied() }),
		(k, offset) =>
			props.perspectiveDocuments({ offset, lensValue: k.lensValue, query: k.query || undefined }),
		(page) => page.documents,
	)
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
							<option value="all">{`Every ${(lens().heading ?? 'group').toLowerCase()}`}</option>
							<For each={ov().lens}>
								{(l, i) => <option value={String(i())}>{lens().label(l.value)}</option>}
							</For>
						</SelectControl>
					</Show>
				</form>
				<Show when={paged.failed()}>
					{(e) => (
						<p class="fig-note" role="alert">
							{e()}
						</p>
					)}
				</Show>
				<ul class="ib-report-an-findings">
					<For each={paged.items()}>{(d) => <DocumentCard d={d} criteria={ov().criteria} />}</For>
				</ul>
				<MoreButton
					shown={paged.items().length}
					total={paged.total()}
					busy={paged.busy()}
					onMore={paged.more}
					noun={s.words.nouns.documents}
				/>
			</section>
		</div>
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

/**
 * One document's findings, every criterion at once, in the task's order. A
 * numbered item reads whole (its entries together); the rest read by
 * criterion, and a criterion with a single entry beside several entries of
 * the first is said to cover all of them, as the run recorded it.
 */
function DocumentCard(props: {
	d: PerspectiveDocument
	criteria: readonly { criterionId: number; text: string }[]
}) {
	const s = useReportSurface()
	const lens = () => lensWords(s)
	const textOf = (criterionId: number) =>
		props.criteria.find((c) => c.criterionId === criterionId)?.text ?? ''
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
		<li class={['ib-report-an-finding', wordsClass(props.d)]}>
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
									<dt>{textOf(e.criterionId)}</dt>
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
									{textOf(g.criterionId)}
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
		</li>
	)
}
