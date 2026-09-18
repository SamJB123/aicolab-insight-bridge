/**
 * The canonical corpus tables, as the pipeline exports them.
 *
 * This is a Drizzle view of `db/sqlite_exporter.py SCHEMA_DDL` in the Insight
 * Bridge pipeline (and its Cloudflare port in
 * `workers/zones/insight-bridge-pipeline`), narrowed to the columns the shared
 * reading layer actually selects. It is deliberately NOT a copy of any app's
 * `db/schema.ts`: the pipeline's output is the contract, and an app whose
 * prepared database does not match it is behind the standard and gets
 * migrated, never accommodated.
 *
 * Two things follow from the canonical shape and are worth stating, because
 * every app had drifted from both:
 *
 *   • `entity` carries THREE columns — id, entity_id, entity_name. It has no
 *     sector, voice, period or body_type. Every attribute of a contributor
 *     lives in `facet_assignment`, and `facet` describes it (its kind, its
 *     granularity and the noun a reader should see). Apps that denormalised a
 *     facet into an entity column invented that column.
 *
 *   • `topic_cluster` has no `junk` flag. It carries an advisory
 *     `junk_ai_flagged` and a human `junk_status` of 'none' | 'confirmed' |
 *     'dismissed'. Only 'confirmed' is excluded from the record.
 *
 * Only columns this layer reads are declared, so an app's prepared database
 * may carry more (build ids, provenance, the analysis tables) without
 * mattering here.
 */
import type { SQLiteAsyncDatabase } from 'drizzle-orm/sqlite-core'
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Either SQLite drizzle speaks over these tables.
 *
 * `DrizzleD1Database` is `SQLiteAsyncDatabase<'async', D1RunResult>` — what a
 * standalone app reads. `DrizzleSqliteDODatabase` is
 * `SQLiteAsyncDatabase<'sync', DurableSQLiteRunResult>` — what the pipeline zone
 * reads for a run, straight from the Durable Object's own storage. Both extend
 * the same class, and its select builder extends `QueryPromise` whatever the
 * result kind, so every query in this layer reads the same and `await` resolves
 * a sync result as readily as an async one.
 */
export type CorpusDb = SQLiteAsyncDatabase<'sync' | 'async', unknown>

/** A contributor to the corpus. Everything else about it is a facet. */
export const entity = sqliteTable('entity', {
	id: text('id').primaryKey(),
	entityId: text('entity_id').notNull(),
	entityName: text('entity_name').notNull(),
})

/**
 * A document a contributor lodged. Narrowed to the join: what a document IS —
 * its type, its descriptor, its transcript source, its word count — is a facet
 * of granularity 'document', not a column here.
 */
export const document = sqliteTable('document', {
	documentId: text('document_id').primaryKey(),
	entityUuid: text('entity_uuid').notNull(),
})

/** What a facet IS: how it is drawn from, what it describes, what to call it. */
export const facet = sqliteTable('facet', {
	facet: text('facet').primaryKey(),
	/** 'vocabulary' (a controlled list) | 'free' (open text). */
	kind: text('kind').notNull(),
	/** 'entity' | 'document' — what the facet describes. */
	granularity: text('granularity').notNull(),
	/** The reader's word for it: "professional voice", "time period", "sector". */
	noun: text('noun'),
})

/** One facet value on one subject. The generic home of every attribute. */
export const facetAssignment = sqliteTable('facet_assignment', {
	facetAssignmentId: integer('facet_assignment_id').primaryKey(),
	/** 'entity' | 'document' | 'chunk'. */
	subjectType: text('subject_type').notNull(),
	subjectId: text('subject_id').notNull(),
	facet: text('facet').notNull(),
	facetValue: text('facet_value').notNull(),
	isPrimary: integer('is_primary').notNull().default(0),
})

export const topicCluster = sqliteTable('topic_cluster', {
	topicClusterId: integer('topic_cluster_id').primaryKey(),
	title: text('title').notNull(),
	description: text('description').notNull(),
	/** 'none' | 'confirmed' | 'dismissed'; only 'confirmed' leaves the record. */
	junkStatus: text('junk_status').notNull().default('none'),
	junkAiReason: text('junk_ai_reason'),
})

export const supercluster = sqliteTable('supercluster', {
	superclusterId: integer('supercluster_id').primaryKey(),
	/** 0 = a base topic's own node; 1.. = grouping generations toward the roots. */
	generation: integer('generation').notNull(),
	topicClusterId: integer('topic_cluster_id'),
	title: text('title'),
	description: text('description'),
})

export const superclusterEdge = sqliteTable('supercluster_edge', {
	childSuperclusterId: integer('child_supercluster_id').notNull(),
	parentSuperclusterId: integer('parent_supercluster_id').notNull(),
	similarity: real('similarity'),
	membershipType: text('membership_type'),
	isPrimary: integer('is_primary').notNull().default(0),
})

export const entityTopicClusterMembership = sqliteTable('entity_topic_cluster_membership', {
	membershipId: integer('membership_id').primaryKey(),
	entityUuid: text('entity_uuid').notNull(),
	topicClusterId: integer('topic_cluster_id').notNull(),
	/** 'exemplar' | 'high_value' | 'member'. */
	membershipType: text('membership_type').notNull(),
})

/** A contributor's written position on one topic. Only strong memberships get one. */
export const clusterEntityPerspective = sqliteTable('cluster_entity_perspective', {
	clusterEntityPerspectiveId: integer('cluster_entity_perspective_id').primaryKey(),
	topicClusterId: integer('topic_cluster_id').notNull(),
	entityUuid: text('entity_uuid').notNull(),
	title: text('title').notNull(),
	position: text('position').notNull(),
	positionAnalysis: text('position_analysis').notNull(),
})

/** The pipeline's synthesised position for one facet VALUE on one topic. */
export const clusterKeyPerspective = sqliteTable('cluster_key_perspective', {
	clusterKeyPerspectiveId: integer('cluster_key_perspective_id').primaryKey(),
	topicClusterId: integer('topic_cluster_id').notNull(),
	facet: text('facet').notNull(),
	facetValue: text('facet_value').notNull(),
	position: text('position').notNull(),
	positionAnalysis: text('position_analysis').notNull(),
})

export const clusterKeyPoint = sqliteTable('cluster_key_point', {
	clusterKeyPointId: integer('cluster_key_point_id').primaryKey(),
	topicClusterId: integer('topic_cluster_id').notNull(),
	keyPoint: text('key_point').notNull(),
	details: text('details').notNull(),
})

export const clusterKeyPointQuote = sqliteTable('cluster_key_point_quote', {
	quoteId: integer('quote_id').primaryKey(),
	clusterKeyPointId: integer('cluster_key_point_id').notNull(),
	quoteText: text('quote_text').notNull(),
	entityUuid: text('entity_uuid').notNull(),
})

/**
 * Each topic's place in the galaxy sky, baked once per run so a reading page
 * can draw a still constellation without a client-side solve. NOT a pipeline
 * table: this is the reading layer's own artefact, written by the star bake.
 */
export const topicStar = sqliteTable('topic_star', {
	topicClusterId: integer('topic_cluster_id').primaryKey(),
	x: real('x').notNull(),
	y: real('y').notNull(),
	/** Visual radius, normalised 0..1 over the corpus. */
	r: real('r').notNull(),
})
