/**
 * @aicolab/insight-bridge/explorer/mcp — a report's MCP baseline: the tools
 * every report's connector serves, over the explorer's reads. One definition:
 * the pipeline's per-run connector registers these over its run store, and an
 * app registers them over its own D1 (`explorerReads(db, scope)`), then adds
 * the tools only its own tables can answer. Moved from the pipeline zone's
 * mcp/server.ts (2026-10-21); the tool names and inputs are that connector's.
 *
 * The reads are an interface (`ExplorerReads`) whose method names are the
 * pipeline store's, so the store's Durable Object stub IS the reads and an
 * app's object over D1 is too. Every word a description uses — the nouns, the
 * lens, the scale of the record — is the run's own, read per request; each
 * tool's group (`toolGroup`) and each input's example come from here, the
 * examples drawn from the run itself, so the Connect page needs nothing else.
 * Confirmed-junk topics are hidden everywhere. `search` / `fetch` are the
 * ChatGPT-compatibility aliases.
 */
import type {
	DocumentDetail,
	EntityDetail,
	EntitySummary,
	FoundDocument,
	Hierarchy,
	Overview,
	QuestionSummary,
	RelatedTopic,
	RunWords,
	SearchHit,
	TagCategorySummary,
	TagDocument,
	TaskResult,
	TextHit,
	TopicDetail,
	TopicSummary,
} from '@aicolab/insight-bridge-contracts/explorer'
import type { CorpusDb } from '@aicolab/insight-bridge-contracts/schema'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { toolGroup } from '../mcp-tools.ts'
import * as x from './data.ts'
import type { ReadScope } from './scope.ts'

/** One concept of a vocabulary facet, as `conceptDetail` reads it. */
export type ConceptDetail = NonNullable<Awaited<ReturnType<typeof x.conceptDetail>>>

/** The reads the baseline's tools answer from — the run store's explorer methods, by name. */
export interface ExplorerReads {
	explorerWords(): Promise<RunWords>
	explorerOverview(): Promise<Overview>
	explorerTopics(includeJunk?: boolean): Promise<TopicSummary[]>
	explorerTopic(topicClusterId: number): Promise<TopicDetail | null>
	explorerRelatedTopics(topicClusterId: number, limit?: number): Promise<RelatedTopic[]>
	explorerHierarchy(): Promise<Hierarchy>
	explorerEntities(): Promise<EntitySummary[]>
	explorerEntity(key: string): Promise<EntityDetail | null>
	explorerFindDocuments(query: string, limit?: number): Promise<FoundDocument[]>
	explorerDocument(documentId: string): Promise<DocumentDetail | null>
	explorerVocabularies(facet?: string): Promise<TagCategorySummary[]>
	explorerConcept(facet: string, ref: string): Promise<ConceptDetail | null>
	explorerSubjectsForConcept(ref: string, facet: string | null): Promise<TagDocument[]>
	explorerTags(): Promise<TagCategorySummary[]>
	explorerDocumentsForTag(path: string, category: string | null): Promise<TagDocument[]>
	explorerQuestions(): Promise<QuestionSummary[]>
	explorerTaskResults(): Promise<TaskResult[]>
	explorerSearchText(query: string, limit?: number): Promise<TextHit[]>
	explorerHydrateChunks(chunkIds: string[]): Promise<Omit<SearchHit, 'score'>[]>
}

