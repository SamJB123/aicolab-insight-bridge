/**
 * The shared Insight Bridge material, as components.
 *
 * Consumer apps mount these inside their own routes, so the material renders in
 * the host's theme and chrome rather than on a separately-served page.
 * Everything here must read correctly for ANY corpus — anything corpus-specific
 * arrives as a prop.
 *
 * The material splits across two host routes:
 *
 *   /insight-bridge — `InsightBridgeAbout`: how dense information becomes
 *     accessible, what else runs on the pipeline, and what agents can do with
 *     any of it. This is a pitch for the pipeline, so it carries no reading
 *     caveats.
 *
 *   /method — `InsightBridgeReading`: the rules for reading what comes out.
 *     They belong beside the host's own account of its run, which is why the
 *     component takes a `corpusNotes` slot for the factors specific to that run.
 */

import { Panel } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { For, Show } from 'solid-js'
import { CORPORA, siblings } from './corpora.ts'

/**
 * Links into the HOST's own routes are supplied by the host as ready-made
 * elements, not as href strings: only the consumer can type `to` against its
 * generated route tree, and only its router can keep the navigation
 * client-side. Cross-origin links to sibling corpora are plain anchors, since
 * no router can route those anyway.
 *
 *   <InsightBridgeAbout
 *     slug="second-chair"
 *     connectLink={<Link to="/connect">This corpus’s connector →</Link>}
 *   />
 */
export type AboutProps = {
	/** This app's slug in the family registry — marks itself current. */
	slug: string
	/** The host's link to its MCP console. */
	connectLink?: JSX.Element
}

/**
 * The <h1> of every consumer's /insight-bridge page. A host renders it as
 * `<h1 class="…">{INSIGHT_BRIDGE_TITLE}</h1>` in its own heading style, so all
 * three corpora lead with the same line without retyping it.
 */
export const INSIGHT_BRIDGE_TITLE = 'This resource is powered by Insight Bridge'

/**
 * The standing short-form tagline. Register is deliberately close to the
 * Alliance's own "For Good and For All": short, plain, and about what the
 * reader gets to DO.
 *
 * It is no longer rendered on its own — the subtitle in `InsightBridgeLede`
 * embeds it ("...equips you to wield knowledge you didn't know you needed...").
 * Kept exported because it is the quotable form for anywhere outside these
 * pages; if you change one, check the other still reads as the same promise.
 */
export const INSIGHT_BRIDGE_TAGLINE = 'Wield knowledge you didn’t know you needed.'

/**
 * The lede is framed on CONSEQUENCE, not on frequency. Earlier drafts said how
 * much evidence goes unread, which is both unprovable and uninteresting; what
 * matters is who pays for it going unread.
 *
 * The second barrier is a language problem, never a diligence one. Do not
 * reintroduce "nobody thinks to look" or "you didn't know it was there" — the
 * people this is for usually know the evidence exists and cannot address it,
 * because it is filed in an institution's vocabulary and not their own. The
 * Speak step states the same principle and the two must agree.
 */
export function InsightBridgeLede() {
	return (
		<div class="ib-lede">
			{/* The definition sits directly under the host's h1 (which is the tagline)
			    and answers "what IS this?" before any argument starts. */}
			<p class="ib-define">
				Insight Bridge is a pipeline that equips you to wield knowledge you didn’t know you needed, by
				giving it a structure any question can travel through.
			</p>
			<p class="ib-stand">
				Evidence that could change how something is done goes unused for two reasons: there is too
				much of it to get across, and reaching it means already speaking the language of the body that
				produced it. Both costs fall hardest on small organisations, community groups and individual
				advocates, who have no research staff to absorb them.
			</p>
			<p class="ib-stand">
				Insight Bridge opens a body of evidence to whoever has a question, and makes what is inside it
				findable in the words you would actually use.
			</p>
		</div>
	)
}

/**
 * Speak · Surface · Synthesise — the three-part crossing.
 *
 * Named to sit alongside the Alliance's own Spark · Sculpt · Steward rather
 * than to borrow from it. The first two steps are what a good search gives you;
 * the third is what nothing else does, and is the reason the corpus is exposed
 * to agents rather than only to readers.
 *
 * "Synthesise" here is the AGENT combining findings for one reader, which is a
 * different operation from what the pipeline does when it builds a cluster's
 * proposition and grades every source against it. That stage is named
 * "Perspectives" (STAGES 06) precisely so the word "synthesis" means one thing
 * on this page. Do not rename it back.
 */
