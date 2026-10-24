/**
 * The shapes the report catalogue answers with, and the projections from the explorer's
 * reads to them. Written for the reader of a result and sized for a model's context
 * (./sizes.test.ts measures each against a budget): a listing is a page with its total,
 * a detail is trimmed to what a reader opens first and says where the rest is, a quote
 * is clipped, every link is whole. The Markdown renderers are the resources' text.
 *
 * Field names keep the vocabulary the connectors have taught agents since 2026-10-21:
 * ids in snake_case (`topic_id`, `source_id`, `document_id`, `supercluster_id`,
 * `passage_id`), the rest as the explorer reads name them.
 */
import type {
	GroupProfile,
	RunWords,
	TopicProfile,
} from '@aicolab/insight-bridge-contracts/explorer'
import { lineageNodeSchema, sourceWords } from '@aicolab/insight-bridge-contracts/explorer'
import { z } from 'zod'
import { groupNodeId, sourceNodeId, topicNodeId } from '../readings.ts'

/* ───────────────────────── sizes ───────────────────────── */

/** A passage of text in a listing is cut here; the whole is a `document_text` page away. */
export const PASSAGE_CHARS = 600
/** A quote in a detail is cut here. */
export const QUOTE_CHARS = 300
/** A document's text in `get_document` without `include_text`; with it, `TEXT_CHARS_MAX`. */
export const TEXT_PREVIEW_CHARS = 600
export const TEXT_CHARS_MAX = 40_000
/** How many of a long list a default read returns. */
export const PAGE = 40
export const PAGE_MAX = 100

