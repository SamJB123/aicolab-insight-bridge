/**
 * @aicolab/insight-bridge/explorer/readings — a report's readings: what a
 * topic, a grouping node, a source and a document SAY in the reader, made
 * from the explorer's reads (the contract shapes) and the run's words. One
 * definition for every report: the app's detail sheet, the galaxy and the
 * hub's page face all read through here, so a reading reads the same on every
 * surface. Pure: the host loads the data, and an app adds what only its own
 * facets and tables can say (a submission number, a link to the original) to
 * the view this returns; it never restates these.
 *
 * Node ids are the reader's `t:<topicClusterId>`, `g:<superclusterId>` and
 * `s:<entityId>`; `parseNodeId` also reads the galaxy's `g<generation>:` ids
 * and a source's uuid, so a row means the same thing on every surface.
 *
 * Reading policy, from the apps' drawers (2026-10-21): a quote shown is a
 * sentence, not a file name or a title (`looksLikeQuote`), at most two per
 * point, preferring different sources (`pickQuotes`); a Step 1 quote shows
 * only when the pipeline verified it; positions sort by the run's own scale.
 */
import type {
	DocumentDetail,
	EntityDetail,
	GroupDetail,
	RunWords,
	TopicDetail,
} from '@aicolab/insight-bridge-contracts/explorer'
import type {
	IBFlag,
	IBNodeContent,
	IBNodeId,
	IBNotice,
	IBPoint,
	IBQuote,
} from '../galaxy/types.ts'
import { cap } from '../grammar.ts'
import {
	type AnalysisBlock,
	buildContainerContent,
	buildDocumentContent,
	buildSourceContent,
	buildTopicContent,
	type ContentVocabulary,
	type ContributorGroup,
	type StatChip,
	type TopicLens,
} from '../reader/content-builders.ts'
import type { ReadingView } from '../reader/reading-view.ts'
import { generationLabel } from '../tree.ts'
import { questionClause } from '../world/schema.ts'

export type { ReadingView }

/** A document as the readings name and order it: its id, titles and facets. */
export interface DocumentLine {
	documentId: string
	title: string | null
	fileName: string
	facets: Readonly<Record<string, string[]>>
}

/** The reader's fixed words, and the readings' own, where the corpus says them differently. */
export interface ReadingVocabulary extends Partial<ContentVocabulary> {
	/** The answers section's title; else the run's one question task's title, else 'Answers'. */
	answersTitle?: string
	/** The answered-questions stat's unit — 'questions answered'. */
	answeredUnit?: string
}

/** What every reading is written with. */
export interface ReadingContext {
	words: RunWords
	/** The host's colour for each position (its palette, as the Brief takes it). */
	positionColors: Readonly<Record<string, string>>
	vocabulary?: ReadingVocabulary
	/** A document's name in a list or as a quote's source; its title, else its file name. */
	documentLabel?: (d: DocumentLine) => string
	/** The order a source's documents read in; by file name when absent. */
	documentOrder?: (a: DocumentLine, b: DocumentLine) => number
}

/**
 * What an app adds to a reading from its own facets and tables: an eyebrow
 * or a detail line in place of the default, and flags, lede fragments, links
 * and stats after the default ones; a related chip.
 */
export interface ReadingAdditions {
	eyebrow?: string
	detail?: string
	flags?: IBFlag[]
	meta?: Array<string | null | undefined>
	links?: IBNodeContent['links']
	stats?: StatChip[]
	related?: IBNodeContent['related']
	/**
	 * The notice a withheld or annotated source's reading opens with, in place
	 * of the generic one made from the scope's words (High Water's carries the
	 * custodian, its contact and the way to sign in).
	 */
	notice?: IBNotice
}

/** A reading with an app's additions folded in. */
const withAdditions = (view: ReadingView, add: ReadingAdditions | undefined): ReadingView =>
	add
		? {
				...view,
				eyebrow: add.eyebrow ?? view.eyebrow,
				detail: add.detail ?? view.detail,
				flags: [...(view.flags ?? []), ...(add.flags ?? [])],
				content: {
					...view.content,
					stats: [...(view.content.stats ?? []), ...(add.stats ?? [])],
					links: [...(view.content.links ?? []), ...(add.links ?? [])],
					related: add.related ?? view.content.related,
				},
			}
		: view

