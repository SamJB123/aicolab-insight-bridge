/**
 * @aicolab/insight-bridge/explorer/analysis — what a report's custom analysis
 * pages read: one page per task the run performed, each read by its kind.
 *
 *   tagging        a taxonomy over the documents: every value (and, for a
 *                  nested vocabulary, every ancestor) with the documents
 *                  tagged there, the primaries, and its spread over the lens;
 *                  the values tagged together; then a value's documents with
 *                  the model's own evidence for the tag.
 *   questions      the task's questions in order, who answered each, by lens.
 *   perspective    the task's criteria with their findings, sources and lens;
 *                  then a criterion's findings, a page at a time.
 *   assessment     each scored criterion's distribution, overall and by lens,
 *                  the first two scored together; then the documents ranked.
 *   metrics        the metrics the documents proposed, grouped by name, and
 *                  the north stars they were aligned to where the task had
 *                  any; then a group's entries.
 *
 * Every count is over the task's own documents that are published; a
 * document's lens value is its source's. The lens is the run's
 * (`RunWords.lens`), in its own order, the unclassified last.
 */
import type {
	AnalysisPage,
	AssessedDocuments,
	AssessmentOverview,
	EvidenceSource,
	LensBase,
	MetricEntries,
	MetricsOverview,
	PerspectiveFindings,
	PerspectiveOverview,
	QuestionsOverview,
	ReportTask,
	RunWords,
	TagDocuments,
	TaggedValue,
	TaggingOverview,
} from '@aicolab/insight-bridge-contracts/explorer'
import type { CorpusDb } from '@aicolab/insight-bridge-contracts/schema'
import * as s from '@aicolab/insight-bridge-contracts/schema'
import { type AnalysisTask, TASK_TYPES, taskTitle } from '@aicolab/insight-bridge-contracts/tasks'
import { PATH_SEP } from '@aicolab/insight-bridge-contracts/vocabulary'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { questionClause } from '../world/schema.ts'
import { loadFacetCache } from './facets.ts'
import { lensOf, lensRank, questionDetail } from './pages.ts'

const n = (v: unknown) => Number(v ?? 0)
const pct = (part: number, whole: number) => (whole ? Math.round((1000 * part) / whole) / 10 : 0)
const round2 = (v: number) => Math.round(v * 100) / 100
/** Ids at a time in an IN list: D1 and Durable Object SQLite bind ~100 parameters per statement. */
const BATCH = 90
const inGroups = <T>(items: readonly T[], size = BATCH): T[][] =>
	Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
		items.slice(i * size, i * size + size),
	)

/** A page of a long list: where it starts and how many it holds (at most 100). */
export interface Paging {
	offset?: number
	limit?: number
}
const pageOf = <T>(rows: readonly T[], paging: Paging) => {
	const offset = Math.max(0, Math.floor(paging.offset ?? 0))
	const limit = Math.min(100, Math.max(1, Math.floor(paging.limit ?? 25)))
	return rows.slice(offset, offset + limit)
}

/** Narrow the reader's lens filter: undefined is every value, null the unclassified. */
const lensMatches = (filter: string | null | undefined, value: string | null) =>
	filter === undefined || filter === value

// ---------------------------------------------------------------- the task and its documents

const kindOf = (raw: string) => {
	const kind = TASK_TYPES.find((t) => t === raw)
	if (!kind) throw new Error(`[analysis] unknown task type ${raw}`)
	return kind
}

/** The task as the run's profile declares it, when the run carries one. */
async function declarationOf(db: CorpusDb, taskId: string): Promise<AnalysisTask | null> {
	const [meta] = await db
		.select({ profile: s.runMeta.profile })
		.from(s.runMeta)
		.where(eq(s.runMeta.singleton, 1))
		.limit(1)
	return meta?.profile?.analysis_tasks.find((t) => t.task_id === taskId) ?? null
}

interface AnalysedDocument extends EvidenceSource {
	entityUuid: string
}

/**
 * The task's published documents (by its ledger rows), each with whose it is
 * and its lens value; the lens's values with their documents and sources.
 */
async function analysedBy(db: CorpusDb, words: RunWords, taskId: string) {
	const [rows, entityFacets] = await Promise.all([
		db
			.select({
				customAnalysisId: s.docCustomAnalysis.customAnalysisId,
				taskType: s.docCustomAnalysis.taskType,
				documentId: s.publishedDocument.documentId,
				documentTitle: s.publishedDocument.documentTitle,
				fileName: s.publishedDocument.fileName,
				entityUuid: s.entity.id,
				entityId: s.entity.entityId,
				entityName: s.entity.entityName,
			})
			.from(s.docCustomAnalysis)
			.innerJoin(
				s.publishedDocument,
				eq(s.publishedDocument.documentId, s.docCustomAnalysis.documentId),
			)
			.innerJoin(s.entity, eq(s.entity.id, s.publishedDocument.entityUuid))
			.where(eq(s.docCustomAnalysis.taskId, taskId)),
		loadFacetCache(db, 'entity'),
	])
	const byAnalysis = new Map<number, AnalysedDocument>()
	const byDocument = new Map<string, AnalysedDocument>()
	for (const r of rows) {
		const doc: AnalysedDocument = {
			documentId: r.documentId,
			documentTitle: r.documentTitle,
			fileName: r.fileName,
			entityId: r.entityId,
			entityName: r.entityName,
			entityUuid: r.entityUuid,
			lensValue: lensOf(words, entityFacets.get(r.entityUuid)),
		}
		byAnalysis.set(r.customAnalysisId, doc)
		byDocument.set(r.documentId, doc)
	}
	const rank = lensRank(words)
	const tally = new Map<string | null, { documents: number; sources: Set<string> }>()
	for (const d of byDocument.values()) {
		const t = tally.get(d.lensValue) ?? { documents: 0, sources: new Set<string>() }
		t.documents += 1
		t.sources.add(d.entityUuid)
		tally.set(d.lensValue, t)
	}
	const lens: LensBase[] = words.lens
		? [...tally]
				.map(([value, t]) => ({ value, documents: t.documents, sources: t.sources.size }))
				.sort((a, b) => rank(a.value) - rank(b.value) || b.documents - a.documents)
		: []
	const lensIndex = new Map(lens.map((l, i) => [l.value, i]))
	return {
		kind: rows[0] ? kindOf(rows[0].taskType) : null,
		byAnalysis,
		byDocument,
		lens,
		/** A zeroed count per lens value. */
		zeros: () => lens.map(() => 0),
		/** The lens slot of a value, or -1 without a lens. */
		slot: (value: string | null) => lensIndex.get(value) ?? -1,
	}
}

