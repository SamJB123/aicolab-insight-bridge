/**
 * The query side of semantic search, for every reader of a run — the apps'
 * connectors and pages, and the pipeline's own run site. ONE definition:
 *
 *   VECTOR_DIMS        the width every index stores: Vectorize caps a vector at
 *                      1536 dims, so each passage's embedding is stored as its
 *                      RAW first 1536 (not the API's `dimensions`, which
 *                      renormalises and would not match), and a query is cut
 *                      the same way.
 *   runEmbeddingModel  the model the run embedded its passages with (its run
 *                      config): a query must be embedded with the same one.
 *   embedQuery         one query, embedded and cut to VECTOR_DIMS.
 *   vectorNearest      a host's nearest-passages function over its vector
 *                      index (what the connector's search tools and the topic
 *                      search page both take).
 */
import type { EmbeddingModel } from '@aicolab/insight-bridge-contracts/models'
import { resolvedModels } from '@aicolab/insight-bridge-contracts/run-config'
import { type CorpusDb, runMeta } from '@aicolab/insight-bridge-contracts/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { NearestPassages } from './tools.ts'

export const VECTOR_DIMS = 1536

/** The model the run embedded its passages with, from its own run config. */
export async function runEmbeddingModel(db: CorpusDb): Promise<EmbeddingModel> {
	const [meta] = await db
		.select({ runConfig: runMeta.runConfig })
		.from(runMeta)
		.where(eq(runMeta.singleton, 1))
		.limit(1)
	if (!meta?.runConfig)
		throw new Error('run_meta.run_config is missing: the run cannot say which model embedded it')
	return resolvedModels(meta.runConfig).embedding
}

/** Where a query is sent: the provider's key, and a gateway in front of it when the host uses one. */
export interface EmbeddingCredentials {
	apiKey: string
	/** An OpenAI-compatible base URL (an AI gateway); the provider's own when absent. */
	baseURL?: string
}

/** What the embeddings endpoint returns, as far as this reads it. */
const embeddingsSchema = z.object({ data: z.array(z.object({ embedding: z.array(z.number()) })) })

/** Embed one query with the run's model and cut it to the stored width. */
export async function embedQuery(
	credentials: EmbeddingCredentials,
	query: string,
	model: EmbeddingModel,
): Promise<number[]> {
	const base = (credentials.baseURL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
	const res = await fetch(`${base}/embeddings`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.apiKey}` },
		body: JSON.stringify({ model, input: query }),
	})
	if (!res.ok) throw new Error(`embeddings ${res.status}: ${await res.text()}`)
	const [first] = embeddingsSchema.parse(await res.json()).data
	if (!first) throw new Error('the embeddings API returned no vector for the query')
	if (first.embedding.length < VECTOR_DIMS)
		throw new Error(`the query's vector has ${first.embedding.length} dims < ${VECTOR_DIMS}`)
	return first.embedding.slice(0, VECTOR_DIMS)
}

/** The part of a vector index (a Vectorize binding) a passage search uses. */
export interface PassageIndex {
	query(
		vector: number[],
		options: { topK: number; returnMetadata: 'none' },
	): Promise<{ matches: { id: string; score: number }[] }>
}

/** The host's nearest-passages function: the query embedded with the run's model, the index asked. */
export const vectorNearest =
	(
		index: PassageIndex,
		credentials: EmbeddingCredentials,
		model: EmbeddingModel,
	): NearestPassages =>
	async (query, topK) => {
		const result = await index.query(await embedQuery(credentials, query, model), {
			topK,
			returnMetadata: 'none',
		})
		return new Map(result.matches.map((m) => [m.id, m.score]))
	}