/** The explorer's reads over a corpus database, in the reader's scope: what an app passes. */
export const explorerReads = (db: CorpusDb, scope?: ReadScope): ExplorerReads => ({
	explorerWords: () => x.runWords(db),
	explorerOverview: () => x.overview(db, scope),
	explorerTopics: (includeJunk) => x.topics(db, includeJunk, scope),
	explorerTopic: (id) => x.topicById(db, id, scope),
	explorerRelatedTopics: (id, limit) => x.relatedTopics(db, id, limit, scope),
	explorerHierarchy: () => x.hierarchy(db),
	explorerEntities: () => x.entities(db, scope),
	explorerEntity: (key) => x.entityByKey(db, key, scope),
	explorerFindDocuments: (query, limit) => x.findDocuments(db, query, limit, scope),
	explorerDocument: (id) => x.documentById(db, id, scope),
	explorerVocabularies: (facet) => x.vocabularySummary(db, facet ? { facet } : {}, scope),
	explorerConcept: (facet, ref) => x.conceptDetail(db, facet, ref),
	explorerSubjectsForConcept: (ref, facet) => x.subjectsForConcept(db, ref, facet, scope),
	explorerTags: () => x.tagSummary(db, scope),
	explorerDocumentsForTag: (path, category) => x.documentsForTag(db, path, category, scope),
	explorerQuestions: () => x.questionSummary(db, scope),
	explorerTaskResults: () => x.taskResults(db, scope),
	explorerSearchText: (query, limit) => x.searchText(db, query, limit, scope),
	explorerHydrateChunks: (ids) => x.hydrateChunks(db, ids, scope),
})

/** The host's nearest passages to a query (chunk id → similarity), when it binds a vector index. */
export type NearestPassages = (query: string, topK: number) => Promise<ReadonlyMap<string, number>>

export interface ExplorerToolsOptions {
	reads: ExplorerReads
	/** The report's name, as its connector introduces it. */
	name: string
	/** The host's vector search; absent, the search tools read passages by text. */
	nearest?: NearestPassages
	/** What the host's own rules add to the connector's instructions (a gate's notice, a caveat). */
	instructions?: string
}

const json = (data: unknown) => ({
	content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
})
const fmt = (n: number) => n.toLocaleString('en-US')

/**
 * Register the baseline's tools on `server`. The connector's instructions are
 * `explorerInstructions`, which the host passes when it constructs the server
 * (the SDK takes them at construction).
 */
