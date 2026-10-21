/**
 * The Overview — a report's landing page, for every Insight Bridge report:
 * the run in one paragraph, its scale in live figures, the record's structure
 * as a tree, who is in it by the run's lens, the widest-reaching topic, and the
 * doors into the deep views. Every figure is the database's at request time
 * (explorer/pages reportOverview and landscape); every word that is not the
 * pipeline's is the run's own (RunWords). What only one corpus can say — a
 * note under a figure, a picture beside the title — the host passes in.
 *
 * Moved from Training Data's routes/index.tsx and the pipeline's run-site
 * overview (2026-10-21), the richer of the two with the other's doors.
 */
import type { Landscape, ReportOverview } from '@aicolab/insight-bridge-contracts/explorer'
import { Eyebrow } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { For, Show } from 'solid-js'
import { StructureTree } from '../brief/structure-tree.tsx'
import { BarList, DoorCard, PositionStrip, StatTiles } from '../site/figures.tsx'
import { kindLabel } from './analysis/common.tsx'
import {
	cap,
	fmt,
	type ReportSurface,
	ReportSurfaceProvider,
	tasksOf,
	useReportSurface,
} from './surface.tsx'
import './report.css'

/** What only the host can add: notes under the headline figures, a sentence after the source, and a picture beside the title. */
export interface OverviewAdditions {
	notes?: { sources?: string; documents?: string }
	/** The facet whose values `overview.documentsBy` counts, so they can be named. */
	documentFacet?: string
	/** Follows "The evidence came from …" — what the host's records promise about it. */
	sourceNote?: string
	/** Rendered beside the title, in place — a function, so the element is made where it is drawn (hydration walks the DOM in order). */
	hero?: () => JSX.Element
}

export function OverviewPage(props: {
	overview: ReportOverview
	landscape: Landscape
	surface: ReportSurface
	additions?: OverviewAdditions
}) {
	return (
		<ReportSurfaceProvider surface={props.surface}>
			<OverviewBody
				overview={props.overview}
				landscape={props.landscape}
				additions={props.additions}
			/>
		</ReportSurfaceProvider>
	)
}

