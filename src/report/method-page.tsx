/**
 * Method — how the record was read, and how to read what came out, for every
 * Insight Bridge report.
 *
 * Two halves, from two places, and the split is the point: THE SHARED RULES
 * (`InsightBridgeReading`) hold for every corpus; THIS RUN'S ACCOUNT is
 * derived from the run's own row and committed build (core's `buildMethod`),
 * save what the host authored around it (its collection, how it loaded its
 * site). Every count is live. What only one corpus can say — where its data is
 * served from, its notes on particular sources — the host passes in.
 *
 * Moved from Training Data's routes/method.tsx (2026-10-21), with the
 * pipeline's run-site method page's account of a scale that measures no
 * agreement.
 */
import type { MethodData, RunMethod } from '@aicolab/insight-bridge-contracts/explorer'
import { Eyebrow } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { For, Show } from 'solid-js'
import { InsightBridgeReading } from '../about.tsx'
import {
	cap,
	fmt,
	type ReportSurface,
	ReportSurfaceContext,
	useReportSurface,
	vocabularyOf,
} from './surface.tsx'
import './report.css'

/** What only the host can add to its method page, each a lazy slot. */
export interface MethodAdditions {
	/** After the opening account: where this deployment serves its data from. */
	serving?: () => JSX.Element
	/** After the run's own notes: the host's notes on particular sources. */
	notes?: () => JSX.Element
	/** More figures for the closing chips. */
	chips?: string[]
}

export function MethodPage(props: {
	method: RunMethod
	data: MethodData
	surface: ReportSurface
	additions?: MethodAdditions
}) {
	return (
		<ReportSurfaceContext value={props.surface}>
			<MethodBody method={props.method} data={props.data} additions={props.additions} />
		</ReportSurfaceContext>
	)
}

