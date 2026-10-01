/**
 * The world record — what a report ISLAND is built from.
 *
 * Settled 2026-10-01. An Insight Bridge report becomes a chessboard island:
 * the island is the report's site (one entry point per section), and inside
 * the buildings every topic and every source is a room whose doorways are
 * the record's own relations, each doorway paired with the item that
 * explains it — a source's written perspective beside the door to the topic
 * it is about, a facet's comparative lens over the doors of its cohort.
 *
 * This is the ONE shape that world is built from, read off a run's canonical
 * tables (`record.ts`) and served by the app that holds the run. Everything a
 * room shows is here; nothing is fetched per room. The relations are stated
 * ONCE and referenced by id: a membership is a (topic, source, grade), a
 * perspective is a source's written stance on a topic, and both the topic
 * room and the source room read the same row from their own side.
 *
 * Serialisable, zod-validated at both ends, no corpus named.
 */
import { z } from 'zod'

const id = z.string().min(1)
const facetValues = z.record(z.string(), z.array(z.string()))

/** A verbatim quote, attributed to a source by its public id when the record knows it. */
export const worldQuoteSchema = z.object({ text: z.string(), source: id.nullable() }).readonly()
export type WorldQuote = z.infer<typeof worldQuoteSchema>

/** A key point: the headline, its elaboration, the quotes that back it. */
export const worldPointSchema = z
	.object({ point: z.string(), details: z.string(), quotes: z.array(worldQuoteSchema).readonly() })
	.readonly()
export type WorldPoint = z.infer<typeof worldPointSchema>

/** The run's words, as its site settings and profile give them. */
export const worldSiteSchema = z
	.object({
		/** A stable key for the report: the app's slug, or the run id. */
		slug: id,
		title: z.string().min(1),
		eyebrow: z.string().nullable(),
		standfirst: z.string().nullable(),
		source: z.object({ label: z.string(), href: z.string() }).readonly().nullable(),
		nouns: z
			.object({
				entity: z.string(),
				entities: z.string(),
				document: z.string(),
				documents: z.string(),
			})
			.readonly(),
		/** The position scale: every label, and what its ends mean when it measures agreement. */
		scale: z
			.object({
				order: z.array(z.string()).readonly(),
				supportive: z.array(z.string()).readonly(),
				contesting: z.array(z.string()).readonly(),
				unclear: z.string().nullable(),
			})
			.readonly(),
	})
	.readonly()
export type WorldSite = z.infer<typeof worldSiteSchema>

/** A facet the run ANALYSED (it wrote comparative perspectives along it) — the
 *  only facets that become doorways. Values in the profile's order where it
 *  declares one, else by how many sources carry each. */
export const worldFacetSchema = z
	.object({
		key: id,
		heading: z.string().min(1),
		values: z
			.array(
				z.object({ value: z.string(), label: z.string(), sources: z.number().int() }).readonly(),
			)
			.readonly(),
	})
	.readonly()
export type WorldFacet = z.infer<typeof worldFacetSchema>

export const worldGenerationSchema = z
	.object({ generation: z.number().int(), label: z.string(), labelPlural: z.string() })
	.readonly()

/** A grouping node of any generation. */
export const worldGroupSchema = z
	.object({
		id: z.number().int(),
		generation: z.number().int(),
		title: z.string(),
		description: z.string().nullable(),
		/** Primary parent group, null at a root. */
		parentId: z.number().int().nullable(),
		topics: z.number().int(),
		sources: z.number().int(),
		positions: z.record(z.string(), z.number().int()),
	})
	.readonly()
export type WorldGroup = z.infer<typeof worldGroupSchema>

/** A topic's membership of a grouping node (the soft DAG; one is primary). */
export const worldParentSchema = z
	.object({
		groupId: z.number().int(),
		isPrimary: z.boolean(),
		membershipType: z.string().nullable(),
		similarity: z.number().nullable(),
	})
	.readonly()

/** One facet value's comparative perspective on a topic. */
export const worldLensSchema = z
	.object({
		facet: id,
		value: z.string(),
		position: z.string(),
		analysis: z.string(),
		quotes: z.array(worldQuoteSchema).readonly(),
	})
	.readonly()
export type WorldLens = z.infer<typeof worldLensSchema>

export const worldTopicSchema = z
	.object({
		id: z.number().int(),
		title: z.string(),
		description: z.string(),
		/** Every grouping node it belongs to; exactly one primary when the run built a tree. */
		parents: z.array(worldParentSchema).readonly(),
		sources: z.number().int(),
		documents: z.number().int(),
		positions: z.record(z.string(), z.number().int()),
		keyPoints: z.array(worldPointSchema).readonly(),
		/** The facet-level perspectives, one per (analysed facet, value) the run wrote. */
		lenses: z.array(worldLensSchema).readonly(),
		/** The topic's baked place in the galaxy sky (0..1 disc), when the run baked one. */
		star: z.object({ x: z.number(), y: z.number(), r: z.number() }).readonly().nullable(),
	})
	.readonly()
export type WorldTopic = z.infer<typeof worldTopicSchema>

export const worldDocumentSchema = z
	.object({
		id: id,
		title: z.string(),
		/** How many key points the pipeline drew from it; the points themselves are a reading (`worldReading`). */
		keyPoints: z.number().int(),
	})
	.readonly()