const reportTask = (
	words: RunWords,
	taskId: string,
	kind: ReportTask['kind'],
	declaration: AnalysisTask | null,
	documents: number,
): ReportTask => ({
	taskId,
	kind,
	title: words.tasks[taskId]?.title ?? taskTitle({ task_id: taskId, title: null }),
	description: declaration?.task_description ?? '',
	documents,
})

/** Every custom analysis the run performed, in its profile's order: the pages the analysis section lists. */
export async function analysisTasks(db: CorpusDb, words: RunWords): Promise<ReportTask[]> {
	const [rows, meta] = await Promise.all([
		db.all<{ taskId: string; taskType: string; documents: number }>(sql`
			SELECT dca.task_id AS taskId, dca.task_type AS taskType, COUNT(DISTINCT dca.document_id) AS documents
			FROM doc_custom_analysis dca JOIN published_document d ON d.document_id = dca.document_id
			GROUP BY dca.task_id, dca.task_type`),
		db
			.select({ profile: s.runMeta.profile })
			.from(s.runMeta)
			.where(eq(s.runMeta.singleton, 1))
			.limit(1),
	])
	const declared = meta[0]?.profile?.analysis_tasks ?? []
	const order = (taskId: string) => {
		const at = declared.findIndex((t) => t.task_id === taskId)
		return at < 0 ? declared.length : at
	}
	return rows
		.sort((a, b) => order(a.taskId) - order(b.taskId) || a.taskId.localeCompare(b.taskId))
		.map((r) =>
			reportTask(
				words,
				r.taskId,
				kindOf(r.taskType),
				declared.find((t) => t.task_id === r.taskId) ?? null,
				n(r.documents),
			),
		)
}

/** A custom analysis page: the task's overview, read by its kind; null when the run never performed it. */
export async function analysisPage(
	db: CorpusDb,
	words: RunWords,
	taskId: string,
): Promise<AnalysisPage | null> {
	const kind = words.tasks[taskId]?.type ?? (await analysedBy(db, words, taskId)).kind
	switch (kind) {
		case 'metadata_tagging': {
			const overview = await taggingOverview(db, words, taskId)
			return overview && { kind, overview }
		}
		case 'question_response': {
			const overview = await questionsOverview(db, words, taskId)
			return overview && { kind, overview }
		}
		case 'perspective_analysis': {
			const overview = await perspectiveOverview(db, words, taskId)
			return overview && { kind, overview }
		}
		case 'criteria_assessment': {
			const overview = await assessmentOverview(db, words, taskId)
			return overview && { kind, overview }
		}
		case 'metrics_evaluation': {
			const overview = await metricsOverview(db, words, taskId)
			return overview && { kind, overview }
		}
		default:
			return null
	}
}

const lensFilter = z.string().nullable().optional()
const offset = z.number().int().min(0)

/**
 * What a custom analysis page asks for when its reader opens something: one
 * request for every drill-down, so a host serves them all through one door
 * (`analysisDrill`) and validates what reaches it.
 */
export const analysisDrillSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('tagDocuments'),
		taskId: z.string(),
		category: z.string(),
		path: z.string(),
		offset,
		lensValue: lensFilter,
	}),
	z.object({ kind: z.literal('questionDetail'), questionId: z.number().int() }),
	z.object({
		kind: z.literal('perspectiveFindings'),
		taskId: z.string(),
		criterionId: z.number().int(),
		offset,
		lensValue: lensFilter,
		query: z.string().optional(),
	}),
	z.object({
		kind: z.literal('assessedDocuments'),
		taskId: z.string(),
		offset,
		sortBy: z.number().int().optional(),
		order: z.enum(['asc', 'desc']).optional(),
		lensValue: lensFilter,
		cell: z
			.object({
				xCriterion: z.number().int(),
				x: z.number(),
				yCriterion: z.number().int(),
				y: z.number(),
			})
			.optional(),
	}),
	z.object({
		kind: z.literal('metricEntries'),
		taskId: z.string(),
		offset,
		name: z.string().optional(),
		northStar: z.string().optional(),
	}),
])
export type AnalysisDrill = z.infer<typeof analysisDrillSchema>

/** A drill-down's answer, by its request's kind (the page parses it against the contract's shape). */
export async function analysisDrill(db: CorpusDb, words: RunWords, request: AnalysisDrill) {
	switch (request.kind) {
		case 'tagDocuments':
			return tagDocuments(db, words, request.taskId, request.category, request.path, request)
		case 'questionDetail':
			return questionDetail(db, words, request.questionId)
		case 'perspectiveFindings':
			return perspectiveFindings(db, words, request.taskId, request.criterionId, request)
		case 'assessedDocuments':
			return assessedDocuments(db, words, request.taskId, request)
		case 'metricEntries':
			return metricEntries(db, words, request.taskId, request)
	}
}

