/**
 * A criteria assessment's page — the one kind of custom analysis with real
 * numbers. Each criterion is a scorecard: its declared range, the mean, and
 * the whole distribution as one 100% bar on a sequential ramp (a severity
 * scale has no neutral middle, so it never diverges); then the same bar for
 * each lens value. With two or more criteria, the first two are scored
 * together on a grid, a cell per pair; a cell narrows the ranked documents
 * below to the documents that scored it. The ranked list leads with each
 * document's scores, its one-line finding and, opened, the reasoning and the
 * evidence.
 */
import type {
	AssessedDocument,
	AssessedDocuments,
	AssessmentCriterion,
	AssessmentOverview,
} from '@aicolab/insight-bridge-contracts/explorer'
import { Button, SelectControl } from '@aicolab/ui-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { fmt, useReportSurface } from '../surface.tsx'
import { AnalysisHead, lensWords, MoreButton, usePaged } from './common.tsx'

export type AssessedDocumentsLoader = (options: {
	offset: number
	sortBy?: number
	order?: 'asc' | 'desc'
	lensValue?: string | null
	cell?: { xCriterion: number; x: number; yCriterion: number; y: number }
}) => Promise<AssessedDocuments | null>

/** Where a score sits on its criterion's range (or the scores seen), 0 to 1: the ramp step it is drawn in. */
const placeOf = (score: number, low: number, high: number) =>
	high > low ? (score - low) / (high - low) : 0.5
/** The heat ramp's five steps, lowest first. */
const rampStep = (place: number) => `var(--s${Math.min(5, Math.max(1, Math.round(1 + place * 4)))})`

function rangeOf(c: AssessmentCriterion): [number, number] {
	if (c.range) return c.range
	const scores = c.distribution.map((d) => d.score)
	return [Math.min(...scores, 0), Math.max(...scores, 1)]
}

/** A distribution as one 100% bar, lowest score first, each score in its step of the ramp. */
function ScoreBar(props: {
	distribution: AssessmentCriterion['distribution']
	range: [number, number]
	scored: number
	noun: string
}) {
	return (
		<span
			class="ib-report-an-scorebar"
			role="img"
			aria-label={props.distribution.map((d) => `${d.score}: ${d.documents}`).join(', ')}
		>
			<For each={props.distribution}>
				{(d) => (
					<span
						class="ib-report-an-scorebar-seg"
						style={{
							'--w': `${props.scored ? (100 * d.documents) / props.scored : 0}%`,
							background: rampStep(placeOf(d.score, props.range[0], props.range[1])),
						}}
						title={`Score ${d.score}: ${d.documents} ${props.noun} (${props.scored ? Math.round((100 * d.documents) / props.scored) : 0}%)`}
					/>
				)}
			</For>
		</span>
	)
}