export async function registerExplorerTools(
	server: McpServer,
	options: ExplorerToolsOptions,
): Promise<void> {
	const { reads } = options
	const [words, overview, topics, documents] = await Promise.all([
		reads.explorerWords(),
		reads.explorerOverview(),
		reads.explorerTopics(),
		reads.explorerFindDocuments('', 1),
	])
	const { entity, entities, document, documents: documentsNoun } = words.nouns
	const lens = words.lens
	const lensHeading = lens ? (words.facets[lens]?.heading ?? lens) : null
	const topicsVisible = overview.clusters - overview.junkConfirmedClusters
	const semantic = options.nearest !== undefined
	// the run's own examples: its widest topic, one of its documents
	const widest = [...topics].sort((a, b) => b.entities - a.entities)[0]
	const topicExample = widest ? [widest.topicClusterId] : []
	const queryExample = widest ? [widest.title] : []
	const documentExample = documents[0] ? [documents[0].documentId] : []
	const conceptFacet = overview.tagCategories[0]?.category

	const ORIENTATION = toolGroup('Orientation & search')
	const TOPICS = toolGroup('Topics')
	const SOURCES = toolGroup(entities.charAt(0).toUpperCase() + entities.slice(1))
	const DOCUMENTS = toolGroup(documentsNoun.charAt(0).toUpperCase() + documentsNoun.slice(1))
	const VOCABULARIES = toolGroup('Vocabularies')
	const ANALYSIS = toolGroup('Custom analysis')

	const visibleTopic = async (topicId: number) => {
		const t = await reads.explorerTopic(topicId)
		return t && t.junkStatus !== 'confirmed' ? t : null
	}
	const noTopic = (topicId: number) => json({ error: `no visible topic with id ${topicId}` })

	server.registerTool(
		'corpus_overview',
		{
			title: 'Run overview',
			_meta: ORIENTATION,
			description: `Scale and headline figures for "${options.name}": counts, ${entity} facets with their values, tag categories and questions. Call this first.`,
			inputSchema: {},
		},
		async () => json({ name: options.name, ...overview, clusters: topicsVisible }),
	)

	const search = async (query: string, limit: number): Promise<SearchHit[]> => {
		if (options.nearest) {
			const scores = await options.nearest(query, limit)
			const hits = await reads.explorerHydrateChunks([...scores.keys()])
			return hits
				.map((h) => ({ ...h, score: scores.get(h.chunkId) ?? 0 }))
				.sort((a, b) => b.score - a.score)
		}
		return (await reads.explorerSearchText(query, limit)).map((h) => ({
			...h,
			topics: [],
			score: 0,
		}))
	}

	server.registerTool(
		'search_corpus',
		{
			title: semantic ? 'Semantic search' : 'Text search',
			_meta: ORIENTATION,
			description: `${semantic ? 'Semantic' : 'Text'} search over the run's ${fmt(overview.chunks)} passages: the most relevant verbatim passages with their ${document}, ${entity} and the topics they belong to.`,
			inputSchema: {
				query: z.string().meta({ examples: queryExample }),
				top_k: z
					.number()
					.int()
					.min(1)
					.max(50)
					.optional()
					.meta({ examples: [8] }),
			},
		},
		async ({ query, top_k }) => json(await search(query, top_k ?? 12)),
	)

	server.registerTool(
		'find_topics',
		{
			title: 'Find topics',
			_meta: ORIENTATION,
			description:
				'Describe what you are after; returns the topics whose passages best match, ranked by relevance, each with its topic_id.',
			inputSchema: {
				query: z.string().meta({ examples: queryExample }),
				limit: z
					.number()
					.int()
					.min(1)
					.max(40)
					.optional()
					.meta({ examples: [8] }),
			},
		},
		async ({ query, limit }) => {
			const hits = await search(query, 100)
			const agg = new Map<number, { title: string; relevance: number; passages: number }>()
			for (const h of hits)
				for (const t of h.topics)
					agg.set(t.topicClusterId, {
						title: t.title,
						relevance: (agg.get(t.topicClusterId)?.relevance ?? 0) + (h.score || 1),
						passages: (agg.get(t.topicClusterId)?.passages ?? 0) + 1,
					})
			return json(
				[...agg]
					.map(([topicId, v]) => ({
						topic_id: topicId,
						...v,
						relevance: Math.round(v.relevance * 1000) / 1000,
					}))
					.sort((a, b) => b.relevance - a.relevance)
					.slice(0, limit ?? 15),
			)
		},
	)

	server.registerTool(
		'search',
		{
			title: 'Search (alias)',
			_meta: ORIENTATION,
			description: 'Passage search (alias of search_corpus); results carry ids usable with fetch.',
			inputSchema: { query: z.string().meta({ examples: queryExample }) },
		},
		async ({ query }) =>
			json({
				results: (await search(query, 10)).map((h) => ({
					id: h.chunkId,
					title: `${h.title ?? h.fileName} — ${h.entityName}`,
					text: h.text,
				})),
			}),
	)

	server.registerTool(
		'fetch',
		{
			title: 'Fetch (alias)',
			_meta: ORIENTATION,
			description:
				'Fetch a full record by id from search results: a document_id or a passage id returns the document analysis.',
			inputSchema: { id: z.string().meta({ examples: documentExample }) },
		},
		async ({ id }) => {
			const direct = await reads.explorerDocument(id)
			if (direct) return json({ ...direct, id, title: direct.title ?? direct.fileName })
			const docId = id.slice(0, id.lastIndexOf('_'))
			const via = docId ? await reads.explorerDocument(docId) : null
			return json(
				via
					? { ...via, id, title: via.title ?? via.fileName }
					: { error: `no document or passage ${id}` },
			)
		},
	)

	server.registerTool(
		'list_topics',
		{
			title: 'List all topics',
			_meta: TOPICS,
			description: `All ${fmt(topicsVisible)} topics with title, description, key-point/${entity}/${document} counts and the stance mix. Prefer find_topics when you know what you're looking for.`,
			inputSchema: {},
		},
		async () => json(topics),
	)

	server.registerTool(
		'get_topic',
		{
			title: 'Get a topic',
			_meta: TOPICS,
			description: `Full profile of one topic by topic_id (stable: a topic keeps its id when documents are appended and the corpus is re-clustered): description, synthesised key points with verbatim quotes, every ${entity}'s stance and framing, comparative perspectives${lensHeading ? ` by ${lensHeading.toLowerCase()}` : ''}, contributing ${documentsNoun}, and its place in the hierarchy.`,
			inputSchema: { topic_id: z.number().int().meta({ examples: topicExample }) },
		},
		async ({ topic_id }) => {
			const t = await visibleTopic(topic_id)
			if (!t) return noTopic(topic_id)
			return json({
				...t,
				entityPerspectives: t.entityPerspectives.map((e) => ({
					...e,
					quotes: e.quotes.slice(0, 2),
				})),
				related: await reads.explorerRelatedTopics(topic_id, 10),
			})
		},
	)

	server.registerTool(
		'topic_quotes',
		{
			title: 'Topic quotes',
			_meta: TOPICS,
			description: `Verbatim quotes for a topic, each attributed to the ${entity} that wrote it and the key point it supports.`,
			inputSchema: {
				topic_id: z.number().int().meta({ examples: topicExample }),
				limit: z
					.number()
					.int()
					.min(1)
					.max(60)
					.optional()
					.meta({ examples: [10] }),
			},
		},
		async ({ topic_id, limit }) => {
			const t = await visibleTopic(topic_id)
			if (!t) return noTopic(topic_id)
			const quotes = t.keyPointItems.flatMap((kp) =>
				kp.quotes.map((q) => ({
					quote: q.text,
					entity: q.entityName,
					key_point: kp.keyPoint,
					...(q.withheld ? { withheld: true } : {}),
					...(q.notice === undefined ? {} : { notice: q.notice }),
				})),
			)
			return json(quotes.slice(0, limit ?? 20))
		},
	)

	server.registerTool(
		'topic_perspectives',
		{
			title: 'Perspectives on a topic',
			_meta: TOPICS,
			description: `How each ${lensHeading?.toLowerCase() ?? 'group'} value frames a topic: position, analysis and attributed quotes — the comparative lens; plus every ${entity}'s own position.`,
			inputSchema: {
				topic_id: z.number().int().meta({ examples: topicExample }),
				facet: z
					.string()
					.optional()
					.describe(lens ? `Restrict to one facet, e.g. ${lens}` : 'Restrict to one facet'),
			},
		},
		async ({ topic_id, facet }) => {
			const t = await visibleTopic(topic_id)
			if (!t) return noTopic(topic_id)
			return json({
				facetPerspectives: t.facetPerspectives.filter((f) => !facet || f.facet === facet),
				entityPerspectives: t.entityPerspectives.map((e) => ({
					entity: e.entityName,
					position: e.position,
					analysis: e.positionAnalysis,
					quotes: e.quotes.slice(0, 2),
					...(e.withheld ? { withheld: true } : {}),
					...(e.notice === undefined ? {} : { notice: e.notice }),
				})),
			})
		},
	)

	server.registerTool(
		'related_topics',
		{
			title: 'Related topics',
			_meta: TOPICS,
			description: `Topics whose participating ${entities} overlap a topic, ranked by shared ${entities}.`,
			inputSchema: {
				topic_id: z.number().int().meta({ examples: topicExample }),
				limit: z
					.number()
					.int()
					.min(1)
					.max(40)
					.optional()
					.meta({ examples: [10] }),
			},
		},
		async ({ topic_id, limit }) => json(await reads.explorerRelatedTopics(topic_id, limit ?? 10)),
	)

	server.registerTool(
		'list_hierarchy',
		{
			title: 'Topic hierarchy',
			_meta: TOPICS,
			description:
				'The supercluster tree above the topics: nodes by generation (0 = topic) with titles, and child→parent edges with membership strength.',
			inputSchema: {},
		},
		async () => json(await reads.explorerHierarchy()),
	)

	server.registerTool(
		'list_entities',
		{
			title: `List ${entities}`,
			_meta: SOURCES,
			description: `The ${fmt(overview.entities)} ${entities} behind the ${documentsNoun}, each with facets, ${document} count and topic count. Use entity_id with get_entity.`,
			inputSchema: {},
		},
		async () => json(await reads.explorerEntities()),
	)

	server.registerTool(
		'get_entity',
		{
			title: `Get one ${entity}`,
			_meta: SOURCES,
			description: `Profile of one ${entity} by entity_id (or its uuid): facets, ${documentsNoun}, and the topics it engages with — membership strength, position and analysis where analysed.`,
			inputSchema: { entity_id: z.string() },
		},
		async ({ entity_id }) =>
			json((await reads.explorerEntity(entity_id)) ?? { error: `no ${entity} ${entity_id}` }),
	)

	server.registerTool(
		'find_documents',
		{
			title: `Find ${documentsNoun} by title`,
			_meta: DOCUMENTS,
			description: `Substring search over titles, file names and ${entity} names; returns document_id for get_document.`,
			inputSchema: { query: z.string() },
		},
		async ({ query }) => json(await reads.explorerFindDocuments(query, 15)),
	)

	server.registerTool(
		'get_document',
		{
			title: `Get one ${document}`,
			_meta: DOCUMENTS,
			description:
				'Source-level analysis by document_id: key points with verbatim quotes, tags, question responses, criteria analyses, the topics its passages fell into, and the full extracted text.',
			inputSchema: {
				document_id: z.string().meta({ examples: documentExample }),
				include_text: z.boolean().optional(),
			},
		},
		async ({ document_id, include_text }) => {
			const d = await reads.explorerDocument(document_id)
			if (!d) return json({ error: `no document ${document_id}` })
			return json(include_text ? d : { ...d, text: `${d.text.slice(0, 600)}…` })
		},
	)

	if (overview.tagCategories.length) {
		// v7: one vocabulary model — a facet backed by a controlled vocabulary (a manifest
		// facet loaded from a SKOS scheme, or a tagging task's categories) is a tree of
		// concepts; subjects carry concepts directly and, through the closure, every ancestor.
		const vocabNames = overview.tagCategories.map((t) => t.category).join(', ')
		const facetExample = conceptFacet ? [conceptFacet] : []
		server.registerTool(
			'list_vocabularies',
			{
				title: 'Vocabularies',
				_meta: VOCABULARIES,
				description: `Every vocabulary-backed facet (${vocabNames}) with its concept tree: paths, the stable external id and notation each concept carries in its source scheme, and how many ${entities} or ${documentsNoun} carry each concept, ancestors included. Pass facet to fetch one.`,
				inputSchema: { facet: z.string().optional().meta({ examples: facetExample }) },
			},
			async ({ facet }) => json(await reads.explorerVocabularies(facet)),
		)
		server.registerTool(
			'get_concept',
			{
				title: 'Get a concept',
				_meta: VOCABULARIES,
				description: `One concept of a vocabulary facet by path (levels joined by ' › '), external id or notation: its labels (preferred, alternate), definitions, broader / narrower / related concepts and its matches into other schemes.`,
				inputSchema: {
					facet: z.string().meta({ examples: facetExample }),
					concept: z.string(),
				},
			},
			async ({ facet, concept }) =>
				json(
					(await reads.explorerConcept(facet, concept)) ?? {
						error: `no concept ${concept} in ${facet}`,
					},
				),
		)
		server.registerTool(
			'entities_for_concept',
			{
				title: `${entities} for a concept`,
				_meta: VOCABULARIES,
				description: `The ${entities} whose facet carries a concept directly or through a descendant (marked derived), by path, external id or notation. Ids round-trip to get_entity.`,
				inputSchema: {
					concept: z.string(),
					facet: z.string().optional().meta({ examples: facetExample }),
				},
			},
			async ({ concept, facet }) =>
				json(
					(await reads.explorerSubjectsForConcept(concept, facet ?? null)).filter(
						(r) => r.subjectType === 'entity',
					),
				),
		)
		server.registerTool(
			'documents_for_concept',
			{
				title: `${documentsNoun} for a concept`,
				_meta: VOCABULARIES,
				description: `The ${documentsNoun} tagged with a concept directly or through a descendant (marked derived), with relevance, primary flag and the evidencing context where a model assigned it. Ids round-trip to get_document.`,
				inputSchema: {
					concept: z.string(),
					facet: z.string().optional().meta({ examples: facetExample }),
				},
			},
			async ({ concept, facet }) =>
				json(
					(await reads.explorerSubjectsForConcept(concept, facet ?? null)).filter(
						(r) => r.subjectType === 'document',
					),
				),
		)
		// aliases kept for existing consumers
		server.registerTool(
			'list_tags',
			{
				title: 'Tag vocabularies (alias)',
				_meta: VOCABULARIES,
				description: `Alias of list_vocabularies restricted to ${document}-level tagging categories (${vocabNames}).`,
				inputSchema: {},
			},
			async () => json(await reads.explorerTags()),
		)
		server.registerTool(
			'documents_for_tag',
			{
				title: `${documentsNoun} for a tag (alias)`,
				_meta: VOCABULARIES,
				description: `Alias of documents_for_concept: the ${documentsNoun} tagged with a tag path (ancestors included, marked derived), with relevance and the evidencing context.`,
				inputSchema: {
					path: z.string().describe("Full tag path, levels joined by ' › '"),
					category: z.string().optional().meta({ examples: facetExample }),
				},
			},
			async ({ path, category }) =>
				json(await reads.explorerDocumentsForTag(path, category ?? null)),
		)
	}
	if (overview.questions) {
		server.registerTool(
			'question_coverage',
			{
				title: 'Questions',
				_meta: ANALYSIS,
				description: `The ${overview.questions} questions the run put to every ${document}, how many ${documentsNoun} addressed each, and each ${entity}'s stated position.`,
				inputSchema: {},
			},
			async () => json(await reads.explorerQuestions()),
		)
	}
	const tasks = Object.values(words.tasks)
	if (tasks.length) {
		server.registerTool(
			'task_results',
			{
				title: 'Custom analysis results',
				_meta: ANALYSIS,
				description: `The run's ${tasks.length} custom analysis task(s) — ${tasks.map((t) => t.title).join(', ')} — each with its corpus-wide results: tag assignment counts, question coverage, findings by category, or metrics. A task with documentsAnalysed 0 produced nothing. Per-${document} detail rides on get_document.`,
				inputSchema: {},
			},
			async () => json(await reads.explorerTaskResults()),
		)
	}
}

