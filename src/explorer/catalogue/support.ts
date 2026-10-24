/**
 * What every connector read stands on, shared by the report catalogue (./reads,
 * ./readers) and the tool table it replaces (../tools): the run's facts the
 * descriptions and examples are written from (`toolContext`), the reader's words
 * and ranks, the loaders a read composes (facets by holder, a facet filter, the
 * landscape's profiles, a search's passages) and the standing caveats. Nothing
 * here decides an answer's shape: that is each read's own.
 */
import type { Overview, RunWords, TopicProfile } from '@aicolab/insight-bridge-contracts/explorer'
import type { CorpusDb } from '@aicolab/insight-bridge-contracts/schema'
import * as s from '@aicolab/insight-bridge-contracts/schema'
import { asc, eq } from 'drizzle-orm'
import { cap } from '../../grammar.ts'
import * as x from '../data.ts'
import { derivedFacets, type EffectiveFacets, loadFacetCache } from '../facets.ts'
import * as pages from '../pages.ts'
import { perRecord } from '../reader.ts'
import { isKept, keepSources, type ReadScope, scopeKey } from '../scope.ts'

/* ───────────────────────── what a read reads with ───────────────────────── */

/** What every read is given: the corpus, the run's words, the reader's scope. */
export interface ToolReadContext {
	db: CorpusDb
	words: RunWords
	scope?: ReadScope
}

/** What the descriptions and examples say about this run. */
export interface ToolContext {
	words: RunWords
	overview: Overview
	/** The lens's values, in the profile's order (empty without a lens). */
	lensValues: string[]
	/** The facets list_tags and tag_pivot read, keyed as written, headed as the site reads them. */
	facets: { key: string; label: string }[]
	/** Whether the run built a grouping tree above its topics. */
	tree: boolean
	/** Real values from this run for the console's starting inputs. */
	examples: {
		topicId: number | null
		query: string | null
		documentId: string | null
		sourceId: string | null
		groupId: number | null
		questionKey: string | null
	}
}

/** The host's nearest passages to a query, by chunk id, when it binds a vector index. */
export type NearestPassages = (query: string, topK: number) => Promise<ReadonlyMap<string, number>>

/* ───────────────────────── words and ranks ───────────────────────── */

export const pct = (part: number, whole: number) =>
	whole ? Math.round((1000 * part) / whole) / 10 : 0

/** Facets that are the pipeline's own bookkeeping, never a reader's facet. */
const INTERNAL_FACETS: ReadonlySet<string> = new Set(['entity_name_provenance', 'llm_entity_name'])
export const internalFacet = (key: string) =>
	INTERNAL_FACETS.has(key) || /sha256$|_url$|filename$/.test(key)

/** A subject's facets with the pipeline's bookkeeping left out. */
export const readerFacetValues = (facets: EffectiveFacets | undefined): EffectiveFacets =>
	Object.fromEntries(Object.entries(facets ?? {}).filter(([key]) => !internalFacet(key)))

/** The standing caveat on every count of sources. */
export const notPrevalence = (words: RunWords, sources: number) =>
	`${cap(words.nouns.entity)} counts are NOT prevalence: these are the ${sources} ${words.nouns.entities} in this record${words.gathered ? `, ${words.gathered}` : ''}; they are not a sample of any population. Never read "N ${words.nouns.entities} say X" as a measurement of how common X is.`

export const TOPIC_ID =
	'The topic_id (topicClusterId) from find_topics / list_topics / topics_in_supercluster / contested_topics. Stable: a topic keeps it when documents are appended and the corpus is re-clustered.'

export const NO_TREE =
	'This run built no grouping tree above its topics; there are no families or themes. Use find_topics, list_topics or get_topic directly.'

/**
 * How far a position pushes back on its topic's claim, highest first: the
 * contesting positions by their place on the scale (the last furthest from
 * agreement), then the unclear one, then the supportive. A scale with no
 * agreement axis reads by its own order, the last first.
 */
export const dissentOf = (scale: RunWords['scale']) => (position: string) => {
	if (!scale.contesting.length) return scale.order.indexOf(position)
	const at = scale.contesting.indexOf(position)
	if (at >= 0) return 2 + at
	return position === scale.unclear ? 1 : 0
}

export const valueWord = (words: RunWords, facet: string, value: string) =>
	words.facets[facet]?.values[value] ?? value
export const lensValueOf = (words: RunWords, facets: EffectiveFacets | undefined) =>
	pages.lensOf(words, facets)
export const lensKey = (words: RunWords) => words.lens ?? 'lens'

/** The lens's heading in lower case, for a sentence; null without a lens. */
export const lensWords = (t: ToolContext) =>
	t.words.lens ? (t.words.facets[t.words.lens]?.heading ?? t.words.lens).toLowerCase() : null

