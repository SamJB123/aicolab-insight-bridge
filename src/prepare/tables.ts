/**
 * The two derived tables every report's prepared database carries beside the
 * canonical run (an app's src/db/schema.ts re-exports them, so its migration
 * creates them and its loader loads them). Filled by `prepareRun`.
 *
 *   doc_dominant_topic   each document's dominant topic — its highest
 *                        soft-score passage membership among the live,
 *                        substantive topics of the committed build, over ALL
 *                        its passages.
 *   chunk_primary_topic  each passage's top-1 substantive topic in the
 *                        committed build — what a vector index's `topic`
 *                        metadata carries, kept here so a search hit and the
 *                        record agree.
 */
import { chunk, document, topicCluster } from '@aicolab/insight-bridge-contracts/schema'
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const docDominantTopic = sqliteTable(
	'doc_dominant_topic',
	{
		documentId: text('document_id')
			.primaryKey()
			.notNull()
			.references(() => document.documentId, { onDelete: 'cascade' }),
		topicClusterId: integer('topic_cluster_id')
			.notNull()
			.references(() => topicCluster.topicClusterId, { onDelete: 'cascade' }),
		softScore: real('soft_score').notNull(),
	},
	(t) => [index('idx_ddt_topic').on(t.topicClusterId)],
)

export const chunkPrimaryTopic = sqliteTable(
	'chunk_primary_topic',
	{
		chunkId: text('chunk_id')
			.primaryKey()
			.notNull()
			.references(() => chunk.id, { onDelete: 'cascade' }),
		topicClusterId: integer('topic_cluster_id')
			.notNull()
			.references(() => topicCluster.topicClusterId, { onDelete: 'cascade' }),
	},
	(t) => [index('idx_cpt_topic').on(t.topicClusterId)],
)