/** How the reader's scope reads a source's words (the explorer shapes' `withheld` and `notice`). */
interface SourceWords {
	withheld?: boolean
	notice?: string
}

/**
 * A source's reading under the scope: a withheld or annotated source's
 * reading opens with its notice — the app's, else one made from the scope's
 * words — first among the sections.
 */
const withNotice = (
	view: ReadingView,
	words: SourceWords,
	add: ReadingAdditions | undefined,
): ReadingView => {
	if (!words.withheld && !words.notice) return view
	const title = words.withheld ? 'Words withheld' : 'Notice'
	const notice: IBNotice = add?.notice ?? {
		tone: words.withheld ? 'withheld' : 'info',
		title,
		body: words.notice ?? '',
	}
	return {
		...view,
		content: {
			...view.content,
			sections: [{ kind: 'notice', title: notice.title, notice }, ...view.content.sections],
		},
	}
}

/** A quote as the reader shows it, carrying its source's scope words. */
const readerQuote = (text: string, source: string | undefined, words: SourceWords): IBQuote => ({
	text,
	...(source === undefined ? {} : { source }),
	...(words.withheld ? { withheld: true } : {}),
	...(words.notice === undefined || words.withheld ? {} : { notice: words.notice }),
})

export const topicNodeId = (topicClusterId: number): IBNodeId => `t:${topicClusterId}`
export const groupNodeId = (superclusterId: number): IBNodeId => `g:${superclusterId}`
export const sourceNodeId = (entityId: string): IBNodeId => `s:${entityId}`

/** What a reading's row points at. */
export type ReadingTarget =
	| { kind: 'topic'; key: number }
	| { kind: 'group'; key: number }
	| { kind: 'source'; key: string }

export function parseNodeId(id: IBNodeId): ReadingTarget | null {
	const at = id.indexOf(':')
	if (at < 0) return null
	const kind = id.slice(0, at)
	const rest = id.slice(at + 1)
	if (!rest) return null
	if (kind === 't' && /^\d+$/.test(rest)) return { kind: 'topic', key: Number(rest) }
	if (/^g\d*$/.test(kind) && /^\d+$/.test(rest)) return { kind: 'group', key: Number(rest) }
	if (kind === 's') return { kind: 'source', key: rest }
	return null
}

/* ── quotes ────────────────────────────────────────────────────────────── */

/** Does this text read like a verbatim sentence, not a file name or a title? */
export function looksLikeQuote(q: string, minLen = 50): boolean {
	if (q.length < minLen || q.length > 420) return false
	if (/\.(pdf|docx?|xlsx?|pptx?|csv|txt|jpe?g|png|md)\b/i.test(q)) return false
	const words = q.split(/\s+/).filter(Boolean)
	if (words.length < 8) return false
	return words.filter((w) => /^[a-z]/.test(w)).length >= 3
}

/**
 * Readable, distinct quotes, preferring a different source for each. A
 * withheld quote is the notice in the words' place: it is never judged as a
 * sentence, and it is distinct by its source, not its (shared) text.
 */
export function pickQuotes(rows: readonly IBQuote[], n = 2): IBQuote[] {
	const out: IBQuote[] = []
	const seenSource = new Set<string>()
	const used = new Set<string>()
	const keyOf = (r: IBQuote, text: string) => (r.withheld ? `withheld:${r.source ?? ''}` : text)
	const readable = (r: IBQuote, text: string, minLen: number) =>
		r.withheld === true || looksLikeQuote(text, minLen)
	for (const minLen of [60, 45]) {
		for (const r of rows) {
			if (out.length >= n) break
			const text = r.text.trim()
			const source = r.source ?? ''
			if (seenSource.has(source) || used.has(keyOf(r, text)) || !readable(r, text, minLen)) continue
			out.push({ ...r, text })
			seenSource.add(source)
			used.add(keyOf(r, text))
		}
	}
	for (const r of rows) {
		if (out.length >= n) break
		const text = r.text.trim()
		if (used.has(keyOf(r, text)) || !readable(r, text, 45)) continue
		out.push({ ...r, text })
		used.add(keyOf(r, text))
	}
	return out
}

/* ── words ─────────────────────────────────────────────────────────────── */