/** A text cut at a word boundary with an ellipsis, when longer than `max`. */
export const clip = (text: string, max: number): string => {
	if (text.length <= max) return text
	const cut = text.slice(0, max)
	const space = cut.lastIndexOf(' ')
	return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** One page of rows and what it is a page of. */
export const pageOf = <T>(rows: readonly T[], offset: number, limit: number) => ({
	total: rows.length,
	offset,
	returned: Math.max(0, Math.min(limit, rows.length - offset)),
	rows: rows.slice(offset, offset + limit),
})

export const pageShape = {
	/** Rows that matched, before offset and limit. */
	total: z.number().int(),
	offset: z.number().int(),
	returned: z.number().int(),
}

/* ───────────────────────── links ───────────────────────── */

/** Where a reading opens on the report site: the drawer's `detail` on the page that holds it. */
const readingPage = (words: RunWords): string => {
	if (words.sections.includes('topics')) return '/topics'
	if (words.sections.includes('sources')) return '/sources'
	return '/'
}
const sourcesPage = (words: RunWords): string =>
	words.sections.includes('sources') ? '/sources' : readingPage(words)

export const topicUrl = (origin: string, words: RunWords, topicClusterId: number): string =>
	`${origin}${readingPage(words)}?detail=${encodeURIComponent(topicNodeId(topicClusterId))}`
export const groupUrl = (origin: string, words: RunWords, superclusterId: number): string =>
	`${origin}${readingPage(words)}?detail=${encodeURIComponent(groupNodeId(superclusterId))}`
export const sourceUrl = (origin: string, words: RunWords, entityId: string): string =>
	`${origin}${sourcesPage(words)}?detail=${encodeURIComponent(sourceNodeId(entityId))}`
export const documentUrl = (
	origin: string,
	words: RunWords,
	entityId: string,
	documentId: string,
): string => `${sourceUrl(origin, words, entityId)}&document=${encodeURIComponent(documentId)}`

/* ───────────────────────── rows ───────────────────────── */

const mixSchema = z.record(z.string(), z.number().int())

/** A topic in a listing: its reach, its position mix and its place in the tree. */
export const topicRowSchema = z.object({
	topic_id: z.number().int(),
	title: z.string(),
	sources: z.number().int(),
	documents: z.number().int(),
	stances: z.number().int(),
	positionMix: mixSchema,
	supportivePct: z.number(),
	contestedPct: z.number(),
	/** Distinct lens values among the stance-holders, and the only one when there is one. */
	lensValues: z.number().int(),
	singleLensValue: z.string().nullable(),
	/** Grouping ancestors by primary edge, nearest first. */
	lineage: z.array(lineageNodeSchema),
	url: z.string(),
	/** A search's relevance: the summed scores of the matched passages whose primary topic this is. */
	relevance: z.number().optional(),
	/** `related_topics`: how many nearest-generation groups, or how many sources, this shares with the topic asked about. */
	sharedGroups: z.number().int().optional(),
	sharedSources: z.number().int().optional(),
})
export type TopicRow = z.infer<typeof topicRowSchema>

export const topicRowOf = (
	t: TopicProfile,
	origin: string,
	words: RunWords,
	extra: Partial<Pick<TopicRow, 'relevance' | 'sharedGroups' | 'sharedSources'>> = {},
): TopicRow => ({
	topic_id: t.topicClusterId,
	title: t.title,
	sources: t.sources,
	documents: t.documents,
	stances: t.stances,
	positionMix: t.positions,
	supportivePct: t.supportivePct,
	contestedPct: t.contestedPct,
	lensValues: t.lensValueCount,
	singleLensValue: t.singleLensValue,
	lineage: t.lineage,
	url: topicUrl(origin, words, t.topicClusterId),
	...extra,
})

/** A grouping node in a listing: its place, its reach and its position mix. */
export const groupRowSchema = z.object({
	supercluster_id: z.number().int(),
	generation: z.number().int(),
	/** 'family' | 'theme' | 'group', counted down from the root generation. */
	kind: z.string(),
	title: z.string(),
	description: z.string().nullable(),
	parent_id: z.number().int().nullable(),
	parentTitle: z.string().nullable(),
	/** Direct primary children, and topics beneath it by primary edge. */
	children: z.number().int(),
	topics: z.number().int(),
	sources: z.number().int(),
	documents: z.number().int(),
	stances: z.number().int(),
	positionMix: mixSchema,
	url: z.string(),
})
export type GroupRow = z.infer<typeof groupRowSchema>

export const groupRowOf = (g: GroupProfile, origin: string, words: RunWords): GroupRow => ({
	supercluster_id: g.superclusterId,
	generation: g.generation,
	kind: g.kind,
	title: g.title,
	description: g.description,
	parent_id: g.parentId,
	parentTitle: g.parentTitle,
	children: g.children,
	topics: g.topics,
	sources: g.sources,
	documents: g.documents,
	stances: g.stances,
	positionMix: g.positions,
	url: groupUrl(origin, words, g.superclusterId),
})

/** A passage a search found. */
export const passageSchema = z.object({
	passage_id: z.string(),
	/** The host's similarity score; 0 for a text match. */
	score: z.number(),
	document_id: z.string(),
	documentTitle: z.string(),
	source: z.string(),
	source_id: z.string().nullable(),
	lensValue: z.string().nullable(),
	/** The passage, cut at PASSAGE_CHARS; `truncated` says so, and `document_text` has the whole. */
	text: z.string(),
	truncated: z.boolean(),
	/** The current topics this passage strongly belongs to. */
	topics: z.array(z.object({ topic_id: z.number().int(), title: z.string() })),
	...sourceWords,
})
export type Passage = z.infer<typeof passageSchema>

/** A quote with its attribution, clipped. */
export const quoteSchema = z.object({
	quote: z.string(),
	source: z.string().nullable(),
	source_id: z.string().nullable(),
	lensValue: z.string().nullable(),
	...sourceWords,
})
export type Quote = z.infer<typeof quoteSchema>

/** A stance as a listing shows it: whose, its one-word position, its framing. */
export const stanceRowSchema = z.object({
	source: z.string(),
	source_id: z.string(),
	lensValue: z.string().nullable(),
	position: z.string(),
	framing: z.string(),
	...sourceWords,
})
export type StanceRow = z.infer<typeof stanceRowSchema>

/* ───────────────────────── one topic ───────────────────────── */

/** How many stances `get_topic` lists; `source_perspectives` pages the rest. */
export const TOPIC_STANCES_SHOWN = 25

export const topicOutputSchema = z.object({
	topic_id: z.number().int(),
	title: z.string(),
	description: z.string(),
	url: z.string(),
	/** A topic a reviewer confirmed as junk: excluded from every aggregate, listed here by name only. */
	junk: z.boolean(),
	junkReason: z.string().nullable(),
	lineage: z.array(lineageNodeSchema),
	documents: z.number().int(),
	reach: z.object({
		sources: z.number().int(),
		/** Strongly linked sources by membership grade (exemplar, high_value). */
		byTier: mixSchema,
	}),
	positionMix: mixSchema,
	/** The position mix of each lens value's stances, in the lens's order; null without a lens. */
	positionsByLens: z.record(z.string(), mixSchema).nullable(),
	contestation: z.object({
		contestingStances: z.number().int(),
		contestingLensValues: z.array(z.string()),
		distinctLensValues: z.number().int(),
		singleLensValue: z.boolean(),
	}),
	/** The cross-cutting key findings, each with up to two attributed quotes; `topic_quotes` has every quote. */
	keyFindings: z.array(
		z.object({ finding: z.string(), details: z.string(), quotes: z.array(quoteSchema) }),
	),
	stancesHeld: z.number().int(),
	/** Up to TOPIC_STANCES_SHOWN stances, dissent first; `source_perspectives` pages all of them with their own points and quotes. */
	stances: z.array(stanceRowSchema),
	stancesTruncated: z.number().int(),
	note: z.string(),
})
export type TopicOutput = z.infer<typeof topicOutputSchema>

/* ───────────────────────── one source ───────────────────────── */

export const SOURCE_TOPICS_SHOWN = 20
export const SOURCE_DOCUMENTS_SHOWN = 20

export const sourceOutputSchema = z.object({
	source: z.string(),
	source_id: z.string(),
	url: z.string(),
	lensValue: z.string().nullable(),
	facets: z.record(z.string(), z.array(z.string())),
	/** The model's own reading of the name, when it has one. */
	inferredName: z.string().nullable(),
	counts: z.object({
		documents: z.number().int(),
		/** Topics strongly linked (exemplar or high value). */
		topics: z.number().int(),
		stances: z.number().int(),
		keyPoints: z.number().int(),
		questionsAnswered: z.number().int(),
	}),
	/** Its documents, up to SOURCE_DOCUMENTS_SHOWN; `get_document` reads one. */
	documents: z.array(
		z.object({
			document_id: z.string(),
			title: z.string(),
			keyPoints: z.number().int(),
			answers: z.number().int(),
			facets: z.record(z.string(), z.array(z.string())),
			url: z.string(),
		}),
	),
	documentsTruncated: z.number().int(),
	/** The topics it is strongly linked to, dissent first, up to SOURCE_TOPICS_SHOWN: its position and framing where it wrote a stance. */
	topics: z.array(
		z.object({
			topic_id: z.number().int(),
			title: z.string(),
			membershipType: z.string(),
			position: z.string().nullable(),
			framing: z.string().nullable(),
			analysis: z.string().nullable(),
			quotes: z.array(z.string()),
			url: z.string(),
		}),
	),
	topicsTruncated: z.number().int(),
	...sourceWords,
	note: z.string(),
})
export type SourceOutput = z.infer<typeof sourceOutputSchema>

/* ───────────────────────── one document ───────────────────────── */

export const DOCUMENT_KEY_POINTS_SHOWN = 10
export const DOCUMENT_FINDINGS_SHOWN = 12

const keyPointSchema = z.object({
	keyPoint: z.string(),
	details: z.string(),
	/** The verified quotes, up to two, clipped. */
	quotes: z.array(z.string()),
})

export const documentOutputSchema = z.object({
	document_id: z.string(),
	title: z.string(),
	fileName: z.string(),
	source: z.string(),
	source_id: z.string(),
	url: z.string(),
	facets: z.record(z.string(), z.array(z.string())),
	counts: z.object({
		keyPoints: z.number().int(),
		quotes: z.number().int(),
		passages: z.number().int(),
	}),
	/** Up to DOCUMENT_KEY_POINTS_SHOWN key points with their verified quotes. */
	keyPoints: z.array(keyPointSchema),
	keyPointsTruncated: z.number().int(),
	/** The model-assigned tags, by category. */
	tags: z.array(
		z.object({
			category: z.string(),
			path: z.string(),
			name: z.string(),
			relevance: z.string(),
			isPrimary: z.boolean(),
			context: z.string(),
		}),
	),
	/** The questions this document answered, each with its position and up to two key points with a quote each. */
	answers: z.array(
		z.object({
			question: z.string(),
			clause: z.string(),
			text: z.string(),
			position: z.string(),
			keyPoints: z.array(keyPointSchema),
		}),
	),
	questionsPutTo: z.number().int(),
	/** Findings of a perspective or criteria task, by the task's own categories, up to DOCUMENT_FINDINGS_SHOWN. */
	findings: z.array(
		z.object({
			topic: z.string(),
			subtopic: z.string(),
			keyPoint: z.string(),
			details: z.string(),
			quotes: z.array(z.string()),
		}),
	),
	findingsTruncated: z.number().int(),
	metrics: z.array(
		z.object({
			metricType: z.string(),
			metricName: z.string(),
			explicitness: z.string(),
			description: z.string(),
			requirements: z.array(z.string()),
			northStars: z.array(z.object({ northStar: z.string(), how: z.string() })),
		}),
	),
	/** The current topics its passages fell into. */
	topics: z.array(
		z.object({ topic_id: z.number().int(), title: z.string(), passages: z.number().int() }),
	),
	/** The extracted text: its opening by default (TEXT_PREVIEW_CHARS), or with `include_text` up to TEXT_CHARS_MAX; `document_text` pages the whole. */
	text: z.string(),
	textChars: z.number().int(),
	textTruncated: z.boolean(),
	analysed: z.boolean(),
	...sourceWords,
	note: z.string(),
})
export type DocumentOutput = z.infer<typeof documentOutputSchema>

/* ───────────────────────── Markdown: the resources' text ───────────────────────── */

const line = (label: string, value: string | number | null | undefined): string | null =>
	value === null || value === undefined || value === '' ? null : `**${label}:** ${value}`

const mixLine = (mix: Readonly<Record<string, number>>): string =>
	Object.entries(mix)
		.map(([position, n]) => `${position} ${n}`)
		.join(' · ')

const quoteLines = (quotes: readonly Quote[]): string[] =>
	quotes.map((q) =>
		q.withheld
			? `> _${q.quote}_ — ${q.source ?? 'unattributed'}`
			: `> “${q.quote}” — ${q.source ?? 'unattributed'}${q.lensValue ? ` (${q.lensValue})` : ''}`,
	)

export function topicMarkdown(t: TopicOutput, words: RunWords): string {
	const parts: string[] = [`# ${t.title}`]
	if (t.junk) parts.push(`_Confirmed as junk in review${t.junkReason ? `: ${t.junkReason}` : ''}._`)
	parts.push(t.description)
	parts.push(
		[
			line('Web', t.url),
			line('Lineage', t.lineage.map((n) => n.title ?? `Group ${n.superclusterId}`).join(' › ')),
			line(`${words.nouns.entities} strongly linked`, t.reach.sources),
			line(words.nouns.documents, t.documents),
			line('Stances', `${t.stancesHeld} (${mixLine(t.positionMix)})`),
			line(
				'Contesting',
				`${t.contestation.contestingStances} stance(s)${t.contestation.contestingLensValues.length ? ` from ${t.contestation.contestingLensValues.join(', ')}` : ''}`,
			),
		]
			.filter((l): l is string => l !== null)
			.join('  \n'),
	)
	if (t.keyFindings.length) {
		parts.push('## Key findings')
		for (const [i, f] of t.keyFindings.entries())
			parts.push(
				[`### ${i + 1}. ${f.finding}`, f.details || null, ...quoteLines(f.quotes)]
					.filter((l): l is string => l !== null)
					.join('\n\n'),
			)
	}
	if (t.stances.length) {
		parts.push(
			`## Stances (${t.stances.length} of ${t.stancesHeld}, dissent first)`,
			t.stances
				.map(
					(s) =>
						`- **${s.source}**${s.lensValue ? ` (${s.lensValue})` : ''} — ${s.position}: ${s.framing}`,
				)
				.join('\n'),
		)
		if (t.stancesTruncated > 0)
			parts.push(`_${t.stancesTruncated} further stances: \`source_perspectives\` lists them all._`)
	}
	parts.push('---', `_${t.note}_`)
	return parts.join('\n\n')
}

export function sourceMarkdown(e: SourceOutput, words: RunWords): string {
	const parts: string[] = [`# ${e.source}`]
	if (e.notice) parts.push(`_${e.withheld ? 'Words withheld' : 'Notice'}: ${e.notice}_`)
	const facets = Object.entries(e.facets)
		.map(([key, values]) => line(key, values.join(', ')))
		.filter((l): l is string => l !== null)
	parts.push(
		[
			line('Web', e.url),
			line('Lens', e.lensValue),
			...facets,
			line(words.nouns.documents, e.counts.documents),
			line('Topics strongly linked', e.counts.topics),
			line('Stances', e.counts.stances),
			line('Questions answered', e.counts.questionsAnswered),
		]
			.filter((l): l is string => l !== null)
			.join('  \n'),
	)
	if (e.topics.length) {
		parts.push(
			`## Topics (${e.topics.length}${e.topicsTruncated ? ` of ${e.topics.length + e.topicsTruncated}` : ''})`,
			e.topics
				.map((t) =>
					[
						`### ${t.title}${t.position ? ` — ${t.position}` : ''}`,
						t.framing ? `_${t.framing}_` : null,
						t.analysis || null,
						...t.quotes.map((q) => `> “${q}”`),
					]
						.filter((l): l is string => l !== null)
						.join('\n\n'),
				)
				.join('\n\n'),
		)
	}
	if (e.documents.length) {
		parts.push(
			`## ${words.nouns.documents.charAt(0).toUpperCase()}${words.nouns.documents.slice(1)} (${e.documents.length}${e.documentsTruncated ? ` of ${e.documents.length + e.documentsTruncated}` : ''})`,
			e.documents
				.map(
					(d) =>
						`- ${d.title} — ${d.keyPoints} key points${d.answers ? `, ${d.answers} answers` : ''} (${d.document_id})`,
				)
				.join('\n'),
		)
	}
	parts.push('---', `_${e.note}_`)
	return parts.join('\n\n')
}

export function documentMarkdown(d: DocumentOutput, words: RunWords): string {
	const parts: string[] = [`# ${d.title}`]
	if (d.notice) parts.push(`_${d.withheld ? 'Words withheld' : 'Notice'}: ${d.notice}_`)
	const facets = Object.entries(d.facets)
		.map(([key, values]) => line(key, values.join(', ')))
		.filter((l): l is string => l !== null)
	parts.push(
		[
			line(words.nouns.entity.charAt(0).toUpperCase() + words.nouns.entity.slice(1), d.source),
			line('Web', d.url),
			line('File', d.fileName),
			...facets,
			line('Passages', d.counts.passages),
		]
			.filter((l): l is string => l !== null)
			.join('  \n'),
	)
	if (d.keyPoints.length) {
		parts.push(
			`## Key points (${d.keyPoints.length}${d.keyPointsTruncated ? ` of ${d.keyPoints.length + d.keyPointsTruncated}` : ''})`,
			...d.keyPoints.map((k, i) =>
				[`### ${i + 1}. ${k.keyPoint}`, k.details || null, ...k.quotes.map((q) => `> “${q}”`)]
					.filter((l): l is string => l !== null)
					.join('\n\n'),
			),
		)
	} else if (!d.withheld) {
		parts.push(
			'_The pipeline produced no key points for this document; it still holds topic memberships._',
		)
	}
	if (d.answers.length) {
		parts.push(
			'## Answers',
			...d.answers.map((a) =>
				[
					`### ${a.clause} ${a.text}`,
					a.position || null,
					...a.keyPoints.flatMap((k) => [`- ${k.keyPoint}`, ...k.quotes.map((q) => `  > “${q}”`)]),
				]
					.filter((l): l is string => l !== null)
					.join('\n\n'),
			),
		)
	}
	if (d.findings.length) {
		parts.push(
			'## Findings',
			d.findings
				.map(
					(f) =>
						`- **${f.topic} › ${f.subtopic}:** ${f.keyPoint}${f.details ? ` ${f.details}` : ''}`,
				)
				.join('\n'),
		)
	}
	if (d.tags.length) {
		parts.push(
			'## Tags',
			d.tags
				.map(
					(t) =>
						`- ${t.category}: ${t.path}${t.isPrimary ? ' (primary)' : ''}${t.relevance ? ` · ${t.relevance}` : ''}`,
				)
				.join('\n'),
		)
	}
	if (d.topics.length) {
		parts.push(
			'## Topics its passages fell into',
			d.topics.map((t) => `- ${t.title} (${t.passages} passages, topic ${t.topic_id})`).join('\n'),
		)
	}
	if (d.text) {
		parts.push(
			`## Text${d.textTruncated ? ` (opening ${d.text.length.toLocaleString('en-US')} of ${d.textChars.toLocaleString('en-US')} characters; \`document_text\` pages the whole)` : ''}`,
			d.text,
		)
	}
	parts.push('---', `_${d.note}_`)
	return parts.join('\n\n')
}
