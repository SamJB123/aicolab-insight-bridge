/**
 * A perspective task's page: what each source said against each criterion
 * the task set. There is nothing to score — the findings ARE the result — so
 * the page is a register, read two ways (the user's choice, 2026-10-22):
 *
 *   By document (first)  one card per document: every entry it has under
 *                        every criterion, in the task's order, so a claim
 *                        reads beside the evidence, timeframe and people its
 *                        document gives for it. Where the run numbered its
 *                        findings (schema v12), each item reads whole; where
 *                        it did not, a criterion with one entry is said to
 *                        speak for all the document's entries above it.
 *   By criterion         the criteria as tabs with their findings, sources
 *                        and lens spread, then the chosen criterion's findings
 *                        as cards, for reading one criterion across the record.
 *
 * Both are searchable and narrowed to one lens value.
 */
import type {
	PerspectiveDocument,
	PerspectiveDocuments,
	PerspectiveFinding,
	PerspectiveFindings,
	PerspectiveOverview,
} from '@aicolab/insight-bridge-contracts/explorer'
import { Segmented, SelectControl, TextInput } from '@aicolab/ui-solid'
import { createSignal, For, Show } from 'solid-js'
import { fmt, useReportSurface } from '../surface.tsx'
import {
	AnalysisHead,
	LensKey,
	LensStrip,
	lensWords,
	MoreButton,
	usePaged,
	WordsNotice,
	wordsClass,
} from './common.tsx'

export type PerspectiveFindingsLoader = (
	criterionId: number,
	options: { offset: number; lensValue?: string | null; query?: string },
) => Promise<PerspectiveFindings | null>

export type PerspectiveDocumentsLoader = (options: {
	offset: number
	lensValue?: string | null
	query?: string
}) => Promise<PerspectiveDocuments | null>