const STEPS: { label: string; body: string }[] = [
	{
		label: 'Speak',
		body: 'Say what you care about, in your own language: the thing you have spent a career on, the situation you are actually in, what you are trying to change. No one should have to learn a corpus’s vocabulary to get an answer from it.',
	},
	{
		label: 'Surface',
		body: 'An agent translates that into the record’s own terms and brings up what speaks to it, across the whole body of evidence, including material you could not have named, written for a purpose that was not yours. The structure is what lets it do that without reading four thousand documents itself: it searches the analysis, walks the topic tree, and pulls the passages and quotes sitting behind anything it finds.',
	},
	{
		label: 'Synthesise',
		body: 'The agent then reads what it surfaced against the context you gave it in the first step. It works out which findings bear on what you are trying to do, organises them around your problem, and writes the result in the terms you arrived with.',
	},
]

/**
 * The corpus the worked example was actually run against, named from the
 * registry so its brand and URL cannot drift out of sync with the family cards.
 */
const CASE_CORPUS = CORPORA.find((c) => c.slug === 'audit-corpus')

export function InsightBridgeSteps(props: { slug?: string }) {
	// On the audit corpus's own site the mention is not a link: every sibling
	// link on this page opens in a new tab, and sending a reader to the page they
	// are already on would be worse than plain text.
	const caseCorpusRef = () => {
		if (!CASE_CORPUS) return null
		if (props.slug === CASE_CORPUS.slug) {
			return <strong class="ib-corpus-ref">{CASE_CORPUS.name}</strong>
		}
		return (
			<a class="ib-corpus-ref" href={CASE_CORPUS.url} target="_blank" rel="noopener noreferrer">
				{CASE_CORPUS.name}
			</a>
		)
	}

	return (
		<section class="ib-sec">
			<h2 class="ib-h2">AI Agents + Insight Bridge = Democratisation</h2>
			<p class="ib-sub">Speak · Surface · Synthesise</p>
			<p class="ib-stand">
				Insight Bridge does the structuring. An agent does the reading, the matching and the
				interpreting. Between them they turn what a person cares about into something the record can
				answer, then turn the answer back into something that person can use.
			</p>
			<ol class="ib-steps">
				<For each={STEPS}>
					{(s) => (
						<li>
							<span class="ib-step-label">{s.label}</span>
							<p>{s.body}</p>
						</li>
					)}
				</For>
			</ol>
			{/* ui-solid's Panel, so the box picks up the host's surface, hairline and
			    radius tokens instead of inventing its own card. It supplies its own
			    padding and header spacing; `.ib-case` only positions it in the flow. */}
			{/* Drawn from one real session against the audit corpus. Two things this
			    copy must not do: assume anything about the advocate beyond what they
			    said (they are a mental-health specialist; the rest are stated
			    concerns), and describe the output as a set of results. It was an
			    argued document, and the bullets exist so that lands. */}
			<Panel class="ib-case" title="Real world example" glow>
				<p>
					An advocate specialising in Australia’s mental health sector, who also cares deeply about
					child safety, gendered violence and education, described all of that in their own words,
					with no idea how any of it was filed in the {caseCorpusRef()} corpus. What came back was:
				</p>
				<ul class="ib-case-list">
					<li>
						<strong>Six parts</strong>, following the shape of what they had described: mental health,
						then child safety and shame, then gendered violence, then education, then the machinery
						that let all of it persist, then what to do about it.
					</li>
					<li>
						<strong>Thirteen findings</strong>, each argued from reports it named, quoted and dated,
						with the oversight body that made them and its severity score attached.
					</li>
					<li>
						<strong>Eight recommendations</strong>, every one of which an oversight body had already
						put on the record.
					</li>
					<li>
						<strong>Connections between things filed apart</strong>: that a family violence response is
						suicide prevention, and that exclusion from education and untreated mental illness feed
						each other.
					</li>
					<li>
						<strong>An evidence ledger</strong> of the twenty-three reports it drew on, and a note on
						how it was assembled.
					</li>
				</ul>
				<p>
					Whatever field you work in, the evidence that would change how you work has probably
					already been gathered by a body you have never heard of, for a purpose that was not yours.
				</p>
			</Panel>
		</section>
	)
}

