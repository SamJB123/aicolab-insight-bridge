/**
 * THE canonical run schema — the one definition of the database a pipeline
 * run produces, whichever port of the pipeline produced it.
 *
 * Three things are built from this module and nothing else:
 *
 *   • the pipeline zone's run store (a Durable Object's SQLite) — drizzle-kit
 *     generates the store's migrations from these tables;
 *   • the shared reading layer (`brief/`, `sources/`), which runs over an app's
 *     D1 with the same table objects;
 *   • the Python pipeline's `SCHEMA_DDL`, generated from these tables by the
 *     zone's script and held to them by the zone's parity test, table for
 *     table, so the two ports stay in lockstep and a database from either is a
 *     run to the other.
 *
 * A reading APP may EXTEND this — its campaigns, its Top 30 — by declaring its
 * extra tables in its own drizzle file that imports these. It may not
 * redeclare, narrow or denormalise them: an app whose database does not match
 * is behind the standard and gets re-prepared, never accommodated. The run
 * store itself has no extension tier: a run is a run.
 *
 * DDL FIDELITY. The store's DDL used to be hand-written SQL beside a drizzle
 * mirror of it; this module replaces both, so everything the SQL said is said
 * here — CHECK constraints via `check()`, text primary keys made NOT NULL by
 * declaring the key at table level (a bare `text PRIMARY KEY` admits NULL in
 * SQLite), the case-insensitive label index, and the exact UNIQUE forms (a
 * table constraint where the DDL wrote one, a named unique index where it
 * wrote that). The parity test compares structures, not text.
 *
 * JSON COLUMNS are `zodJson(schema)` columns (./zod-json.ts): typed by the
 * contract that defines their content and validated both ways at the driver.
 */
import { clusteringParamsSchema } from '@aicolab/insight-bridge-contracts/clustering'
import {
	manifestDocumentSchema,
	manifestRecordSchema,
} from '@aicolab/insight-bridge-contracts/manifest'
import { profileDocumentSchema, profileSchema } from '@aicolab/insight-bridge-contracts/profile'
import { runConfigSchema } from '@aicolab/insight-bridge-contracts/run-config'
import {
	clusteringTuningSchema,
	entityReviewAppliedSchema,
	hierarchyStatsSchema,
	junkReviewSchema,
	labelStatsSchema,
	unmatchedTopicsSchema,
} from '@aicolab/insight-bridge-contracts/run-notes'
import { runSiteSchema } from '@aicolab/insight-bridge-contracts/site'
import { levelNamesSchema } from '@aicolab/insight-bridge-contracts/vocabulary'
import { sql } from 'drizzle-orm'
import {
	type AnySQLiteColumn,
	check,
	index,
	integer,
	primaryKey,
	real,
	type SQLiteAsyncDatabase,
	sqliteTable,
	text,
	unique,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { zodJson } from './zod-json.ts'

export { zodJson }

/**
 * The schema's version, recorded in `pipeline_state` under `schema_version` by
 * whichever port creates a run database. A run built under an earlier version
 * stays readable; appending to it, or importing its archive, needs the current
 * one.
 *
 *   8 (2026-09-18)  one canonical drizzle schema for both ports. `run_meta`
 *                   holds the run's registry snapshot, records, site and the
 *                   two run-level review notes; `cluster_build` carries the
 *                   four per-build notes; `pipeline_state` is a plain string
 *                   ledger with a NOT NULL key. The name slots, the manifest,
 *                   appends and embedding shards are foundation tables.
 *   7 (2026-09-05)  one vocabulary model for facets and tags.
 *   6 (2026-09-02)  builds and stable topic identity.
 */
export const RUN_SCHEMA_VERSION = 8

/**
 * Either SQLite drizzle speaks over these tables.
 *
 * `DrizzleD1Database` is `SQLiteAsyncDatabase<'async', D1RunResult>` — what a
 * standalone app reads. `DrizzleSqliteDODatabase` is
 * `SQLiteAsyncDatabase<'sync', DurableSQLiteRunResult>` — what the pipeline zone
 * reads for a run, straight from the Durable Object's own storage. Both extend
 * the same class, and its select builder extends `QueryPromise` whatever the
 * result kind, so every query in the reading layer reads the same and `await`
 * resolves a sync result as readily as an async one.
 */
export type CorpusDb = SQLiteAsyncDatabase<'sync' | 'async', unknown>

/* ───────────────────────── core corpus tables ───────────────────────── */

/** A contributor to the corpus. Everything else about it is a facet. */
export const entity = sqliteTable(
	'entity',
	{
		id: text('id').notNull(),
		entityId: text('entity_id').notNull().unique(),
		/** The DISPLAYED name — the computed winner: override › manifest › inferred › entityId. */
		entityName: text('entity_name').notNull(),
		/** A person's rename (Organise, the entity-review gate). Wins over everything. */
		overrideName: text('override_name'),
		/** Supplied by a manifest or metadata spreadsheet. */
		manifestName: text('manifest_name'),
		/** The model's name from Step 1 (first document that yields one). */
		inferredName: text('inferred_name'),
	},
	(t) => [primaryKey({ columns: [t.id] })],
)

export const document = sqliteTable(
	'document',
	{
		documentId: text('document_id').notNull(),
		entityUuid: text('entity_uuid')
			.notNull()
			.references(() => entity.id, { onDelete: 'restrict' }),
		fileName: text('file_name').notNull(),
		/** The DISPLAYED title — manifest › inferred; null falls back to fileName in readers. */
		documentTitle: text('document_title'),
		manifestTitle: text('manifest_title'),
		inferredTitle: text('inferred_title'),
	},
	(t) => [primaryKey({ columns: [t.documentId] }), index('idx_document_entity').on(t.entityUuid)],
)

/**
 * A passage. The Python pipeline stores the embedding vector inline; the zone
 * keeps vectors in R2 shards and writes `[]` here. Either way the column holds a
 * JSON array of numbers, and is typed as one.
 */
export const chunk = sqliteTable(
	'chunk',
	{
		id: text('id').notNull(),
		documentId: text('document_id')
			.notNull()
			.references(() => document.documentId, { onDelete: 'cascade' }),
		chunkIndex: integer('chunk_index').notNull(),
		text: text('text').notNull(),
		embedding: zodJson(z.array(z.number()))('embedding').notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.id] }),
		index('idx_chunk_document').on(t.documentId, t.chunkIndex),
	],
)