export function PerspectiveView(props: {
	overview: PerspectiveOverview
	perspectiveFindings: PerspectiveFindingsLoader
	perspectiveDocuments: PerspectiveDocumentsLoader
}) {
	const s = useReportSurface()
	const lens = () => lensWords(s)
	const ov = () => props.overview
	// the reader's pick, when it is one of this task's criteria; else the task's first
	const [picked, setChosen] = createSignal<number | null>(null)
	const chosen = () => {
		const id = picked()
		return ov().criteria.some((c) => c.criterionId === id)
			? id
			: (ov().criteria[0]?.criterionId ?? null)
	}
	const criterion = () => ov().criteria.find((c) => c.criterionId === chosen())
	const textOf = (criterionId: number) =>
		ov().criteria.find((c) => c.criterionId === criterionId)?.text ?? ''
	const sourcesTotal = () => ov().lens.reduce((a, l) => a + l.sources, 0) || 0
	const [query, setQuery] = createSignal('')
	const [applied, setApplied] = createSignal('')
	const [lensAt, setLensAt] = createSignal('all')
	const lensValue = () =>
		lensAt() === 'all' ? undefined : (ov().lens[Number(lensAt())]?.value ?? undefined)
	const [mode, setMode] = createSignal<'documents' | 'criteria'>('documents')
	const paged = usePaged(
		() => {
			const id = chosen()
			return mode() !== 'criteria' || id === null
				? null
				: { id, lensValue: lensValue(), query: applied() }
		},
		(k, offset) =>
			props.perspectiveFindings(k.id, {
				offset,
				lensValue: k.lensValue,
				query: k.query || undefined,
			}),
		(page) => page.findings,
	)
	const byDocument = usePaged(
		() => (mode() === 'documents' ? { lensValue: lensValue(), query: applied() } : null),
		(k, offset) =>
			props.perspectiveDocuments({ offset, lensValue: k.lensValue, query: k.query || undefined }),
		(page) => page.documents,
	)
	const controls = (label: string) => (
		<form
			class="ib-report-an-controls"
			onSubmit={(e) => {
				e.preventDefault()
				setApplied(query().trim())
			}}
		>
			<TextInput
				type="search"
				aria-label={label}
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
	)
	return (
		<div class="view-wrap ib-report-view-wide">
			<AnalysisHead
				task={ov().task}
				lede={`What each ${s.words.nouns.entity} said against each of the task's criteria, as the model found it in their ${s.words.nouns.documents}, with the words they used. Nothing here is scored or ranked. Read it by ${s.words.nouns.document}, each finding beside the rest of what its ${s.words.nouns.document} said, or one criterion at a time across the record.`}
			/>
			<section class="sec" style={{ 'border-top': 'none' }}>
				<div class="ib-report-an-controls">
					<Segmented
						label="Read"
						options={[
							{ id: 'documents', label: `By ${s.words.nouns.document}` },
							{ id: 'criteria', label: 'By criterion' },
						]}
						value={mode()}
						onChange={(id) => setMode(id === 'criteria' ? 'criteria' : 'documents')}
					/>
				</div>
			</section>
			<Show when={mode() === 'documents'}>
				<section class="sec">
					{controls(`Search the ${s.words.nouns.documents}' findings`)}
					<Show when={byDocument.failed()}>
						{(e) => (
							<p class="fig-note" role="alert">
								{e()}
							</p>
						)}
					</Show>
					<ul class="ib-report-an-findings">
						<For each={byDocument.items()}>
							{(d) => <DocumentCard d={d} criteria={ov().criteria} />}
						</For>
					</ul>
					<MoreButton
						shown={byDocument.items().length}
						total={byDocument.total()}
						busy={byDocument.busy()}
						onMore={byDocument.more}
						noun={s.words.nouns.documents}
					/>
				</section>
			</Show>
			<Show when={mode() === 'criteria'}>
				<section class="sec" style={{ 'border-top': 'none' }}>
					<div class="ib-report-an-criteria" role="tablist" aria-label="Criteria">
						<For each={ov().criteria}>
							{(c) => (
								<button
									type="button"
									role="tab"
									aria-selected={chosen() === c.criterionId ? 'true' : 'false'}
									class={['ib-report-an-criterion', { 'ib-report-on': chosen() === c.criterionId }]}
									onClick={() => setChosen(c.criterionId)}
								>
									<span class="ib-report-an-criterion-text">{c.text}</span>
									<span class="ib-report-an-n">
										{`${fmt(c.findings)} findings · ${fmt(c.sources)} ${s.words.nouns.entities}`}
									</span>
									<Show when={ov().lens.length > 1}>
										<LensStrip
											lens={ov().lens}
											counts={c.byLens}
											of="sources"
											overall={sourcesTotal() ? c.sources / sourcesTotal() : 0}
											label={lens().label}
											noun={lens().heading ?? 'group'}
										/>
									</Show>
								</button>
							)}
						</For>
					</div>
					<Show when={ov().lens.length > 1 && lens().heading}>
						{(heading) => <LensKey lens={ov().lens} label={lens().label} heading={heading()} />}
					</Show>
				</section>
				<Show when={criterion()}>
					{(c) => (
						<section class="sec">
							<h2 class="sec-h">{c().text}</h2>
							{controls('Search the findings')}
							<Show when={paged.failed()}>
								{(e) => (
									<p class="fig-note" role="alert">
										{e()}
									</p>
								)}
							</Show>
							<ul class="ib-report-an-findings">
								<For each={paged.items()}>{(f) => <FindingCard f={f} textOf={textOf} />}</For>
							</ul>
							<MoreButton
								shown={paged.items().length}
								total={paged.total()}
								busy={paged.busy()}
								onMore={paged.more}
								noun="findings"
							/>
						</section>
					)}
				</Show>
			</Show>
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

function FindingCard(props: { f: PerspectiveFinding; textOf: (criterionId: number) => string }) {
	const s = useReportSurface()
	const lens = () => lensWords(s)
	return (
		<li class={['ib-report-an-finding', wordsClass(props.f)]}>
			<p class="ib-report-an-finding-head">{props.f.keyPoint}</p>
			<WordsNotice of={props.f} />
			<p>{props.f.details}</p>
			<For each={props.f.quotes}>
				{(quote) => <blockquote class="ib-report-an-quote">{quote}</blockquote>}
			</For>
			<Show when={props.f.alongside.length}>
				<dl class="ib-report-an-alongside">
					<For each={props.f.alongside}>
						{(x) => (
							<>
								<dt>{props.textOf(x.criterionId)}</dt>
								<dd>
									<strong>{x.keyPoint}</strong> {x.details}
								</dd>
							</>
						)}
					</For>
				</dl>
			</Show>
			<div class="ib-report-an-evidence-who">
				<button
					type="button"
					class="dw-inline-link"
					onClick={() => s.open({ kind: 'source', key: props.f.documentId })}
				>
					{props.f.entityName}
				</button>
				<Show when={s.words.lens}>
					<small class="ib-report-an-chip">{lens().label(props.f.lensValue)}</small>
				</Show>
				<small class="fig-note">{props.f.documentTitle ?? props.f.fileName}</small>
			</div>
		</li>
	)
}