const STAGES: { n: string; title: string; body: string }[] = [
	{
		n: '01',
		title: 'Curation',
		body: 'Sources are collected and normalised into documents. This is a hand-built evidence base rather than a sampling frame, and the selection is the first and largest analytical choice in the pipeline. Counts therefore describe what was gathered, never what is common in the world.',
	},
	{
		n: '02',
		title: 'Facets',
		body: 'Each source is classified on the axes that matter for the corpus (who is speaking, when, what kind of body or publication) by deterministic rules over its metadata; the model plays no part in it. These become the comparative lenses the app offers.',
	},
	{
		n: '03',
		title: 'Extraction',
		body: 'Every document is read end-to-end by a language model, which pulls out its key points with verbatim supporting quotes, tags it against controlled vocabularies, and records structured analyses such as the claims it makes and the evidence offered for each.',
	},
	{
		n: '04',
		title: 'Clustering',
		body: 'Passages are embedded and clustered from the bottom up, and the resulting hierarchy is cut at its leaves: the smallest coherent groupings survive instead of being absorbed into the broad, stable ones above them. A distance penalty pushes a single source’s own passages apart, so a topic has to be reached by several sources. The topic list is an output of this stage; nothing supplies it beforehand.',
	},
	{
		n: '05',
		title: 'Membership',
		body: 'Each topic then works out which dimensions of meaning actually separate it from the rest of the corpus, and grades every passage on that topic’s own measure. A passage is an exemplar of a topic, a high-value member, or a member, so the strongest evidence for a topic can be told apart from its edges.',
	},
	{
		n: '06',
		title: 'Perspectives',
		body: 'Each cluster’s proposition is synthesised from its members first. Only then is every engaged source assessed against that completed proposition, giving a position and the reasoning behind it. The same is done per lens value, producing the comparative views.',
	},
	{
		n: '07',
		title: 'Grouping',
		body: 'The topics are clustered again by the same method, this time on a representative vector for each, producing themes and then families above them, until the top generation is small enough to hold in your head. Membership stays soft at every level, so a topic can belong to more than one theme, with one marked primary. What you get is a tree you can walk down and cross-links you can follow sideways.',
	},
]

export function InsightBridgePipeline() {
	return (
		<section class="ib-sec">
			<h2 class="ib-h2">Inside the Insight Bridge pipeline</h2>
			<p class="ib-sub">How dense information becomes accessible</p>
			<p class="ib-stand">
				A body of documents becomes reachable when it has structure, and these seven stages are how it
				gets built: every document read in full, every passage placed among the passages arguing the
				same thing, and every source given a position on each of those arguments. They run the same
				way whichever corpus goes through them.
			</p>
			<ol class="ib-stages">
				<For each={STAGES}>
					{(s) => (
						<li>
							<span class="ib-stage-n">{s.n}</span>
							<div>
								<h3>{s.title}</h3>
								<p>{s.body}</p>
							</div>
						</li>
					)}
				</For>
			</ol>
		</section>
	)
}

/**
 * The commitments. Placed BEFORE the mechanism, not after it: these are the
 * principles the pipeline was built from, so they belong in the pitch rather
 * than in a footnote qualifying it.
 *
 * Each item is WHY first, HOW second — the value the AI CoLab holds, then what
 * the pipeline does about it. Keep the why positively framed: earlier drafts
 * led on what the tool refuses to do, which reads as defensiveness rather than
 * as a reason to trust it.
 *
 * Every claim here must be about the CORPUS, never about the agents that read
 * it. We do not ship those agents and cannot promise how they behave, so the
 * third item's safeguard is checkability — every claim carries its source and
 * its words, which is a property of the data and true regardless of who is
 * reading. Do not add a bullet that says an agent will or won't do something.
 */
export function InsightBridgeRespect() {
	return (
		<section class="ib-sec">
			<h2 class="ib-h2">What Insight Bridge is built to respect</h2>
			<p class="ib-stand">
				Three commitments shaped how this pipeline was built. Each one is about whose knowledge counts,
				and who gets to use it.
			</p>
			<ul class="ib-rules">
				<li>
					<strong>The detail.</strong> Public purpose work depends on a clear line of sight to what was
					actually said, and by whom. Every proposition traces back to the passages and the verbatim
					quotes it was built from, and every source links out to the original.
				</li>
				<li>
					<strong>The minority.</strong> How common a view is in a corpus does not automatically say
					how much it matters. Whether you want the position of a specific community or a specialist
					perspective is a judgement only you can make. Cutting the clustering at its leaves keeps
					each small distinct concern as its own topic.
				</li>
				<li>
					<strong>Your judgement.</strong> You bring your own context, priorities, and principles.
					Insight Bridge equips you to discover what is argued, who argues it, and the specific points
					they raised. It does not rank sources, score their credibility, or tell you who is right.
				</li>
			</ul>
		</section>
	)
}

export type ReadingProps = {
	/**
	 * Whatever governs THIS run and no other — degraded sources, a lens that
	 * behaves oddly, a quirk in how the tree came out. Rendered after the shared
	 * rules, under `corpusNotesTitle`, so a reader meets the method and the
	 * particular case in one place. Host markup, host classes; the component only
	 * supplies the heading and the spacing above it.
	 */
	corpusNotes?: JSX.Element
	/** Heading for the slot. Defaults to "In this corpus". */
	corpusNotesTitle?: string
}

