/**
 * Questions — who answered which of the questions the run put to every
 * document, and what they said, for every report whose run has a question
 * task. Top: a lens × question heat map of attention; every cell and every
 * column header is a control. Below: the selected question with its wording,
 * the answers by lens value, and a lens filter. An answer opens its
 * contributor's reading. All live.
 *
 * The host owns the URL: it hands the page the current selection and is told
 * when the reader changes it. Moved from Training Data's routes/terms.tsx
 * (2026-10-21), where the questions are the committee's terms of reference.
 */
import type { QuestionDetail, QuestionsOverview } from '@aicolab/insight-bridge-contracts/explorer'
import { Eyebrow } from '@aicolab/ui-solid'
import { createMemo, For, Show } from 'solid-js'
import { HeatCell, StatRow } from './figures.tsx'
import {
	documentLabelOf,
	fmt,
	type ReportSurface,
	ReportSurfaceContext,
	useReportSurface,
	vocabularyOf,
} from './surface.tsx'
import './report.css'

/** Which question is open, and which lens value its answers are filtered to (null: the unclassified; absent: all). */
export interface QuestionsSelection {
	questionId?: number
	lensValue?: string | null
}

export function QuestionsPage(props: {
	overview: QuestionsOverview
	detail: QuestionDetail | null
	selection: QuestionsSelection
	/** The reader chose a question or a lens value; `scroll` when the answers should come into view. */
	onSelect: (selection: QuestionsSelection, scroll: boolean) => void
	surface: ReportSurface
}) {
	return (
		<ReportSurfaceContext value={props.surface}>
			<QuestionsBody
				overview={props.overview}
				detail={props.detail}
				selection={props.selection}
				onSelect={props.onSelect}
			/>
		</ReportSurfaceContext>
	)
}