/** The task's own documents and declaration, or null when the run never performed it. */
async function taskFrame(db: CorpusDb, words: RunWords, taskId: string) {
	const [frame, declaration] = await Promise.all([
		analysedBy(db, words, taskId),
		declarationOf(db, taskId),
	])
	const kind = frame.kind ?? (declaration ? declaration.task_type : null)
	if (!kind) return null
	return {
		...frame,
		declaration,
		task: reportTask(words, taskId, kind, declaration, frame.byDocument.size),
	}
}

// ---------------------------------------------------------------- tagging

const relevanceRank = (r: string | null) =>
	r === 'High' ? 0 : r === 'Medium' ? 1 : r === 'Low' ? 2 : 3

/** Every prefix of a value's path, root first: "A › B › C" → A, A › B, A › B › C. */
const prefixes = (path: string) => {
	const parts = path.split(PATH_SEP)
	return parts.map((_, i) => parts.slice(0, i + 1).join(PATH_SEP))
}

/** A category's vocabulary as the run registered it: each concept's path, in the vocabulary's order, and its level names. */
async function vocabularyOf(db: CorpusDb, category: string) {
	const [facetRow] = await db
		.select({ kind: s.facet.kind, vocabularyId: s.facet.vocabularyId })
		.from(s.facet)
		.where(eq(s.facet.facet, category))
		.limit(1)
	const vocabularyId = facetRow?.vocabularyId ?? null
	if (vocabularyId === null)
		return { free: true, paths: [] as string[], levels: [] as string[], nested: false }
	const [vocabulary, concepts, labels, broader] = await Promise.all([
		db
			.select({ levels: s.vocabulary.levelNames })
			.from(s.vocabulary)
			.where(eq(s.vocabulary.vocabularyId, vocabularyId))
			.limit(1),
		db
			.select({ id: s.concept.conceptId })
			.from(s.concept)
			.where(and(eq(s.concept.vocabularyId, vocabularyId), eq(s.concept.deprecated, 0)))
			.orderBy(asc(s.concept.conceptId)),
		db
			.select({ id: s.conceptLabel.conceptId, label: s.conceptLabel.label })
			.from(s.conceptLabel)
			.innerJoin(s.concept, eq(s.concept.conceptId, s.conceptLabel.conceptId))
			.where(and(eq(s.concept.vocabularyId, vocabularyId), eq(s.conceptLabel.kind, 'pref'))),
		db
			.select({ id: s.conceptBroader.conceptId, parent: s.conceptBroader.broaderId })
			.from(s.conceptBroader)
			.innerJoin(s.concept, eq(s.concept.conceptId, s.conceptBroader.conceptId))
			.where(eq(s.concept.vocabularyId, vocabularyId)),
	])
	const labelOf = new Map(labels.map((l) => [l.id, l.label]))
	const parentOf = new Map(broader.map((b) => [b.id, b.parent]))
	const pathOf = (id: number, seen = new Set<number>()): string => {
		const label = labelOf.get(id) ?? String(id)
		const parent = parentOf.get(id)
		if (parent === undefined || seen.has(parent)) return label
		seen.add(id)
		return `${pathOf(parent, seen)}${PATH_SEP}${label}`
	}
	return {
		free: facetRow?.kind === 'free',
		paths: concepts.map((c) => pathOf(c.id)),
		levels: vocabulary[0]?.levels ?? [],
		nested: broader.length > 0,
	}
}

/** A tagging task's categories: every value with its documents, primaries and lens spread, and what is tagged together. */
export async function taggingOverview(
	db: CorpusDb,
	words: RunWords,
	taskId: string,
): Promise<TaggingOverview | null> {
	const frame = await taskFrame(db, words, taskId)
	if (frame?.task.kind !== 'metadata_tagging') return null
	const rows = await db.all<{
		documentId: string
		facet: string
		value: string
		isPrimary: number
	}>(sql`
		SELECT fa.subject_id AS documentId, fa.facet AS facet, fa.facet_value AS value, fa.is_primary AS isPrimary
		FROM facet_assignment fa JOIN doc_custom_analysis dca ON dca.custom_analysis_id = fa.custom_analysis_id
		WHERE dca.task_id = ${taskId} AND fa.subject_type = 'document'`)
	const declared =
		frame.declaration?.task_type === 'metadata_tagging' ? frame.declaration.tag_categories : []
	const names = [...new Set([...declared.map((c) => c.category_name), ...rows.map((r) => r.facet)])]
	const categories = await Promise.all(
		names.map(async (name) => {
			const declaration = declared.find((c) => c.category_name === name)
			const vocabulary = await vocabularyOf(db, name)
			const declaredPaths = new Set(vocabulary.paths)
			const nodes = new Map<
				string,
				{ docs: Set<string>; primary: Set<string>; byLens: Set<string>[] }
			>()
			const node = (path: string) => {
				const found = nodes.get(path)
				if (found) return found
				const made = {
					docs: new Set<string>(),
					primary: new Set<string>(),
					byLens: frame.lens.map(() => new Set<string>()),
				}
				nodes.set(path, made)
				return made
			}
			for (const path of vocabulary.paths) for (const p of prefixes(path)) node(p)
			const tagged = new Set<string>()
			const topOf = new Map<string, Set<string>>()
			for (const r of rows) {
				if (r.facet !== name) continue
				const doc = frame.byDocument.get(r.documentId)
				if (!doc) continue
				tagged.add(doc.documentId)
				const all = prefixes(r.value)
				topOf.set(doc.documentId, (topOf.get(doc.documentId) ?? new Set()).add(all[0] ?? r.value))
				const slot = frame.slot(doc.lensValue)
				for (const p of all) {
					const at = node(p)
					at.docs.add(doc.documentId)
					if (r.isPrimary) at.primary.add(doc.documentId)
					if (slot >= 0) at.byLens[slot]?.add(doc.documentId)
				}
			}
			// siblings by the vocabulary's own order, then any value the model wrote outside it by documents
			const vocabularyOrder = new Map(vocabulary.paths.map((p, i) => [p, i]))
			const order = (path: string) => vocabularyOrder.get(path) ?? Number.MAX_SAFE_INTEGER
			const values: TaggedValue[] = [...nodes]
				.map(([path, at]) => {
					const parts = path.split(PATH_SEP)
					return {
						path,
						name: parts.at(-1) ?? path,
						depth: parts.length - 1,
						parentPath: parts.length > 1 ? parts.slice(0, -1).join(PATH_SEP) : null,
						declared: declaredPaths.has(path),
						documents: at.docs.size,
						primary: at.primary.size,
						byLens: at.byLens.map((set) => set.size),
					}
				})
				.sort(
					(a, b) =>
						order(a.path) - order(b.path) ||
						b.documents - a.documents ||
						a.path.localeCompare(b.path),
				)
			const combos = new Map<string, number>()
			for (const set of topOf.values()) {
				const key = [...set].sort().join('\u0000')
				combos.set(key, (combos.get(key) ?? 0) + 1)
			}
			return {
				name,
				description: declaration?.description ?? '',
				levels: declaration?.levels.length ? declaration.levels : vocabulary.levels,
				primary: declaration?.primary ?? values.some((v) => v.primary > 0),
				vocabulary:
					declaration?.open || vocabulary.free
						? ('open' as const)
						: vocabulary.nested || values.some((v) => v.depth > 0)
							? ('tree' as const)
							: ('list' as const),
				documentsTagged: tagged.size,
				values,
				combinations: [...combos]
					.map(([key, documents]) => ({ paths: key.split('\u0000'), documents }))
					.sort((a, b) => b.documents - a.documents || a.paths.length - b.paths.length)
					.slice(0, 15),
			}
		}),
	)
	return { task: frame.task, lens: frame.lens, categories }
}