/* ───────────────────────── embeddings kept outside the database ───────────────────────── */

/** Embedding payloads may live outside the database as float32 .npy shards (the zone's R2); the store keeps the manifest of them. */
export const embeddingShard = sqliteTable(
	'embedding_shard',
	{
		shardId: text('shard_id').notNull(),
		r2Key: text('r2_key').notNull().unique(),
		model: text('model').notNull(),
		dims: integer('dims').notNull(),
		dtype: text('dtype').notNull().default('f32'),
		chunkCount: integer('chunk_count').notNull(),
		byteLength: integer('byte_length').notNull(),
		createdAt: integer('created_at').notNull(),
	},
	(t) => [primaryKey({ columns: [t.shardId] })],
)

export const chunkEmbeddingRef = sqliteTable(
	'chunk_embedding_ref',
	{
		chunkId: text('chunk_id')
			.notNull()
			.references(() => chunk.id, { onDelete: 'cascade' }),
		shardId: text('shard_id')
			.notNull()
			.references(() => embeddingShard.shardId, { onDelete: 'restrict' }),
		rowOffset: integer('row_offset').notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.chunkId] }),
		index('idx_chunk_embedding_ref_shard').on(t.shardId),
	],
)

/* ───────────────────────── the applied manifest ───────────────────────── */

/**
 * The applied manifest, verbatim: one row per manifest record — its core
 * columns, and its facets and documents as the manifest contract types them.
 * A faithful record of what was applied; the QUERY surface stays
 * `facet_assignment` and the name slots.
 */
export const manifestEntry = sqliteTable(
	'manifest_entry',
	{
		manifestEntryId: integer('manifest_entry_id').primaryKey({ autoIncrement: true }),
		sourceId: text('source_id').notNull(),
		entityId: text('entity_id').notNull(),
		entityName: text('entity_name').notNull(),
		nameProvenance: text('name_provenance').notNull(),
		facets: zodJson(manifestRecordSchema.pick({ facets: true, facet_provenance: true }))(
			'facets_json',
		).notNull(),
		documents: zodJson(manifestDocumentSchema.array())('documents_json').notNull(),
		createdAt: integer('created_at').notNull(),
	},
	(t) => [index('idx_manifest_entry_entity').on(t.entityId)],
)

/* ───────────────────────── vocabularies (v7) ───────────────────────── */

/** A controlled vocabulary pinned to one version: a SKOS scheme, a profile tree, a flat value list, or a library entry. */
export const vocabulary = sqliteTable(
	'vocabulary',
	{
		vocabularyId: integer('vocabulary_id').primaryKey({ autoIncrement: true }),
		key: text('key').notNull(),
		version: text('version').notNull().default(''),
		title: text('title').notNull(),
		description: text('description'),
		sourceUri: text('source_uri'),
		licence: text('licence'),
		/** The level names (Tier 1, Tier 2, …), when the author named them. */
		levelNames: zodJson(levelNamesSchema)('level_names'),
		loadedAt: integer('loaded_at').notNull(),
	},
	(t) => [unique().on(t.key, t.version)],
)

export const concept = sqliteTable(
	'concept',
	{
		conceptId: integer('concept_id').primaryKey({ autoIncrement: true }),
		vocabularyId: integer('vocabulary_id')
			.notNull()
			.references(() => vocabulary.vocabularyId, { onDelete: 'cascade' }),
		/** The stable identifier a manifest may carry: a SKOS concept's uri segment; a profile tree's full path. */
		externalId: text('external_id').notNull(),
		uri: text('uri'),
		/** SKOS notation: the scheme's own code for the concept, when it has one. */
		notation: text('notation'),
		deprecated: integer('deprecated').notNull().default(0),
		replacedById: integer('replaced_by_id').references((): AnySQLiteColumn => concept.conceptId, {
			onDelete: 'set null',
		}),
		created: text('created'),
		modified: text('modified'),
	},
	(t) => [
		unique().on(t.vocabularyId, t.externalId),
		index('idx_concept_vocabulary').on(t.vocabularyId),
		index('idx_concept_notation').on(t.vocabularyId, t.notation),
	],
)