const plural = (word: string) => (word.endsWith('s') ? word : `${word}s`)

const headingOf = (c: ReadingContext, facet: string) => c.words.facets[facet]?.heading ?? cap(facet)
const valueWord = (c: ReadingContext, facet: string, value: string) =>
	c.words.facets[facet]?.values[value] ?? value

/** A subject's value on the run's lens, in the reader's words. */
const lensValue = (c: ReadingContext, facets: Readonly<Record<string, string[]>>) => {
	const lens = c.words.lens
	const value = lens ? facets[lens]?.[0] : undefined
	return lens && value !== undefined ? valueWord(c, lens, value) : null
}

/** A position's place on the scale; one off the scale sorts last. */
const rank = (c: ReadingContext, position: string | null) => {
	const at = position === null ? -1 : c.words.scale.order.indexOf(position)
	return at < 0 ? -1 : at
}

const vocabularyOf = (c: ReadingContext) => ({
	documentsTitle: cap(c.words.nouns.documents),
	documentsUnit: c.words.nouns.documents,
	...c.vocabulary,
})

const mixOf = (positions: readonly string[]) => {
	const mix: Record<string, number> = {}
	for (const p of positions) mix[p] = (mix[p] ?? 0) + 1
	return mix
}

/* ── a topic ───────────────────────────────────────────────────────────── */

export function topicReading(
	d: TopicDetail,
	c: ReadingContext,
	add?: ReadingAdditions,
): ReadingView {
	const { nouns } = c.words
	const facetsOf = new Map(d.members.map((m) => [m.entityUuid, m.facets]))
	const lensOf = (entityUuid: string | null) =>
		entityUuid === null ? null : lensValue(c, facetsOf.get(entityUuid) ?? {})
	const source = (name: string | null, entityUuid: string | null) =>
		[name, lensOf(entityUuid)].filter(Boolean).join(' · ') || undefined
	const stanceOf = new Map(d.entityPerspectives.map((p) => [p.entityUuid, p.position]))
	const stances = d.entityPerspectives.length
	// a member (every one strongly linked) with no written stance
	const unjudged = d.members.filter((m) => !stanceOf.has(m.entityUuid)).length
	const lensValues = new Map<string, number>()
	for (const p of d.entityPerspectives) {
		const value = lensOf(p.entityUuid)
		if (value) lensValues.set(value, (lensValues.get(value) ?? 0) + 1)
	}

	const flags: IBFlag[] = []
	const lens = c.words.lens
	const [onlyValue] = lensValues.keys()
	if (lens && lensValues.size === 1 && onlyValue)
		flags.push({
			label: `1 ${headingOf(c, lens).toLowerCase()}`,
			hot: true,
			tip: `Everything here is said by ${onlyValue}; read it as one constituency's account.`,
		})
	if (d.junkStatus === 'confirmed')
		flags.push({
			label: 'junk',
			hot: true,
			tip: d.junkAiReason ?? 'Confirmed as junk in review and excluded from every aggregate.',
		})

	// one lens section per analysed facet, the run's lens first; rows by the scale
	const byFacet = new Map<string, TopicLens['rows']>()
	const facetOrder = [...new Set(d.facetPerspectives.map((p) => p.facet))].sort(
		(a, b) => Number(b === lens) - Number(a === lens),
	)
	for (const p of [...d.facetPerspectives].sort(
		(a, b) => rank(c, b.position) - rank(c, a.position),
	)) {
		const label = valueWord(c, p.facet, p.facetValue)
		byFacet.set(p.facet, [
			...(byFacet.get(p.facet) ?? []),
			{
				label,
				position: p.position,
				positionColor: c.positionColors[p.position],
				analysis: p.positionAnalysis,
				quotes: pickQuotes(
					p.quotes.map((q) => readerQuote(q.text, source(q.entityName, q.entityUuid), q)),
				),
				share: p.facet === lens && stances ? (lensValues.get(label) ?? 0) / stances : undefined,
			},
		])
	}

	const row = (m: TopicDetail['members'][number]) => ({
		id: sourceNodeId(m.entityId),
		label: m.entityName,
		detail:
			[lensOf(m.entityUuid), stanceOf.get(m.entityUuid)].filter(Boolean).join(' · ') || undefined,
	})
	const graded = (grade: string) =>
		d.members
			.filter((m) => m.membershipType === grade)
			.sort(
				(a, b) =>
					rank(c, stanceOf.get(b.entityUuid) ?? null) -
						rank(c, stanceOf.get(a.entityUuid) ?? null) || a.entityName.localeCompare(b.entityName),
			)
	const contributorGroups: ContributorGroup[] = [
		{ label: 'Exemplars', rows: graded('exemplar').map(row) },
		{ label: 'High-value', rows: graded('high_value').map(row) },
	]

	return withAdditions(
		{
			eyebrow: 'Topic',
			title: d.title,
			detail: `${d.entities} ${nouns.entities} · ${stances} written stances${unjudged ? ` · ${unjudged} members without one` : ''}`,
			mix: d.positions,
			flags,
			content: buildTopicContent(
				{
					description: d.description,
					contributors: { value: d.entities, unit: nouns.entities },
					documents: { value: d.documents, unit: vocabularyOf(c).documentsUnit },
					stats: [
						...(lens
							? [
									{
										label: plural(headingOf(c, lens).toLowerCase()),
										value: String(lensValues.size),
									},
								]
							: []),
						{ label: `core ${nouns.entities}`, value: String(graded('exemplar').length) },
					],
					keyPoints: d.keyPointItems.map((kp) => ({
						text: kp.keyPoint,
						detail: kp.details || undefined,
						quotes: pickQuotes(
							kp.quotes.map((q) => readerQuote(q.text, source(q.entityName, q.entityUuid), q)),
						),
					})),
					lenses: facetOrder.map((facet) => ({
						label: headingOf(c, facet),
						rows: byFacet.get(facet) ?? [],
					})),
					parents: d.parents.map((p) => ({
						id: groupNodeId(p.superclusterId),
						label: p.title ?? `Group ${p.superclusterId}`,
						isPrimary: p.isPrimary,
						membershipType: p.membershipType,
						similarity: p.similarity,
					})),
					contributorGroups,
				},
				vocabularyOf(c),
			),
		},
		add,
	)
}

