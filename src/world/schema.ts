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
 * Read in THREE PARTS (settled 2026-10-25), each when it is needed, off a
 * run's canonical tables (`record.ts`) by the app that holds the run:
 *
 *   the record    every room, door and finding of the island: the record's
 *                 relations, names, titles, positions and counts, and none of
 *                 its writing — read when the island is built;
 *   a room's text the writing one room's walls carry (`worldText`): its key
 *                 points' headlines, its perspectives' and lenses' words, its
 *                 answers — read when the room is entered;
 *   a reading     what a reading sheet adds (`worldReading`): the key points
 *                 with their details and quotes, a perspective's quotes —
 *                 read when an item is opened.
 *
 * The relations are stated ONCE and referenced by id: a membership is a
 * (topic, source, grade), a perspective is a source's written stance on a
 * topic, and both the topic room and the source room read the same row from
 * their own side; a room's text and a reading name their rows by the same ids.
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

/** One facet value's comparative perspective on a topic; its words are its topic's room text. */
export const worldLensSchema = z
	.object({
		facet: id,
		value: z.string(),
		position: z.string(),
		/** How many quotes back it (a lens heading an alley draws them round its rail). */
		quotes: z.number().int(),
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
		/** How many key points the run drew for it; their headlines are its room's text, the rest a reading. */
		keyPoints: z.number().int(),
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
		/** How many key points the pipeline drew from it: their headlines are its
		 *  source's room text, each point's details and quotes a reading. */
		points: z.number().int(),
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
 *  from either side. Its one-word position and its counts; its words are
 *  either side's room text, its key points and quotes a reading. */
export const worldPerspectiveSchema = z
	.object({
		topicId: z.number().int(),
		sourceId: id,
		position: z.string(),
		keyPoints: z.number().int(),
		quotes: z.number().int(),
	})
	.readonly()
export type WorldPerspective = z.infer<typeof worldPerspectiveSchema>

/** One document's answer to one prompt of a task: who answered, how many
 *  points it holds, a criteria assessment's score; its position (a question
 *  task's answer in prose) and its first point are the task's room text,
 *  the rest a reading. */
export const worldAnswerSchema = z
	.object({
		sourceId: id,
		documentId: id,
		keyPoints: z.number().int(),
		/** A criteria assessment's score for this criterion (schema v12); absent on every other answer. */
		score: z.number().optional(),
	})
	.readonly()
export type WorldAnswer = z.infer<typeof worldAnswerSchema>

/* ── a room's text: the writing its walls carry, read when it is entered ── */

/**
 * Whose room's text: the record item every room of a building hangs from —
 * a topic (its room and the hans off it), a source, a cohort (a facet value's
 * lobby), a task (its hall and its prompts' rooms).
 */
export const worldTextRefSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('topic'), topicId: z.number().int() }).readonly(),
	z.object({ kind: z.literal('source'), sourceId: id }).readonly(),
	z.object({ kind: z.literal('cohort'), facet: id, value: z.string() }).readonly(),
	z.object({ kind: z.literal('task'), taskId: id }).readonly(),
])
export type WorldTextRef = z.infer<typeof worldTextRefSchema>

/** A perspective's words: its title, its description and its position's analysis. */
export const worldPerspectiveTextSchema = z
	.object({
		topicId: z.number().int(),
		sourceId: id,
		title: z.string(),
		description: z.string(),
		analysis: z.string(),
	})
	.readonly()
export type WorldPerspectiveText = z.infer<typeof worldPerspectiveTextSchema>

/** A lens's words: its analysis and the quotes that back it. */
export const worldLensTextSchema = z
	.object({
		topicId: z.number().int(),
		facet: id,
		value: z.string(),
		analysis: z.string(),
		quotes: z.array(worldQuoteSchema).readonly(),
	})
	.readonly()
export type WorldLensText = z.infer<typeof worldLensTextSchema>

/** An answer's words: its position where the task writes one, its first point. */
export const worldAnswerTextSchema = z
	.object({
		taskId: id,
		promptKey: id,
		sourceId: id,
		documentId: id,
		position: z.string().nullable(),
		lead: z.string().nullable(),
	})
	.readonly()
export type WorldAnswerText = z.infer<typeof worldAnswerTextSchema>

