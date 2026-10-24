/**
 * The Brief's contract — ONE shape for every corpus.
 *
 * Settled 2026-09-16, from the pipeline's schema rather than from any app.
 * Four apps had each hard-coded themselves down to a single facet (sector,
 * period, voice) and grown their own node types around it. The pipeline never
 * worked that way: `facet`, `facet_assignment` and `cluster_key_perspective`
 * are generic, and two of the five runs had in fact computed two facets each,
 * one of which the app was silently dropping.
 *
 * So facets are a LIST everywhere they appear. A run with one facet passes a
 * list of one. Nothing here is per-corpus except the words, and those come in
 * as vocabulary.
 *
 * The shapes that cross a wire as an operation's output (a facet's declaration,
 * the chapter reading) are declared as zod schemas with their types inferred, so
 * the report catalogue publishes them from this one definition.
 */
import { z } from 'zod'

/** A facet the reading surfaces, as the app declares it. */
export const facetSpecSchema = z.object({
	/** The `facet` key as the pipeline wrote it: 'sector', 'voice', 'era'. */
	key: z.string(),
	/** The reader's word for it. Defaults to the `facet.noun` in the database. */
	label: z.string().optional(),
	/**
	 * True when the facet's values have a meaningful order (era, period, decade),
	 * which is the one thing the database cannot tell us: a controlled vocabulary
	 * is no guarantee of order, and 'sector' is as much a vocabulary as 'era'.
	 * Ordinal facets draw as a distribution; nominal ones draw as shares.
	 */
	ordinal: z.boolean().optional(),
	/** Value order for an ordinal facet; defaults to the values' natural sort. */
	order: z.array(z.string()).optional(),
	/**
	 * How a value should READ, where the pipeline's own word is not the
	 * reader's: `True` → "Gave evidence at a hearing",
	 * `public_hearing_transcript` → "Hearing transcript". Plain data, so it
	 * crosses the server boundary with the rest of the config. Values absent
	 * from the map read as the pipeline wrote them.
	 */
	labels: z.record(z.string(), z.string()).optional(),
})
export type FacetSpec = z.infer<typeof facetSpecSchema>

/** One facet value's share of a node's written positions. */
export interface FacetShare {
	facet: string
	value: string
	stances: number
	pct: number
}

/** A contributor cited often enough to name on a node. */
export interface BriefContributor {
	entityId: string
	name: string
	/** The contributor's primary values on the declared facets, for the chip's title. */
	detail: string | null
	count: number
}

/** A node of the record's tree: a grouping node of any generation, or a topic. */
export interface BriefNode {
	id: number
	/** The tree's own word for this generation: "family", "theme", "group", "topic". */
	kind: string
	/** The pipeline's title, split at its first ": " into subject and claim. */
	title: string
	subject: string
	claim: string
	description: string | null
	topics: number
	sources: number
	stances: number
	positions: Record<string, number>
	contesting: number
	unclear: number
	supportivePct: number
	/** Every declared facet's mix over this node, in the order declared. */
	facets: FacetShare[]
	contributors: BriefContributor[]
	contributorTotal: number
}

export type BriefFamily = BriefNode & { themeIds: number[]; topicIds: number[] }
export type BriefTheme = BriefNode & { familyId: number | null; topicIds: number[] }

export interface BriefStar {
	x: number
	y: number
	r: number
}

export interface BriefTopic {
	id: number
	title: string
	subject: string
	claim: string
	description: string
	/** The grouping node directly above it; null when the run built none. */
	parentId: number | null
	sources: number
	stances: number
	positions: Record<string, number>
	contesting: number
	/** Distinct values this topic's contributors hold, per declared facet. */
	facetCounts: Record<string, number>
	/** Facets on which every contributor holds the SAME value — a one-sided topic. */
	singleValue: Record<string, string>
	star: BriefStar | null
}

export interface BriefData {
	/** Contributors and substantive topics in the whole record. */
	scale: { sources: number; topics: number }
	/** The facets this reading surfaces, resolved against the database. */
	facets: Array<FacetSpec & { label: string }>
	/**
	 * Whether this run's positions measure AGREEMENT with a node's claim. False
	 * for a run whose positions grade something else — a severity scale, say —
	 * where `supportivePct`, `contesting` and `unclear` mean nothing and the
	 * reading shows the position mix alone.
	 */
	agreementAxis: boolean
	/** True when the run built no grouping tree: the chapters are the topics. */
	flat: boolean
	/** True when the run built exactly ONE grouping generation. */
	singleGeneration: boolean
	/** True when the tree is deeper than the two generations a chapter draws. */
	deeperTree: boolean
	/** Root groups by reach; empty when flat. */
	families: BriefFamily[]
	themes: Record<number, BriefTheme>
	topics: Record<number, BriefTopic>
	/** Every substantive topic by reach — the chapter order when flat. */
	topicOrder: number[]
	/** Each topic as a node in its own right, for a topic chapter's facts. */
	chapters: Record<number, BriefNode>
}

/* ── the reading, fetched per chapter on demand ─────────────────────────── */

export const readingQuoteSchema = z.object({
	text: z.string(),
	source: z.string(),
	entityId: z.string(),
	/** The speaker's primary values on the declared facets. */
	detail: z.string().nullable(),
	/** The words are WITHHELD and `text` is the notice standing in for them
	 * (a contributor whose content the app gates — Indigenous Cultural and
	 * Intellectual Property under a restricted deployment). */
	withheld: z.boolean().optional(),
	/** The scope's notice: the text standing in when `withheld`, else shown beside the words. */
	notice: z.string().optional(),
})
export type ReadingQuote = z.infer<typeof readingQuoteSchema>

export const readingPointSchema = z.object({
	id: z.number().int(),
	topicId: z.number().int(),
	point: z.string(),
	details: z.string(),
	quote: readingQuoteSchema.nullable(),
})
export type ReadingPoint = z.infer<typeof readingPointSchema>

/** One facet value's position on one topic — a cell of the who-says-what matrix. */
export const facetPinSchema = z.object({
	topicId: z.number().int(),
	facet: z.string(),
	value: z.string(),
	position: z.string(),
	analysis: z.string(),
})
export type FacetPin = z.infer<typeof facetPinSchema>

export const pushbackSchema = z.object({
	topicId: z.number().int(),
	entityId: z.string(),
	name: z.string(),
	detail: z.string().nullable(),
	position: z.string(),
	/** The pipeline's title for the stance; the notice when `withheld`. */
	title: z.string(),
	/** Empty when `withheld`. */
	analysis: z.string(),
	/** The stance's text is withheld (see `ReadingQuote.withheld`); the
	 * contributor and its position label stay. */
	withheld: z.boolean().optional(),
	/** The scope's notice (see `ReadingQuote.notice`). */
	notice: z.string().optional(),
})
export type Pushback = z.infer<typeof pushbackSchema>

export const chapterReadingSchema = z.object({
	id: z.number().int(),
	/** Topics the reading draws on, in reach order. */
	topicIds: z.array(z.number().int()),
	points: z.array(readingPointSchema),
	/** Pins for EVERY declared facet; the matrix renders one section per facet. */
	pins: z.array(facetPinSchema),
	pushback: z.array(pushbackSchema),
})
export type ChapterReading = z.infer<typeof chapterReadingSchema>

/* ── the words ──────────────────────────────────────────────────────────── */

/** The corpus's nouns. The only per-app content in the whole layer. */
export interface BriefVocabulary {
	/** 'submitter' / 'episode' / 'source' / 'report'. */
	source: string
	sources: string
	/** What the page is called in its own words. */
	title: string
	standfirst?: string
}
