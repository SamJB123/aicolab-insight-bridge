/**
 * The long reads of a report (settled 2026-10-24): each written once, as every operation
 * is, and marked `task`, so a client that can follow a task (the Tasks extension, or
 * REST's `Prefer: respond-async`) is handed one and told as it progresses, while any
 * other caller gets the answer inline. The handler reports progress and asks through its
 * Call; it never knows whether it ran inline or in the app's Workflow.
 *
 *   reading_list     a question → the documents most worth reading on it, with the
 *                    passages the record quotes from them (asks mid-way whether topics
 *                    the run flagged as junk should count)
 *   draft_brief      a question → the evidence the record holds on it, topic by topic,
 *                    and, where the caller's model can be asked, a draft brief citing it
 *                    (`brief` is the report's Brief page, ../readers)
 *   compare_sources  two to four sources side by side on the topics they share
 */
import { NotFound, operationsFor } from '@aicolab/app-kit/api/define'
import type {
	EntityDetail,
	TopicDetail,
	TopicSummary,
} from '@aicolab/insight-bridge-contracts/explorer'
import { z } from 'zod'
import * as x from '../data.ts'
import * as pages from '../pages.ts'
import { type ReportCtx, readContext, siteOf } from './context.ts'
import { GROUP } from './reads.ts'
import { clip, documentUrl, PASSAGE_CHARS, QUOTE_CHARS, sourceUrl, topicUrl } from './shapes.ts'
import { dissentOf, lensValueOf, notPrevalence, type ToolContext } from './support.ts'

const define = operationsFor<ReportCtx>()
const grouped = (group: string) => ({ tags: [group], meta: { 'aicolab.org/group': group } })

/** A task lives half an hour after its last change; a client that polls waits two seconds. */
const TASK = { ttlMs: 30 * 60 * 1000, pollIntervalMs: 2000 }

/** A field with this run's own starting value as its example. */
const ex = <S extends z.ZodType>(schema: S, value: unknown): S =>
	value === undefined || value === null ? schema : schema.meta({ examples: [value] })

/* ───────────────────────── words ───────────────────────── */

const STOP_WORDS = new Set(
	'about after again also and are because been being between both but can could does doing each for from had has have how into its just more most not off only other our out over same should some such than that the their them then there these they this those through under until very was were what when where which while who whom why will with would you your'.split(
		' ',
	),
)

/** The words that carry a question: lower-cased, three letters or more, not a stop word. */
export function termsOf(text: string): string[] {
	return [...new Set(text.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? [])].filter(
		(word) => !STOP_WORDS.has(word),
	)
}

/** How many of the question's words a text carries (a word's first letters count, so "regulate" meets "regulation"). */
export function overlap(terms: readonly string[], text: string): number {
	const haystack = text.toLowerCase()
	let count = 0
	for (const term of terms) {
		const stem = term.length > 6 ? term.slice(0, 6) : term
		if (haystack.includes(stem)) count += 1
	}
	return count
}

/**
 * The topics that meet a question, best first: by the host's vector index where it has
 * one (the passages' relevance summed per topic), else by the question's words in each
 * topic's title and description.
 */
