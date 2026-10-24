/**
 * A criteria assessment's page — the one kind of custom analysis with real
 * numbers. Every figure reads the scores in BANDS (explorer/bands.ts): a model
 * scores in steps finer than a reader thinks in, so a legend of every distinct
 * score (3.2, 3.7, 4.8 …) would be noise. Each criterion is a scorecard: its
 * declared range, the mean, and how its documents fall across the bands as one
 * 100% bar on a sequential ramp (a severity scale has no neutral middle, so it
 * never diverges), with each band's count and share; then the same bar for
 * each lens value. With two or more criteria, the first two are read together
 * on a grid of their bands; a cell narrows the ranked documents below to the
 * documents in both bands. The ranked list leads with each document's own
 * scores, its one-line finding and, opened, the reasoning and the evidence.
 */
import type {
	AssessedDocument,
	AssessedDocuments,
	AssessmentCriterion,
	AssessmentOverview,
} from '@aicolab/insight-bridge-contracts/explorer'
import { Button, SelectControl } from '@aicolab/ui-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import {
	bandCounts,
	defaultBands,
	inRange,
	type ScoreBand,
	type ScoreRange,
} from '../../explorer/bands.ts'
import { fmt, useReportSurface } from '../surface.tsx'
import {
	AnalysisHead,
	lensWords,
	MoreButton,
	useDocumentName,
	usePaged,
	WordsNotice,
	wordsClass,
} from './common.tsx'

export type AssessedDocumentsLoader = (options: {
	offset: number
	sortBy?: number
	order?: 'asc' | 'desc'
	lensValue?: string | null
	cell?: { xCriterion: number; x: ScoreRange; yCriterion: number; y: ScoreRange }
}) => Promise<AssessedDocuments | null>

/** A host's own bands for a criterion (by its words), or none for the scale's whole points. */
export type ScoreBandsOf = (criterion: AssessmentCriterion) => readonly ScoreBand[] | undefined

/** The heat ramp's five steps, a band's place among its bands: lowest band first. */
const rampStep = (index: number, count: number) =>
	`var(--s${count > 1 ? Math.round(1 + (4 * index) / (count - 1)) : 3})`

function rangeOf(c: AssessmentCriterion): [number, number] {
	if (c.range) return c.range
	const scores = c.distribution.map((d) => d.score)
	return [Math.min(...scores, 0), Math.max(...scores, 1)]
}

/** A criterion's name for an axis or a chip: its words before their parenthesised rubric. */
const shortName = (text: string) => text.split(' (')[0]?.trim() || text

/** A band's bounds, for the server's filter. */
const rangeOfBand = (band: ScoreBand): ScoreRange => ({
	min: band.min,
	max: band.max,
	minOpen: band.minOpen,
	maxOpen: band.maxOpen,
})

const share = (part: number, whole: number) => (whole ? Math.round((100 * part) / whole) : 0)

/** Documents across the bands as one 100% bar, lowest band first. */
function BandBar(props: {
	bands: readonly ScoreBand[]
	counts: number[]
	scored: number
	noun: string
}) {
	return (
		<span
			class="ib-report-an-scorebar"
			role="img"
			aria-label={props.bands.map((b, i) => `${b.label}: ${props.counts[i] ?? 0}`).join(', ')}
		>
			<For each={props.bands}>
				{(band, i) => (
					<span
						class="ib-report-an-scorebar-seg"
						style={{
							'--w': `${share(props.counts[i()] ?? 0, props.scored)}%`,
							background: rampStep(i(), props.bands.length),
						}}
						title={`${band.label}${band.note ? ` (${band.note})` : ''}: ${props.counts[i()] ?? 0} ${props.noun} (${share(props.counts[i()] ?? 0, props.scored)}%)`}
					/>
				)}
			</For>
		</span>
	)
}

