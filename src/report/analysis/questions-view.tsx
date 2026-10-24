/**
 * A question task's page, laid out the way a government "summary of
 * responses" is read: the questions in their own order, each with its full
 * wording, how many sources answered it and how each lens value engaged.
 * Opening a question reads its answers grouped by lens value, each with its
 * position and, opened, its key points with their verbatim quotes. Coverage is
 * the one number a question task has; everything else is what people said.
 */
import type {
	QuestionAnswer,
	QuestionDetail,
	QuestionMeta,
	QuestionsOverview,
} from '@aicolab/insight-bridge-contracts/explorer'
import { Segmented } from '@aicolab/ui-solid'
import { createEffect, createMemo, createSignal, For, Show, untrack } from 'solid-js'
import { fmt, useReportSurface } from '../surface.tsx'
import {
	AnalysisHead,
	LensKey,
	LensStrip,
	lensWords,
	pctOf,
	useDocumentName,
	WordsNotice,
	wordsClass,
} from './common.tsx'

export type QuestionDetailLoader = (questionId: number) => Promise<QuestionDetail | null>

/** The question's wording without a leading clause, which its marker already shows. */
const wording = (text: string) => text.replace(/^\([a-z0-9]+\)\s*/i, '').replace(/;$/, '.')

export function QuestionsView(props: {
	overview: QuestionsOverview
	questionDetail: QuestionDetailLoader
}) {
	const s = useReportSurface()
	const lens = () => lensWords(s)
	const ov = () => props.overview
	const [open, setOpen] = createSignal<number | null>(null)
	const sourcesTotal = () => ov().sourcesWithDocuments
	const max = () => Math.max(1, ...ov().questions.map((q) => q.sources))
	const countsOf = (questionId: number) =>
		ov().heat.map((row) => row.cells.find((c) => c.questionId === questionId)?.addressed ?? 0)
	return (
		<div class="view-wrap ib-report-view-wide">
			<AnalysisHead
				task={ov().task}
				lede={`The pipeline put every question to every ${s.words.nouns.document} and recorded an answer only where it found one: an unanswered question means no answer was found in the available text, never that a ${s.words.nouns.entity} has no view. ${fmt(sourcesTotal())} ${s.words.nouns.entities} lodged the ${s.words.nouns.documents} it read. Open a question to read its answers.`}
			/>
			<section class="sec" style={{ 'border-top': 'none' }}>
				<ol class="ib-report-an-ladder">
					<For each={ov().questions}>
						{(q) => (
							<li class={['ib-report-an-rung', { 'ib-report-on': open() === q.questionId }]}>
								<button
									type="button"
									class="ib-report-an-rung-head"
									aria-expanded={open() === q.questionId ? 'true' : 'false'}
									onClick={() => setOpen(open() === q.questionId ? null : q.questionId)}
								>
									<span class="ib-report-an-clause">{q.clause}</span>
									<span class="ib-report-an-rung-text">{wording(q.text)}</span>
									<span class="ib-report-an-rung-figures">
										<span
											class="ib-report-an-bar"
											title={`${q.sources} of ${sourcesTotal()} ${s.words.nouns.entities}`}
										>
											<span
												class="ib-report-an-bar-fill"
												style={{ '--w': `${(100 * q.sources) / max()}%` }}
											/>
										</span>
										<span class="ib-report-an-n">
											{`${fmt(q.sources)} of ${fmt(sourcesTotal())}`}
											<small>{` · ${pctOf(q.sources, sourcesTotal())}%`}</small>
										</span>
										<Show when={ov().lensValues.length > 1}>
											<LensStrip
												lens={ov().lensValues.map((v) => ({
													value: v.value,
													sources: v.sources,
													documents: 0,
												}))}
												counts={countsOf(q.questionId)}
												of="sources"
												overall={sourcesTotal() ? q.sources / sourcesTotal() : 0}
												label={lens().label}
												noun={lens().heading ?? 'group'}
											/>
										</Show>
									</span>
								</button>
								<Show when={open() === q.questionId}>
									<QuestionReader question={q} questionDetail={props.questionDetail} />
								</Show>
							</li>
						)}
					</For>
				</ol>
				<Show when={ov().lensValues.length > 1 && lens().heading}>
					{(heading) => (
						<LensKey
							lens={ov().lensValues.map((v) => ({
								value: v.value,
								sources: v.sources,
								documents: 0,
							}))}
							label={lens().label}
							heading={heading()}
						/>
					)}
				</Show>
			</section>
		</div>
	)
}

