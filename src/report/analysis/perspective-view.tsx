/**
 * A perspective task's page: what each source said against each criterion
 * the task set. There is nothing to score — the findings ARE the result — so
 * the page is a register: the criteria as tabs with their findings, sources
 * and lens spread, then the chosen criterion's findings as cards (the key
 * point as the headline, the details, the verbatim quotes, whose), searchable
 * and narrowed to one lens value. Where the run numbered its findings (schema
 * v12), a card shows its finding whole: the claim with its evidence,
 * timeframe and who is affected beside it.
 */
import type {
	PerspectiveFinding,
	PerspectiveFindings,
	PerspectiveOverview,
} from '@aicolab/insight-bridge-contracts/explorer'
import { SelectControl, TextInput } from '@aicolab/ui-solid'
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

export function PerspectiveView(props: {
	overview: PerspectiveOverview
	perspectiveFindings: PerspectiveFindingsLoader
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
	const paged = usePaged(
		() => {
			const id = chosen()
			return id === null ? null : { id, lensValue: lensValue(), query: applied() }
		},
		(k, offset) =>
			props.perspectiveFindings(k.id, {
				offset,
				lensValue: k.lensValue,
				query: k.query || undefined,
			}),
		(page) => page.findings,
	)
	return (
		<div class="view-wrap ib-report-view-wide">
			<AnalysisHead
				task={ov().task}
				lede={`What each ${s.words.nouns.entity} said against each of the task's criteria, as the model found it in their ${s.words.nouns.documents}, with the words they used. Nothing here is scored or ranked; choose a criterion to read its findings.`}
			/>
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
						<form
							class="ib-report-an-controls"
							onSubmit={(e) => {
								e.preventDefault()
								setApplied(query().trim())
							}}
						>
							<TextInput
								type="search"
								aria-label="Search the findings"
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
		</div>
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