export const conceptLabel = sqliteTable(
	'concept_label',
	{
		conceptLabelId: integer('concept_label_id').primaryKey({ autoIncrement: true }),
		conceptId: integer('concept_id')
			.notNull()
			.references(() => concept.conceptId, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		/** pref | alt | hidden */
		kind: text('kind').notNull(),
		lang: text('lang'),
	},
	(t) => [
		check('concept_label_kind', sql`${t.kind} IN ('pref', 'alt', 'hidden')`),
		unique().on(t.conceptId, t.label, t.kind),
		// Labels resolve case-insensitively (writers.ts normaliseLabel), so the
		// index is on the NOCASE collation of the label, as Python's DDL declares it.
		index('idx_concept_label_lookup').on(sql`${t.label} COLLATE NOCASE`, t.kind),
	],
)

export const conceptNote = sqliteTable(
	'concept_note',
	{
		conceptNoteId: integer('concept_note_id').primaryKey({ autoIncrement: true }),
		conceptId: integer('concept_id')
			.notNull()
			.references(() => concept.conceptId, { onDelete: 'cascade' }),
		/** definition | scope */
		kind: text('kind').notNull(),
		text: text('text').notNull(),
	},
	(t) => [check('concept_note_kind', sql`${t.kind} IN ('definition', 'scope')`)],
)

/** Broader edges — an edge table, so a concept may have several broaders (SKOS polyhierarchy). */
export const conceptBroader = sqliteTable(
	'concept_broader',
	{
		conceptId: integer('concept_id')
			.notNull()
			.references(() => concept.conceptId, { onDelete: 'cascade' }),
		broaderId: integer('broader_id')
			.notNull()
			.references(() => concept.conceptId, { onDelete: 'cascade' }),
	},
	(t) => [
		primaryKey({ columns: [t.conceptId, t.broaderId] }),
		index('idx_concept_broader_parent').on(t.broaderId),
	],
)

export const conceptRelated = sqliteTable(
	'concept_related',
	{
		conceptId: integer('concept_id')
			.notNull()
			.references(() => concept.conceptId, { onDelete: 'cascade' }),
		relatedId: integer('related_id')
			.notNull()
			.references(() => concept.conceptId, { onDelete: 'cascade' }),
	},
	(t) => [primaryKey({ columns: [t.conceptId, t.relatedId] })],
)

/** Matches to other schemes (exact | close | same) and retired identifiers of this concept (former). */
export const conceptMatch = sqliteTable(
	'concept_match',
	{
		conceptMatchId: integer('concept_match_id').primaryKey({ autoIncrement: true }),
		conceptId: integer('concept_id')
			.notNull()
			.references(() => concept.conceptId, { onDelete: 'cascade' }),
		scheme: text('scheme').notNull(),
		uri: text('uri').notNull(),
		kind: text('kind').notNull(),
	},
	(t) => [
		check('concept_match_kind', sql`${t.kind} IN ('exact', 'close', 'same', 'former')`),
		unique().on(t.conceptId, t.uri),
		index('idx_concept_match_uri').on(t.uri),
	],
)

/** Materialised transitive closure over concept_broader; depth 0 = self. Written at load, read by every hierarchy query. */
export const conceptClosure = sqliteTable(
	'concept_closure',
	{
		ancestorId: integer('ancestor_id')
			.notNull()
			.references(() => concept.conceptId, { onDelete: 'cascade' }),
		descendantId: integer('descendant_id')
			.notNull()
			.references(() => concept.conceptId, { onDelete: 'cascade' }),
		depth: integer('depth').notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.ancestorId, t.descendantId] }),
		index('idx_concept_closure_descendant').on(t.descendantId, t.depth),
	],
)

/* ───────────────────────── facets ───────────────────────── */

/** One row per declared facet: its kind, its vocabulary (kind 'vocabulary' only) and the depth its perspectives group at. */
export const facet = sqliteTable(
	'facet',
	{
		facet: text('facet').notNull(),
		/** vocabulary | free */
		kind: text('kind').notNull(),
		vocabularyId: integer('vocabulary_id').references(() => vocabulary.vocabularyId, {
			onDelete: 'set null',
		}),
		/** entity | document */
		granularity: text('granularity').notNull().default('entity'),
		/** The reader's word for it: "professional voice", "time period", "sector". */
		noun: text('noun'),
		analyseAtDepth: integer('analyse_at_depth'),
		allowsPrimary: integer('allows_primary').notNull().default(0),
	},
	(t) => [
		primaryKey({ columns: [t.facet] }),
		check('facet_kind', sql`${t.kind} IN ('vocabulary', 'free')`),
		check('facet_granularity', sql`${t.granularity} IN ('entity', 'document')`),
	],
)

/**
 * A value applied to a subject. `facetValue` is always the string (a free
 * facet's truth; a vocabulary facet's display); `conceptId` the resolved
 * concept (null = unresolved, kept and reported). Model assignments
 * (provenance llm_inferred — the former document_tag) also carry relevance,
 * the primary flag, the evidencing context and the task that wrote them.
 * Multi-valued; readers resolve one provenance per (subject, facet) by rank.
 */