function OverviewBody(props: {
	overview: ReportOverview
	landscape: Landscape
	additions: OverviewAdditions | undefined
}) {
	const s = useReportSurface()
	const tasks = () => tasksOf(s.words)
	const o = () => props.overview
	const land = () => props.landscape
	const w = () => s.words
	const nouns = () => w().nouns
	const lens = () => w().lens
	const lensHeading = () => {
		const l = lens()
		return l ? (w().facets[l]?.heading ?? l) : null
	}
	const busiest = () => land().topics[0]
	const flat = () => land().groups.length === 0
	const lensPlural = (count: number) => {
		const heading = lensHeading()
		return heading ? ` across ${fmt(count)} ${heading.toLowerCase()}${count === 1 ? '' : 's'}` : ''
	}
	const lensVocabulary = () => {
		const l = lens()
		return l ? (w().facets[l]?.order.length ?? 0) : 0
	}
	/** What a custom analysis task's page holds, by its kind. */
	const taskDoor = (kind: string) => {
		const heading = lensHeading()?.toLowerCase()
		const by = heading ? `, by ${heading}` : ''
		switch (kind) {
			case 'question_response':
				return `Each question put to every ${nouns().document}: who answered it${by}, and every answer with its key points and quotes.`
			case 'metadata_tagging':
				return `Every ${nouns().document} tagged against a vocabulary: what was tagged most, what was primary, and what each ${heading ?? 'group'} tagged more than others.`
			case 'perspective_analysis':
				return `What each ${nouns().entity} said against each criterion, with their own words${by}.`
			case 'criteria_assessment':
				return `Every ${nouns().document} scored against each criterion: how the scores fell${by}, and the ${nouns().documents} ranked with the reasoning.`
			default:
				return `The measures the ${nouns().documents} proposed, grouped by name, with the data each would take to collect.`
		}
	}
	const connectDoor = () => {
		const heading = lensHeading()
		return (
			`The same data over a Model Context Protocol server: add it as a connector and an agent can search the passages` +
			(heading ? `, split any topic by ${heading.toLowerCase()}` : '') +
			`, read every ${nouns().entity}'s stance` +
			(tasks().length ? ' and every custom analysis' : '') +
			'.'
		)
	}
	const documentsNote = () => {
		const facet = props.additions?.documentFacet
		if (props.additions?.notes?.documents) return props.additions.notes.documents
		if (!facet || !o().documentsBy.length) return undefined
		return o()
			.documentsBy.map((d) => {
				const word = (w().facets[facet]?.values[d.value] ?? d.value).toLowerCase()
				return `${fmt(d.documents)} ${word}${d.documents === 1 ? '' : 's'}`
			})
			.join(' · ')
	}

	return (
		<div class="view-wrap">
			<header class={['view-head', { 'ib-report-home-hero': !!props.additions?.hero }]}>
				<div>
					<Show when={w().eyebrow}>{(e) => <Eyebrow>{e()}</Eyebrow>}</Show>
					<h1 class="view-title ib-report-landing-title">{w().title}</h1>
					<p class="view-stand">
						{w().standfirst}{' '}
						<Show when={w().source}>
							{(source) => (
								<span>
									The evidence came from{' '}
									<a class="dw-inline-link" href={source().href} target="_blank" rel="noreferrer">
										{source().label}
									</a>
									{props.additions?.sourceNote ? `, ${props.additions.sourceNote}.` : '.'}
								</span>
							)}
						</Show>
					</p>
				</div>
				<Show when={props.additions?.hero}>{(hero) => <>{hero()()}</>}</Show>
			</header>

			<section class="sec" style={{ 'border-top': 'none' }}>
				<StatTiles
					items={[
						{
							n: fmt(o().sources),
							l: `${nouns().entities} read end-to-end`,
							note: props.additions?.notes?.sources,
						},
						{ n: fmt(o().documents), l: nouns().documents, note: documentsNote() },
						{ n: fmt(o().passages), l: 'passages embedded' },
						{
							n: fmt(o().topics),
							l: 'topics',
							note: o().junkTopics ? `${fmt(o().junkTopics)} removed after review` : undefined,
						},
						...(o().stances
							? [
									{
										n: fmt(o().stances),
										l: `${nouns().entity}-level stances`,
										note: `by ${fmt(o().stancedSources)} ${nouns().entities}`,
									},
								]
							: [{ n: fmt(o().keyPoints), l: 'key points' }]),
						...(o().questions
							? [
									{
										n: fmt(o().answers),
										l: 'answers to questions',
										note: `${fmt(o().questions)} question${o().questions === 1 ? '' : 's'} · ${fmt(o().answeringSources)} ${nouns().entities} answered at least one`,
									},
								]
							: [{ n: fmt(o().quotes), l: 'verbatim quotes' }]),
					]}
				/>
			</section>

			<Show when={land().topics.length > 0}>
				<section class="sec">
					<h2 class="sec-h">How the record is organised</h2>
					<p class="sec-sub">
						{flat()
							? `The pipeline read the ${fmt(o().sources)} ${nouns().entities} into ${fmt(o().topics)} topics, each a proposition the ${nouns().documents} argue about. Every name below is the pipeline's; click a topic to open it.`
							: `The pipeline read the ${fmt(o().sources)} ${nouns().entities} into ${fmt(o().topics)} topics and grouped the topics into ${fmt(land().groups.length)} ${land().generations[0]?.labelPlural ?? 'groups'}. Every name below is the pipeline's; click a ${land().generations[0]?.label ?? 'group'} or a topic to open it.`}
					</p>
					<StructureTree
						groups={land().groups.map((g) => ({
							id: g.superclusterId,
							generation: g.generation,
							title: g.title,
							parentId: g.parentId,
							topics: g.topics,
							sources: g.sources,
						}))}
						topics={land().topics.map((t) => ({
							id: t.topicClusterId,
							title: t.title,
							parentId: t.parentId,
							sources: t.sources,
						}))}
						top={land().top}
						generations={land().generations}
						sources={o().sources}
						sourceLabel={nouns().entities}
						onOpen={(node) => s.open({ kind: node.kind, key: node.id })}
					/>
					<p class="fig-note">
						<s.Link section="topics" class="dw-inline-link">
							Read the topics →
						</s.Link>
						{` — every topic with its claim, its figures and its reading; every topic and ${nouns().entity} opens the record.`}
					</p>
				</section>
			</Show>

			<section class="sec">
				<div class="grid2">
					<Show when={lens() && lensHeading()}>
						{(heading) => (
							<div class="fig reveal">
								<div class="fig-title">
									Who is in the record — {nouns().entities} by {heading().toLowerCase()}
								</div>
								<BarList
									labelWidth={150}
									color="var(--s2)"
									rows={o().lensValues.map((row) => {
										const l = lens() ?? ''
										const value = row.value
										return {
											label:
												value === null ? 'Unclassified' : (w().facets[l]?.values[value] ?? value),
											value: row.sources,
											tip: value === null ? undefined : w().facets[l]?.descriptions[value],
										}
									})}
								/>
								<p class="fig-note">
									{`The pipeline's classification of each ${nouns().entity}, on the profile's ${lensVocabulary() ? `${lensVocabulary()}-value` : 'own'} vocabulary.`}
								</p>
							</div>
						)}
					</Show>
					<Show when={busiest()}>
						{(t) => (
							<div class="fig reveal">
								<div class="fig-title">The widest-reaching topic</div>
								<button
									type="button"
									class="door-t ib-report-topic"
									onClick={() => s.open({ kind: 'topic', key: t().topicClusterId })}
								>
									{t().title}
								</button>
								<p class="fig-note">
									{`${fmt(t().sources)} ${nouns().entities} engage it, ${fmt(t().stances)} with a written stance${lensPlural(t().lensValueCount)}.` +
										(w().scale.supportive.length
											? ` ${t().supportivePct}% supportive of its framing.`
											: '')}
								</p>
								<PositionStrip
									positions={t().positions}
									order={w().scale.order}
									colors={s.positionColors}
									height="10px"
								/>
								<p class="fig-note">
									<s.Link section="topics" class="dw-inline-link">
										Every topic by reach →
									</s.Link>
								</p>
							</div>
						)}
					</Show>
				</div>
			</section>

			<section class="sec">
				<div class="grid2 findings-grid">
					<For each={tasks()}>
						{(t) => (
							<s.Link section="analysis" taskId={t.taskId} class="fig reveal door">
								<DoorCard eyebrow={kindLabel(t.kind)} title={t.title} go="Read it →">
									<p>{taskDoor(t.kind)}</p>
								</DoorCard>
							</s.Link>
						)}
					</For>
					<s.Link section="search" class="fig reveal door">
						<DoorCard
							eyebrow="Search"
							title="Find where your question meets the record"
							go="Search the topics →"
						>
							<p>
								{`Describe a question in your own words; the topics closest to it come from a semantic search over ${fmt(o().passages)} passages.`}
							</p>
						</DoorCard>
					</s.Link>
					<s.Link section="sources" class="fig reveal door">
						<DoorCard
							eyebrow={`${cap(nouns().entities)} · ${fmt(o().sources)}`}
							title="The record itself"
							go={`Browse the ${nouns().entities} →`}
						>
							<p>
								{`Every ${nouns().entity}, filterable by every facet it carries, with what the pipeline found in each ${nouns().document}.`}
							</p>
						</DoorCard>
					</s.Link>
					<s.Link section="galaxy" class="fig reveal door">
						<DoorCard eyebrow="Galaxy" title="The record as a night sky" go="Open the galaxy →">
							<p>{`Every topic as a body and every ${nouns().entity} as dust, with the reading beside it.`}</p>
						</DoorCard>
					</s.Link>
					<s.Link section="method" class="fig reveal door">
						<DoorCard eyebrow="Method" title="How the record was read" go="Read the method →">
							<p>
								The pipeline as this run actually ran it, how to read a position, and the run's
								scale in live figures.
							</p>
						</DoorCard>
					</s.Link>
					<s.Link section="connect" class="fig reveal door">
						<DoorCard eyebrow="MCP" title="Give an agent the whole record" go="Connect an agent →">
							<p>{connectDoor()}</p>
						</DoorCard>
					</s.Link>
				</div>
			</section>
		</div>
	)
}
