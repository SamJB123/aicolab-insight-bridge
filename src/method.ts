/**
 * The pipeline's account of itself: the sentences every method page, the
 * shared /insight-bridge page and a generated run site use for the stages the
 * pipeline runs the same way for every corpus.
 *
 * ONE RULE GOVERNS EVERY SENTENCE HERE, and it is why the copy is centralised:
 * say what the output guarantees, never how it is produced. A reader, a client
 * or a competitor must be able to verify every sentence from the outputs alone.
 * Properties, guarantees and reading rules are in. Mechanism, order of
 * operations, a named algorithm beside a guarantee, parameter values,
 * thresholds and formulas are out. If a sentence would let an engineer
 * reconstruct a step rather than recognise a result, it does not belong here,
 * and it does not belong in a host's own stage text either. The mechanism is
 * described in one place, by its author, on their own timetable; a page is not
 * that place.
 *
 * Nouns are the host's: a consultation says "submitter", a podcast "episode", a
 * research corpus "source". The copy takes them and reads as one voice
 * everywhere. A host appends its own facts (counts, what its review confirmed,
 * how it derives a dominant topic) after the shared sentence, never inside it.
 *
 * Pure strings, no JSX, so a server module can import this without pulling the
 * components in.
 */
import type { MethodData, MethodStage, RunMethod } from '@aicolab/insight-bridge-contracts/explorer'
import { facetKind, type Profile } from '@aicolab/insight-bridge-contracts/profile'
import { type RunConfig, resolvedModels } from '@aicolab/insight-bridge-contracts/run-config'
import { taskTitle } from '@aicolab/insight-bridge-contracts/tasks'

export type MethodNouns = {
	/** One source entity, lower case: "submitter", "episode", "source". */
	entity: string
	/** Its plural. */
	entities: string
	/** One document, lower case: "submission", "transcript", "document". Defaults to "document". */
	document?: string
	/** Its plural. Defaults to "documents". */
	documents?: string
	/**
	 * The run's position scale as a phrase that can follow "recorded against
	 * that proposition": "from Supports to Opposes". Omitted, the copy refers to
	 * the profile's scale without listing it.
	 */
	scale?: string
}

export type MethodCopy = {
	/** How topics are found, and what it takes to be one. */
	clustering: string
	/** Graded membership of passages and entities in every topic. */
	membership: string
	/** Propositions, and the positions read against them. */
	positions: string
	/** The verbatim-evidence guarantee. */
	evidence: string
	/** Advisory junk review, confirmed by a person. */
	review: string
	/** Themes and families above the topics. */
	hierarchy: string
	/** What happens when documents are added to a finished run. */
	growth: string
}

export function methodCopy(nouns: MethodNouns): MethodCopy {
	const { entity, entities } = nouns
	const document = nouns.document ?? 'document'
	const documents = nouns.documents ?? 'documents'
	const scale = nouns.scale ? `, ${nouns.scale}` : ", on the scale this run's profile defines"
	return {
		clustering:
			`Topics are found from the passages themselves, bottom-up, by grouping the passages across the ` +
			`corpus that say the same thing; nothing supplies a list of themes beforehand. A topic has to be ` +
			`raised by more than one ${entity} to form: one ${entity}'s volume cannot make a topic on its ` +
			`own, and the rare topic that only one ${entity} carries is flagged as such.`,
		membership:
			`Each passage, and each ${entity}, is then placed against every topic at a graded strength ` +
			`(exemplar, high-value, member), so a ${entity} that touches a topic in passing is recorded as ` +
			`well as the ${entities} that define it, and a passage can belong to more than one topic.`,
		positions:
			`Each topic is written up as a proposition with key points, and every exemplar and high-value ` +
			`${entity}'s position is recorded against that proposition${scale}. Positions are relative to ` +
			`the topic's own framing, never absolute agreement, and every ${entity} is measured against the ` +
			`same proposition.`,
		evidence:
			`Every quotation is verbatim from the source ${document}: each is verified against the ` +
			`${document}'s text before it is stored, and one that cannot be found there is never presented ` +
			`as verified.`,
		review:
			'A model flags topics that look like page furniture, boilerplate or reference lists; a reviewer ' +
			'confirms or dismisses each flag, and only a confirmed flag excludes a topic. Nothing is deleted.',
		hierarchy:
			'The topics are grouped upward, generation by generation, into themes and then families, until ' +
			'the top is small enough to hold in your head. A topic can sit under more than one theme, with ' +
			'one marked primary, so the result is a tree you can walk down and cross-links you can follow ' +
			'sideways. Nothing above the topics is chosen by hand.',
		growth:
			`When ${documents} are added to a finished run, existing topics keep their identity and their ` +
			`links; the new material is either placed into today's topics or the whole corpus is ` +
			`re-clustered, and the record shows which.`,
	}
}