/** One question's answers, grouped by lens value, narrowed to one value on request. */
function QuestionReader(props: { question: QuestionMeta; questionDetail: QuestionDetailLoader }) {
	const s = useReportSurface()
	const lens = () => lensWords(s)
	const [detail, setDetail] = createSignal<QuestionDetail | null>(null)
	const [failed, setFailed] = createSignal<string | null>(null)
	createEffect(
		() => props.question.questionId,
		(id) => {
			let live = true
			setDetail(null)
			// the loader is read once per question: the id, not the loader, decides a fetch
			untrack(() => props.questionDetail(id)).then(
				(d) => live && setDetail(() => d),
				(e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)),
			)
			return () => {
				live = false
			}
		},
	)
	const [lensAt, setLensAt] = createSignal('all')
	const groups = createMemo(() =>
		(detail()?.byLensValue ?? []).filter(
			(g, i) => g.answers.length && (lensAt() === 'all' || String(i) === lensAt()),
		),
	)
	return (
		<div class="ib-report-an-drill">
			<Show when={failed()}>
				{(e) => (
					<p class="fig-note" role="alert">
						{e()}
					</p>
				)}
			</Show>
			<Show when={detail()} fallback={<p class="fig-note">Loading the answers…</p>}>
				{(d) => (
					<>
						<Show when={d().byLensValue.length > 1}>
							<Segmented
								label={lens().heading ?? 'Group'}
								options={[
									{ id: 'all', label: `Every ${(lens().heading ?? 'group').toLowerCase()}` },
									...d().byLensValue.map((g, i) => ({
										id: String(i),
										label: `${lens().label(g.value)} · ${g.answers.length}`,
									})),
								]}
								value={lensAt()}
								onChange={(id) => setLensAt(id)}
							/>
						</Show>
						<For each={groups()}>
							{(g) => (
								<div class="ib-report-q-sector">
									<div class="ib-report-q-sector-h">
										<h4>{lens().label(g.value)}</h4>
										<span class="fig-note" style={{ margin: 0 }}>
											{`${g.answers.length} answer${g.answers.length === 1 ? '' : 's'}`}
										</span>
									</div>
									<ul class="ib-report-an-answers">
										<For each={g.answers}>{(a) => <AnswerCard a={a} />}</For>
									</ul>
								</div>
							)}
						</For>
					</>
				)}
			</Show>
		</div>
	)
}

function AnswerCard(props: { a: QuestionAnswer }) {
	const s = useReportSurface()
	const name = useDocumentName()
	return (
		<li class={['ib-report-an-answer', wordsClass(props.a)]}>
			<div class="ib-report-an-evidence-who">
				<button
					type="button"
					class="dw-inline-link"
					onClick={() => s.open({ kind: 'source', key: props.a.documentId })}
				>
					{props.a.name}
				</button>
				<small class="fig-note">{name(props.a.documentId)}</small>
			</div>
			<p class="ib-report-an-position">{props.a.position}</p>
			<WordsNotice of={props.a} />
			<Show when={props.a.keyPoints.length}>
				<details class="ib-report-an-points">
					<summary>{`${props.a.keyPoints.length} key point${props.a.keyPoints.length === 1 ? '' : 's'}`}</summary>
					<ul>
						<For each={props.a.keyPoints}>
							{(k) => (
								<li>
									<strong>{k.keyPoint}</strong>
									<p>{k.details}</p>
									<For each={k.quotes}>
										{(quote) => <blockquote class="ib-report-an-quote">{quote}</blockquote>}
									</For>
								</li>
							)}
						</For>
					</ul>
				</details>
			</Show>
		</li>
	)
}