/** The documents tagged with a value or beneath it: the leaf each was given and the model's evidence, primaries first. */
export async function tagDocuments(
	db: CorpusDb,
	words: RunWords,
	taskId: string,
	category: string,
	path: string,
	options: Paging & { lensValue?: string | null } = {},
): Promise<TagDocuments | null> {
	const frame = await analysedBy(db, words, taskId)
	if (!frame.kind) return null
	const rows = await db.all<{
		documentId: string
		value: string
		relevance: string | null
		isPrimary: number
		context: string | null
	}>(sql`
		SELECT fa.subject_id AS documentId, fa.facet_value AS value, fa.relevance AS relevance,
			fa.is_primary AS isPrimary, fa.context AS context
		FROM facet_assignment fa JOIN doc_custom_analysis dca ON dca.custom_analysis_id = fa.custom_analysis_id
		WHERE dca.task_id = ${taskId} AND fa.subject_type = 'document' AND fa.facet = ${category}
			AND (fa.facet_value = ${path} OR fa.facet_value LIKE ${`${path}${PATH_SEP}%`})`)
	// a document once, at its strongest tag here: primary, then relevance
	const best = new Map<string, (typeof rows)[number]>()
	for (const r of rows) {
		const doc = frame.byDocument.get(r.documentId)
		if (!doc || !lensMatches(options.lensValue, doc.lensValue)) continue
		const held = best.get(r.documentId)
		if (
			!held ||
			r.isPrimary > held.isPrimary ||
			(r.isPrimary === held.isPrimary && relevanceRank(r.relevance) < relevanceRank(held.relevance))
		)
			best.set(r.documentId, r)
	}
	const documents = [...best.values()]
		.flatMap((r) => {
			const doc = frame.byDocument.get(r.documentId)
			return doc
				? [
						{
							...evidence(doc),
							tag: r.value,
							relevance: r.relevance,
							isPrimary: r.isPrimary === 1,
							context: r.context,
						},
					]
				: []
		})
		.sort(
			(a, b) =>
				Number(b.isPrimary) - Number(a.isPrimary) ||
				relevanceRank(a.relevance) - relevanceRank(b.relevance) ||
				a.entityName.localeCompare(b.entityName),
		)
	return { category, path, total: documents.length, documents: pageOf(documents, options) }
}

const evidence = (doc: AnalysedDocument): EvidenceSource => ({
	documentId: doc.documentId,
	documentTitle: doc.documentTitle,
	fileName: doc.fileName,
	entityId: doc.entityId,
	entityName: doc.entityName,
	lensValue: doc.lensValue,
})

// ---------------------------------------------------------------- questions