export function AssessmentView(props: {
	overview: AssessmentOverview
	assessedDocuments: AssessedDocumentsLoader
}) {
	const s = useReportSurface()
	const lens = () => lensWords(s)
	const ov = () => props.overview
	const docs = () => s.words.nouns.documents
	const [sortBy, setSortBy] = createSignal<number | null>(ov().criteria[0]?.criterionId ?? null)
	const [order, setOrder] = createSignal<'desc' | 'asc'>('desc')
	const [lensAt, setLensAt] = createSignal('all')
	const [cell, setCell] = createSignal<{ x: number; y: number } | null>(null)
	const lensValue = () =>
		lensAt() === 'all' ? undefined : (ov().lens[Number(lensAt())]?.value ?? undefined)
	const paged = usePaged(
		() => ({ sortBy: sortBy(), order: order(), lensValue: lensValue(), cell: cell() }),
		(k, offset) => {
			const j = ov().joint
			return props.assessedDocuments({
				offset,
				sortBy: k.sortBy ?? undefined,
				order: k.order,
				lensValue: k.lensValue,
				cell:
					j && k.cell ? { xCriterion: j.x, x: k.cell.x, yCriterion: j.y, y: k.cell.y } : undefined,
			})
		},
		(page) => page.documents,
	)
	const textOf = (criterionId: number) =>
		ov().criteria.find((c) => c.criterionId === criterionId)?.text ?? ''
	return (
		<div class="view-wrap ib-report-view-wide">
			<AnalysisHead
				task={ov().task}
				lede={`Every ${s.words.nouns.document} was scored against each criterion, with a one-line finding, the model's reasoning and the evidence it relied on. The bars show how the scores fell, lowest left; the grid shows the first two criteria together.`}
			/>
			<section class="sec" style={{ 'border-top': 'none' }}>
				<div class="ib-report-an-scorecards">
					<For each={ov().criteria}>
						{(c) => (
							<article class="ib-report-an-scorecard">
								<header>
									<span class="ib-report-an-eyebrow">{c.category}</span>
									<h3>{c.text}</h3>
									<Show when={c.description}>{(d) => <p class="fig-note">{d()}</p>}</Show>
								</header>
								<div class="ib-report-an-score-figures">
									<span class="ib-report-an-mean">{c.mean ?? '–'}</span>
									<span class="fig-note">{`mean of ${fmt(c.scored)} ${docs()}${c.range ? ` · scale ${c.range[0]}–${c.range[1]}` : ''}`}</span>
								</div>
								<ScoreBar
									distribution={c.distribution}
									range={rangeOf(c)}
									scored={c.scored}
									noun={docs()}
								/>
								<ul class="ib-report-an-score-legend">
									<For each={c.distribution}>
										{(d) => (
											<li>
												<span
													class="ib-report-an-swatch"
													style={{ background: rampStep(placeOf(d.score, ...rangeOf(c))) }}
												/>
												{`${d.score}: ${fmt(d.documents)}`}
											</li>
										)}
									</For>
								</ul>
								<Show when={c.byLens.length > 1}>
									<table class="ib-report-an-lens-table">
										<caption class="fig-note">{`By ${(lens().heading ?? 'group').toLowerCase()}`}</caption>
										<tbody>
											<For each={c.byLens}>
												{(l) => (
													<tr>
														<th scope="row">{lens().label(l.value)}</th>
														<td>
															<ScoreBar
																distribution={l.distribution}
																range={rangeOf(c)}
																scored={l.scored}
																noun={docs()}
															/>
														</td>
														<td class="ib-report-an-n">{l.mean ?? '–'}</td>
														<td class="ib-report-an-n">{fmt(l.scored)}</td>
													</tr>
												)}
											</For>
										</tbody>
									</table>
								</Show>
							</article>
						)}
					</For>
				</div>
			</section>
			<Show when={ov().joint}>
				{(j) => (
					<JointGrid joint={j()} criteria={ov().criteria} chosen={cell()} onChoose={setCell} />
				)}
			</Show>
			<section class="sec">
				<h2 class="sec-h">{`The ${docs()}, ranked`}</h2>
				<div class="ib-report-an-controls">
					<SelectControl
						aria-label="Rank by"
						value={String(sortBy() ?? '')}
						onChange={(e) => setSortBy(Number(e.currentTarget.value))}
					>
						<For each={ov().criteria}>
							{(c) => <option value={String(c.criterionId)}>{`Rank by ${c.text}`}</option>}
						</For>
					</SelectControl>
					<SelectControl
						aria-label="Order"
						value={order()}
						onChange={(e) => setOrder(e.currentTarget.value === 'asc' ? 'asc' : 'desc')}
					>
						<option value="desc">Highest first</option>
						<option value="asc">Lowest first</option>
					</SelectControl>
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
					<Show when={cell()}>
						{(c) => (
							<Button variant="outline" onClick={() => setCell(null)}>
								{`Scored ${c().x} and ${c().y} · clear`}
							</Button>
						)}
					</Show>
				</div>
				<Show when={paged.failed()}>
					{(e) => (
						<p class="fig-note" role="alert">
							{e()}
						</p>
					)}
				</Show>
				<ol class="ib-report-an-ranked">
					<For each={paged.items()}>
						{(d) => <RankedDocument d={d} textOf={textOf} criteria={ov().criteria} />}
					</For>
				</ol>
				<MoreButton
					shown={paged.items().length}
					total={paged.total()}
					busy={paged.busy()}
					onMore={paged.more}
					noun={docs()}
				/>
			</section>
		</div>
	)
}