/**
 * The connector's instructions: what the record is, its scale and the usual
 * path through the tools, then whatever the host's own rules add. The SDK
 * takes them when the host constructs its server, before the tools register.
 */
export async function explorerInstructions(options: ExplorerToolsOptions): Promise<string> {
	const [words, overview] = await Promise.all([
		options.reads.explorerWords(),
		options.reads.explorerOverview(),
	])
	const { entity, entities, documents } = words.nouns
	const lensHeading = words.lens ? (words.facets[words.lens]?.heading ?? words.lens) : null
	const topicsVisible = overview.clusters - overview.junkConfirmedClusters
	return (
		`This connector serves "${options.name}"${words.standfirst ? ` — ${words.standfirst}` : ''}: ${fmt(overview.documents)} ${documents} from ${fmt(overview.entities)} ${entities}, ` +
		`split into ${fmt(overview.chunks)} passages and clustered into ${fmt(topicsVisible)} cross-document topics, each synthesised with key points, verbatim quotes, ` +
		`per-${entity} perspectives and comparative perspectives${lensHeading ? ` by ${lensHeading.toLowerCase()}` : ''}` +
		(overview.tagCategories.length
			? `; ${entities} and ${documents} carry controlled vocabularies (${overview.tagCategories.map((t) => t.category).join(', ')}) — hierarchical, with stable ids, browsable via list_vocabularies / get_concept`
			: '') +
		(overview.questions ? `; responses to ${overview.questions} questions are recorded` : '') +
		'. Typical flow: corpus_overview → find_topics / list_topics → get_topic, topic_quotes, topic_perspectives → get_document / get_entity for source-level detail. Ids round-trip between tools.' +
		(options.instructions ? ` ${options.instructions}` : '')
	)
}