export const facetAssignment = sqliteTable(
	'facet_assignment',
	{
		facetAssignmentId: integer('facet_assignment_id').primaryKey({ autoIncrement: true }),
		subjectType: text('subject_type').notNull(),
		subjectId: text('subject_id').notNull(),
		facet: text('facet').notNull(),
		facetValue: text('facet_value').notNull(),
		conceptId: integer('concept_id').references(() => concept.conceptId, { onDelete: 'set null' }),
		provenance: text('provenance').notNull().default('manifest'),
		confidence: real('confidence'),
		relevance: text('relevance'),
		isPrimary: integer('is_primary').notNull().default(0),
		context: text('context'),
		customAnalysisId: integer('custom_analysis_id').references(
			(): AnySQLiteColumn => docCustomAnalysis.customAnalysisId,
			{ onDelete: 'cascade' },
		),
		createdAt: integer('created_at').notNull(),
	},
	(t) => [
		check('facet_assignment_subject_type', sql`${t.subjectType} IN ('entity', 'document', 'chunk')`),
		unique().on(t.subjectType, t.subjectId, t.facet, t.facetValue, t.provenance),
		index('idx_facet_subject').on(t.subjectType, t.subjectId),
		index('idx_facet_lookup').on(t.facet, t.facetValue, t.subjectType),
		index('idx_facet_concept').on(t.conceptId, t.subjectType),
		index('idx_facet_analysis').on(t.customAnalysisId),
	],
)

/* ───────────────────────── document analysis ───────────────────────── */

export const keyPoint = sqliteTable(
	'key_point',
	{
		keyPointId: integer('key_point_id').primaryKey({ autoIncrement: true }),
		documentId: text('document_id')
			.notNull()
			.references(() => document.documentId, { onDelete: 'cascade' }),
		keyPoint: text('key_point').notNull(),
		details: text('details').notNull(),
	},
	(t) => [index('idx_key_point_document').on(t.documentId)],
)

export const keyQuote = sqliteTable('key_quote', {
	keyQuoteId: integer('key_quote_id').primaryKey({ autoIncrement: true }),
	keyPointId: integer('key_point_id')
		.notNull()
		.references(() => keyPoint.keyPointId, { onDelete: 'cascade' }),
	quote: text('quote').notNull(),
})

/** Step 1 quotes are checked against the document text; a miss is kept but marked. */
export const keyQuoteVerification = sqliteTable('key_quote_verification', {
	keyQuoteId: integer('key_quote_id')
		.primaryKey()
		.notNull()
		.references(() => keyQuote.keyQuoteId, { onDelete: 'cascade' }),
	verified: integer('verified').notNull(),
})

/* ───────────────────────── custom analysis ───────────────────────── */

export const docCustomAnalysis = sqliteTable(
	'doc_custom_analysis',
	{
		customAnalysisId: integer('custom_analysis_id').primaryKey({ autoIncrement: true }),
		documentId: text('document_id')
			.notNull()
			.references(() => document.documentId, { onDelete: 'cascade' }),
		taskId: text('task_id').notNull(),
		taskType: text('task_type').notNull(),
		schemaVersion: integer('schema_version').notNull().default(1),
		createdAt: integer('created_at').notNull(),
	},
	(t) => [uniqueIndex('uq_doc_custom_analysis').on(t.documentId, t.taskId)],
)

/** Consultation questions: which a document addresses and how. */
export const question = sqliteTable('question', {
	questionId: integer('question_id').primaryKey({ autoIncrement: true }),
	questionKey: text('question_key').notNull().unique(),
	questionText: text('question_text').notNull(),
	ordinal: integer('ordinal').notNull().default(0),
})

export const questionResponse = sqliteTable(
	'question_response',
	{
		questionResponseId: integer('question_response_id').primaryKey({ autoIncrement: true }),
		customAnalysisId: integer('custom_analysis_id')
			.notNull()
			.references(() => docCustomAnalysis.customAnalysisId, { onDelete: 'cascade' }),
		documentId: text('document_id')
			.notNull()
			.references(() => document.documentId, { onDelete: 'cascade' }),
		questionId: integer('question_id')
			.notNull()
			.references(() => question.questionId, { onDelete: 'cascade' }),
		addressed: integer('addressed').notNull().default(0),
		position: text('position').notNull().default(''),
	},
	(t) => [unique().on(t.documentId, t.questionId)],
)

export const questionResponseKeyPoint = sqliteTable('question_response_key_point', {
	questionResponseKeyPointId: integer('question_response_key_point_id').primaryKey({
		autoIncrement: true,
	}),
	questionResponseId: integer('question_response_id')
		.notNull()
		.references(() => questionResponse.questionResponseId, { onDelete: 'cascade' }),
	keyPoint: text('key_point').notNull(),
	details: text('details').notNull(),
})