/** The first two criteria scored together: a cell per pair of scores, shaded by its documents. */
function JointGrid(props: {
	joint: NonNullable<AssessmentOverview['joint']>
	criteria: AssessmentCriterion[]
	chosen: { x: number; y: number } | null
	onChoose: (cell: { x: number; y: number } | null) => void
}) {
	const s = useReportSurface()
	const xs = createMemo(() => [...new Set(props.joint.cells.map((c) => c.x))].sort((a, b) => a - b))
	const ys = createMemo(() => [...new Set(props.joint.cells.map((c) => c.y))].sort((a, b) => b - a))
	const max = () => Math.max(1, ...props.joint.cells.map((c) => c.documents))
	const at = (x: number, y: number) =>
		props.joint.cells.find((c) => c.x === x && c.y === y)?.documents ?? 0
	const name = (id: number) => props.criteria.find((c) => c.criterionId === id)?.text ?? ''
	return (
		<section class="sec">
			<h2 class="sec-h">{`${name(props.joint.x)} and ${name(props.joint.y)} together`}</h2>
			<p class="fig-note">{`Each cell counts the ${s.words.nouns.documents} that scored that pair. Choose a cell to rank only those ${s.words.nouns.documents}.`}</p>
			<div class="ib-report-an-joint-wrap">
				<table class="ib-report-an-joint">
					<thead>
						<tr>
							<th scope="col">{`${name(props.joint.y)} ↓ · ${name(props.joint.x)} →`}</th>
							<For each={xs()}>{(x) => <th scope="col">{x}</th>}</For>
						</tr>
					</thead>
					<tbody>
						<For each={ys()}>
							{(y) => (
								<tr>
									<th scope="row">{y}</th>
									<For each={xs()}>
										{(x) => (
											<td style={{ '--pct': String(Math.round((100 * at(x, y)) / max())) }}>
												<Show when={at(x, y)} fallback={<span class="ib-report-an-joint-empty" />}>
													<button
														type="button"
														aria-pressed={
															props.chosen?.x === x && props.chosen?.y === y ? 'true' : 'false'
														}
														onClick={() =>
															props.onChoose(
																props.chosen?.x === x && props.chosen?.y === y ? null : { x, y },
															)
														}
														title={`${at(x, y)} ${s.words.nouns.documents} scored ${x} and ${y}`}
													>
														{at(x, y)}
													</button>
												</Show>
											</td>
										)}
									</For>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</div>
		</section>
	)
}

function RankedDocument(props: {
	d: AssessedDocument
	textOf: (id: number) => string
	criteria: AssessmentCriterion[]
}) {
	const s = useReportSurface()
	const lens = () => lensWords(s)
	const rangeFor = (id: number) => {
		const c = props.criteria.find((x) => x.criterionId === id)
		return c ? rangeOf(c) : ([0, 1] as [number, number])
	}
	return (
		<li class="ib-report-an-ranked-doc">
			<div class="ib-report-an-evidence-who">
				<button
					type="button"
					class="dw-inline-link"
					onClick={() => s.open({ kind: 'source', key: props.d.documentId })}
				>
					{props.d.documentTitle ?? props.d.fileName}
				</button>
				<small class="fig-note">{props.d.entityName}</small>
				<Show when={s.words.lens}>
					<small class="ib-report-an-chip">{lens().label(props.d.lensValue)}</small>
				</Show>
			</div>
			<ul class="ib-report-an-doc-scores">
				<For each={props.d.scores}>
					{(x) => (
						<li>
							<span
								class="ib-report-an-score-dot"
								style={{
									background:
										x.score === null
											? 'transparent'
											: rampStep(placeOf(x.score, ...rangeFor(x.criterionId))),
								}}
							>
								{x.score ?? '–'}
							</span>
							<span class="ib-report-an-score-what">
								<small>{props.textOf(x.criterionId)}</small>
								<span>{x.keyPoint}</span>
							</span>
						</li>
					)}
				</For>
			</ul>
			<details class="ib-report-an-points">
				<summary>Reasoning and evidence</summary>
				<For each={props.d.scores}>
					{(x) => (
						<div class="ib-report-an-reasoning">
							<strong>{props.textOf(x.criterionId)}</strong>
							<p>{x.details}</p>
							<For each={x.quotes}>
								{(quote) => <blockquote class="ib-report-an-quote">{quote}</blockquote>}
							</For>
						</div>
					)}
				</For>
			</details>
		</li>
	)
}