function QuestionsBody(props: {
	overview: QuestionsOverview
	detail: QuestionDetail | null
	selection: QuestionsSelection
	onSelect: (selection: QuestionsSelection, scroll: boolean) => void
}) {
	const s = useReportSurface()
	const v = vocabularyOf(s)
	const nouns = () => s.words.nouns
	const lensFacet = () => s.words.lens
	const lens = () => {
		const facet = lensFacet()
		return facet ? (s.words.facets[facet]?.heading ?? facet) : 'Group'
	}
	const valueLabel = (value: string | null) => {
		const facet = lensFacet()
		return value === null
			? 'Unclassified'
			: facet
				? (s.words.facets[facet]?.values[value] ?? value)
				: value
	}
	const ov = () => props.overview
	const det = () => props.detail
	const qid = () => det()?.question.questionId
	const overallOf = (questionId: number) =>
		ov().overall.find((o) => o.questionId === questionId)?.pct ?? 0
	const cellOf = (value: string | null, questionId: number) =>
		ov()
			.heat.find((row) => row.value === value)
			?.cells.find((c) => c.questionId === questionId)
	const filtered = () => props.selection.lensValue !== undefined
	const groupsShown = createMemo(() =>
		(det()?.byLensValue ?? []).filter(
			(g) => g.answers.length && (!filtered() || g.value === props.selection.lensValue),
		),
	)
	const shownCount = createMemo(() => groupsShown().reduce((a, g) => a + g.answers.length, 0))
	/** The question's wording without its leading clause, which the tab already shows. */
	const wording = (text: string) => text.replace(/^\([a-z0-9]+\)\s*/i, '').replace(/;$/, '.')
	const first = () => ov().questions[0]?.clause ?? ''
	const last = () => ov().questions[ov().questions.length - 1]?.clause ?? ''

	return (
		<div class="view-wrap view-wide">
			<header class="view-head">
				<Eyebrow>{`§ ${v.questionsTitle} · ${first()} to ${last()}`}</Eyebrow>
				<h1 class="view-title">{`Who answered which ${v.question}`}</h1>
				<p class="view-stand">
					{`The pipeline put every ${v.question} of ${v.questionsPhrase} (${fmt(ov().questions.length)} in all) to every ${nouns().document}, told not to force a match: quoting ${v.questionsPhrase} does not count, and an unanswered ${v.question} means no answer was found in the available text, never that a ${nouns().entity} has no view. What remains is a map of attention: each cell is the share of a ${lens().toLowerCase()}'s ${nouns().entities} whose documents substantively answer a ${v.question}. Click a column to read the answers; click a cell to read one ${lens().toLowerCase()}'s.`}
				</p>
			</header>

			<section class="sec" style={{ 'border-top': 'none' }}>
				<div class="fig reveal heat-wrap">
					<table class="heat">
						<caption class="fig-title" style={{ 'text-align': 'left', 'caption-side': 'top' }}>
							{`Share of each ${lens().toLowerCase()} answering each ${v.question} · ${fmt(ov().sourcesWithDocuments)} ${nouns().entities} with documents`}
						</caption>
						<thead>
							<tr>
								<th scope="col">{lens()}</th>
								<For each={ov().questions}>
									{(q) => (
										<th
											scope="col"
											class={['click', { on: qid() === q.questionId }]}
											title={q.text}
											onClick={() =>
												props.onSelect({ questionId: q.questionId, lensValue: undefined }, true)
											}
										>
											{q.clause}
											<br />
											<span class="heat-n">{`${overallOf(q.questionId)}%`}</span>
										</th>
									)}
								</For>
							</tr>
						</thead>
						<tbody>
							<For each={ov().lensValues}>
								{(row) => (
									<tr>
										<th scope="row">
											{valueLabel(row.value)} <span class="heat-n">{row.sources}</span>
										</th>
										<For each={ov().questions}>
											{(q) => (
												<HeatCell
													pct={cellOf(row.value, q.questionId)?.pct ?? 0}
													n={cellOf(row.value, q.questionId)?.addressed}
													d={cellOf(row.value, q.questionId)?.sources}
													active={qid() === q.questionId && props.selection.lensValue === row.value}
													onClick={() =>
														props.onSelect({ questionId: q.questionId, lensValue: row.value }, true)
													}
													title={`${valueLabel(row.value)} × ${q.clause}: ${cellOf(row.value, q.questionId)?.addressed ?? 0} of ${cellOf(row.value, q.questionId)?.sources ?? 0} ${nouns().entities} (${cellOf(row.value, q.questionId)?.pct ?? 0}%). ${q.text}`}
												/>
											)}
										</For>
									</tr>
								)}
							</For>
						</tbody>
					</table>
				</div>
				<p class="fig-note">
					{`Percentages are of the ${lens().toLowerCase()}'s ${nouns().entities} with at least one document. The column header carries the corpus-wide share. A ${nouns().entity} with several documents counts once.`}
				</p>
			</section>

			<Show when={det()}>
				{(dd) => (
					<section class="sec" id="answers">
						<fieldset class="q-tabs" aria-label={v.questionsTitle}>
							<For each={ov().questions}>
								{(q) => (
									<button
										type="button"
										aria-pressed={q.questionId === qid() ? 'true' : 'false'}
										class={['q-tab', { on: q.questionId === qid() }]}
										title={q.text}
										onClick={() =>
											props.onSelect({ questionId: q.questionId, lensValue: undefined }, false)
										}
									>
										{q.clause} <small>{q.sources}</small>
									</button>
								)}
							</For>
						</fieldset>
						<Eyebrow>
							{`${v.question.charAt(0).toUpperCase()}${v.question.slice(1)} ${dd().question.clause} · answered by ${fmt(dd().question.sources)} ${nouns().entities} · ${fmt(dd().question.keyPoints)} key points`}
						</Eyebrow>
						<h2 class="q-text">{wording(dd().question.text)}</h2>
						<StatRow
							items={[
								{
									n: fmt(dd().question.sources),
									l: `${nouns().entities} answered, directly or in substance`,
								},
								{
									n: `${overallOf(dd().question.questionId)}%`,
									l: `of ${nouns().entities} with documents`,
								},
								{
									n: fmt(dd().question.keyPoints),
									l: `key points extracted under this ${v.question}`,
								},
								{ n: fmt(dd().byLensValue.length), l: `${lens().toLowerCase()}s represented` },
							]}
						/>
						<div class="roster-filter" style={{ 'margin-top': '1.2rem' }}>
							<fieldset class="seg" aria-label={lens()}>
								<button
									type="button"
									class={['seg-b', { on: !filtered() }]}
									onClick={() =>
										props.onSelect(
											{ questionId: dd().question.questionId, lensValue: undefined },
											false,
										)
									}
								>
									{`All ${lens().toLowerCase()}s`}
								</button>
								<For each={dd().byLensValue}>
									{(g) => (
										<button
											type="button"
											class={['seg-b', { on: filtered() && props.selection.lensValue === g.value }]}
											onClick={() =>
												props.onSelect(
													{ questionId: dd().question.questionId, lensValue: g.value },
													false,
												)
											}
										>
											{`${valueLabel(g.value)} · ${g.answers.length}`}
										</button>
									)}
								</For>
							</fieldset>
							<span class="fig-note" style={{ margin: 0 }}>
								{`${shownCount()} answer${shownCount() === 1 ? '' : 's'} shown`}
							</span>
						</div>

						<For each={groupsShown()}>
							{(g) => (
								<div class="q-sector">
									<div class="q-sector-h">
										<h4>{valueLabel(g.value)}</h4>
										<span class="fig-note" style={{ margin: 0 }}>
											{`${g.answers.length} of ${cellOf(g.value, dd().question.questionId)?.sources ?? '?'} ${nouns().entities}`}
										</span>
									</div>
									<div class="q-answers">
										<For each={g.answers}>
											{(a) => (
												<button
													type="button"
													class="q-answer reveal"
													onClick={() => s.open({ kind: 'source', key: a.documentId })}
												>
													<span class="q-answer-who">
														<span>{a.name}</span>
														<small>
															{documentLabelOf(s, {
																documentId: a.documentId,
																title: a.documentTitle,
																fileName: a.fileName,
																facets: a.documentFacets,
															}) +
																(a.keyPoints.length
																	? ` · ${a.keyPoints.length} key point${a.keyPoints.length === 1 ? '' : 's'}`
																	: '')}
														</small>
													</span>
													<span class="q-answer-pos">{a.position}</span>
												</button>
											)}
										</For>
									</div>
								</div>
							)}
						</For>
					</section>
				)}
			</Show>
		</div>
	)
}