async function topicsFor(
	ctx: ReportCtx,
	question: string,
	candidates: readonly TopicSummary[],
): Promise<{ topic: TopicSummary; score: number }[]> {
	const terms = termsOf(question)
	const byWords = candidates
		.map((topic) => ({ topic, score: overlap(terms, `${topic.title} ${topic.description}`) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
	if (!ctx.nearest) return byWords
	const c = readContext(ctx)
	const hits = await pages.topicSearch(c.db, c.words, await ctx.nearest(question, 100), 40, c.scope)
	const byId = new Map(candidates.map((topic) => [topic.topicClusterId, topic]))
	const semantic = hits.flatMap((hit) => {
		const topic = byId.get(hit.topicClusterId)
		return topic ? [{ topic, score: hit.relevance }] : []
	})
	// the index's topics first, then any the words alone found
	const seen = new Set(semantic.map((entry) => entry.topic.topicClusterId))
	return [...semantic, ...byWords.filter((entry) => !seen.has(entry.topic.topicClusterId))]
}

/** The model's answer, as the protocol carries it: one content block or several. */
const sampledContent = z.object({
	content: z.union([
		z.looseObject({ type: z.string(), text: z.string().optional() }),
		z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
	]),
})

const sampledText = (result: unknown): string => {
	const parsed = sampledContent.safeParse(result)
	if (!parsed.success) return ''
	const blocks = Array.isArray(parsed.data.content) ? parsed.data.content : [parsed.data.content]
	return blocks
		.map((block) => (block.type === 'text' ? (block.text ?? '') : ''))
		.filter(Boolean)
		.join('\n')
}

/* ───────────────────────── the long reads, for one run ───────────────────────── */

export function tasksFor(t: ToolContext) {
	const nouns = t.words.nouns

	const reading_list = define({
		name: 'reading_list',
		summary: `A reading list of ${nouns.documents} for a question`,
		description: `Given a question in your own words, finds the topics that meet it (by the record's vector index where the report has one, else by the question's words), visits them, and returns the ${nouns.documents} most worth reading on it, each with the passages the record quotes from it. Long-running: a client that can follow a task is handed one and told as it progresses; mid-way it asks whether topics the run flagged as junk should count, where someone can answer.`,
		...grouped(GROUP.tasks),
		input: z.object({
			question: ex(
				z.string().min(3).describe('What you want to read about, in your own words.'),
				t.examples.query,
			),
			limit: z.coerce
				.number()
				.int()
				.min(1)
				.max(20)
				.default(5)
				.describe(`How many ${nouns.documents} to pick.`),
		}),
		output: z.object({
			question: z.string(),
			picks: z.array(
				z.object({
					document_id: z.string(),
					title: z.string(),
					source: z.string(),
					source_id: z.string().nullable(),
					/** How strongly the document's topics met the question, summed over its topics. */
					score: z.number(),
					topics: z.array(z.object({ topic_id: z.number().int(), title: z.string() })),
					/** Passages the record quotes from this document's source on the matching topics, clipped. */
					quotes: z.array(z.string()),
					url: z.string(),
				}),
			),
			/** Topics that met the question and were visited. */
			topicsConsidered: z.number().int(),
			junkIncluded: z.boolean(),
			note: z.string(),
		}),
		rest: { method: 'GET', path: '/reading-list' },
		task: TASK,
		handler: async ({ question, limit }, ctx, call) => {
			const c = readContext(ctx)
			const w = c.words
			const [live, every] = await Promise.all([
				x.topics(c.db, false, c.scope),
				x.topics(c.db, true, c.scope),
			])
			const liveIds = new Set(live.map((topic) => topic.topicClusterId))
			const matching = (await topicsFor(ctx, question, live)).slice(0, 12)
			const terms = termsOf(question)
			const junk = every
				.filter((topic) => !liveIds.has(topic.topicClusterId))
				.map((topic) => ({ topic, score: overlap(terms, `${topic.title} ${topic.description}`) }))
				.filter((entry) => entry.score > 0)

			// the question mid-way: junk topics also match; asked only where someone can answer
			let junkIncluded = false
			if (junk.length > 0 && call.elicit) {
				const answer = await call.elicit(
					'junk',
					`${junk.length} topic${junk.length === 1 ? '' : 's'} the run flagged as junk also match${junk.length === 1 ? 'es' : ''} your question. Include ${nouns.documents} from ${junk.length === 1 ? 'it' : 'them'}?`,
					z.object({
						include: z
							.boolean()
							.describe(`Include ${nouns.documents} from topics the run flagged as junk.`),
					}),
				)
				junkIncluded = answer.action === 'accept' && answer.content.include
			}
			const visiting = junkIncluded ? [...matching, ...junk] : matching

			interface Pick {
				document_id: string
				title: string
				source: string
				entityUuid: string
				score: number
				topics: { topic_id: number; title: string }[]
				quotes: Set<string>
			}
			const picks = new Map<string, Pick>()
			let visited = 0
			for (const { topic, score } of visiting) {
				call.signal.throwIfAborted()
				call.progress({ progress: visited, total: visiting.length, message: topic.title })
				const detail: TopicDetail | null = await x.topicById(c.db, topic.topicClusterId, c.scope)
				visited += 1
				if (!detail) continue
				const quotesOf = (entityUuid: string): string[] =>
					detail.keyPointItems.flatMap((item) =>
						overlap(terms, `${item.keyPoint} ${item.details}`) === 0
							? []
							: item.quotes.flatMap((quote) =>
									quote.entityUuid === entityUuid && !quote.withheld ? [quote.text] : [],
								),
					)
				for (const document of detail.sourceDocuments) {
					const pick = picks.get(document.documentId) ?? {
						document_id: document.documentId,
						title: document.title ?? document.fileName,
						source: document.entityName,
						entityUuid: document.entityUuid,
						score: 0,
						topics: [],
						quotes: new Set<string>(),
					}
					pick.score += score
					pick.topics.push({ topic_id: topic.topicClusterId, title: topic.title })
					for (const quote of quotesOf(document.entityUuid)) pick.quotes.add(quote)
					picks.set(document.documentId, pick)
				}
			}
			call.progress({ progress: visiting.length, total: visiting.length, message: 'Ranking' })
			const ranked = [...picks.values()]
				.sort((a, b) => b.score - a.score || b.quotes.size - a.quotes.size)
				.slice(0, limit)
			const slugs = new Map<string, string>()
			for (const e of await x.entities(c.db, c.scope)) slugs.set(e.entityUuid, e.entityId)
			return {
				question,
				picks: ranked.map((pick) => {
					const slug = slugs.get(pick.entityUuid) ?? null
					return {
						document_id: pick.document_id,
						title: pick.title,
						source: pick.source,
						source_id: slug,
						score: Math.round(pick.score * 1000) / 1000,
						topics: pick.topics,
						quotes: [...pick.quotes].slice(0, 3).map((quote) => clip(quote, QUOTE_CHARS)),
						url: slug ? documentUrl(siteOf(ctx), w, slug, pick.document_id) : ctx.origin,
					}
				}),
				topicsConsidered: visiting.length,
				junkIncluded,
				note: notPrevalence(w, t.overview.entities),
			}
		},
	})

	const evidenceSchema = z.object({
		topic_id: z.number().int(),
		title: z.string(),
		url: z.string(),
		positionMix: z.record(z.string(), z.number().int()),
		/** The topic's key findings that meet the question, each with its first attributed quote. */
		findings: z.array(
			z.object({
				finding: z.string(),
				quote: z.string().nullable(),
				source: z.string().nullable(),
			}),
		),
		/** The stances that push back on the topic, strongest first (up to two). */
		dissent: z.array(
			z.object({
				source: z.string(),
				source_id: z.string(),
				position: z.string(),
				framing: z.string(),
			}),
		),
	})

	const CITATION = /\[topic:(\d+)\]/g

	// `draft_brief`, not `brief`: the Brief is the report's page (../readers), read in parts.
	const draft_brief = define({
		name: 'draft_brief',
		summary: 'A brief on a question, drafted from the record',
		description: `Given a question, finds the topics that meet it and gathers what the record holds on each as evidence: the key findings that bear on the question with a verbatim quote and its ${nouns.entity}, the position mix, and the stances that push back. Where the caller’s model can be asked (sampling), it also drafts a short brief from that evidence alone, every claim cited as [topic:ID]; citations that name no gathered topic are removed and counted. Long-running: a client that can follow a task is handed one.`,
		...grouped(GROUP.tasks),
		input: z.object({
			question: ex(z.string().min(3).describe('The question the brief answers.'), t.examples.query),
			limit: z.coerce
				.number()
				.int()
				.min(2)
				.max(10)
				.default(6)
				.describe('How many topics to draw on.'),
		}),
		output: z.object({
			question: z.string(),
			/** The draft, where the caller's model wrote one. */
			brief: z.string().nullable(),
			written_by: z.enum(['the caller’s model', 'nobody']),
			evidence: z.array(evidenceSchema),
			citations: z.object({ kept: z.number().int(), removed: z.number().int() }),
			note: z.string(),
		}),
		rest: { method: 'GET', path: '/brief/draft' },
		task: TASK,
		handler: async ({ question, limit }, ctx, call) => {
			const c = readContext(ctx)
			const w = c.words
			const terms = termsOf(question)
			const dissent = dissentOf(w.scale)
			const live = await x.topics(c.db, false, c.scope)
			const ranked = (await topicsFor(ctx, question, live)).slice(0, limit)
			const evidence: z.infer<typeof evidenceSchema>[] = []
			let seen = 0
			for (const { topic } of ranked) {
				call.signal.throwIfAborted()
				seen += 1
				call.progress({ progress: seen, total: ranked.length, message: topic.title })
				const detail = await x.topicSynthesis(c.db, topic.topicClusterId, c.scope)
				if (!detail) continue
				const findings = detail.keyPointItems
					.map((item) => ({ item, score: overlap(terms, `${item.keyPoint} ${item.details}`) }))
					.sort((a, b) => b.score - a.score)
					.slice(0, 4)
					.map(({ item }) => {
						const quote = item.quotes.find((q) => !q.withheld)
						return {
							finding: item.keyPoint,
							quote: quote ? clip(quote.text, QUOTE_CHARS) : null,
							source: quote?.entityName ?? null,
						}
					})
				const contesting = detail.stances
					.filter((stance) => w.scale.contesting.includes(stance.position) && !stance.withheld)
					.sort((a, b) => dissent(b.position) - dissent(a.position))
					.slice(0, 2)
					.map((stance) => ({
						source: stance.entityName,
						source_id: stance.entityId,
						position: stance.position,
						framing: clip(stance.title, PASSAGE_CHARS),
					}))
				evidence.push({
					topic_id: topic.topicClusterId,
					title: topic.title,
					url: topicUrl(siteOf(ctx), w, topic.topicClusterId),
					positionMix: detail.positions,
					findings,
					dissent: contesting,
				})
			}

			let text: string | null = null
			let kept = 0
			let removed = 0
			if (call.sample && evidence.length > 0) {
				call.progress({
					progress: ranked.length,
					total: ranked.length,
					message: 'Drafting the brief',
				})
				const findingLine = (f: { finding: string; quote: string | null; source: string | null }) =>
					`- ${f.finding}${f.quote ? ` — “${f.quote}” (${f.source ?? 'unattributed'})` : ''}`
				const pushbackLine = (entry: z.infer<typeof evidenceSchema>) =>
					entry.dissent.length
						? `\nPushback: ${entry.dissent.map((d) => `${d.source} (${d.position}): ${d.framing}`).join('; ')}`
						: ''
				const material = evidence
					.map(
						(entry) =>
							`[topic:${entry.topic_id}] ${entry.title}\n${entry.findings.map(findingLine).join('\n')}${pushbackLine(entry)}`,
					)
					.join('\n\n')
				const answer = await call.sample('brief', {
					systemPrompt: `You write a short, evidence-led brief from one record of ${nouns.documents} by ${nouns.entities}. Use only the material given; invent nothing. Cite every claim with its topic id in square brackets exactly as given, like [topic:12]. Say what the record shows, never what is true in the world, and never read a count of ${nouns.entities} as how common a view is. Plain prose in two or three paragraphs, 150 to 300 words, UK spelling.`,
					messages: [
						{
							role: 'user',
							content: { type: 'text', text: `Question: ${question}\n\nMaterial:\n\n${material}` },
						},
					],
					maxTokens: 900,
				})
				const ids = new Set(evidence.map((entry) => String(entry.topic_id)))
				text = sampledText(answer).replace(CITATION, (whole, id: string) => {
					if (ids.has(id)) {
						kept += 1
						return whole
					}
					removed += 1
					return ''
				})
			}
			const writtenBy: 'the caller’s model' | 'nobody' =
				text === null ? 'nobody' : 'the caller’s model'
			return {
				question,
				brief: text,
				written_by: writtenBy,
				evidence,
				citations: { kept, removed },
				note: notPrevalence(w, t.overview.entities),
			}
		},
	})

	const compare_sources = define({
		name: 'compare_sources',
		summary: `${nouns.entities.charAt(0).toUpperCase()}${nouns.entities.slice(1)} side by side`,
		description: `Two to four ${nouns.entities} side by side: the topics they all took a stance on, each ${nouns.entity}'s position and framing there, and which of those topics divide them (positions on both sides of the agreement axis); then the topics only one of them engaged. Long-running on a wide record: a client that can follow a task is handed one.`,
		...grouped(GROUP.tasks),
		input: z.object({
			sources: z
				.array(z.string().min(1))
				.min(2)
				.max(4)
				.describe('Two to four source_ids (or uuids), from list_sources or get_source.'),
			topic_id: z.coerce
				.number()
				.int()
				.optional()
				.describe(
					'Compare on this one topic alone, whether or not every source took a stance on it.',
				),
		}),
		output: z.object({
			sources: z.array(
				z.object({
					source_id: z.string(),
					source: z.string(),
					lensValue: z.string().nullable(),
					stances: z.number().int(),
					url: z.string(),
				}),
			),
			/** The topics every source took a stance on (or the one asked for). */
			shared: z.array(
				z.object({
					topic_id: z.number().int(),
					title: z.string(),
					url: z.string(),
					divided: z.boolean(),
					positions: z.array(
						z.object({
							source_id: z.string(),
							position: z.string().nullable(),
							framing: z.string().nullable(),
							analysis: z.string().nullable(),
							withheld: z.boolean().optional(),
							notice: z.string().optional(),
						}),
					),
				}),
			),
			sharedTotal: z.number().int(),
			/** Per source, how many topics it took a stance on that the others did not. */
			onlyOne: z.array(z.object({ source_id: z.string(), topics: z.number().int() })),
			note: z.string(),
		}),
		rest: { method: 'POST', path: '/compare' },
		task: TASK,
		handler: async ({ sources, topic_id }, ctx, call) => {
			const c = readContext(ctx)
			const w = c.words
			const found: EntityDetail[] = []
			let seen = 0
			for (const key of sources) {
				call.signal.throwIfAborted()
				const detail = await x.entityByKey(c.db, key, c.scope)
				if (!detail)
					throw new NotFound(`No ${nouns.entity} matching "${key}". list_sources names them.`)
				seen += 1
				call.progress({ progress: seen, total: sources.length, message: detail.entityName })
				found.push(detail)
			}
			const stanced = found.map(
				(e) =>
					new Map(
						e.topicItems.filter((tp) => tp.position !== null).map((tp) => [tp.topicClusterId, tp]),
					),
			)
			const everyone = (id: number) => stanced.every((m) => m.has(id))
			const titles = new Map(
				found.flatMap((e) =>
					e.topicItems.map((tp): [number, string] => [tp.topicClusterId, tp.title]),
				),
			)
			const sharedIds =
				topic_id !== undefined
					? [topic_id]
					: [...new Set(found.flatMap((e) => e.topicItems.map((tp) => tp.topicClusterId)))].filter(
							everyone,
						)
			const supportive = new Set(w.scale.supportive)
			const contesting = new Set(w.scale.contesting)
			const shared = sharedIds
				.map((id) => {
					const positions = found.map((e, i) => {
						const tp = stanced[i]?.get(id)
						return {
							source_id: e.entityId,
							position: tp?.position ?? null,
							framing: tp?.perspectiveTitle ?? null,
							analysis:
								tp?.positionAnalysis === undefined || tp.positionAnalysis === null
									? null
									: clip(tp.positionAnalysis, PASSAGE_CHARS),
							...(e.withheld ? { withheld: true } : {}),
							...(e.notice === undefined ? {} : { notice: e.notice }),
						}
					})
					const held = positions.flatMap((p) => (p.position ? [p.position] : []))
					const divided = held.some((p) => supportive.has(p)) && held.some((p) => contesting.has(p))
					return {
						topic_id: id,
						title: titles.get(id) ?? '',
						url: topicUrl(siteOf(ctx), w, id),
						divided,
						positions,
					}
				})
				.sort((a, b) => Number(b.divided) - Number(a.divided) || a.title.localeCompare(b.title))
			return {
				sources: found.map((e, i) => ({
					source_id: e.entityId,
					source: e.entityName,
					lensValue: lensValueOf(w, e.facets),
					stances: stanced[i]?.size ?? 0,
					url: sourceUrl(siteOf(ctx), w, e.entityId),
				})),
				shared: shared.slice(0, 40),
				sharedTotal: shared.length,
				onlyOne: found.map((e, i) => ({
					source_id: e.entityId,
					topics: [...(stanced[i]?.keys() ?? [])].filter((id) =>
						stanced.every((m, j) => j === i || !m.has(id)),
					).length,
				})),
				note: notPrevalence(w, t.overview.entities),
			}
		},
	})

	return {
		served: [reading_list, draft_brief, compare_sources],
		reading_list,
		draft_brief,
		compare_sources,
	}
}