/**
 * The copy in the pipeline's own generic nouns, for the pages that describe it
 * for every corpus at once (the shared /insight-bridge page).
 */
export const GENERIC_METHOD_COPY: MethodCopy = methodCopy({ entity: 'source', entities: 'sources' })

/* ───────────────────────── a run's Method page, derived ───────────────────────── */
//
// WHAT IS DERIVED. The run itself is knowable from its own row: which stages
// the pipeline ran, under which settings, against which profile, and what each
// produced. `run_meta.profile` and `run_meta.run_config` carry the intent; the
// committed `cluster_build` carries what the clustering actually settled on
// (its `params` are the values that stuck after tuning, which is why they and
// not the run config's starting values are stated); the counts come from the
// database at request time. A stage the run's config switched off does not
// appear, so a reader is told what happened, not what the pipeline can do.
//
// WHAT IS AUTHORED is the host's: the collection (which pages were fetched, how
// the text was recovered, what the source could not give) is not knowable from
// the run, nor is how the host loaded its site. A host passes those as
// stages before and after the derived ones, and may add a sentence to the
// reading-in and the reading stages for what its own records carry.
//
// SETTINGS APPEAR WHERE THEY CHANGE THE READING, AND ONLY THOSE: the minimum
// cluster size decides how many passages make a topic, so it is stated;
// concurrency and retries decide how fast it ran, so they are not; the
// clustering's other settings and the membership thresholds are the pipeline's
// own (the rule at the top of this file).
//
// Moved here from the pipeline zone's lib/run-method.ts and Training Data's
// own copy (2026-10-21); this is the richer of the two, with what was the
// pipeline's (a scale that measures no agreement) kept.

/** What a host writes of its own collection and site, around the derived account. */
export interface MethodAuthored {
	/** Stages before the derived ones: the collection. */
	before?: MethodStage[]
	/** A sentence after the reading-in: what the collection records about its sources and documents. */
	ingest?: string
	/** A sentence after the reading: what else that reading did for this corpus. */
	analysis?: string
	/** How the questions read in a sentence — "the committee's 14 terms of reference". */
	questions?: string
	/** Stages after the derived ones: how the site was loaded. */
	after?: MethodStage[]
}

const count = (value: number) => value.toLocaleString('en-AU')