function MethodBody(props: {
	method: RunMethod
	data: MethodData
	additions: MethodAdditions | undefined
}) {
	const s = useReportSurface()
	const v = vocabularyOf(s)
	const m = () => props.method
	const o = () => props.data.overview
	const nouns = () => s.words.nouns
	const lensHeading = () => {
		const lens = s.words.lens
		return lens ? (s.words.facets[lens]?.heading ?? lens) : null
	}

	return (
		<div class="view-wrap">
			<header class="view-head">
				<Eyebrow>§ Method</Eyebrow>
				<h1 class="view-title">How the record was read</h1>
			</header>

			<section class="sec" style={{ 'border-top': 'none' }}>
				<p class="ib-report-lede measure">
					This site reads a single database built by the <strong>insight-bridge</strong> pipeline
					from{' '}
					<Show when={s.words.source} fallback="its corpus">
						{(source) => (
							<a class="dw-inline-link" href={source().href} target="_blank" rel="noreferrer">
								{source().label}
							</a>
						)}
					</Show>
					: <strong>{fmt(o().sources)}</strong> {nouns().entities},{' '}
					<strong>{fmt(o().documents)}</strong> {nouns().documents},{' '}
					<strong>{fmt(o().passages)}</strong> passages, <strong>{fmt(o().memberships)}</strong>{' '}
					{nouns().entity}–topic memberships, <strong>{fmt(o().stances)}</strong> {nouns().entity}
					-level stances
					<Show when={lensHeading()}>
						{(heading) => (
							<span>
								, <strong>{fmt(o().lensRows)}</strong> {heading().toLowerCase()} perspectives
							</span>
						)}
					</Show>
					<Show when={o().questions}>
						<span>
							{' '}
							and <strong>{fmt(o().answers)}</strong> answers to {v.questionsPhrase}
						</span>
					</Show>
					.
				</p>
				<Show when={props.additions?.serving}>{(serving) => serving()()}</Show>

				<h3 class="sec-h ib-report-h">What was done, in order</h3>
				<p class="sec-sub">
					Each step below is a stage this run actually executed, read from the run's own record of
					itself; a stage the run was configured to skip is not listed.
				</p>
				<ol class="pipeline">
					<For each={m().stages}>
						{(stage) => (
							<li class="pipeline-stage reveal">
								<div class="pipeline-t">{stage.title}</div>
								<p class="pipeline-b">{stage.body}</p>
							</li>
						)}
					</For>
				</ol>

				<Show when={m().attempts.length > 1}>
					<h3 class="sec-h ib-report-h">The clustering attempts</h3>
					<p class="sec-sub">
						The tuning gate walked these settings before the last row was committed. The minimum
						cluster size decides how many passages a group must hold to count as a topic; noise is
						the passages left in no topic.
					</p>
					<div class="fig reveal heat-wrap">
						<table class="heat attempts">
							<thead>
								<tr>
									<th scope="col">Attempt</th>
									<th scope="col">Min cluster size</th>
									<th scope="col">Topics</th>
									<th scope="col">Noise passages</th>
								</tr>
							</thead>
							<tbody>
								<For each={m().attempts}>
									{(a, i) => (
										<tr class={{ committed: i() === m().attempts.length - 1 }}>
											<th scope="row">{i() === m().attempts.length - 1 ? 'committed' : i() + 1}</th>
											<td>{a.minClusterSize}</td>
											<td>{a.clusters}</td>
											<td>{fmt(a.noise)}</td>
										</tr>
									)}
								</For>
							</tbody>
						</table>
					</div>
				</Show>

				<h3 class="sec-h ib-report-h">What each {nouns().entity} was classified by</h3>
				<p class="sec-sub">
					Every facet the run's profile declares. A facet marked <em>compared</em> is one the
					analysis wrote a perspective for, value by value — the lens you can read a topic through.
					Facets that are not compared ride beside it as facets of the record.
				</p>
				<div class="defs">
					<For each={m().facets}>{(facet) => <FacetDefinition facet={facet} />}</For>
				</div>

				<h3 class="sec-h ib-report-h">What a position means here</h3>
				<p class="sec-sub">
					<Show
						when={m().scale.agreement}
						fallback="This run's scale does not measure agreement. Read the labels as what they say and not as a spectrum from support to opposition."
					>
						{(agreement) =>
							`Read weakest claim first. ${agreement().supportive.join(', ')} ${agreement().supportive.length === 1 ? 'agrees' : 'agree'} with a topic's proposition; ${agreement().contesting.join(', ')} ${agreement().contesting.length === 1 ? 'pushes' : 'push'} back against it${agreement().unclear ? `; ${agreement().unclear} reads as neither` : ''}.`
						}
					</Show>
				</p>
				<div class="defs">
					<For each={m().scale.labels}>
						{(label) => (
							<>
								<div class="def-t">{label}</div>
								<div class="def-b">{m().scale.definitions[label] ?? '—'}</div>
							</>
						)}
					</For>
				</div>
				<Show when={m().scale.guidance}>{(guidance) => <p class="fig-note">{guidance()}</p>}</Show>

				<InsightBridgeReading
					corpusNotesTitle="In this run"
					corpusNotes={() => (
						<RunNotes method={m()} data={props.data} additions={props.additions} />
					)}
				/>

				<Show when={m().tasks.length}>
					<h3 class="sec-h ib-report-h">What else was asked of every {nouns().document}</h3>
					<p class="sec-sub">
						Beyond the standard reading, this run declared its own questions and put each of them to
						every {nouns().document}.
					</p>
					<div class="defs">
						<For each={m().tasks}>
							{(task) => (
								<>
									<div class="def-t">{task.title}</div>
									<div class="def-b">{task.description}</div>
								</>
							)}
						</For>
					</div>
				</Show>

				<Show when={m().glossary.length}>
					<h3 class="sec-h ib-report-h">Words this corpus uses</h3>
					<p class="sec-sub">
						Terms the run was given before it read anything, so that its own writing uses them the
						way this field does.
					</p>
					<div class="defs">
						<For each={m().glossary}>
							{(entry) => (
								<>
									<div class="def-t">{entry.term}</div>
									<div class="def-b">
										{entry.meaning}
										<Show when={entry.note}>
											{(note) => (
												<span>
													{' '}
													<em>{note()}</em>
												</span>
											)}
										</Show>
									</div>
								</>
							)}
						</For>
					</div>
				</Show>

				<h3 class="sec-h ib-report-h">Which model did what</h3>
				<p class="sec-sub">
					Named because it matters: the reading, the writing-up and the grouping were done by these,
					and a different model would have produced a different record.
				</p>
				<div class="defs">
					<For each={m().models}>
						{(role) => (
							<>
								<div class="def-t">{role.model}</div>
								<div class="def-b">{role.role}</div>
							</>
						)}
					</For>
				</div>

				<div class="chips">
					<For
						each={[
							`${fmt(o().sources)} ${nouns().entities}`,
							`${fmt(o().documents)} ${nouns().documents}`,
							...(props.additions?.chips ?? []),
							`${fmt(o().passages)} passages`,
							`${fmt(o().keyPoints)} key points`,
							`${fmt(o().quotes)} quotes · ${o().quotesVerifiedPct}% verified`,
							`${fmt(o().topics)} topics · ${fmt(o().junkTopics)} removed`,
							...o().generations.map((g) => `${fmt(g.count)} ${g.labelPlural}`),
							`${fmt(o().memberships)} memberships`,
							`${fmt(o().stances)} stances`,
							...(lensHeading()
								? [`${fmt(o().lensRows)} ${(lensHeading() ?? '').toLowerCase()} perspectives`]
								: []),
							...(o().questions
								? [`${fmt(o().questions)} ${v.question}s · ${fmt(o().answers)} answers`]
								: []),
						]}
					>
						{(chip) => <span class="chip-s">{chip}</span>}
					</For>
				</div>
			</section>
		</div>
	)
}