/**
 * The writing one room's walls carry, by the ids the record names its rows
 * with: a topic's key points' headlines (its rail), each of its documents'
 * headlines (a source's rail), and the words of every perspective, lens and
 * answer hung there. A part the ref's room does not hang is empty.
 */
export const worldTextSchema = z
	.object({
		ref: worldTextRefSchema,
		points: z.array(z.string()).readonly(),
		documents: z
			.array(z.object({ id: id, points: z.array(z.string()).readonly() }).readonly())
			.readonly(),
		perspectives: z.array(worldPerspectiveTextSchema).readonly(),
		lenses: z.array(worldLensTextSchema).readonly(),
		answers: z.array(worldAnswerTextSchema).readonly(),
	})
	.readonly()
export type WorldText = z.infer<typeof worldTextSchema>

/* ── a reading: what a sheet adds, read when an item is opened ── */

/**
 * The readings a room fetches when an item is opened — the key points the
 * record counts but does not carry, with their details and quotes: a topic's
 * own, a source's perspective on a topic (with the perspective's own quotes),
 * a document's own analysis, a document's answer to a task's prompt.
 */
export const worldReadingRefSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('topic'), topicId: z.number().int() }).readonly(),
	z.object({ kind: z.literal('perspective'), topicId: z.number().int(), sourceId: id }).readonly(),
	z.object({ kind: z.literal('document'), documentId: id }).readonly(),
	z.object({ kind: z.literal('answer'), taskId: id, promptKey: id, documentId: id }).readonly(),
])
export type WorldReadingRef = z.infer<typeof worldReadingRefSchema>

export const worldReadingSchema = z
	.object({
		ref: worldReadingRefSchema,
		keyPoints: z.array(worldPointSchema).readonly(),
		/** The item's own quotes beside its points (a perspective's); empty for the rest. */
		quotes: z.array(worldQuoteSchema).readonly(),
	})
	.readonly()
export type WorldReading = z.infer<typeof worldReadingSchema>

/**
 * One PROMPT a task read every document against, with every answer: a
 * question of a question task; a criterion of a perspective or criteria
 * task (the analysis's subtopic, under its analysis topic as `group`).
 */
export const worldPromptSchema = z
	.object({
		/** The question's key, or the criterion's own id in the run. */
		key: id,
		/** The clause as it reads on a plaque — "(a)" — or "(1)", "(2)"… for a criterion. */
		clause: z.string(),
		text: z.string(),
		/** The analysis topic a criterion sits under; null for a question. */
		group: z.string().nullable(),
		ordinal: z.number().int(),
		answers: z.array(worldAnswerSchema).readonly(),
	})
	.readonly()
export type WorldPrompt = z.infer<typeof worldPromptSchema>

/** The task kinds whose results are prompts answered per document. */
export const PROMPT_TASK_KINDS = [
	'question_response',
	'perspective_analysis',
	'criteria_assessment',
] as const

/**
 * A custom analysis the run performed — a headline concern of this report,
 * so each becomes an entry point of its own. Read from the run's ledger
 * (`doc_custom_analysis`), so a run has exactly the tasks it ran. A prompt
 * task (questions, perspective criteria, assessment criteria) carries its
 * prompts and every answer, from that kind's own canonical tables; a tagging
 * or metrics task is carried as declared, so the island can name its
 * building, and gains its rooms as its readings are added here.
 */
export const worldTaskSchema = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.enum(PROMPT_TASK_KINDS),
			id: id,
			title: z.string(),
			description: z.string(),
			prompts: z.array(worldPromptSchema).readonly(),
		})
		.readonly(),
	z
		.object({
			kind: z.enum(['metadata_tagging', 'metrics_evaluation']),
			id: id,
			title: z.string(),
			description: z.string(),
		})
		.readonly(),
])
export type WorldTask = z.infer<typeof worldTaskSchema>
/** A task that carries prompts and answers. */
export type WorldPromptTask = Extract<WorldTask, { prompts: unknown }>
export const isPromptTask = (task: WorldTask): task is WorldPromptTask => 'prompts' in task

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

/** "(a) the opportunities…" → "(a)"; a key like AI-TOR-a gives the same letter. */
export const questionClause = (key: string, text: string): string => {
	const lead = text.match(/^\(([a-z0-9]+)\)/i)
	if (lead) return `(${lead[1]})`
	const tail = key.match(/-([a-z0-9]+)$/i)
	return tail ? `(${tail[1]})` : key
}