export const questionResponseQuote = sqliteTable('question_response_quote', {
	questionResponseQuoteId: integer('question_response_quote_id').primaryKey({
		autoIncrement: true,
	}),
	questionResponseKeyPointId: integer('question_response_key_point_id')
		.notNull()
		.references(() => questionResponseKeyPoint.questionResponseKeyPointId, { onDelete: 'cascade' }),
	quote: text('quote').notNull(),
})

export const analysisTopic = sqliteTable('analysis_topic', {
	analysisTopicId: integer('analysis_topic_id').primaryKey({ autoIncrement: true }),
	topicName: text('topic_name').notNull().unique(),
})

export const analysisSubtopic = sqliteTable(
	'analysis_subtopic',
	{
		analysisSubtopicId: integer('analysis_subtopic_id').primaryKey({ autoIncrement: true }),
		analysisTopicId: integer('analysis_topic_id')
			.notNull()
			.references(() => analysisTopic.analysisTopicId, { onDelete: 'cascade' }),
		subtopicName: text('subtopic_name').notNull(),
	},
	(t) => [uniqueIndex('uq_subtopic_per_topic').on(t.analysisTopicId, t.subtopicName)],
)

export const criterionAnalysis = sqliteTable('criterion_analysis', {
	criterionAnalysisId: integer('criterion_analysis_id').primaryKey({ autoIncrement: true }),
	analysisSubtopicId: integer('analysis_subtopic_id')
		.notNull()
		.references(() => analysisSubtopic.analysisSubtopicId, { onDelete: 'cascade' }),
	customAnalysisId: integer('custom_analysis_id')
		.notNull()
		.references(() => docCustomAnalysis.customAnalysisId, { onDelete: 'cascade' }),
	keyPoint: text('key_point').notNull(),
	details: text('details').notNull(),
})

export const criterionQuote = sqliteTable('criterion_quote', {
	quoteId: integer('quote_id').primaryKey({ autoIncrement: true }),
	criterionAnalysisId: integer('criterion_analysis_id')
		.notNull()
		.references(() => criterionAnalysis.criterionAnalysisId, { onDelete: 'cascade' }),
	quote: text('quote').notNull(),
})

export const metric = sqliteTable('metric', {
	metricId: integer('metric_id').primaryKey({ autoIncrement: true }),
	customAnalysisId: integer('custom_analysis_id')
		.notNull()
		.references(() => docCustomAnalysis.customAnalysisId, { onDelete: 'cascade' }),
	metricType: text('metric_type').notNull(),
	metricName: text('metric_name').notNull(),
	explicitness: text('explicitness').notNull(),
	metricDescription: text('metric_description').notNull(),
})

export const metricCollectionRequirement = sqliteTable('metric_collection_requirement', {
	requirementId: integer('requirement_id').primaryKey({ autoIncrement: true }),
	metricId: integer('metric_id')
		.notNull()
		.references(() => metric.metricId, { onDelete: 'cascade' }),
	requirement: text('requirement').notNull(),
})

export const northStar = sqliteTable('north_star', {
	northStarId: integer('north_star_id').primaryKey({ autoIncrement: true }),
	northStarName: text('north_star_name').notNull().unique(),
})

export const metricNorthStarAlignment = sqliteTable('metric_north_star_alignment', {
	alignmentId: integer('alignment_id').primaryKey({ autoIncrement: true }),
	metricId: integer('metric_id')
		.notNull()
		.references(() => metric.metricId, { onDelete: 'cascade' }),
	northStarId: integer('north_star_id')
		.notNull()
		.references(() => northStar.northStarId, { onDelete: 'cascade' }),
	alignmentHow: text('alignment_how').notNull(),
})

/* ───────────────────────── clusters (v6: builds, stable topic ids) ───────────────────────── */

/**
 * One clustering: the initial one, then a hold or an update per append;
 * topics keep their identity across builds. The four notes are what the
 * pipeline records about a build as it goes (contracts/run-notes.ts): NULL
 * until the step that writes each has run.
 */
export const clusterBuild = sqliteTable(
	'cluster_build',
	{
		buildId: integer('build_id').primaryKey({ autoIncrement: true }),
		kind: text('kind').notNull(),
		appendNo: integer('append_no'),
		createdAt: integer('created_at').notNull(),
		params: zodJson(clusteringParamsSchema)('params_json').notNull(),
		points: integer('points').notNull(),
		artifactsPrefix: text('artifacts_prefix').notNull(),
		/** The clustering as committed: attempts, parameters, outcome (an initial build; a hold has none). */
		tuning: zodJson(clusteringTuningSchema)('tuning'),
		/** What the supercluster ascent found. */
		hierarchy: zodJson(hierarchyStatsSchema)('hierarchy'),
		/** How the grouping nodes were labelled. */
		labels: zodJson(labelStatsSchema)('labels'),
		/** Topics an import's rebuilt clustering could not match (that rebuilt build only). */
		unmatchedTopics: zodJson(unmatchedTopicsSchema)('unmatched_topics'),
	},
	(t) => [check('cluster_build_kind', sql`${t.kind} IN ('initial', 'hold', 'update')`)],
)

/** The committed build every reader uses (one row, singleton = 1). */
export const runCurrentBuild = sqliteTable(
	'run_current_build',
	{
		singleton: integer('singleton').primaryKey(),
		buildId: integer('build_id')
			.notNull()
			.references(() => clusterBuild.buildId),
	},
	(t) => [check('run_current_build_singleton', sql`${t.singleton} = 1`)],
)