/** "a, b and c" — a list a sentence can contain. */
function sentenceList(items: readonly string[]): string {
	if (items.length <= 1) return items[0] ?? ''
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * The stages that actually ran, in the order the pipeline runs them. Every
 * phase the pipeline can skip is gated on the same config flag the pipeline
 * gates it on, so this cannot claim a step that did not happen.
 */
function stagesOf(
	profile: Profile,
	config: RunConfig,
	d: MethodData,
	authored: MethodAuthored,
): MethodStage[] {
	const p = profile.prompts.params
	const o = d.overview
	const c = config.clustering
	const minClusterSize = d.build?.params.min_cluster_size ?? c.min_cluster_size
	const attempts = d.build?.tuning?.attempts.length ?? 0
	const copy = methodCopy({
		entity: p.entity_noun,
		entities: p.entity_noun_plural,
		document: p.document_noun,
		documents: p.document_noun_plural,
		scale: `on this run's own scale, ${sentenceList(profile.stance.labels)}`,
	})
	const questions = authored.questions ?? `the run's ${count(o.questions)} questions`
	const then = (sentence: string | undefined) => (sentence ? ` ${sentence}` : '')
	const stages: MethodStage[] = [...(authored.before ?? [])]

	stages.push({
		key: 'ingest',
		title: `Reading in the ${p.document_noun_plural}`,
		body:
			`Every ${p.document_noun} was stored whole under its ${p.entity_noun}, its text cut into passages small enough to compare — ` +
			`${count(o.passages)} of them across ${count(o.documents)} ${p.document_noun_plural} from ${count(o.sources)} ${p.entity_noun_plural} — ` +
			`and each passage embedded with ${resolvedModels(config).embedding}, which is what makes a search by meaning, and the grouping ` +
			`below, possible at all.${then(authored.ingest)}`,
	})

	stages.push({
		key: 'analysis',
		title: `Reading each ${p.document_noun} end to end`,
		body:
			`A language model read every ${p.document_noun} in full against this run's profile and recorded what it found as key points, ` +
			`each with the verbatim quotes that support it: ${count(o.keyPoints)} key points and ${count(o.quotes)} quotes. ${copy.evidence} ` +
			`${o.quotesVerifiedPct}% verify, and a quote that does not is never shown here.` +
			then(authored.analysis) +
			(o.questions
				? ` The same reading put ${questions} to every ${p.document_noun}: ${count(o.answers)} answers were found, each with a position, ` +
					`key points and quotes. A question left unanswered means no answer was located in the available text, never that a ${p.entity_noun} has no view.`
				: ''),
	})

	if (config.entity_review.enabled)
		stages.push({
			key: 'entity-review',
			// "What counts as one", not "who they are": an entity is whatever the
			// profile says it is, and for a submissions corpus that is a
			// submission, not a person.
			title: `Settling what counts as one ${p.entity_noun}`,
			body:
				`The names the model inferred were put to a person beside the names the record carries, before anything was counted, so that one ` +
				`${p.entity_noun} appearing under two spellings is counted once in every figure on this site. The record's name stands; the model's ` +
				`reading is kept beside it.`,
		})

	stages.push({
		key: 'clustering',
		title: 'Grouping the passages into topics',
		body:
			`${copy.clustering} A group had to hold at least ${minClusterSize} passages to count as a topic. ` +
			(attempts > 1
				? `The settings were tuned at a review gate: ${attempts} attempts were tried before these were committed (they are listed below). `
				: c.auto_relax
					? 'Where those settings found nothing, they were relaxed a step at a time until they did. '
					: '') +
			`${copy.membership} ${count(o.topics + o.junkTopics)} topics resulted, over ${count(d.clusteredPassages)} passages.`,
	})

	if (config.run_synthesis)
		stages.push({
			key: 'synthesis',
			title: 'Writing each topic up and reading positions against it',
			body:
				`${copy.positions} ${count(o.stances)} positions were written` +
				(profile.facets_to_analyse.length
					? `, and the same was done for each value of ${sentenceList(profile.facets_to_analyse)}: ${count(o.lensRows)} perspectives`
					: '') +
				`. A position here records how a ${p.entity_noun} stands against one topic's particular framing, and is never a verdict on the subject in general.`,
		})

	if (config.junk_review.enabled)
		stages.push({
			key: 'junk-review',
			title: 'Removing the groups that carry nothing',
			body:
				`A model flagged topics whose synthesis reported no substantive shared content, and a person confirmed or rejected each flag — and ` +
				`could confirm a topic the model had not flagged. ` +
				(o.junkTopics
					? `${count(o.junkTopics)} ${o.junkTopics === 1 ? 'topic was' : 'topics were'} confirmed and ${o.junkTopics === 1 ? 'is' : 'are'} excluded from every figure on this site.`
					: 'Nothing was confirmed, so every topic found stands.') +
				' The flag alone never removes anything.',
		})

	if (config.hierarchy.enabled)
		stages.push({
			key: 'hierarchy',
			title: 'Offering the topics upward into themes',
			body:
				'The topics were grouped again, generation by generation, each generation clustering the one below it until it stopped merging' +
				(config.hierarchy.max_generations
					? `, held to ${config.hierarchy.max_generations} generation${config.hierarchy.max_generations === 1 ? '' : 's'}`
					: '') +
				(config.hierarchy.force_target ? `, then cut to ${config.hierarchy.target} groups at the top` : '') +
				`. A topic with no theme above the attachment threshold ${config.hierarchy.attach_orphans ? 'was attached to its nearest theme rather than left alone' : 'stands on its own'}. ` +
				'This site reads the tree as the run left it, however many generations that turned out to be' +
				(o.groups
					? ` — here, ${count(o.groups)} ${o.generations[0]?.labelPlural ?? 'groups'} above the topics, each named by the model from its members.`
					: ', and where nothing merged the topics simply stand on their own.'),
		})

	stages.push({
		key: 'stars',
		title: 'Placing the topics in a sky',
		// "Place", never "position": on this page a position is what a source
		// took against a proposition, and a run with synthesis off has none.
		body:
			"Each topic's place in the galaxy was computed once and stored with the run, seeded so it is the same sky every time. That is what " +
			'lets these pages draw the constellation as plain graphics, with no WebGPU and nothing solved in your browser.',
	})

	return [...stages, ...(authored.after ?? [])]
}

/** Which model did what, for the roles that shaped what is on this site. */
function modelsOf(profile: Profile, config: RunConfig, d: MethodData) {
	const m = resolvedModels(config)
	return [
		{
			role: `Reading each ${profile.prompts.params.document_noun}${d.overview.questions ? ', answering the questions' : ''}`,
			model: m.step1,
		},
		...(config.run_synthesis ? [{ role: 'Writing the topics up and reading positions', model: m.step2 }] : []),
		...(config.hierarchy.enabled ? [{ role: 'Naming the themes', model: m.hierarchy_labels }] : []),
		...(config.junk_review.enabled ? [{ role: 'Flagging empty topics', model: m.junk_review }] : []),
		{ role: 'Embedding the passages', model: m.embedding },
		...(m.fallback ? [{ role: 'When a call failed', model: m.fallback }] : []),
	]
}

/** A run's Method page: the derived account, around what the host authored, and what the run declared. */
export function buildMethod(
	profile: Profile,
	config: RunConfig,
	d: MethodData,
	authored: MethodAuthored = {},
): RunMethod {
	const analysed = new Set(profile.facets_to_analyse)
	return {
		stages: stagesOf(profile, config, d, authored),
		models: modelsOf(profile, config, d),
		scale: {
			labels: profile.stance.labels,
			definitions: profile.stance.definitions,
			guidance: profile.stance.guidance,
			agreement: profile.stance.agreement,
		},
		facets: profile.facets.map((f) => ({
			key: f.name,
			noun: f.noun,
			kind: facetKind(f),
			granularity: f.granularity,
			analysed: analysed.has(f.name),
			// A vocabulary facet's values are listed outright or produced by
			// bucketing another facet; a `ref` or `tree` vocabulary is neither, and
			// its concepts belong to the record rather than to this summary.
			values: f.values ?? f.derive?.buckets.map((b) => b.label) ?? [],
			derivedFrom: f.derive?.from_facet ?? null,
			excludedValues: f.excluded_values,
		})),
		tasks: profile.analysis_tasks.map((t) => ({
			id: t.task_id,
			title: taskTitle(t),
			description: t.task_description,
			type: t.task_type,
		})),
		glossary: profile.glossary,
		exclusions: profile.exclusions.analysis.map((rule) => ({ facet: rule.facet, values: rule.values })),
		attempts: (d.build?.tuning?.attempts ?? []).map((a) => ({
			minClusterSize: a.min_cluster_size,
			clusters: a.clusters,
			noise: a.noise,
		})),
	}
}