/* ── a grouping node ───────────────────────────────────────────────────── */

export function groupReading(
	d: GroupDetail,
	c: ReadingContext,
	add?: ReadingAdditions,
): ReadingView {
	return withAdditions(groupView(d, c), add)
}

function groupView(d: GroupDetail, c: ReadingContext): ReadingView {
	const { nouns, scale, lens } = c.words
	const kind = generationLabel(d.generation, d.topGeneration)
	const supportive = new Set(scale.supportive)
	const supportOf = (positions: Readonly<Record<string, number>>) => {
		const total = Object.values(positions).reduce((a, n) => a + n, 0)
		const yes = Object.entries(positions).reduce((a, [p, n]) => a + (supportive.has(p) ? n : 0), 0)
		return total ? Math.round((1000 * yes) / total) / 10 : 0
	}
	const view = { eyebrow: cap(kind), title: d.title ?? `Group ${d.superclusterId}` }
	const detail = `${d.topicCount} topics · ${d.entities} ${nouns.entities}`
	if (d.children.length) {
		const childKind = generationLabel(
			d.children[0]?.generation ?? d.generation - 1,
			d.topGeneration,
			true,
		)
		return {
			...view,
			detail,
			mix: d.positions,
			content: buildContainerContent({
				lede: d.description ?? `${d.children.length} ${childKind} make up this ${kind}.`,
				childrenTitle: cap(childKind),
				rows: d.children.map((ch) => ({
					id: groupNodeId(ch.superclusterId),
					label: ch.title ?? `Group ${ch.superclusterId}`,
					detail: `${ch.topics} topics · ${ch.entities} ${nouns.entities}`,
					weight: ch.entities,
				})),
			}),
		}
	}
	return {
		...view,
		detail,
		mix: d.positions,
		content: buildContainerContent({
			lede: d.description ?? `${d.topics.length} topics make up this ${kind}.`,
			childrenTitle: 'Topics',
			rows: d.topics.map((t) => {
				const spread = lens ? t.facetSpread[lens] : undefined
				return {
					id: topicNodeId(t.topicClusterId),
					label: t.title,
					detail: [
						`${t.entities} ${nouns.entities}`,
						lens && spread !== undefined
							? `${spread} ${spread === 1 ? headingOf(c, lens).toLowerCase() : plural(headingOf(c, lens).toLowerCase())}`
							: null,
						supportive.size ? `${supportOf(t.positions)}% supportive` : null,
					]
						.filter(Boolean)
						.join(' · '),
					weight: t.entities,
				}
			}),
		}),
	}
}