/**
 * A topic. Junk review: an advisory LLM verdict, then a human decision —
 * `junkStatus` 'none' (unreviewed / not junk), 'confirmed' (excluded from the
 * hierarchy, exports and consumers), 'dismissed' (flag overruled).
 */
export const topicCluster = sqliteTable(
	'topic_cluster',
	{
		topicClusterId: integer('topic_cluster_id').primaryKey({ autoIncrement: true }),
		title: text('title').notNull(),
		description: text('description').notNull(),
		junkAiFlagged: integer('junk_ai_flagged').notNull().default(0),
		junkAiReason: text('junk_ai_reason'),
		junkStatus: text('junk_status').notNull().default('none'),
		createdBuildId: integer('created_build_id')
			.notNull()
			.references(() => clusterBuild.buildId),
		retiredBuildId: integer('retired_build_id').references(() => clusterBuild.buildId),
		mergedInto: integer('merged_into').references(
			(): AnySQLiteColumn => topicCluster.topicClusterId,
		),
	},
	(t) => [index('idx_topic_cluster_live').on(t.retiredBuildId)],
)

/** HDBSCAN's positional label for a topic within one build. */
export const topicClusterBuild = sqliteTable(
	'topic_cluster_build',
	{
		buildId: integer('build_id')
			.notNull()
			.references(() => clusterBuild.buildId, { onDelete: 'cascade' }),
		topicClusterId: integer('topic_cluster_id')
			.notNull()
			.references(() => topicCluster.topicClusterId, { onDelete: 'cascade' }),
		clusterId: integer('cluster_id').notNull(),
		hardMembers: integer('hard_members').notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.buildId, t.topicClusterId] }),
		unique().on(t.buildId, t.clusterId),
	],
)

/** Provenance of a topic's title and key points (per-topic artefacts). */
export const topicSynthesisState = sqliteTable('topic_synthesis_state', {
	topicClusterId: integer('topic_cluster_id')
		.primaryKey()
		.notNull()
		.references(() => topicCluster.topicClusterId, { onDelete: 'cascade' }),
	titleWrittenAt: integer('title_written_at'),
	titleBuildId: integer('title_build_id').references(() => clusterBuild.buildId),
	titleFingerprint: text('title_fingerprint'),
	titleModel: text('title_model'),
	keyPointsWrittenAt: integer('key_points_written_at'),
	keyPointsBuildId: integer('key_points_build_id').references(() => clusterBuild.buildId),
	keyPointsFingerprint: text('key_points_fingerprint'),
	keyPointsModel: text('key_points_model'),
})

export const clusterKeyPoint = sqliteTable('cluster_key_point', {
	clusterKeyPointId: integer('cluster_key_point_id').primaryKey({ autoIncrement: true }),
	topicClusterId: integer('topic_cluster_id')
		.notNull()
		.references(() => topicCluster.topicClusterId, { onDelete: 'cascade' }),
	keyPoint: text('key_point').notNull(),
	details: text('details').notNull(),
})

export const clusterKeyPointQuote = sqliteTable('cluster_key_point_quote', {
	quoteId: integer('quote_id').primaryKey({ autoIncrement: true }),
	clusterKeyPointId: integer('cluster_key_point_id')
		.notNull()
		.references(() => clusterKeyPoint.clusterKeyPointId, { onDelete: 'cascade' }),
	quoteText: text('quote_text').notNull(),
	entityUuid: text('entity_uuid')
		.notNull()
		.references(() => entity.id, { onDelete: 'cascade' }),
})

/** One row per (cluster, facet, facet value): the comparative lens. */
export const clusterKeyPerspective = sqliteTable(
	'cluster_key_perspective',
	{
		clusterKeyPerspectiveId: integer('cluster_key_perspective_id').primaryKey({
			autoIncrement: true,
		}),
		topicClusterId: integer('topic_cluster_id')
			.notNull()
			.references(() => topicCluster.topicClusterId, { onDelete: 'cascade' }),
		facet: text('facet').notNull(),
		facetValue: text('facet_value').notNull(),
		position: text('position').notNull(),
		positionAnalysis: text('position_analysis').notNull(),
		writtenAt: integer('written_at'),
		writtenBuildId: integer('written_build_id').references(() => clusterBuild.buildId),
		inputsFingerprint: text('inputs_fingerprint'),
		writtenByModel: text('written_by_model'),
	},
	(t) => [index('idx_cluster_perspective_facet').on(t.topicClusterId, t.facet, t.facetValue)],
)

export const clusterPerspectiveQuote = sqliteTable('cluster_perspective_quote', {
	quoteId: integer('quote_id').primaryKey({ autoIncrement: true }),
	clusterKeyPerspectiveId: integer('cluster_key_perspective_id')
		.notNull()
		.references(() => clusterKeyPerspective.clusterKeyPerspectiveId, { onDelete: 'cascade' }),
	quoteIdOriginal: text('quote_id_original').notNull(),
	quoteText: text('quote_text').notNull(),
	entityUuid: text('entity_uuid')
		.notNull()
		.references(() => entity.id, { onDelete: 'cascade' }),
	rationale: text('rationale'),
})