/** A question task's questions in its order, who answered each, and how each lens value engaged. */
export async function questionsOverview(
	db: CorpusDb,
	words: RunWords,
	taskId: string,
): Promise<QuestionsOverview | null> {
	const frame = await taskFrame(db, words, taskId)
	if (frame?.task.kind !== 'question_response') return null
	const [questions, answers, keyPoints] = await Promise.all([
		db
			.select()
			.from(s.question)
			.where(eq(s.question.taskId, taskId))
			.orderBy(asc(s.question.ordinal), asc(s.question.questionId)),
		db
			.select({
				questionId: s.publishedQuestionResponse.questionId,
				documentId: s.publishedQuestionResponse.documentId,
			})
			.from(s.publishedQuestionResponse)
			.innerJoin(s.question, eq(s.question.questionId, s.publishedQuestionResponse.questionId))
			.where(and(eq(s.question.taskId, taskId), eq(s.publishedQuestionResponse.addressed, 1))),
		db.all<{ questionId: number; keyPoints: number }>(sql`
			SELECT r.question_id AS questionId, COUNT(*) AS keyPoints
			FROM published_question_response_key_point k
			JOIN published_question_response r ON r.question_response_id = k.question_response_id
			JOIN question q ON q.question_id = r.question_id
			WHERE q.task_id = ${taskId}
			GROUP BY r.question_id`),
	])
	// the task's sources: whose documents it read
	const sources = new Map<string, string | null>()
	for (const d of frame.byDocument.values()) sources.set(d.entityUuid, d.lensValue)
	const sourcesOf = new Map<number, Set<string>>()
	const responsesOf = new Map<number, number>()
	const cell = new Map<string, Set<string>>()
	for (const a of answers) {
		const doc = frame.byDocument.get(a.documentId)
		if (!doc) continue
		sourcesOf.set(a.questionId, (sourcesOf.get(a.questionId) ?? new Set()).add(doc.entityUuid))
		responsesOf.set(a.questionId, (responsesOf.get(a.questionId) ?? 0) + 1)
		const key = `${doc.lensValue ?? ''}|${a.questionId}`
		cell.set(key, (cell.get(key) ?? new Set()).add(doc.entityUuid))
	}
	const keyPointsOf = new Map(keyPoints.map((r) => [r.questionId, n(r.keyPoints)]))
	const lensValues = frame.lens.map((l) => ({ value: l.value, sources: l.sources }))
	return {
		task: frame.task,
		questions: questions.map((q) => ({
			questionId: q.questionId,
			key: q.questionKey,
			clause: questionClause(q.questionKey, q.questionText),
			text: q.questionText,
			ordinal: q.ordinal,
			sources: sourcesOf.get(q.questionId)?.size ?? 0,
			responses: responsesOf.get(q.questionId) ?? 0,
			keyPoints: keyPointsOf.get(q.questionId) ?? 0,
		})),
		lensValues,
		heat: lensValues.map((v) => ({
			value: v.value,
			cells: questions.map((q) => {
				const addressed = cell.get(`${v.value ?? ''}|${q.questionId}`)?.size ?? 0
				return {
					questionId: q.questionId,
					addressed,
					sources: v.sources,
					pct: pct(addressed, v.sources),
				}
			}),
		})),
		overall: questions.map((q) => ({
			questionId: q.questionId,
			pct: pct(sourcesOf.get(q.questionId)?.size ?? 0, sources.size),
		})),
		sourcesWithDocuments: sources.size,
	}
}

// ---------------------------------------------------------------- perspective and assessment rows

/** A criterion task's rows: each finding or score, its criterion and category, and the document it is of. */
async function criterionRows(db: CorpusDb, taskId: string) {
	return db.all<{
		id: number
		criterionId: number
		criterion: string
		category: string
		customAnalysisId: number
		item: number | null
		score: number | null
	}>(sql`
		SELECT ca.criterion_analysis_id AS id, ca.analysis_subtopic_id AS criterionId, st.subtopic_name AS criterion,
			t.topic_name AS category, ca.custom_analysis_id AS customAnalysisId, ca.item AS item, ca.score AS score
		FROM criterion_analysis ca
		JOIN doc_custom_analysis dca ON dca.custom_analysis_id = ca.custom_analysis_id
		JOIN analysis_subtopic st ON st.analysis_subtopic_id = ca.analysis_subtopic_id
		JOIN analysis_topic t ON t.analysis_topic_id = st.analysis_topic_id
		WHERE dca.task_id = ${taskId}
		ORDER BY ca.criterion_analysis_id`)
}

/** The criteria a task declared, in its order, by their text: the order its pages list them in. */
const declaredCriteria = (declaration: AnalysisTask | null) =>
	declaration?.task_type === 'perspective_analysis' ||
	declaration?.task_type === 'criteria_assessment'
		? declaration.categories.flatMap((c) =>
				c.criteria.map((x) => ({
					text: x.criterion,
					description: 'description' in x ? x.description : '',
					range: 'score_range' in x ? x.score_range : null,
				})),
			)
		: []

/** Each finding's text and quotes, for a page of ids. */
async function findingTexts(db: CorpusDb, ids: readonly number[]) {
	const texts = new Map<number, { keyPoint: string; details: string; quotes: string[] }>()
	for (const group of inGroups(ids)) {
		const [rows, quotes] = await Promise.all([
			db
				.select({
					id: s.criterionAnalysis.criterionAnalysisId,
					keyPoint: s.criterionAnalysis.keyPoint,
					details: s.criterionAnalysis.details,
				})
				.from(s.criterionAnalysis)
				.where(inArray(s.criterionAnalysis.criterionAnalysisId, group)),
			db
				.select({ id: s.criterionQuote.criterionAnalysisId, quote: s.criterionQuote.quote })
				.from(s.criterionQuote)
				.where(inArray(s.criterionQuote.criterionAnalysisId, group))
				.orderBy(asc(s.criterionQuote.quoteId)),
		])
		for (const r of rows) texts.set(r.id, { keyPoint: r.keyPoint, details: r.details, quotes: [] })
		for (const q of quotes) texts.get(q.id)?.quotes.push(q.quote)
	}
	return texts
}

/** The criteria found in the rows, in the task's declared order (then first seen). */
const criteriaOf = (
	rows: Awaited<ReturnType<typeof criterionRows>>,
	declared: ReturnType<typeof declaredCriteria>,
) => {
	const seen = new Map<number, { criterionId: number; text: string; category: string }>()
	for (const r of rows)
		if (!seen.has(r.criterionId))
			seen.set(r.criterionId, {
				criterionId: r.criterionId,
				text: r.criterion,
				category: r.category,
			})
	const at = (text: string) => {
		const i = declared.findIndex((d) => d.text === text)
		return i < 0 ? declared.length : i
	}
	return [...seen.values()].sort((a, b) => at(a.text) - at(b.text) || a.criterionId - b.criterionId)
}