/* ── a document's analyses ─────────────────────────────────────────────── */

const documentLabel = (c: ReadingContext, d: DocumentLine) =>
	c.documentLabel ? c.documentLabel(d) : (d.title ?? d.fileName)

/** The title the run gives its one task of a type, else the reader's word for it. */
const taskTitleOf = (c: ReadingContext, type: string, fallback: string) => {
	const mine = Object.values(c.words.tasks).filter((t) => t.type === type)
	return mine.length === 1 ? (mine[0]?.title ?? fallback) : fallback
}

/** A document's model-assigned tags, one line per category, primary first. */
const tagLines = (d: DocumentDetail): string[] => {
	const byCategory = new Map<string, string[]>()
	for (const t of d.tags) {
		const list = byCategory.get(t.category) ?? []
		if (t.isPrimary) list.unshift(t.name)
		else list.push(t.name)
		byCategory.set(t.category, list)
	}
	return [...byCategory].map(
		([category, names]) =>
			`${category}: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`,
	)
}

/** Answers, findings and metrics across documents, each a points section. */
function analysisBlocks(
	docs: readonly DocumentDetail[],
	c: ReadingContext,
	withSource: boolean,
): AnalysisBlock[] {
	const quoteOf = (doc: DocumentDetail) => (text: string) =>
		readerQuote(text, withSource ? documentLabel(c, doc) : undefined, doc)
	const answers: IBPoint[] = docs.flatMap((doc) =>
		doc.questionResponses
			.filter((r) => r.addressed)
			.map((r) => ({
				text: `${questionClause(r.questionKey, r.questionText)} ${r.questionText.replace(/^\([a-z0-9]+\)\s*/i, '')}`,
				detail: r.position || undefined,
				quotes: r.keyPoints.flatMap((kp) => kp.quotes.slice(0, 2).map(quoteOf(doc))),
			})),
	)
	const blocks: AnalysisBlock[] = []
	if (answers.length)
		blocks.push({
			title: c.vocabulary?.answersTitle ?? taskTitleOf(c, 'question_response', 'Answers'),
			points: answers,
		})
	const byTopic = new Map<string, IBPoint[]>()
	for (const doc of docs)
		for (const cr of doc.criteria)
			byTopic.set(cr.topic, [
				...(byTopic.get(cr.topic) ?? []),
				{ text: cr.keyPoint, detail: cr.details || undefined, quotes: cr.quotes.map(quoteOf(doc)) },
			])
	for (const [title, points] of byTopic) blocks.push({ title, points })
	const metrics: IBPoint[] = docs.flatMap((doc) =>
		doc.metrics.map((m) => ({
			text: m.metricName,
			detail: [m.explicitness, m.metricDescription].filter(Boolean).join(' — ') || undefined,
		})),
	)
	if (metrics.length)
		blocks.push({ title: taskTitleOf(c, 'metrics_evaluation', 'Metrics'), points: metrics })
	return blocks
}

/** A document's key points, with the quotes the pipeline verified, each attributed to its document. */
const keyPointsOf = (c: ReadingContext, doc: DocumentDetail): IBPoint[] =>
	doc.keyPointItems.map((kp) => ({
		text: kp.keyPoint,
		detail: kp.details || undefined,
		quotes: kp.quotes
			.filter((q) => q.verified)
			.map((q) => readerQuote(q.text, documentLabel(c, doc), doc)),
	}))

/* ── a source ──────────────────────────────────────────────────────────── */

/**
 * A source: its stances, its topics and its documents, each listed with its
 * key points and answers counted. A source with ONE document reads that
 * document's points and analysis too (`sole`, its detail): there the source's
 * reading is the document's. A source with several lists them and each opens
 * its own reading, as every deployed report read a source: points gathered
 * from many documents would read as the source's own findings, and reading
 * every document's detail to show them cost a drawer one read per document
 * (951 for one audit body).
 */