/** One facet as the method states it: whether it was compared, where it is recorded, its values. */
function FacetDefinition(props: { facet: RunMethod['facets'][number] }) {
	const s = useReportSurface()
	const heading = (key: string) =>
		s.words.facets[key]?.heading ?? cap(props.facet.key === key ? props.facet.noun : key)
	const descriptions = () => s.words.facets[props.facet.key]?.descriptions ?? {}
	return (
		<>
			<div class="def-t">{heading(props.facet.key)}</div>
			<div class="def-b">
				{(props.facet.analysed ? 'Compared. ' : '') +
					(props.facet.granularity === 'document'
						? `Recorded per ${s.words.nouns.document}. `
						: '') +
					(props.facet.derivedFrom ? `Computed from ${heading(props.facet.derivedFrom)}. ` : '') +
					(props.facet.values.length
						? props.facet.values
								.map((v) => (descriptions()[v] ? `${v} (${descriptions()[v]})` : v))
								.join(' · ')
						: props.facet.kind === 'free'
							? 'Recorded as written, with no fixed list of values.'
							: 'Its values come from a vocabulary held with the run.')}
				<Show when={props.facet.excludedValues.length > 0}>
					<em> Left out of comparisons: {props.facet.excludedValues.join(', ')}.</em>
				</Show>
			</div>
		</>
	)
}

/**
 * What is particular to this run, in the slot the shared reading rules provide
 * for it. A component of its own (not JSX handed over as a prop expression):
 * Solid 2 numbers hydration keys per component, and a subtree built inside a
 * prop expression is numbered differently on the server and the client.
 */
function RunNotes(props: {
	method: RunMethod
	data: MethodData
	additions: MethodAdditions | undefined
}) {
	const s = useReportSurface()
	const v = vocabularyOf(s)
	const nouns = () => s.words.nouns
	const heading = (key: string) => (s.words.facets[key]?.heading ?? key).toLowerCase()
	return (
		<div class="measure">
			<Show when={props.data.junk.length}>
				<p>
					<strong>Removed after review.</strong>{' '}
					{props.data.junk
						.map(
							(j) =>
								`“${j.title}”${j.reason ? ` — ${j.reason.replace(/\.$/, '')}` : ' — confirmed by the reviewer without a model flag'}.`,
						)
						.join(' ')}{' '}
					{`${props.data.junk.length === 1 ? 'It is' : 'They are'} excluded from every figure on this site, including the ${fmt(props.data.overview.topics)} topics counted above.`}
				</p>
			</Show>
			<Show when={props.data.unanalysed.length}>
				<p>
					<strong>Not analysed.</strong>{' '}
					<For each={props.data.unanalysed}>
						{(u, i) => (
							<span>
								{i() > 0 ? '; ' : ''}
								<button
									type="button"
									class="dw-inline-link"
									onClick={() => s.open({ kind: 'source', key: u.entityId })}
								>
									{u.title}
								</button>
							</span>
						)}
					</For>
					{`. Step 1 produced no key points for ${props.data.unanalysed.length === 1 ? 'this document' : 'these documents'}; ${props.data.unanalysed.length === 1 ? 'it keeps its' : 'they keep their'} topic memberships.`}
				</p>
			</Show>
			<Show when={props.method.exclusions.length}>
				<p>
					<strong>Kept out of the analysis.</strong>{' '}
					{props.method.exclusions
						.map(
							(rule) =>
								`${nouns().entities} whose ${heading(rule.facet)} is ${rule.values.join(' or ')}`,
						)
						.join('; ')}
					. They are in the record and can be read, but no topic or perspective was written from
					them.
				</p>
			</Show>
			<Show when={props.data.overview.questions}>
				<p>
					<strong>{cap(v.questionsPhrase)} are answered per document.</strong>
					{` A ${nouns().entity} with more than one document may answer a ${v.question} twice; the ${v.questionsTitle} page counts a ${nouns().entity} once. An unanswered ${v.question} means no answer was located in the available text, never that a ${nouns().entity} has no view.`}
				</p>
			</Show>
			<Show when={props.additions?.notes}>{(notes) => notes()()}</Show>
		</div>
	)
}