// ---------------------------------------------------------------- perspective

/** A perspective task's criteria: findings, documents and sources under each, sources by lens value. */
export async function perspectiveOverview(
	db: CorpusDb,
	words: RunWords,
	taskId: string,
): Promise<PerspectiveOverview | null> {
	const frame = await taskFrame(db, words, taskId)
	if (frame?.task.kind !== 'perspective_analysis') return null
	const rows = (await criterionRows(db, taskId)).filter((r) =>
		frame.byAnalysis.has(r.customAnalysisId),
	)
	const criteria = criteriaOf(rows, declaredCriteria(frame.declaration)).map((c) => {
		const mine = rows.filter((r) => r.criterionId === c.criterionId)
		const docs = mine.flatMap((r) => {
			const doc = frame.byAnalysis.get(r.customAnalysisId)
			return doc ? [doc] : []
		})
		const byLens = frame.lens.map(() => new Set<string>())
		for (const d of docs) byLens[frame.slot(d.lensValue)]?.add(d.entityUuid)
		return {
			...c,
			findings: mine.length,
			documents: new Set(docs.map((d) => d.documentId)).size,
			sources: new Set(docs.map((d) => d.entityUuid)).size,
			byLens: byLens.map((set) => set.size),
		}
	})
	return {
		task: frame.task,
		lens: frame.lens,
		criteria,
		itemized: rows.some((r) => r.item !== null),
	}
}

/**
 * A criterion's findings, a page at a time, by source: each with its quotes
 * and, where the run numbered its findings, the other entries of its finding.
 * `query` narrows to findings whose text or source mentions it.
 */
export async function perspectiveFindings(
	db: CorpusDb,
	words: RunWords,
	taskId: string,
	criterionId: number,
	options: Paging & { lensValue?: string | null; query?: string } = {},
): Promise<PerspectiveFindings | null> {
	const frame = await analysedBy(db, words, taskId)
	if (!frame.kind) return null
	const rows = (await criterionRows(db, taskId)).filter((r) =>
		frame.byAnalysis.has(r.customAnalysisId),
	)
	const needle = options.query?.trim().toLowerCase() ?? ''
	let mine = rows.filter((r) => {
		if (r.criterionId !== criterionId) return false
		const doc = frame.byAnalysis.get(r.customAnalysisId)
		return !!doc && lensMatches(options.lensValue, doc.lensValue)
	})
	if (needle) {
		const texts = await findingTexts(
			db,
			mine.map((r) => r.id),
		)
		mine = mine.filter((r) => {
			const t = texts.get(r.id)
			const doc = frame.byAnalysis.get(r.customAnalysisId)
			return (
				!!t &&
				`${t.keyPoint}\n${t.details}\n${t.quotes.join('\n')}\n${doc?.entityName ?? ''}`
					.toLowerCase()
					.includes(needle)
			)
		})
	}
	const sorted = mine.sort((a, b) => {
		const da = frame.byAnalysis.get(a.customAnalysisId)
		const db_ = frame.byAnalysis.get(b.customAnalysisId)
		return (da?.entityName ?? '').localeCompare(db_?.entityName ?? '') || a.id - b.id
	})
	const page = pageOf(sorted, options)
	const siblings = rows.filter((r) =>
		page.some(
			(p) =>
				p.item !== null &&
				r.item === p.item &&
				r.customAnalysisId === p.customAnalysisId &&
				r.id !== p.id,
		),
	)
	const texts = await findingTexts(
		db,
		[...page, ...siblings].map((r) => r.id),
	)
	return {
		criterionId,
		total: sorted.length,
		findings: page.flatMap((r) => {
			const doc = frame.byAnalysis.get(r.customAnalysisId)
			const text = texts.get(r.id)
			if (!doc || !text) return []
			return [
				{
					...evidence(doc),
					findingId: r.id,
					item: r.item,
					criterionId: r.criterionId,
					...text,
					alongside: siblings
						.filter((x) => x.customAnalysisId === r.customAnalysisId && x.item === r.item)
						.flatMap((x) => {
							const t = texts.get(x.id)
							return t ? [{ criterionId: x.criterionId, ...t }] : []
						}),
				},
			]
		}),
	}
}

// ---------------------------------------------------------------- assessment

/** Distinct scores with their documents, lowest first. */
const distributionOf = (scores: readonly number[]) => {
	const counts = new Map<number, number>()
	for (const v of scores) counts.set(round2(v), (counts.get(round2(v)) ?? 0) + 1)
	return [...counts]
		.map(([score, documents]) => ({ score, documents }))
		.sort((a, b) => a.score - b.score)
}
const meanOf = (scores: readonly number[]) =>
	scores.length ? round2(scores.reduce((a, v) => a + v, 0) / scores.length) : null