export function AssessmentView(props: {
	overview: AssessmentOverview
	assessedDocuments: AssessedDocumentsLoader
	/** The host's own bands for a criterion; the scale's whole points where it names none. */
	bands?: ScoreBandsOf
}) {
	const s = useReportSurface()
	const lens = () => lensWords(s)
	const ov = () => props.overview
	const docs = () => s.words.nouns.documents
	const bandsOf = (c: AssessmentCriterion): readonly ScoreBand[] =>
		props.bands?.(c) ?? defaultBands(rangeOf(c))
	const bandsFor = (criterionId: number): readonly ScoreBand[] => {
		const c = ov().criteria.find((x) => x.criterionId === criterionId)
		return c ? bandsOf(c) : []
	}
	// the reader's choice only; until they choose, the first criterion (read where it is read, so it tracks)
	const [chosenSort, setSortBy] = createSignal<number | null | undefined>(undefined)
	const sortBy = () => {
		const chosen = chosenSort()
		return chosen === undefined ? (ov().criteria[0]?.criterionId ?? null) : chosen
	}
	const [order, setOrder] = createSignal<'desc' | 'asc'>('desc')
	const [lensAt, setLensAt] = createSignal('all')
	/** The chosen grid cell, as the band of each criterion. */
	const [cell, setCell] = createSignal<{ x: number; y: number } | null>(null)
	const lensValue = () =>
		lensAt() === 'all' ? undefined : (ov().lens[Number(lensAt())]?.value ?? undefined)
	const cellRanges = () => {
		const j = ov().joint
		const c = cell()
		if (!j || !c) return undefined
		const x = bandsFor(j.x)[c.x]
		const y = bandsFor(j.y)[c.y]
		return x && y
			? { xCriterion: j.x, x: rangeOfBand(x), yCriterion: j.y, y: rangeOfBand(y) }
			: undefined
	}
	const paged = usePaged(
		() => ({ sortBy: sortBy(), order: order(), lensValue: lensValue(), cell: cellRanges() }),
		(k, offset) =>
			props.assessedDocuments({
				offset,
				sortBy: k.sortBy ?? undefined,
				order: k.order,
				lensValue: k.lensValue,
				cell: k.cell,
			}),
		(page) => page.documents,
	)
	const textOf = (criterionId: number) =>
		ov().criteria.find((c) => c.criterionId === criterionId)?.text ?? ''
	const cellWords = () => {
		const j = ov().joint
		const c = cell()
		if (!j || !c) return null
		const x = bandsFor(j.x)[c.x]?.label ?? ''
		const y = bandsFor(j.y)[c.y]?.label ?? ''
		return {
			short: `${x} × ${y}`,
			full: `${shortName(textOf(j.x))}: ${x} · ${shortName(textOf(j.y))}: ${y}`,
		}
	}
	return (
		<div class="view-wrap ib-report-view-wide">
			<AnalysisHead
				task={ov().task}
				lede={`Every ${s.words.nouns.document} was scored against each criterion, with a one-line finding, the model's reasoning and the evidence it relied on. The bars show how the ${s.words.nouns.documents} fall across each scale's bands, lowest left; the grid reads the first two criteria together.`}
			/>
			<section class="sec" style={{ 'border-top': 'none' }}>
				<div class="ib-report-an-scorecards">
					<For each={ov().criteria}>
						{(c) => {
							const bands = createMemo(() => bandsOf(c))
							const counts = createMemo(() => bandCounts(bands(), c.distribution))
							return (
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
									<BandBar bands={bands()} counts={counts()} scored={c.scored} noun={docs()} />
									<ul class="ib-report-an-score-legend">
										<For each={bands()}>
											{(band, i) => (
												// the key names the bands; its range and counts are on hover, as the bar's are
												<li
													title={`${band.label}${band.note ? ` (${band.note})` : ''}: ${fmt(counts()[i()] ?? 0)} ${docs()} (${share(counts()[i()] ?? 0, c.scored)}%)`}
												>
													<span
														class="ib-report-an-swatch"
														style={{ background: rampStep(i(), bands().length) }}
													/>
													{band.label}
												</li>
											)}
										</For>
									</ul>
									<Show when={c.byLens.length > 1}>
										<table class="ib-report-an-lens-table">
											<caption class="fig-note">{`By ${(lens().heading ?? 'group').toLowerCase()}`}</caption>
											<thead>
												<tr>
													<td />
													<td />
													<th scope="col" class="ib-report-an-n">
														Mean
													</th>
												</tr>
											</thead>
											<tbody>
												<For each={c.byLens}>
													{(l) => (
														// one number per row, its mean; how many it holds is on hover
														<tr
															title={`${lens().label(l.value)}: mean ${l.mean ?? '–'} over ${fmt(l.scored)} ${docs()}`}
														>
															<th scope="row">{lens().label(l.value)}</th>
															<td>
																<BandBar
																	bands={bands()}
																	counts={bandCounts(bands(), l.distribution)}
																	scored={l.scored}
																	noun={docs()}
																/>
															</td>
															<td class="ib-report-an-n">{l.mean ?? '–'}</td>
														</tr>
													)}
												</For>
											</tbody>
										</table>
									</Show>
								</article>
							)
						}}
					</For>
				</div>
			</section>
			<Show when={ov().joint}>
				{(j) => (
					<JointGrid
						joint={j()}
						xName={shortName(textOf(j().x))}
						yName={shortName(textOf(j().y))}
						xBands={bandsFor(j().x)}
						yBands={bandsFor(j().y)}
						chosen={cell()}
						onChoose={setCell}
					/>
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
							{(c) => (
								<option value={String(c.criterionId)}>{`Rank by ${shortName(c.text)}`}</option>
							)}
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
					<Show when={cellWords()}>
						{(words) => (
							<Button variant="outline" title={words().full} onClick={() => setCell(null)}>
								{`${words().short} · clear`}
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
						{(d) => <RankedDocument d={d} textOf={textOf} bandsFor={bandsFor} />}
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

/** The first two criteria read together: a cell per pair of their bands, shaded by its documents. */
function JointGrid(props: {
	joint: NonNullable<AssessmentOverview['joint']>
	xName: string
	yName: string
	xBands: readonly ScoreBand[]
	yBands: readonly ScoreBand[]
	chosen: { x: number; y: number } | null
	onChoose: (cell: { x: number; y: number } | null) => void
}) {
	const s = useReportSurface()
	/** Documents per band pair, from the exact pairs the read counted. */
	const at = createMemo(() =>
		props.yBands.map((yb) =>
			props.xBands.map((xb) =>
				props.joint.cells.reduce(
					(n, c) => (inRange(xb, c.x) && inRange(yb, c.y) ? n + c.documents : n),
					0,
				),
			),
		),
	)
	const max = () => Math.max(1, ...at().flat())
	const count = (x: number, y: number) => at()[y]?.[x] ?? 0
	const isChosen = (x: number, y: number) => props.chosen?.x === x && props.chosen?.y === y
	// the highest band of the y criterion at the top
	const rows = () => props.yBands.map((_, i) => props.yBands.length - 1 - i)
	return (
		<section class="sec">
			<h2 class="sec-h">The first two criteria, together</h2>
			<p class="fig-note">{`Each cell counts the ${s.words.nouns.documents} in both bands. Choose a cell to rank only those ${s.words.nouns.documents}.`}</p>
			<div class="ib-report-an-joint-wrap">
				<table class="ib-report-an-joint">
					<caption class="fig-note">
						<span>{`Columns: ${props.xName}`}</span>
						<span>{`Rows: ${props.yName}`}</span>
					</caption>
					<thead>
						<tr>
							<td />
							<For each={props.xBands}>{(band) => <th scope="col">{band.label}</th>}</For>
						</tr>
					</thead>
					<tbody>
						<For each={rows()}>
							{(y) => (
								<tr>
									<th scope="row">{props.yBands[y]?.label}</th>
									<For each={props.xBands}>
										{(_, x) => (
											<td style={{ '--pct': String(Math.round((100 * count(x(), y)) / max())) }}>
												<Show
													when={count(x(), y)}
													fallback={<span class="ib-report-an-joint-empty" />}
												>
													<button
														type="button"
														aria-pressed={isChosen(x(), y) ? 'true' : 'false'}
														onClick={() => props.onChoose(isChosen(x(), y) ? null : { x: x(), y })}
														title={`${fmt(count(x(), y))} ${s.words.nouns.documents}: ${props.xName} ${props.xBands[x()]?.label}, ${props.yName} ${props.yBands[y]?.label}`}
													>
														{fmt(count(x(), y))}
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
	bandsFor: (criterionId: number) => readonly ScoreBand[]
}) {
	const s = useReportSurface()
	const name = useDocumentName()
	const lens = () => lensWords(s)
	/** A score's colour: its band's step on the ramp. */
	const colourOf = (criterionId: number, score: number | null) => {
		if (score === null) return 'transparent'
		const bands = props.bandsFor(criterionId)
		const index = bands.findIndex((b) => inRange(b, score))
		return index < 0 ? 'transparent' : rampStep(index, bands.length)
	}
	return (
		<li class={['ib-report-an-ranked-doc', wordsClass(props.d)]}>
			<div class="ib-report-an-evidence-who">
				<button
					type="button"
					class="dw-inline-link"
					onClick={() => s.open({ kind: 'source', key: props.d.documentId })}
				>
					{name(props.d.documentId)}
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
								style={{ background: colourOf(x.criterionId, x.score) }}
							>
								{x.score ?? '–'}
							</span>
							<span class="ib-report-an-score-what">
								<small>{shortName(props.textOf(x.criterionId))}</small>
								<span>{x.keyPoint}</span>
							</span>
						</li>
					)}
				</For>
			</ul>
			<WordsNotice of={props.d} />
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