export type WorldDocument = z.infer<typeof worldDocumentSchema>

export const worldSourceSchema = z
	.object({
		/** The public id: the run's `entity_id` slug. */
		id: id,
		name: z.string(),
		/** Values on the ANALYSED facets only (best provenance). */
		facets: facetValues,
		documents: z.array(worldDocumentSchema).readonly(),
		/** Member-grade engagements: counted, never doors. */
		memberOnly: z.number().int(),
	})
	.readonly()
export type WorldSource = z.infer<typeof worldSourceSchema>

export const MEMBERSHIP_GRADES = ['exemplar', 'high_value'] as const
export const worldMembershipSchema = z
	.object({ topicId: z.number().int(), sourceId: id, grade: z.enum(MEMBERSHIP_GRADES) })
	.readonly()
export type WorldMembership = z.infer<typeof worldMembershipSchema>

/** A source's written perspective on a topic — the item beside a doorway,
 *  from either side. Its own key points are a reading (`worldReading`). */
export const worldPerspectiveSchema = z
	.object({
		topicId: z.number().int(),
		sourceId: id,
		title: z.string(),
		description: z.string(),
		position: z.string(),
		analysis: z.string(),
		keyPoints: z.number().int(),
		quotes: z.array(z.string()).readonly(),
	})
	.readonly()
export type WorldPerspective = z.infer<typeof worldPerspectiveSchema>

/** One document's answer to one question of a question task: its position
 *  and its first point, the rest a reading (`worldReading`). */
export const worldAnswerSchema = z
	.object({
		sourceId: id,
		documentId: id,
		position: z.string(),
		lead: z.string().nullable(),
		keyPoints: z.number().int(),
	})
	.readonly()
export type WorldAnswer = z.infer<typeof worldAnswerSchema>

/**
 * The readings a room fetches when an item is opened — the key points the
 * record counts but does not carry (they are three quarters of its weight):
 * a source's perspective on a topic, a document's own analysis, a document's
 * answer to a question.
 */
export const worldReadingRefSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('perspective'), topicId: z.number().int(), sourceId: id }).readonly(),
	z.object({ kind: z.literal('document'), documentId: id }).readonly(),
	z.object({ kind: z.literal('answer'), questionKey: id, documentId: id }).readonly(),
])
export type WorldReadingRef = z.infer<typeof worldReadingRefSchema>

export const worldReadingSchema = z
	.object({ ref: worldReadingRefSchema, keyPoints: z.array(worldPointSchema).readonly() })
	.readonly()
export type WorldReading = z.infer<typeof worldReadingSchema>

export const worldQuestionSchema = z
	.object({
		key: id,
		/** The clause as it reads on a plaque — "(a)" — or the key when the text has none. */
		clause: z.string(),
		text: z.string(),
		ordinal: z.number().int(),
		answers: z.array(worldAnswerSchema).readonly(),
	})
	.readonly()
export type WorldQuestion = z.infer<typeof worldQuestionSchema>

/**
 * A custom analysis the profile declared — a headline concern of this report,
 * so each becomes an entry point of its own. A question task carries its
 * questions and every answer; the other kinds are carried as declared so the
 * island can name their building, and gain their rooms as their readings are
 * added here (their tables: analysis_topic/criterion_analysis, metric, and
 * the vocabulary facets a tagging task writes).
 */
export const worldTaskSchema = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('question_response'),
			id: id,
			title: z.string(),
			description: z.string(),
			questions: z.array(worldQuestionSchema).readonly(),
		})
		.readonly(),
	z
		.object({
			kind: z.enum([
				'metadata_tagging',
				'perspective_analysis',
				'criteria_assessment',
				'metrics_evaluation',
			]),
			id: id,
			title: z.string(),
			description: z.string(),
		})
		.readonly(),
])
export type WorldTask = z.infer<typeof worldTaskSchema>

export const worldRecordSchema = z
	.object({
		site: worldSiteSchema,
		facets: z.array(worldFacetSchema).readonly(),
		/** Grouping generations present, roots first; empty when the run built none. */
		generations: z.array(worldGenerationSchema).readonly(),
		groups: z.array(worldGroupSchema).readonly(),
		topics: z.array(worldTopicSchema).readonly(),
		sources: z.array(worldSourceSchema).readonly(),
		/** Strong memberships only (exemplar, high value): the doorways. */
		memberships: z.array(worldMembershipSchema).readonly(),
		perspectives: z.array(worldPerspectiveSchema).readonly(),
		tasks: z.array(worldTaskSchema).readonly(),
	})
	.readonly()
export type WorldRecord = z.infer<typeof worldRecordSchema>

/** Human name for a grouping generation, counted from the top. */
export const worldGenerationLabel = (generation: number, top: number, plural = false): string => {
	const depth = top - generation
	if (depth === 0) return plural ? 'families' : 'family'
	if (depth === 1) return plural ? 'themes' : 'theme'
	return plural ? 'groups' : 'group'
}

/** "(a) the opportunities…" → "(a)"; a key like AI-TOR-a gives the same letter. */
export const questionClause = (key: string, text: string): string => {
	const lead = text.match(/^\(([a-z0-9]+)\)/i)
	if (lead) return `(${lead[1]})`
	const tail = key.match(/-([a-z0-9]+)$/i)
	return tail ? `(${tail[1]})` : key
}