/** An assessment task's criteria: each one's scores, overall and by lens value; the first two scored together. */
export async function assessmentOverview(
	db: CorpusDb,
	words: RunWords,
	taskId: string,
): Promise<AssessmentOverview | null> {
	const frame = await taskFrame(db, words, taskId)
	if (frame?.task.kind !== 'criteria_assessment') return null
	const rows = (await criterionRows(db, taskId)).filter((r) =>
		frame.byAnalysis.has(r.customAnalysisId),
	)
	const declared = declaredCriteria(frame.declaration)
	const criteria = criteriaOf(rows, declared).map((c) => {
		const scored = rows.filter((r) => r.criterionId === c.criterionId && r.score !== null)
		const scoresOf = (filter: (lens: string | null) => boolean) =>
			scored.flatMap((r) => {
				const doc = frame.byAnalysis.get(r.customAnalysisId)
				return doc && r.score !== null && filter(doc.lensValue) ? [r.score] : []
			})
		const all = scoresOf(() => true)
		const declaration = declared.find((d) => d.text === c.text)
		return {
			...c,
			description: declaration?.description ?? '',
			range: declaration?.range ?? null,
			scored: all.length,
			mean: meanOf(all),
			distribution: distributionOf(all),
			byLens: frame.lens.map((l) => {
				const mine = scoresOf((value) => value === l.value)
				return {
					value: l.value,
					scored: mine.length,
					mean: meanOf(mine),
					distribution: distributionOf(mine),
				}
			}),
		}
	})
	const [x, y] = criteria
	let joint: AssessmentOverview['joint'] = null
	if (x && y) {
		const scoreOf = (criterionId: number) => {
			const map = new Map<number, number>()
			for (const r of rows)
				if (r.criterionId === criterionId && r.score !== null)
					map.set(r.customAnalysisId, round2(r.score))
			return map
		}
		const xs = scoreOf(x.criterionId)
		const ys = scoreOf(y.criterionId)
		const cells = new Map<string, { x: number; y: number; documents: number }>()
		for (const [analysis, xv] of xs) {
			const yv = ys.get(analysis)
			if (yv === undefined) continue
			const key = `${xv}|${yv}`
			const cell = cells.get(key) ?? { x: xv, y: yv, documents: 0 }
			cell.documents += 1
			cells.set(key, cell)
		}
		joint = { x: x.criterionId, y: y.criterionId, cells: [...cells.values()] }
	}
	return { task: frame.task, lens: frame.lens, criteria, joint }
}

/**
 * The task's documents with every score, ranked by one criterion (highest
 * first by default); narrowed to a lens value, or to one cell of the joint
 * scores (`x` and `y` are the first two criteria's scores).
 */
export async function assessedDocuments(
	db: CorpusDb,
	words: RunWords,
	taskId: string,
	options: Paging & {
		sortBy?: number
		order?: 'asc' | 'desc'
		lensValue?: string | null
		cell?: { xCriterion: number; x: number; yCriterion: number; y: number }
	} = {},
): Promise<AssessedDocuments | null> {
	const frame = await analysedBy(db, words, taskId)
	if (!frame.kind) return null
	const rows = (await criterionRows(db, taskId)).filter((r) =>
		frame.byAnalysis.has(r.customAnalysisId),
	)
	const byAnalysis = new Map<number, typeof rows>()
	for (const r of rows)
		byAnalysis.set(r.customAnalysisId, [...(byAnalysis.get(r.customAnalysisId) ?? []), r])
	const scoreIn = (mine: typeof rows, criterionId: number) =>
		mine.find((r) => r.criterionId === criterionId)?.score ?? null
	const sortBy = options.sortBy ?? rows[0]?.criterionId
	const direction = options.order === 'asc' ? 1 : -1
	const cell = options.cell
	const ranked = [...byAnalysis]
		.filter(([analysis, mine]) => {
			const doc = frame.byAnalysis.get(analysis)
			if (!doc || !lensMatches(options.lensValue, doc.lensValue)) return false
			if (!cell) return true
			const xv = scoreIn(mine, cell.xCriterion)
			const yv = scoreIn(mine, cell.yCriterion)
			return xv !== null && yv !== null && round2(xv) === cell.x && round2(yv) === cell.y
		})
		.sort(([a, ma], [b, mb]) => {
			const sa = sortBy === undefined ? null : scoreIn(ma, sortBy)
			const sb = sortBy === undefined ? null : scoreIn(mb, sortBy)
			if (sa !== sb) return sa === null ? 1 : sb === null ? -1 : direction * (sa - sb)
			return (frame.byAnalysis.get(a)?.entityName ?? '').localeCompare(
				frame.byAnalysis.get(b)?.entityName ?? '',
			)
		})
	const page = pageOf(ranked, options)
	const texts = await findingTexts(
		db,
		page.flatMap(([, mine]) => mine.map((r) => r.id)),
	)
	return {
		total: ranked.length,
		documents: page.flatMap(([analysis, mine]) => {
			const doc = frame.byAnalysis.get(analysis)
			if (!doc) return []
			return [
				{
					...evidence(doc),
					scores: mine.map((r) => ({
						criterionId: r.criterionId,
						score: r.score,
						keyPoint: texts.get(r.id)?.keyPoint ?? '',
						details: texts.get(r.id)?.details ?? '',
						quotes: texts.get(r.id)?.quotes ?? [],
					})),
				},
			]
		}),
	}
}

// ---------------------------------------------------------------- metrics

/** A metric name as a group: case and spacing aside. */
const metricKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')

async function metricRows(db: CorpusDb, taskId: string) {
	const [metrics, alignments] = await Promise.all([
		db.all<{
			metricId: number
			customAnalysisId: number
			type: string
			name: string
			explicitness: string
			description: string
		}>(sql`
			SELECT m.metric_id AS metricId, m.custom_analysis_id AS customAnalysisId, m.metric_type AS type,
				m.metric_name AS name, m.explicitness AS explicitness, m.metric_description AS description
			FROM metric m JOIN doc_custom_analysis dca ON dca.custom_analysis_id = m.custom_analysis_id
			WHERE dca.task_id = ${taskId} ORDER BY m.metric_id`),
		db.all<{ metricId: number; northStar: string; how: string }>(sql`
			SELECT a.metric_id AS metricId, ns.north_star_name AS northStar, a.alignment_how AS how
			FROM metric_north_star_alignment a
			JOIN north_star ns ON ns.north_star_id = a.north_star_id
			JOIN metric m ON m.metric_id = a.metric_id
			JOIN doc_custom_analysis dca ON dca.custom_analysis_id = m.custom_analysis_id
			WHERE dca.task_id = ${taskId} ORDER BY a.alignment_id`),
	])
	return { metrics, alignments }
}