/* ───────────────────────── shared loads ───────────────────────── */

/** How many sources the scope keeps: the standing caveat's figure. */
export const sourceCount = (c: ToolReadContext) =>
	c.db.$count(s.entity, keepSources(s.entity.id, c.scope))

/** The lens value of each of `uuids`' sources, read for those sources alone. */
export async function lensValues(
	c: ToolReadContext,
	uuids: readonly string[],
): Promise<Map<string, string | null>> {
	const lens = c.words.lens
	if (!lens || !uuids.length) return new Map()
	const facets = await loadFacetCache(c.db, 'entity', [lens], [...new Set(uuids)])
	return new Map([...facets].map(([id, f]) => [id, lensValueOf(c.words, f)]))
}

/** Each source's documents and each document's source, in the scope. */
export async function documentOwners(c: ToolReadContext) {
	const { rows } = await x.documentOwners(c.db)
	const ownerOf = new Map<string, string>()
	const documentsOf = new Map<string, string[]>()
	for (const r of rows) {
		if (!isKept(c.scope, r.entityUuid)) continue
		ownerOf.set(r.documentId, r.entityUuid)
		documentsOf.set(r.entityUuid, [...(documentsOf.get(r.entityUuid) ?? []), r.documentId])
	}
	return { ownerOf, documentsOf }
}

/**
 * Every facet the record holds (its assignments, not the profile's declarations)
 * and every facet the profile derives from one it holds (an era from a year,
 * resolved by loadFacetCache like any other), lens first.
 */
export async function readerFacets(db: CorpusDb, words: RunWords) {
	const [held, declared, derivedForEntities, derivedForDocuments] = await Promise.all([
		db
			.selectDistinct({
				facet: s.facetAssignment.facet,
				subjectType: s.facetAssignment.subjectType,
			})
			.from(s.facetAssignment),
		db.select({ facet: s.facet.facet, noun: s.facet.noun }).from(s.facet),
		derivedFacets(db, 'entity'),
		derivedFacets(db, 'document'),
	])
	const nounOf = new Map(declared.map((d) => [d.facet, d.noun]))
	const keys = [
		...new Set([
			...held
				.filter((h) => h.subjectType === 'entity' || h.subjectType === 'document')
				.map((h) => h.facet),
			...[...derivedForEntities, ...derivedForDocuments].map((d) => d.name),
		]),
	].filter((key) => !internalFacet(key))
	return keys
		.map((key) => ({
			key,
			label: words.facets[key]?.heading ?? cap(nounOf.get(key) ?? key.replace(/_/g, ' ')),
		}))
		.sort((a, b) =>
			a.key === words.lens ? -1 : b.key === words.lens ? 1 : a.key.localeCompare(b.key),
		)
}

/** Each source's values on one facet, a document facet projected up to the source that wrote the document. */
export async function facetHolders(c: ToolReadContext, facet: string) {
	const [entityFacets, documentFacets, { ownerOf }] = await Promise.all([
		loadFacetCache(c.db, 'entity'),
		loadFacetCache(c.db, 'document'),
		documentOwners(c),
	])
	const out: { entityUuid: string; value: string }[] = []
	for (const [uuid, facets] of entityFacets) {
		if (!isKept(c.scope, uuid)) continue
		for (const value of facets[facet] ?? []) out.push({ entityUuid: uuid, value })
	}
	for (const [documentId, facets] of documentFacets) {
		const owner = ownerOf.get(documentId)
		if (!owner) continue
		for (const value of facets[facet] ?? []) out.push({ entityUuid: owner, value })
	}
	return out
}

/** The landscape's topics by id (live counts, lineage), in the scope. */
export async function profiles(c: ToolReadContext) {
	const land = await pages.landscape(c.db, c.words, c.scope)
	return {
		land,
		byId: new Map<number, TopicProfile>(land.topics.map((t) => [t.topicClusterId, t])),
	}
}

/** The passages a search found, with their source, its lens value and their strong topics; scored, best first. */
export async function passagesOf(c: ToolReadContext, ranked: readonly [string, number][]) {
	const score = new Map(ranked)
	const hits = await x.hydrateChunks(
		c.db,
		ranked.map(([id]) => id),
		c.scope,
	)
	const [entityFacets, owners] = await Promise.all([
		loadFacetCache(c.db, 'entity'),
		c.db
			.select({
				documentId: s.publishedDocument.documentId,
				entityUuid: s.entity.id,
				entityId: s.entity.entityId,
			})
			.from(s.publishedDocument)
			.innerJoin(s.entity, eq(s.entity.id, s.publishedDocument.entityUuid))
			.where(keepSources(s.entity.id, c.scope)),
	])
	const ownerOf = new Map(owners.map((o) => [o.documentId, o]))
	return hits
		.map((h) => {
			const owner = ownerOf.get(h.documentId)
			return {
				passage_id: h.chunkId,
				score: score.get(h.chunkId) ?? 0,
				document_id: h.documentId,
				documentTitle: h.title ?? h.fileName,
				source: h.entityName,
				source_id: owner?.entityId ?? null,
				lensValue: owner ? lensValueOf(c.words, entityFacets.get(owner.entityUuid)) : null,
				text: h.text,
				topics: h.topics.map((t) => ({ topic_id: t.topicClusterId, title: t.title })),
				...(h.withheld ? { withheld: true } : {}),
				...(h.notice === undefined ? {} : { notice: h.notice }),
			}
		})
		.sort((a, b) => b.score - a.score)
}