export function sourceReading(
	e: EntityDetail,
	sole: DocumentDetail | null,
	c: ReadingContext,
	add?: ReadingAdditions,
): ReadingView {
	const { nouns, lens } = c.words
	const order =
		c.documentOrder ?? ((a: DocumentLine, b: DocumentLine) => a.fileName.localeCompare(b.fileName))
	const docs = sole && e.documentItems.length === 1 ? [sole] : []
	const lensValues = lens ? (e.facets[lens] ?? []).map((v) => valueWord(c, lens, v)) : []
	const flags: IBFlag[] = lensValues.slice(1).map((v) => ({
		label: `also ${v}`,
		tip: `The pipeline placed this ${nouns.entity} under more than one ${headingOf(c, lens ?? '').toLowerCase()}; the first is primary.`,
	}))
	if (e.inferredName && e.inferredName !== e.entityName)
		flags.push({
			label: e.inferredName,
			tip: `The pipeline's own reading of the ${nouns.entity}'s name; the record's name stands.`,
		})
	const stanced = e.topicItems.filter((t) => t.position !== null)
	const view = withAdditions(
		{
			eyebrow: cap(nouns.entity),
			title: e.entityName,
			detail: lensValues[0],
			mix: mixOf(stanced.flatMap((t) => (t.position ? [t.position] : []))),
			flags,
			content: buildSourceContent(
				{
					meta: [...(add?.meta ?? []), ...(docs.length === 1 && docs[0] ? tagLines(docs[0]) : [])],
					perspectives: stanced
						.sort(
							(a, b) => rank(c, b.position) - rank(c, a.position) || a.title.localeCompare(b.title),
						)
						.map((t) => ({
							id: topicNodeId(t.topicClusterId),
							label: t.title,
							position: t.position ?? undefined,
							positionColor: t.position ? c.positionColors[t.position] : undefined,
							analysis: t.positionAnalysis ?? undefined,
							quotes: t.quotes
								.map((q) => q.trim())
								.filter((q) => looksLikeQuote(q, 40))
								.slice(0, 2)
								.map((q) => readerQuote(q, undefined, e)),
						})),
					engaged: e.topicItems
						.filter((t) => t.position === null)
						.sort((a, b) => a.title.localeCompare(b.title))
						.map((t) => ({ id: topicNodeId(t.topicClusterId), label: t.title })),
					documents: [...e.documentItems].sort(order).map((d) => ({
						documentId: d.documentId,
						label: documentLabel(c, d),
						detail: [`${d.keyPoints} key points`, d.answers ? `${d.answers} answered` : null]
							.filter(Boolean)
							.join(' · '),
					})),
					keyPoints: docs.flatMap((doc) => keyPointsOf(c, doc)),
					analysis: analysisBlocks(docs, c, false),
					stats: e.questionsAnswered
						? [
								{
									label: c.vocabulary?.answeredUnit ?? 'questions answered',
									value: String(e.questionsAnswered),
								},
							]
						: [],
				},
				vocabularyOf(c),
			),
		},
		{ ...add, meta: undefined },
	)
	return withNotice(view, e, add)
}

/* ── a document ────────────────────────────────────────────────────────── */

export function documentReading(
	d: DocumentDetail,
	c: ReadingContext,
	add?: ReadingAdditions,
): ReadingView {
	const flags: IBFlag[] = []
	// a withheld document's key points are behind the notice, not missing
	if (!d.keyPointItems.length && !d.withheld)
		flags.push({
			label: 'not analysed',
			hot: true,
			tip: 'The pipeline produced no key points for this document; it still holds topic memberships.',
		})
	const view = withAdditions(
		{
			eyebrow: cap(c.words.nouns.document),
			title: d.title ?? d.fileName,
			detail: d.entityName,
			flags,
			content: buildDocumentContent(
				{
					meta: [...(add?.meta ?? []), ...tagLines(d)],
					keyPoints: keyPointsOf(c, d),
					analysis: analysisBlocks([d], c, false),
					engaged: d.topics.map((t) => ({ id: topicNodeId(t.topicClusterId), label: t.title })),
				},
				vocabularyOf(c),
			),
		},
		{ ...add, meta: undefined },
	)
	return withNotice(view, d, add)
}