/** A metrics task: the metrics its documents proposed, grouped by name, and the north stars where it had any. */
export async function metricsOverview(
	db: CorpusDb,
	words: RunWords,
	taskId: string,
): Promise<MetricsOverview | null> {
	const frame = await taskFrame(db, words, taskId)
	if (frame?.task.kind !== 'metrics_evaluation') return null
	const { metrics, alignments } = await metricRows(db, taskId)
	const live = metrics.filter((m) => frame.byAnalysis.has(m.customAnalysisId))
	const docOf = (m: (typeof live)[number]) => frame.byAnalysis.get(m.customAnalysisId)
	const alignedTo = new Map<number, string[]>()
	for (const a of alignments)
		alignedTo.set(a.metricId, [...(alignedTo.get(a.metricId) ?? []), a.northStar])
	const groups = new Map<string, typeof live>()
	for (const m of live) groups.set(metricKey(m.name), [...(groups.get(metricKey(m.name)) ?? []), m])
	const declared =
		frame.declaration?.task_type === 'metrics_evaluation' ? frame.declaration.north_stars : []
	const starNames = [...new Set([...declared, ...alignments.map((a) => a.northStar)])]
	return {
		task: frame.task,
		lens: frame.lens,
		northStars: starNames.map((name) => {
			const mine = live.filter((m) => alignedTo.get(m.metricId)?.includes(name))
			const docs = new Set(mine.flatMap((m) => docOf(m)?.documentId ?? []))
			const byLens = frame.zeros()
			for (const id of docs) {
				const slot = frame.slot(frame.byDocument.get(id)?.lensValue ?? null)
				if (slot >= 0) byLens[slot] = (byLens[slot] ?? 0) + 1
			}
			return {
				name,
				declared: declared.includes(name),
				metrics: mine.length,
				documents: docs.size,
				byLens,
			}
		}),
		metrics: [...groups.values()]
			.map((mine) => {
				// the group's name as most of its documents wrote it
				const spellings = new Map<string, number>()
				for (const m of mine) spellings.set(m.name.trim(), (spellings.get(m.name.trim()) ?? 0) + 1)
				const name = [...spellings].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
				const stars = new Map<string, Set<string>>()
				for (const m of mine)
					for (const star of alignedTo.get(m.metricId) ?? [])
						stars.set(star, (stars.get(star) ?? new Set()).add(docOf(m)?.documentId ?? ''))
				return {
					name,
					type: mine[0]?.type ?? '',
					documents: new Set(mine.map((m) => docOf(m)?.documentId)).size,
					explicit: mine.filter((m) => m.explicitness === 'Explicit').length,
					implicit: mine.filter((m) => m.explicitness === 'Implicit').length,
					northStars: [...stars].map(([star, docs]) => ({ name: star, documents: docs.size })),
				}
			})
			.sort((a, b) => b.documents - a.documents || a.name.localeCompare(b.name)),
	}
}

/** The metrics of one name group or one north star, a page at a time, each with its requirements and alignments. */
export async function metricEntries(
	db: CorpusDb,
	words: RunWords,
	taskId: string,
	options: Paging & { name?: string; northStar?: string; lensValue?: string | null } = {},
): Promise<MetricEntries | null> {
	const frame = await analysedBy(db, words, taskId)
	if (!frame.kind) return null
	const { metrics, alignments } = await metricRows(db, taskId)
	const alignmentsOf = new Map<number, { northStar: string; how: string }[]>()
	for (const a of alignments)
		alignmentsOf.set(a.metricId, [
			...(alignmentsOf.get(a.metricId) ?? []),
			{ northStar: a.northStar, how: a.how },
		])
	const key = options.name === undefined ? undefined : metricKey(options.name)
	const chosen = metrics.filter((m) => {
		const doc = frame.byAnalysis.get(m.customAnalysisId)
		if (!doc || !lensMatches(options.lensValue, doc.lensValue)) return false
		if (key !== undefined && metricKey(m.name) !== key) return false
		if (
			options.northStar !== undefined &&
			!alignmentsOf.get(m.metricId)?.some((a) => a.northStar === options.northStar)
		)
			return false
		return true
	})
	const page = pageOf(chosen, options)
	const requirementsOf = new Map<number, string[]>()
	for (const group of inGroups(page.map((m) => m.metricId))) {
		const rows = await db
			.select({
				id: s.metricCollectionRequirement.metricId,
				requirement: s.metricCollectionRequirement.requirement,
			})
			.from(s.metricCollectionRequirement)
			.where(inArray(s.metricCollectionRequirement.metricId, group))
			.orderBy(asc(s.metricCollectionRequirement.requirementId))
		for (const r of rows)
			requirementsOf.set(r.id, [...(requirementsOf.get(r.id) ?? []), r.requirement])
	}
	return {
		total: chosen.length,
		entries: page.flatMap((m) => {
			const doc = frame.byAnalysis.get(m.customAnalysisId)
			if (!doc) return []
			return [
				{
					...evidence(doc),
					metricId: m.metricId,
					name: m.name,
					type: m.type,
					explicitness: m.explicitness,
					description: m.description,
					requirements: requirementsOf.get(m.metricId) ?? [],
					alignments: alignmentsOf.get(m.metricId) ?? [],
				},
			]
		}),
	}
}