/** A contributor's written position on one topic. Only strong memberships get one. */
export const clusterEntityPerspective = sqliteTable(
	'cluster_entity_perspective',
	{
		clusterEntityPerspectiveId: integer('cluster_entity_perspective_id').primaryKey({
			autoIncrement: true,
		}),
		topicClusterId: integer('topic_cluster_id')
			.notNull()
			.references(() => topicCluster.topicClusterId, { onDelete: 'cascade' }),
		entityUuid: text('entity_uuid')
			.notNull()
			.references(() => entity.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		description: text('description').notNull(),
		position: text('position').notNull(),
		positionAnalysis: text('position_analysis').notNull(),
		writtenAt: integer('written_at'),
		writtenBuildId: integer('written_build_id').references(() => clusterBuild.buildId),
		inputsFingerprint: text('inputs_fingerprint'),
		writtenByModel: text('written_by_model'),
	},
	(t) => [uniqueIndex('uq_cluster_entity_perspective').on(t.topicClusterId, t.entityUuid)],
)

export const clusterEntityPerspectiveKeyPoint = sqliteTable(
	'cluster_entity_perspective_key_point',
	{
		keyPointId: integer('key_point_id').primaryKey({ autoIncrement: true }),
		clusterEntityPerspectiveId: integer('cluster_entity_perspective_id')
			.notNull()
			.references(() => clusterEntityPerspective.clusterEntityPerspectiveId, {
				onDelete: 'cascade',
			}),
		keyPoint: text('key_point').notNull(),
		details: text('details').notNull(),
	},
)

export const clusterEntityPerspectiveKpQuote = sqliteTable('cluster_entity_perspective_kp_quote', {
	quoteId: integer('quote_id').primaryKey({ autoIncrement: true }),
	keyPointId: integer('key_point_id')
		.notNull()
		.references(() => clusterEntityPerspectiveKeyPoint.keyPointId, { onDelete: 'cascade' }),
	quoteText: text('quote_text').notNull(),
})

export const clusterEntityPerspectiveQuote = sqliteTable('cluster_entity_perspective_quote', {
	quoteId: integer('quote_id').primaryKey({ autoIncrement: true }),
	clusterEntityPerspectiveId: integer('cluster_entity_perspective_id')
		.notNull()
		.references(() => clusterEntityPerspective.clusterEntityPerspectiveId, { onDelete: 'cascade' }),
	quoteText: text('quote_text').notNull(),
})

export const entityTopicClusterMembership = sqliteTable(
	'entity_topic_cluster_membership',
	{
		membershipId: integer('membership_id').primaryKey({ autoIncrement: true }),
		buildId: integer('build_id')
			.notNull()
			.references(() => clusterBuild.buildId, { onDelete: 'cascade' }),
		entityUuid: text('entity_uuid')
			.notNull()
			.references(() => entity.id, { onDelete: 'cascade' }),
		topicClusterId: integer('topic_cluster_id')
			.notNull()
			.references(() => topicCluster.topicClusterId, { onDelete: 'cascade' }),
		/** exemplar | high_value | member */
		membershipType: text('membership_type').notNull(),
	},
	(t) => [
		uniqueIndex('uq_entity_cluster_membership').on(t.buildId, t.entityUuid, t.topicClusterId),
		index('idx_cluster_membership_type').on(
			t.buildId,
			t.topicClusterId,
			t.membershipType,
			t.entityUuid,
		),
	],
)

export const chunkTopicClusterMembership = sqliteTable(
	'chunk_topic_cluster_membership',
	{
		membershipId: integer('membership_id').primaryKey({ autoIncrement: true }),
		buildId: integer('build_id')
			.notNull()
			.references(() => clusterBuild.buildId, { onDelete: 'cascade' }),
		chunkId: text('chunk_id')
			.notNull()
			.references(() => chunk.id, { onDelete: 'cascade' }),
		topicClusterId: integer('topic_cluster_id')
			.notNull()
			.references(() => topicCluster.topicClusterId, { onDelete: 'cascade' }),
		softScore: real('soft_score').notNull(),
		membershipType: text('membership_type').notNull(),
	},
	(t) => [
		uniqueIndex('uq_chunk_cluster_membership').on(t.buildId, t.chunkId, t.topicClusterId),
		index('idx_chunk_cluster_type').on(t.buildId, t.topicClusterId, t.membershipType),
	],
)

/* ───────────────────────── the supercluster family tree ───────────────────────── */

/**
 * Every node is a row: generation 0 = a base topic (topicClusterId set);
 * generation >= 1 = a supercluster. Every edge is child → parent; isPrimary
 * marks the argmax parent (the clean tree), all rows are the soft DAG.
 */
export const supercluster = sqliteTable(
	'supercluster',
	{
		superclusterId: integer('supercluster_id').primaryKey({ autoIncrement: true }),
		generation: integer('generation').notNull(),
		topicClusterId: integer('topic_cluster_id').references(() => topicCluster.topicClusterId, {
			onDelete: 'cascade',
		}),
		title: text('title'),
		description: text('description'),
		nBaseTopics: integer('n_base_topics').notNull().default(1),
		buildId: integer('build_id').references(() => clusterBuild.buildId, { onDelete: 'cascade' }),
		writtenAt: integer('written_at'),
		writtenBuildId: integer('written_build_id').references(() => clusterBuild.buildId),
		inputsFingerprint: text('inputs_fingerprint'),
		writtenByModel: text('written_by_model'),
	},
	(t) => [
		index('idx_supercluster_generation').on(t.generation),
		index('idx_supercluster_topic').on(t.topicClusterId),
	],
)

export const superclusterEdge = sqliteTable(
	'supercluster_edge',
	{
		childSuperclusterId: integer('child_supercluster_id')
			.notNull()
			.references(() => supercluster.superclusterId, { onDelete: 'cascade' }),
		parentSuperclusterId: integer('parent_supercluster_id')
			.notNull()
			.references(() => supercluster.superclusterId, { onDelete: 'cascade' }),
		similarity: real('similarity'),
		membershipType: text('membership_type'),
		isPrimary: integer('is_primary').notNull().default(0),
	},
	(t) => [
		primaryKey({ columns: [t.childSuperclusterId, t.parentSuperclusterId] }),
		index('idx_supercluster_edge_parent').on(t.parentSuperclusterId),
		index('idx_supercluster_edge_primary').on(t.childSuperclusterId, t.isPrimary),
	],
)

/* ───────────────────────── appends ───────────────────────── */

/**
 * Documents added (or excluded) after a run completed, placed by a hold or an
 * update build. One row per append; documents listed per append.
 */
export const append = sqliteTable(
	'append',
	{
		appendNo: integer('append_no').primaryKey(),
		workflowInstance: text('workflow_instance').notNull(),
		startedAt: integer('started_at').notNull(),
		decidedAt: integer('decided_at'),
		committedAt: integer('committed_at'),
		mode: text('mode'),
		newcomerDocuments: integer('newcomer_documents').notNull(),
		removedDocuments: integer('removed_documents').notNull(),
		buildId: integer('build_id').references(() => clusterBuild.buildId),
	},
	(t) => [check('append_mode', sql`${t.mode} IN ('hold', 'update')`)],
)

export const appendDocument = sqliteTable(
	'append_document',
	{
		appendNo: integer('append_no')
			.notNull()
			.references(() => append.appendNo, { onDelete: 'cascade' }),
		documentId: text('document_id').notNull(),
		kind: text('kind').notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.appendNo, t.documentId] }),
		check('append_document_kind', sql`${t.kind} IN ('added', 'removed')`),
	],
)