/** A search's ranked passages: the host's index when it has one, else a text match (unscored). */
export async function rankedPassages(
	c: ToolReadContext,
	query: string,
	topK: number,
	nearest: readonly [string, number][] | undefined,
): Promise<[string, number][]> {
	if (nearest) return [...nearest]
	return (await x.searchText(c.db, query, topK, c.scope)).map((h) => [h.chunkId, 0])
}

/** The refusal of a facet filter given only its facet or only its value. */
export const halfFacetFilter = (a: { facet?: string; value?: string }) =>
	!a.facet !== !a.value ? '`facet` and `value` go together: give both, or neither' : null

/**
 * What a facet filter keeps: the sources that hold the value (themselves, or
 * through one of their documents) and the documents it reaches (a document
 * that holds it, or every document of a source that does). Facets resolve as
 * every reader resolves them, a facet the profile derives among them. Null
 * when the call names no facet (a call naming only one of the two is refused
 * first: `halfFacetFilter`).
 */
export async function facetFilter(
	c: ToolReadContext,
	a: { facet?: string; value?: string },
): Promise<{ entities: Set<string>; documents: Set<string> } | null> {
	if (!a.facet || !a.value) return null
	const facet = a.facet
	const [entityFacets, documentFacets, { ownerOf, documentsOf }] = await Promise.all([
		loadFacetCache(c.db, 'entity', [facet]),
		loadFacetCache(c.db, 'document', [facet]),
		documentOwners(c),
	])
	const entities = new Set<string>()
	const documents = new Set<string>()
	for (const [uuid, facets] of entityFacets)
		if (facets[facet]?.includes(a.value)) {
			entities.add(uuid)
			for (const d of documentsOf.get(uuid) ?? []) documents.add(d)
		}
	for (const [documentId, facets] of documentFacets)
		if (facets[facet]?.includes(a.value)) {
			documents.add(documentId)
			const owner = ownerOf.get(documentId)
			if (owner) entities.add(owner)
		}
	return { entities, documents }
}

/* ───────────────────────── the run's facts ───────────────────────── */

/**
 * What the descriptions and examples say about this run, in the reader's
 * scope. Kept per record (../reader), under the scope it was read for: every
 * connector request used to read the overview, every topic and the tree
 * before its tool ran.
 */
export const toolContext = perRecord(readToolContext, scopeKey)

async function readToolContext(db: CorpusDb, scope?: ReadScope): Promise<ToolContext> {
	const words = await x.runWords(db)
	const [overview, topics, hierarchy, documents, sources, facets, firstQuestion] =
		await Promise.all([
			x.overview(db, scope),
			x.topics(db, false, scope),
			x.hierarchy(db),
			x.findDocuments(db, '', 1, scope),
			db
				.select({ entityId: s.entity.entityId })
				.from(s.entity)
				.where(keepSources(s.entity.id, scope))
				.orderBy(asc(s.entity.entityId))
				.limit(1),
			readerFacets(db, words),
			db
				.select({ key: s.question.questionKey })
				.from(s.question)
				.orderBy(asc(s.question.ordinal))
				.limit(1),
		])
	const widest = [...topics].sort((a, b) => b.entities - a.entities)[0]
	const groups = hierarchy.nodes.filter((n) => n.generation > 0)
	const lens = words.lens
	return {
		words,
		overview,
		lensValues: lens
			? [
					...new Set([
						...(words.facets[lens]?.order ?? []),
						...(overview.facets.find((f) => f.facet === lens)?.values.map((v) => v.value) ?? []),
					]),
				]
			: [],
		facets,
		tree: groups.length > 0,
		examples: {
			topicId: widest?.topicClusterId ?? null,
			query: widest?.title ?? null,
			documentId: documents[0]?.documentId ?? null,
			sourceId: sources[0]?.entityId ?? null,
			groupId: groups[0]?.superclusterId ?? null,
			questionKey: firstQuestion[0]?.key ?? null,
		},
	}
}