export function InsightBridgeReading(props: ReadingProps) {
	return (
		<section class="ib-sec">
			<h2 class="ib-h2">How to read the output</h2>
			<p class="ib-stand">
				These rules apply to every Insight Bridge corpus. They are properties of the method, not
				caveats about a particular run.
			</p>
			<ul class="ib-rules">
				<li>
					<strong>Positions are relative to a proposition.</strong> A source’s position records how
					it stands against that cluster’s particular framing — not whether it agrees with some
					absolute claim. The same source can support one cluster and redirect a neighbouring one
					that covers similar ground differently.
				</li>
				<li>
					<strong>Propositions are synthesised from the cluster’s own members.</strong> Because the
					argument is built from the sources that were grouped together, and those sources are then
					assessed against it, a degree of agreement is built into the method. Comparisons between
					groups carry weight; a corpus-wide agreement rate does not.
				</li>
				<li>
					<strong>Counts describe the corpus, not the world.</strong> Every corpus here is curated.
					“N sources say X” measures what was collected and is never a measure of how common X is
					in the field.
				</li>
				<li>
					<strong>Clusters differ in how many distinct sources back them.</strong> A long document
					can fragment across many clusters, so weight a theme by the distinct sources beneath it
					rather than by how many clusters it contains.
				</li>
				<li>
					<strong>Every extraction and position is a model judgement.</strong> Key points, stances,
					propositions and syntheses are produced by a language model reading the source. They
					inherit its calibration and are not determinations of fact.
				</li>
			</ul>
			<Show when={props.corpusNotes}>
				<div class="ib-corpus">
					<h3 class="ib-h3">{props.corpusNotesTitle ?? 'In this corpus'}</h3>
					{props.corpusNotes}
				</div>
			</Show>
		</section>
	)
}

export function InsightBridgeFamily(props: { slug: string }) {
	const others = () => siblings(props.slug)
	return (
		<section class="ib-sec">
			<h2 class="ib-h2">Other corpora on this pipeline</h2>
			<p class="ib-stand">
				The same pipeline, the same reading conventions, different bodies of evidence. Each is a
				separate app with its own corpus and its own MCP server. Because the structure and the reading
				rules are identical across all of them, a question that starts in one can be carried into
				another without learning anything new.
			</p>
			<Show when={others().length} fallback={<p class="ib-note">This is the only one so far.</p>}>
				<div class="ib-family">
					<For each={others()}>
						{(c) => (
							// Cross-origin: no router can route these. Opens in a new tab so the
							// reader keeps their place in the corpus they are currently reading.
							<a class="ib-card" href={c.url} target="_blank" rel="noopener noreferrer">
								<span class="ib-card-name">{c.name}</span>
								<span class="ib-card-scale">{c.scale}</span>
								<span class="ib-card-blurb">{c.blurb}</span>
							</a>
						)}
					</For>
				</div>
			</Show>
		</section>
	)
}

export function InsightBridgeMcp(props: { connectLink?: JSX.Element }) {
	return (
		<section class="ib-sec">
			<h2 class="ib-h2">Every corpus is available to agents</h2>
			<p class="ib-stand">
				Each Insight Bridge app exposes its corpus over the Model Context Protocol, so an agent can
				work the analysis directly. The shape is consistent across corpora: orient on the whole body,
				search passages semantically, walk the topic map, open a topic to see its proposition and who
				stands where, split any topic by a comparative lens, and pull the record for a single source.
			</p>
			<p class="ib-stand">
				The tools carry the reading rules in their own descriptions, so an agent is told, at the point
				of use, that counts are not prevalence and that positions are relative to a framing.
			</p>
			<Show when={props.connectLink}>
				<p class="ib-note">{props.connectLink}</p>
			</Show>
		</section>
	)
}

/**
 * The whole /insight-bridge page below the host's own <h1>: tagline, standfirst
 * and every section, in order. A consumer adopts the page with one component and
 * two props rather than assembling pieces — the sequencing is an editorial
 * decision this package should own, not one each app re-makes.
 *
 * `InsightBridgeReading` is deliberately NOT here: it belongs on the host's
 * method page, beside that corpus's own notes.
 */
export function InsightBridgeAbout(props: AboutProps) {
	return (
		<div class="ib-about">
			<InsightBridgeLede />
			<InsightBridgeRespect />
			<InsightBridgeSteps slug={props.slug} />
			<InsightBridgePipeline />
			<InsightBridgeFamily slug={props.slug} />
			<InsightBridgeMcp connectLink={props.connectLink} />
		</div>
	)
}