/* ───────────────────────── the run itself ───────────────────────── */

/**
 * One row (singleton = 1): what the run IS, carried inside its own database so
 * a bare dump of it is self-describing wherever it lands — the name, the
 * resolved profile it ran under, the profile document it was authored from,
 * the run config as launched, the organise records it was ingested from, how
 * its reading site reads (contracts/site.ts), and the two run-level notes the
 * review gates leave (contracts/run-notes.ts). Every column but the name is
 * NULL until the step that writes it has run.
 *
 * Until 2026-09-18 the zone kept these as JSON strings under six keys in
 * `pipeline_state` (the archive's `RUN_META`) and Python kept none; now both
 * ports write this row.
 */
export const runMeta = sqliteTable(
	'run_meta',
	{
		singleton: integer('singleton').primaryKey(),
		name: text('name').notNull(),
		profile: zodJson(profileSchema)('profile'),
		profileDocument: zodJson(profileDocumentSchema)('profile_document'),
		runConfig: zodJson(runConfigSchema)('run_config'),
		records: zodJson(manifestRecordSchema.array())('records'),
		site: zodJson(runSiteSchema)('site'),
		junkReview: zodJson(junkReviewSchema)('junk_review'),
		entityReview: zodJson(entityReviewAppliedSchema)('entity_review'),
		updatedAt: integer('updated_at').notNull(),
	},
	(t) => [check('run_meta_singleton', sql`${t.singleton} = 1`)],
)

/* ───────────────────────── the resume ledger ───────────────────────── */

/**
 * Plain strings only — step stamps, completion markers, R2 keys, the schema
 * version. Anything with a shape is a typed column somewhere (run_meta, the
 * notes on cluster_build), never a JSON string here.
 */
export const pipelineState = sqliteTable(
	'pipeline_state',
	{
		key: text('key').notNull(),
		value: text('value').notNull(),
		updatedAt: integer('updated_at').notNull(),
	},
	(t) => [primaryKey({ columns: [t.key] })],
)

/* ───────────────────────── the galaxy sky ───────────────────────── */

/**
 * Each topic's place in the galaxy sky, baked per build so a reading page can
 * draw a still constellation without a client-side solve.
 */
export const topicStar = sqliteTable('topic_star', {
	topicClusterId: integer('topic_cluster_id')
		.primaryKey()
		.notNull()
		.references(() => topicCluster.topicClusterId, { onDelete: 'cascade' }),
	x: real('x').notNull(),
	y: real('y').notNull(),
	/** Visual radius, normalised 0..1 over the corpus. */
	r: real('r').notNull(),
})
