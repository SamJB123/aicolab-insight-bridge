/**
 * The world record, read off a run's canonical tables — ONE query for every
 * report, whichever app holds the run.
 *
 * WHAT IT READS. The COMMON BASE every Insight Bridge database has (verified
 * on all seven deployed D1s, 2026-10-03): the corpus tier (entity, document,
 * key points and quotes, facets and their assignments), the synthesis tier
 * through the `current_*` views (topics, the grouping tree, memberships, the
 * cluster perspectives and lenses) and the galaxy sky. Nothing here names a
 * build. Facets are resolved by provenance rank exactly as the pipeline does,
 * and only the ANALYSED facets (those `cluster_key_perspective` holds) are
 * carried: they are the only facets that become doorways.
 *
 * WHAT THE APP DECLARES. Three facts differ between an app on the canonical
 * schema verbatim and one prepared to hold a single build, and the app's own
 * schema already states them, so the app passes them (`WorldShape`): which
 * column holds a document's title, how a quote's verification is kept, and
 * where the PUBLISHED rows are read. A database that keeps an append history
 * retains every document it ever held — a document an update removed stays
 * in the canonical table for the record — and reads its current evidence
 * through its own views over those tables; such an app passes the views
 * (`WorldPublished`), and every read of a document, its passages, points,
 * quotes and answers goes through them. A database with no history publishes
 * every row it holds: the canonical tables themselves, the default.
 * The run's WORDS — title, nouns, position scale, facet headings, task titles
 * — come from the app the way the Brief and the Sources layer already take
 * them (`WorldWords`); a run that carries `run_meta` supplies their defaults
 * from its site and profile, so such an app passes nothing.
 *
 * WHAT IS OPTIONAL. The custom analyses are read from the run's own ledger
 * (`doc_custom_analysis`): a run has exactly the tasks it ran, each kind's
 * content from its own canonical tables, and a run with no ledger has no
 * tasks. `run_meta` is read where it exists. Presence is asked of the
 * database itself (sqlite_master), never assumed.
 *
 * COUNTS ARE STRONG LINKS. A topic's sources and documents are its exemplar
 * and high-value memberships only: low-grade members have no written
 * analysis and hang nothing on a wall, so the count says how many sources
 * are strongly linked — the same on a database that kept every tier and on
 * one that kept the strong tiers alone.
 *
 * Whole-table reads joined in TypeScript, the way the Brief reads (the corpus
 * tables are small and D1 caps bound parameters at ~100).
 */

import {
	analysisSubtopic,
	analysisTopic,
	type CorpusDb,
	chunk,
	clusterEntityPerspective,
	clusterEntityPerspectiveKeyPoint,
	clusterEntityPerspectiveKpQuote,
	clusterEntityPerspectiveQuote,
	clusterKeyPerspective,
	clusterKeyPoint,
	clusterKeyPointQuote,
	clusterPerspectiveQuote,
	criterionAnalysis,
	criterionQuote,
	currentDocumentMembership,
	currentEntityMembership,
	currentSupercluster,
	currentSuperclusterEdge,
	currentTopic,
	docCustomAnalysis,
	document,
	entity,
	facet,
	keyPoint,
	keyQuote,
	keyQuoteVerification,
	publishedChunk,
	publishedDocument,
	publishedKeyPoint,
	publishedKeyQuote,
	publishedKeyQuoteVerification,
	publishedQuestionResponse,
	publishedQuestionResponseKeyPoint,
	publishedQuestionResponseQuote,
	question,
	questionResponse,
	questionResponseKeyPoint,
	questionResponseQuote,
	runMeta,
	topicStar,
} from '@aicolab/insight-bridge-contracts/schema'
import { taskTitle } from '@aicolab/insight-bridge-contracts/tasks'
import {
	and,
	asc,
	type ChangeColumnTableName,
	count,
	eq,
	inArray,
	isNotNull,
	type SQL,
	sql,
} from 'drizzle-orm'
import type { AnySQLiteColumn, SQLiteTable, SQLiteViewWithSelection } from 'drizzle-orm/sqlite-core'
import { DEFAULT_SCALE, type PositionScale } from '../brief/data.ts'
import { loadFacetCache } from '../explorer/facets.ts'
import { isKept, keepSources, type ReadScope, wordsOf } from '../explorer/scope.ts'
import { cap } from '../grammar.ts'
import { generationLabel, treeOf } from '../tree.ts'
import {
	MEMBERSHIP_GRADES,
	PROMPT_TASK_KINDS,
	questionClause,
	type WorldAnswer,
	type WorldAnswerText,
	type WorldGroup,
	type WorldLensText,
	type WorldMembership,
	type WorldPerspective,
	type WorldPerspectiveText,
	type WorldPoint,
	type WorldPrompt,
	type WorldQuote,
	type WorldReading,
	type WorldReadingRef,
	type WorldRecord,
	type WorldSource,
	type WorldTask,
	type WorldText,
	type WorldTextRef,
	type WorldTopic,
	worldReadingSchema,
	worldRecordSchema,
	worldTextSchema,
} from './schema.ts'

/**
 * A canonical table as the reader may be given it: the table itself, or a
 * view over it carrying its columns (an app's published layer).
 */
export type Published<T extends SQLiteTable> =
	| T
	| SQLiteViewWithSelection<
			string,
			boolean,
			{
				[K in keyof T['_']['columns']]: ChangeColumnTableName<
					T['_']['columns'][K],
					string,
					'sqlite'
				>
			}
	  >

/**
 * Where the published rows of the corpus tier and the question tables are
 * read: the tables an app's own readers read a document, its passages, its
 * points and quotes and its answers from. The canonical tables themselves
 * for a database with no append history (`CANONICAL_PUBLISHED`); the app's
 * views over them for one that keeps removed documents for the record.
 */
export interface WorldPublished {
	document: Published<typeof document>
	chunk: Published<typeof chunk>
	keyPoint: Published<typeof keyPoint>
	keyQuote: Published<typeof keyQuote>
	keyQuoteVerification: Published<typeof keyQuoteVerification>
	questionResponse: Published<typeof questionResponse>
	questionResponseKeyPoint: Published<typeof questionResponseKeyPoint>
	questionResponseQuote: Published<typeof questionResponseQuote>
}

/** Every row the canonical tables hold is published: the default. */
export const CANONICAL_PUBLISHED: WorldPublished = {
	document,
	chunk,
	keyPoint,
	keyQuote,
	keyQuoteVerification,
	questionResponse,
	questionResponseKeyPoint,
	questionResponseQuote,
}

/**
 * The column shapes an app's schema decides, and where its published rows
 * are read. An app on the canonical schema verbatim passes the contracts'
 * `document.documentTitle` and `{ kind: 'table' }`; a prepared app passes
 * its own `document.title` and its `keyQuote.verified` column (or `'none'`
 * when it kept no verification); an app that keeps an append history passes
 * its published views, and its title column is the view's.
 */
export interface WorldShape {
	/** The column that holds a document's displayed title (null falls back to the file name). */
	documentTitle: AnySQLiteColumn<{ data: string }>
	/** How a Step 1 quote's verification is kept. */
	verification:
		| { kind: 'table' }
		| { kind: 'column'; column: AnySQLiteColumn<{ data: number }> }
		| { kind: 'none' }
	/** Where the published rows are read; the canonical tables when absent. */
	published?: WorldPublished
}

const publishedOf = (shape: WorldShape): WorldPublished => shape.published ?? CANONICAL_PUBLISHED

/**
 * The shape of a run on the canonical schema verbatim, as every app re-prepared
 * onto it holds one: a document's title is `document_title`, verification is
 * its own table, and the published rows are the canonical published views
 * (contracts schema/views.ts), which keep the run's append history out.
 */
export const CANONICAL_RUN_SHAPE: WorldShape = {
	documentTitle: publishedDocument.documentTitle,
	verification: { kind: 'table' },
	published: {
		document: publishedDocument,
		chunk: publishedChunk,
		keyPoint: publishedKeyPoint,
		keyQuote: publishedKeyQuote,
		keyQuoteVerification: publishedKeyQuoteVerification,
		questionResponse: publishedQuestionResponse,
		questionResponseKeyPoint: publishedQuestionResponseKeyPoint,
		questionResponseQuote: publishedQuestionResponseQuote,
	},
}

/** How one facet reads: the heading a reader meets, short words for long
 *  values, and the order its values read in (an ordinal facet — eras,
 *  periods — is never alphabetical or by count). */
export interface WorldFacetWords {
	heading?: string
	values?: Readonly<Record<string, string>>
	order?: readonly string[]
}

/**
 * The run's words, as the app that serves it says them — the same words it
 * already hands the Brief and the Sources layer. Every field is optional: a
 * run with `run_meta` defaults each from its site and profile; a run without
 * one must say at least its title and nouns.
 */
export interface WorldWords {
	title?: string
	eyebrow?: string | null
	standfirst?: string | null
	source?: { label: string; href: string } | null
	nouns?: { entity: string; entities: string; document: string; documents: string }
	/** The position scale the run writes; the pipeline's own by default. */
	positions?: PositionScale
	/** Per facet, keyed by the facet's own name. */
	facets?: Readonly<Record<string, WorldFacetWords>>
	/** Task titles by task id, where the humanised id is not the reader's word. */
	tasks?: Readonly<Record<string, string>>
}

export interface WorldRecordConfig {
	/** The report's stable key (the app's slug, or a run id). */
	slug: string
	shape: WorldShape
	words?: WorldWords
	/**
	 * The reader's scope, as every explorer read takes it (explorer/scope.ts).
	 * An excluded source is absent from the record and from every count; a
	 * withheld source keeps its name, facets, one-word positions, scores and
	 * every count, and each text of its own (its quotes, its documents' points,
	 * its perspectives' title and analysis, its answers) reads the notice in
	 * its room text and its readings (`worldText`, `worldReading`).
	 * An annotated source's words are carried as written: the record has no
	 * place for a notice beside them, and an island shows them without one
	 * (settled 2026-10-21; only the pages carry it). The record's shape is
	 * unchanged.
	 */
	scope?: ReadScope
}

/** A withheld source's reading: its points stand behind the notice, which is the one point shown. */
const noticePoints = (notice: string): WorldPoint[] => [{ point: notice, details: '', quotes: [] }]

const grouped = <T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> => {
	const out = new Map<K, T[]>()
	for (const row of rows) {
		const k = key(row)
		const list = out.get(k)
		if (list) list.push(row)
		else out.set(k, [row])
	}
	return out
}

const num = (value: unknown): number => (value == null ? 0 : Number(value))
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const STRONG: readonly string[] = MEMBERSHIP_GRADES
const isStrong = (grade: string): grade is (typeof MEMBERSHIP_GRADES)[number] =>
	STRONG.includes(grade)
const isPromptKind = (kind: string): kind is (typeof PROMPT_TASK_KINDS)[number] =>
	(PROMPT_TASK_KINDS as readonly string[]).includes(kind)

/** The tables and views the database says it has. */
async function tablesOf(db: CorpusDb): Promise<Set<string>> {
	const rows = await db.all<{ name: string }>(
		sql`SELECT name FROM sqlite_master WHERE type IN ('table', 'view')`,
	)
	return new Set(rows.map((r) => r.name))
}

/** A table's columns, as the database says (a column a later schema version added may be absent). */
async function columnsOf(db: CorpusDb, table: string): Promise<Set<string>> {
	const rows = await db.all<{ name: string }>(sql`SELECT name FROM pragma_table_info(${table})`)
	return new Set(rows.map((r) => r.name))
}

/** The run's own account of itself, where the database carries one. */
async function runMetaOf(db: CorpusDb, tables: ReadonlySet<string>) {
	if (!tables.has('run_meta')) return null
	const [meta] = await db.select().from(runMeta).where(eq(runMeta.singleton, 1)).limit(1)
	return meta ?? null
}

export async function worldRecord(db: CorpusDb, config: WorldRecordConfig): Promise<WorldRecord> {
	const tables = await tablesOf(db)
	const meta = await runMetaOf(db, tables)
	const profile = meta?.profile ?? null
	const site = meta?.site ?? null
	const words = config.words ?? {}
	const params = profile?.prompts.params ?? null
	const { document, keyPoint } = publishedOf(config.shape)
	const scope = config.scope
	const withheld = (uuid: string | null | undefined) => wordsOf(scope, uuid).withheld === true

	const title = words.title ?? site?.title ?? meta?.name
	const nouns =
		words.nouns ??
		(params
			? {
					entity: params.entity_noun,
					entities: params.entity_noun_plural,
					document: params.document_noun,
					documents: params.document_noun_plural,
				}
			: null)
	if (!title || !nouns) {
		throw new Error(
			'[world] the run carries no run_meta: the app must declare the record’s title and nouns (WorldWords)',
		)
	}

	const [
		allEntityRows,
		allDocumentRows,
		docPointRows,
		topicRows,
		scRows,
		edgeRows,
		allMemberRows,
		topicDocRows,
		topicPointCounts,
		lensRows,
		lensQuoteOwners,
		allPerspectiveRows,
		perspectivePointCounts,
		perspectiveQuoteCounts,
		entityFacets,
		documentFacets,
		facetDeclarations,
		starRows,
	] = await Promise.all([
		db.select({ uuid: entity.id, id: entity.entityId, name: entity.entityName }).from(entity),
		db
			.select({
				id: document.documentId,
				entityUuid: document.entityUuid,
				title: config.shape.documentTitle,
				fileName: document.fileName,
			})
			.from(document),
		db
			.select({ documentId: keyPoint.documentId, n: count() })
			.from(keyPoint)
			.groupBy(keyPoint.documentId),
		db
			.select({
				id: currentTopic.topicClusterId,
				title: currentTopic.title,
				description: currentTopic.description,
			})
			.from(currentTopic),
		db
			.select({
				id: currentSupercluster.superclusterId,
				generation: currentSupercluster.generation,
				topicId: currentSupercluster.topicClusterId,
				title: currentSupercluster.title,
				description: currentSupercluster.description,
			})
			.from(currentSupercluster),
		db
			.select({
				child: currentSuperclusterEdge.childSuperclusterId,
				parent: currentSuperclusterEdge.parentSuperclusterId,
				isPrimary: currentSuperclusterEdge.isPrimary,
				membershipType: currentSuperclusterEdge.membershipType,
				similarity: currentSuperclusterEdge.similarity,
			})
			.from(currentSuperclusterEdge),
		db
			.select({
				entityUuid: currentEntityMembership.entityUuid,
				topicId: currentEntityMembership.topicClusterId,
				grade: currentEntityMembership.membershipType,
			})
			.from(currentEntityMembership),
		// Documents strongly linked to a topic: an exemplar or high-value grade,
		// a document's best passage grade there.
		db
			.select({
				topicId: currentDocumentMembership.topicClusterId,
				documents: count(),
			})
			.from(currentDocumentMembership)
			.innerJoin(document, eq(document.documentId, currentDocumentMembership.documentId))
			.where(
				and(
					inArray(currentDocumentMembership.membershipType, [...MEMBERSHIP_GRADES]),
					keepSources(document.entityUuid, scope),
				),
			)
			.groupBy(currentDocumentMembership.topicClusterId),
		db
			.select({ topicId: clusterKeyPoint.topicClusterId, n: count() })
			.from(clusterKeyPoint)
			.groupBy(clusterKeyPoint.topicClusterId),
		db
			.select({
				id: clusterKeyPerspective.clusterKeyPerspectiveId,
				topicId: clusterKeyPerspective.topicClusterId,
				facet: clusterKeyPerspective.facet,
				value: clusterKeyPerspective.facetValue,
				position: clusterKeyPerspective.position,
			})
			.from(clusterKeyPerspective),
		// whose quotes back each lens: counted in the scope, as its text gives them
		db
			.select({
				lensId: clusterPerspectiveQuote.clusterKeyPerspectiveId,
				entityUuid: clusterPerspectiveQuote.entityUuid,
			})
			.from(clusterPerspectiveQuote),
		db
			.select({
				id: clusterEntityPerspective.clusterEntityPerspectiveId,
				topicId: clusterEntityPerspective.topicClusterId,
				entityUuid: clusterEntityPerspective.entityUuid,
				position: clusterEntityPerspective.position,
			})
			.from(clusterEntityPerspective),
		db
			.select({
				perspectiveId: clusterEntityPerspectiveKeyPoint.clusterEntityPerspectiveId,
				n: count(),
			})
			.from(clusterEntityPerspectiveKeyPoint)
			.groupBy(clusterEntityPerspectiveKeyPoint.clusterEntityPerspectiveId),
		db
			.select({
				perspectiveId: clusterEntityPerspectiveQuote.clusterEntityPerspectiveId,
				n: count(),
			})
			.from(clusterEntityPerspectiveQuote)
			.groupBy(clusterEntityPerspectiveQuote.clusterEntityPerspectiveId),
		// every reader's facet resolution (explorer/facets.ts): by provenance rank,
		// and the facets the profile derives (era from year) included — a
		// source's own, and its documents' (a facet recorded per document)
		loadFacetCache(db, 'entity'),
		loadFacetCache(db, 'document'),
		db.select({ facet: facet.facet, noun: facet.noun }).from(facet),
		db.select().from(topicStar),
	])

	/* ── the reader's scope: excluded sources leave (a withheld source's words are its room text's) ── */
	const entityRows = allEntityRows.filter((e) => isKept(scope, e.uuid))
	const documentRows = allDocumentRows.filter((d) => isKept(scope, d.entityUuid))
	const memberRows = allMemberRows.filter((m) => isKept(scope, m.entityUuid))
	const perspectiveRows = allPerspectiveRows.filter((p) => isKept(scope, p.entityUuid))

	/* ── identities ── */
	const slugOf = new Map(entityRows.map((e) => [e.uuid, e.id]))
	const topicIds = new Set(topicRows.map((t) => t.id))
	const strong = memberRows.filter(
		(m): m is typeof m & { grade: (typeof MEMBERSHIP_GRADES)[number] } =>
			topicIds.has(m.topicId) && isStrong(m.grade),
	)

	/* ── the analysed facets, by weight ── */
	const lensWeight = new Map<string, number>()
	for (const row of lensRows) {
		if (!topicIds.has(row.topicId) || row.value == null) continue
		lensWeight.set(row.facet, (lensWeight.get(row.facet) ?? 0) + 1)
	}
	const analysed = [...lensWeight]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([facet]) => facet)
	const analysedSet = new Set(analysed)

	/* ── a source's values on the analysed facets only ── */
	// A facet recorded per document (the audit corpus's time range, derived from
	// each report's year) is held by the source of every document that holds
	// it — the rule the record's Sources page and the connector count by.
	const heldBy = new Map<string, Record<string, string[]>>()
	for (const e of entityRows) heldBy.set(e.uuid, { ...(entityFacets.get(e.uuid) ?? {}) })
	for (const d of documentRows) {
		const held = heldBy.get(d.entityUuid)
		if (!held) continue
		for (const [key, values] of Object.entries(documentFacets.get(d.id) ?? {}))
			held[key] = [...new Set([...(held[key] ?? []), ...values])]
	}
	const facetsOf = (uuid: string): Record<string, string[]> =>
		Object.fromEntries(Object.entries(heldBy.get(uuid) ?? {}).filter(([f]) => analysedSet.has(f)))

	const nounOf = new Map(facetDeclarations.map((f) => [f.facet, f.noun]))
	const facets = analysed.map((key) => {
		const declared = profile?.facets.find((f) => f.name === key) ?? null
		const excluded = new Set(declared?.excluded_values ?? ['Unknown'])
		const counts = new Map<string, number>()
		for (const e of entityRows) {
			for (const value of facetsOf(e.uuid)[key] ?? [])
				counts.set(value, (counts.get(value) ?? 0) + 1)
		}
		const appFacet = words.facets?.[key]
		// The app's order first (an ordinal facet), else the profile's declared
		// values, else by how many sources carry each.
		// a derived facet's values are its buckets, in their order (the era is ordinal)
		const order = (
			appFacet?.order ??
			declared?.values ??
			declared?.derive?.buckets.map((b) => b.label) ??
			[]
		).filter((v) => !excluded.has(v))
		const values = [...new Set([...order, ...counts.keys()])]
			.filter((v) => !excluded.has(v) && (counts.get(v) ?? 0) > 0)
			.sort((a, b) => {
				const ia = order.indexOf(a)
				const ib = order.indexOf(b)
				if (ia >= 0 || ib >= 0) return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib)
				return (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b)
			})
		const siteFacet = site?.facets[key]
		const noun = declared?.noun ?? nounOf.get(key) ?? key
		return {
			key,
			heading: appFacet?.heading ?? siteFacet?.heading ?? cap(noun),
			values: values.map((value) => ({
				value,
				label: appFacet?.values?.[value] ?? siteFacet?.values[value] ?? value,
				sources: counts.get(value) ?? 0,
			})),
		}
	})

	/* ── the tree (core's treeOf) ── */
	// Edges in the order their children appear in the build's rows, so each node's
	// children — and so each group's topics — come out in that order.
	const rowOf = new Map(scRows.map((sc, i) => [sc.id, i]))
	const tree = treeOf({
		nodes: scRows.map((sc) => ({
			superclusterId: sc.id,
			generation: sc.generation,
			topicClusterId: sc.topicId,
			title: sc.title,
		})),
		edges: edgeRows
			.map((e) => ({ child: e.child, parent: e.parent, isPrimary: e.isPrimary === 1 }))
			.sort(
				(a, b) =>
					(rowOf.get(a.child) ?? Number.MAX_SAFE_INTEGER) -
					(rowOf.get(b.child) ?? Number.MAX_SAFE_INTEGER),
			),
	})
	const groupNodes = scRows.filter((sc) => sc.generation > 0)
	const groupIds = new Set(groupNodes.map((g) => g.id))
	const generationsPresent = [...new Set(groupNodes.map((g) => g.generation))].sort((a, b) => b - a)
	const top = generationsPresent[0] ?? 0
	/** A group's current topics, depth first in the build's row order. */
	const topicsUnder = (groupId: number): number[] =>
		tree.topicsUnder(groupId).filter((topicId) => topicIds.has(topicId))

	/* ── per-topic figures ── */
	const strongByTopic = grouped(strong, (m) => m.topicId)
	const perspectivesByTopic = grouped(
		perspectiveRows.filter((p) => topicIds.has(p.topicId)),
		(p) => p.topicId,
	)
	const positionsOf = (rows: readonly { position: string }[]): Record<string, number> => {
		const mix: Record<string, number> = {}
		for (const r of rows) mix[r.position] = (mix[r.position] ?? 0) + 1
		return mix
	}
	const docsByTopic = new Map(topicDocRows.map((r) => [r.topicId, num(r.documents)]))
	const pointsByTopic = new Map(topicPointCounts.map((r) => [r.topicId, num(r.n)]))
	const lensesByTopic = grouped(lensRows, (l) => l.topicId)
	const lensQuotes = new Map<number, number>()
	for (const q of lensQuoteOwners) {
		if (!isKept(scope, q.entityUuid) || withheld(q.entityUuid)) continue
		lensQuotes.set(q.lensId, (lensQuotes.get(q.lensId) ?? 0) + 1)
	}
	const starByTopic = new Map(starRows.map((s) => [s.topicClusterId, s]))
	const edgesByChild = grouped(edgeRows, (e) => e.child)

	const topics: WorldTopic[] = topicRows.map((t) => {
		const base = tree.baseOfTopic.get(t.id)?.superclusterId
		const parents = (base !== undefined ? (edgesByChild.get(base) ?? []) : [])
			.filter((e) => groupIds.has(e.parent))
			.map((e) => ({
				groupId: e.parent,
				isPrimary: e.isPrimary === 1,
				membershipType: e.membershipType,
				similarity: e.similarity,
			}))
		const star = starByTopic.get(t.id)
		return {
			id: t.id,
			title: t.title,
			description: t.description,
			parents,
			sources: new Set((strongByTopic.get(t.id) ?? []).map((m) => m.entityUuid)).size,
			documents: docsByTopic.get(t.id) ?? 0,
			positions: positionsOf(perspectivesByTopic.get(t.id) ?? []),
			keyPoints: pointsByTopic.get(t.id) ?? 0,
			lenses: (lensesByTopic.get(t.id) ?? []).flatMap((l) =>
				analysedSet.has(l.facet) && l.value != null
					? [
							{
								facet: l.facet,
								value: l.value,
								position: l.position,
								quotes: lensQuotes.get(l.id) ?? 0,
							},
						]
					: [],
			),
			star: star ? { x: star.x, y: star.y, r: star.r } : null,
		}
	})

	/* ── groups ── */
	const groups: WorldGroup[] = groupNodes.map((g) => {
		const under = topicsUnder(g.id)
		const sources = new Set<string>()
		const stances: { position: string }[] = []
		for (const topicId of under) {
			for (const m of strongByTopic.get(topicId) ?? []) sources.add(m.entityUuid)
			stances.push(...(perspectivesByTopic.get(topicId) ?? []))
		}
		return {
			id: g.id,
			generation: g.generation,
			title: g.title ?? `Group ${g.id}`,
			description: g.description,
			parentId: tree.parentOf(g.id),
			topics: under.length,
			sources: sources.size,
			positions: positionsOf(stances),
		}
	})

	/* ── sources ── */
	const docPoints = new Map(docPointRows.map((r) => [r.documentId, num(r.n)]))
	const docsByEntity = grouped(documentRows, (d) => d.entityUuid)
	const weakByEntity = new Map<string, number>()
	for (const m of memberRows) {
		if (!topicIds.has(m.topicId) || isStrong(m.grade)) continue
		weakByEntity.set(m.entityUuid, (weakByEntity.get(m.entityUuid) ?? 0) + 1)
	}
	const sources: WorldSource[] = entityRows.map((e) => ({
		id: e.id,
		name: e.name,
		facets: facetsOf(e.uuid),
		documents: (docsByEntity.get(e.uuid) ?? []).map((d) => ({
			id: d.id,
			title: text(d.title) ?? d.fileName,
			points: docPoints.get(d.id) ?? 0,
		})),
		memberOnly: weakByEntity.get(e.uuid) ?? 0,
	}))

	/* ── the relations, once ── */
	const memberships: WorldMembership[] = strong.flatMap((m) => {
		const sourceId = slugOf.get(m.entityUuid)
		return sourceId ? [{ topicId: m.topicId, sourceId, grade: m.grade }] : []
	})
	const perspectivePoints = new Map(perspectivePointCounts.map((r) => [r.perspectiveId, num(r.n)]))
	const perspectiveQuotes = new Map(perspectiveQuoteCounts.map((r) => [r.perspectiveId, num(r.n)]))
	const perspectives: WorldPerspective[] = perspectiveRows.flatMap((p) => {
		const sourceId = slugOf.get(p.entityUuid)
		if (!sourceId || !topicIds.has(p.topicId)) return []
		// a withheld stance keeps its one-word position and its counts; its words are its text's notice
		return [
			{
				topicId: p.topicId,
				sourceId,
				position: p.position,
				keyPoints: perspectivePoints.get(p.id) ?? 0,
				quotes: withheld(p.entityUuid) ? 0 : (perspectiveQuotes.get(p.id) ?? 0),
			},
		]
	})

	/* ── the custom analyses, from the run's ledger ── */
	const ownerOfDocument = new Map(documentRows.map((d) => [d.id, slugOf.get(d.entityUuid) ?? null]))
	const tasks = await tasksOf(db, tables, publishedOf(config.shape), {
		ownerOfDocument,
		titleOf: (taskId) => {
			const declared = profile?.analysis_tasks.find((t) => t.task_id === taskId)
			return words.tasks?.[taskId] ?? taskTitle(declared ?? { task_id: taskId, title: null })
		},
		descriptionOf: (taskId) =>
			profile?.analysis_tasks.find((t) => t.task_id === taskId)?.task_description ?? '',
	})

	const stance = profile?.stance ?? null
	const scale: PositionScale =
		words.positions ??
		(stance
			? {
					order: stance.labels,
					supportive: stance.agreement?.supportive ?? [],
					contesting: stance.agreement?.contesting ?? [],
					unclear: stance.agreement?.unclear ?? undefined,
				}
			: DEFAULT_SCALE)
	return worldRecordSchema.parse({
		site: {
			slug: config.slug,
			title,
			eyebrow: words.eyebrow !== undefined ? words.eyebrow : (site?.eyebrow ?? null),
			standfirst:
				words.standfirst !== undefined
					? words.standfirst
					: (site?.standfirst ?? params?.corpus_description ?? null),
			source: words.source !== undefined ? words.source : (site?.source ?? null),
			nouns,
			scale: {
				order: scale.order,
				supportive: scale.supportive ?? [],
				contesting: scale.contesting ?? [],
				unclear: scale.unclear ?? null,
			},
		},
		facets,
		generations: generationsPresent.map((generation) => ({
			generation,
			label: generationLabel(generation, top),
			labelPlural: generationLabel(generation, top, true),
		})),
		groups,
		topics,
		sources,
		memberships,
		perspectives,
		tasks,
	} satisfies WorldRecord)
}

/* ───────────────────────── the tasks ───────────────────────── */

interface TaskWords {
	/** A document's source slug; absent for a document the scope leaves out. */
	ownerOfDocument: ReadonlyMap<string, string | null>
	titleOf(taskId: string): string
	descriptionOf(taskId: string): string
}

/** "(1)", "(2)"… for a criterion, which has no clause of its own. */
const ordinalClause = (ordinal: number): string => `(${ordinal})`

/**
 * The tasks a run ran, from its ledger: one per task id, in the ledger's
 * order of first appearance; a prompt task with its prompts and answers
 * from that kind's own tables. A database with no ledger ran no tasks.
 */
async function tasksOf(
	db: CorpusDb,
	tables: ReadonlySet<string>,
	{ questionResponse, questionResponseKeyPoint }: WorldPublished,
	words: TaskWords,
): Promise<WorldTask[]> {
	if (!tables.has('doc_custom_analysis')) return []
	const ledger = await db
		.select({
			id: docCustomAnalysis.customAnalysisId,
			documentId: docCustomAnalysis.documentId,
			taskId: docCustomAnalysis.taskId,
			taskType: docCustomAnalysis.taskType,
		})
		.from(docCustomAnalysis)
		.orderBy(asc(docCustomAnalysis.customAnalysisId))
	const byTask = grouped(ledger, (row) => row.taskId)
	const typeOf = new Map(ledger.map((row) => [row.taskId, row.taskType]))

	const questionTasks = [...byTask.keys()].filter((id) => typeOf.get(id) === 'question_response')
	const criteriaTasks = [...byTask.keys()].filter((id) => {
		const kind = typeOf.get(id)
		return kind === 'perspective_analysis' || kind === 'criteria_assessment'
	})

	// Question tasks: the questions, and each document's addressed answer.
	const questionPrompts = new Map<string, WorldPrompt[]>()
	if (questionTasks.length > 0 && tables.has('question')) {
		const [questions, responses, responsePoints] = await Promise.all([
			db.select().from(question),
			db
				.select({
					id: questionResponse.questionResponseId,
					analysisId: questionResponse.customAnalysisId,
					documentId: questionResponse.documentId,
					questionId: questionResponse.questionId,
				})
				.from(questionResponse)
				.where(eq(questionResponse.addressed, 1)),
			// how much each answer's reading holds
			db
				.select({ responseId: questionResponseKeyPoint.questionResponseId, n: count() })
				.from(questionResponseKeyPoint)
				.groupBy(questionResponseKeyPoint.questionResponseId),
		])
		const taskOfAnalysis = new Map(ledger.map((row) => [row.id, row.taskId]))
		const pointsByResponse = new Map(responsePoints.map((p) => [p.responseId, num(p.n)]))
		const responsesByTaskQuestion = grouped(
			responses,
			(r) => `${taskOfAnalysis.get(r.analysisId) ?? ''}|${r.questionId}`,
		)
		for (const taskId of questionTasks) {
			questionPrompts.set(
				taskId,
				[...questions]
					.sort((a, b) => a.ordinal - b.ordinal)
					.map((q) => ({
						key: q.questionKey,
						clause: questionClause(q.questionKey, q.questionText),
						text: q.questionText,
						group: null,
						ordinal: q.ordinal,
						answers: (responsesByTaskQuestion.get(`${taskId}|${q.questionId}`) ?? []).flatMap(
							(r): WorldAnswer[] => {
								const sourceId = words.ownerOfDocument.get(r.documentId)
								return sourceId
									? [
											{
												sourceId,
												documentId: r.documentId,
												keyPoints: pointsByResponse.get(r.id) ?? 0,
											},
										]
									: []
							},
						),
					})),
			)
		}
	}

	// Perspective and criteria tasks: the analysis topic's criteria (its
	// subtopics), and each document's points under each.
	const criteriaPrompts = new Map<string, WorldPrompt[]>()
	if (criteriaTasks.length > 0 && tables.has('criterion_analysis')) {
		// an assessment's score has its own column from schema v12; before it, the score was the point's text
		const scored = (await columnsOf(db, 'criterion_analysis')).has('score')
		const [criteria, rows] = await Promise.all([
			db
				.select({
					id: analysisSubtopic.analysisSubtopicId,
					name: analysisSubtopic.subtopicName,
					topic: analysisTopic.topicName,
				})
				.from(analysisSubtopic)
				.innerJoin(
					analysisTopic,
					eq(analysisTopic.analysisTopicId, analysisSubtopic.analysisTopicId),
				)
				.orderBy(asc(analysisSubtopic.analysisSubtopicId)),
			db
				.select({
					id: criterionAnalysis.criterionAnalysisId,
					criterionId: criterionAnalysis.analysisSubtopicId,
					analysisId: criterionAnalysis.customAnalysisId,
					score: scored ? criterionAnalysis.score : sql<null>`NULL`,
				})
				.from(criterionAnalysis)
				.orderBy(asc(criterionAnalysis.criterionAnalysisId)),
		])
		const ledgerById = new Map(ledger.map((row) => [row.id, row]))
		const rowsByTaskCriterion = grouped(rows, (r) => {
			const entry = ledgerById.get(r.analysisId)
			return `${entry?.taskId ?? ''}|${r.criterionId}`
		})
		for (const taskId of criteriaTasks) {
			// A task's criteria are those any of its documents was read against.
			const used = new Set(
				rows.flatMap((r) =>
					ledgerById.get(r.analysisId)?.taskId === taskId ? [r.criterionId] : [],
				),
			)
			criteriaPrompts.set(
				taskId,
				criteria
					.filter((c) => used.has(c.id))
					.map((c, i) => {
						const byDocument = grouped(
							rowsByTaskCriterion.get(`${taskId}|${c.id}`) ?? [],
							(r) => ledgerById.get(r.analysisId)?.documentId ?? '',
						)
						return {
							key: String(c.id),
							clause: ordinalClause(i + 1),
							text: c.name,
							group: c.topic,
							ordinal: i + 1,
							answers: [...byDocument].flatMap(([documentId, points]): WorldAnswer[] => {
								const sourceId = words.ownerOfDocument.get(documentId)
								if (!sourceId) return []
								// the score is a figure and stays; the finding is the source's words, its room text
								const score = points[0]?.score ?? null
								return [
									{
										sourceId,
										documentId,
										keyPoints: points.length,
										...(score === null ? {} : { score }),
									},
								]
							}),
						}
					}),
			)
		}
	}

	return [...byTask.keys()].flatMap((taskId): WorldTask[] => {
		const kind = typeOf.get(taskId)
		if (!kind) return []
		const title = words.titleOf(taskId)
		const description = words.descriptionOf(taskId)
		if (isPromptKind(kind)) {
			const prompts =
				kind === 'question_response'
					? (questionPrompts.get(taskId) ?? [])
					: (criteriaPrompts.get(taskId) ?? [])
			return [{ kind, id: taskId, title, description, prompts }]
		}
		if (kind === 'metadata_tagging' || kind === 'metrics_evaluation') {
			return [{ kind, id: taskId, title, description }]
		}
		return []
	})
}

/* ───────────────────────── a room's text ───────────────────────── */

/**
 * The writing one room's walls carry, read when the room is entered: a
 * topic's key points' headlines and every perspective and lens hung in its
 * room; a source's documents' headlines, its perspectives and its answers; a
 * cohort's lenses; a task's answers. Unknown ids read as empty, and so does
 * anything of a source the scope leaves out; a withheld source's words read
 * the notice (a perspective's title, a document's one headline, an answer's
 * lead), and its quotes are left out.
 */
export async function worldText(
	db: CorpusDb,
	ref: WorldTextRef,
	shape: WorldShape,
	scope?: ReadScope,
): Promise<WorldText> {
	const notice = scope?.withhold?.notice ?? ''
	const held = (uuid: string | null | undefined) => wordsOf(scope, uuid).withheld === true
	const published = publishedOf(shape)
	const empty: Omit<WorldText, 'ref'> = {
		points: [],
		documents: [],
		perspectives: [],
		lenses: [],
		answers: [],
	}

	/** Perspectives by the rows the condition picks, in the scope. */
	const perspectivesWhere = async (where: SQL | undefined): Promise<WorldPerspectiveText[]> => {
		const rows = await db
			.select({
				topicId: clusterEntityPerspective.topicClusterId,
				sourceId: entity.entityId,
				entityUuid: entity.id,
				title: clusterEntityPerspective.title,
				description: clusterEntityPerspective.description,
				analysis: clusterEntityPerspective.positionAnalysis,
			})
			.from(clusterEntityPerspective)
			.innerJoin(entity, eq(entity.id, clusterEntityPerspective.entityUuid))
			.where(where)
		return rows
			.filter((p) => isKept(scope, p.entityUuid))
			.map((p) =>
				held(p.entityUuid)
					? {
							topicId: p.topicId,
							sourceId: p.sourceId,
							title: notice,
							description: '',
							analysis: '',
						}
					: {
							topicId: p.topicId,
							sourceId: p.sourceId,
							title: p.title,
							description: p.description,
							analysis: p.analysis,
						},
			)
	}

	/** Lenses by the rows the condition picks, each with its quotes in the scope. */
	const lensesWhere = async (where: SQL | undefined): Promise<WorldLensText[]> => {
		const [lenses, quotes] = await Promise.all([
			db
				.select({
					id: clusterKeyPerspective.clusterKeyPerspectiveId,
					topicId: clusterKeyPerspective.topicClusterId,
					facet: clusterKeyPerspective.facet,
					value: clusterKeyPerspective.facetValue,
					analysis: clusterKeyPerspective.positionAnalysis,
				})
				.from(clusterKeyPerspective)
				.where(and(where, isNotNull(clusterKeyPerspective.facetValue))),
			db
				.select({
					lensId: clusterPerspectiveQuote.clusterKeyPerspectiveId,
					text: clusterPerspectiveQuote.quoteText,
					entityUuid: clusterPerspectiveQuote.entityUuid,
					sourceId: entity.entityId,
				})
				.from(clusterPerspectiveQuote)
				.innerJoin(
					clusterKeyPerspective,
					eq(
						clusterKeyPerspective.clusterKeyPerspectiveId,
						clusterPerspectiveQuote.clusterKeyPerspectiveId,
					),
				)
				.leftJoin(entity, eq(entity.id, clusterPerspectiveQuote.entityUuid))
				.where(where),
		])
		const quotesOf = grouped(
			quotes.filter((q) => isKept(scope, q.entityUuid) && !held(q.entityUuid)),
			(q) => q.lensId,
		)
		return lenses.flatMap((l) =>
			l.value === null
				? []
				: [
						{
							topicId: l.topicId,
							facet: l.facet,
							value: l.value,
							analysis: l.analysis,
							quotes: (quotesOf.get(l.id) ?? []).map((q) => ({ text: q.text, source: q.sourceId })),
						},
					],
		)
	}

	const parts = async (): Promise<Omit<WorldText, 'ref'>> => {
		switch (ref.kind) {
			case 'topic': {
				const [points, perspectives, lenses] = await Promise.all([
					db
						.select({ point: clusterKeyPoint.keyPoint })
						.from(clusterKeyPoint)
						.where(eq(clusterKeyPoint.topicClusterId, ref.topicId))
						.orderBy(asc(clusterKeyPoint.clusterKeyPointId)),
					perspectivesWhere(eq(clusterEntityPerspective.topicClusterId, ref.topicId)),
					lensesWhere(eq(clusterKeyPerspective.topicClusterId, ref.topicId)),
				])
				return { ...empty, points: points.map((p) => p.point), perspectives, lenses }
			}
			case 'cohort':
				return {
					...empty,
					lenses: await lensesWhere(
						and(
							eq(clusterKeyPerspective.facet, ref.facet),
							eq(clusterKeyPerspective.facetValue, ref.value),
						),
					),
				}
			case 'source': {
				const [owner] = await db
					.select({ uuid: entity.id })
					.from(entity)
					.where(eq(entity.entityId, ref.sourceId))
					.limit(1)
				if (!owner || !isKept(scope, owner.uuid)) return empty
				const { document, keyPoint } = published
				const [documents, points, perspectives, answers] = await Promise.all([
					db
						.select({ id: document.documentId })
						.from(document)
						.where(eq(document.entityUuid, owner.uuid)),
					db
						.select({ documentId: keyPoint.documentId, point: keyPoint.keyPoint })
						.from(keyPoint)
						.innerJoin(document, eq(document.documentId, keyPoint.documentId))
						.where(eq(document.entityUuid, owner.uuid))
						.orderBy(asc(keyPoint.keyPointId)),
					perspectivesWhere(eq(clusterEntityPerspective.entityUuid, owner.uuid)),
					answerTextsOf(db, published, eq(document.entityUuid, owner.uuid), scope),
				])
				const pointsOf = grouped(points, (p) => p.documentId)
				return {
					...empty,
					documents: documents.map((d) => ({
						id: d.id,
						// a withheld source's points stand behind the notice, the one line shown
						points: held(owner.uuid) ? [notice] : (pointsOf.get(d.id) ?? []).map((p) => p.point),
					})),
					perspectives,
					answers,
				}
			}
			case 'task':
				return {
					...empty,
					answers: await answerTextsOf(
						db,
						published,
						eq(docCustomAnalysis.taskId, ref.taskId),
						scope,
					),
				}
		}
	}

	return worldTextSchema.parse({ ref, ...(await parts()) } satisfies WorldText)
}

/**
 * The answers' words for the ledger rows the condition picks (one task's, or
 * one source's documents'): a question's answer in prose and its first point,
 * a criterion's first point, each named by its task, its prompt's key and
 * its document. A run with no ledger, or none of a kind's tables, has none.
 */
async function answerTextsOf(
	db: CorpusDb,
	{ document, questionResponse, questionResponseKeyPoint }: WorldPublished,
	where: SQL | undefined,
	scope: ReadScope | undefined,
): Promise<WorldAnswerText[]> {
	const tables = await tablesOf(db)
	if (!tables.has('doc_custom_analysis')) return []
	const notice = scope?.withhold?.notice ?? ''
	const held = (uuid: string) => wordsOf(scope, uuid).withheld === true
	const owner = {
		taskId: docCustomAnalysis.taskId,
		documentId: docCustomAnalysis.documentId,
		sourceId: entity.entityId,
		entityUuid: entity.id,
	}
	const answers: WorldAnswerText[] = []

	if (tables.has('question')) {
		const [responses, points] = await Promise.all([
			db
				.select({
					...owner,
					id: questionResponse.questionResponseId,
					promptKey: question.questionKey,
					position: questionResponse.position,
				})
				.from(questionResponse)
				.innerJoin(
					docCustomAnalysis,
					eq(docCustomAnalysis.customAnalysisId, questionResponse.customAnalysisId),
				)
				.innerJoin(question, eq(question.questionId, questionResponse.questionId))
				.innerJoin(document, eq(document.documentId, docCustomAnalysis.documentId))
				.innerJoin(entity, eq(entity.id, document.entityUuid))
				.where(and(where, eq(questionResponse.addressed, 1))),
			db
				.select({
					responseId: questionResponseKeyPoint.questionResponseId,
					point: questionResponseKeyPoint.keyPoint,
				})
				.from(questionResponseKeyPoint)
				.innerJoin(
					questionResponse,
					eq(questionResponse.questionResponseId, questionResponseKeyPoint.questionResponseId),
				)
				.innerJoin(
					docCustomAnalysis,
					eq(docCustomAnalysis.customAnalysisId, questionResponse.customAnalysisId),
				)
				.innerJoin(document, eq(document.documentId, docCustomAnalysis.documentId))
				.where(where)
				.orderBy(asc(questionResponseKeyPoint.questionResponseKeyPointId)),
		])
		const leadOf = new Map<number, string>()
		for (const p of points) if (!leadOf.has(p.responseId)) leadOf.set(p.responseId, p.point)
		for (const r of responses) {
			if (!isKept(scope, r.entityUuid)) continue
			const own = !held(r.entityUuid)
			answers.push({
				taskId: r.taskId,
				promptKey: r.promptKey,
				sourceId: r.sourceId,
				documentId: r.documentId,
				// a question's position is the answer in prose: the source's words
				position: own ? r.position : null,
				lead: own ? (leadOf.get(r.id) ?? null) : notice,
			})
		}
	}

	if (tables.has('criterion_analysis')) {
		const rows = await db
			.select({
				...owner,
				analysisId: criterionAnalysis.customAnalysisId,
				criterionId: criterionAnalysis.analysisSubtopicId,
				point: criterionAnalysis.keyPoint,
			})
			.from(criterionAnalysis)
			.innerJoin(
				docCustomAnalysis,
				eq(docCustomAnalysis.customAnalysisId, criterionAnalysis.customAnalysisId),
			)
			.innerJoin(document, eq(document.documentId, docCustomAnalysis.documentId))
			.innerJoin(entity, eq(entity.id, document.entityUuid))
			.where(where)
			.orderBy(asc(criterionAnalysis.criterionAnalysisId))
		const seen = new Set<string>()
		for (const r of rows) {
			const key = `${r.analysisId}|${r.criterionId}`
			if (seen.has(key) || !isKept(scope, r.entityUuid)) continue
			seen.add(key)
			answers.push({
				taskId: r.taskId,
				// a criterion is keyed by its own id in the run (the record's prompt key)
				promptKey: String(r.criterionId),
				sourceId: r.sourceId,
				documentId: r.documentId,
				position: null,
				// the finding is the source's words
				lead: held(r.entityUuid) ? notice : r.point,
			})
		}
	}
	return answers
}

/* ───────────────────────── the readings ───────────────────────── */

/**
 * One item's reading, fetched when a visitor opens it: the key points (with
 * their details and quotes) the record only counts, and a perspective's own
 * quotes. Unknown ids read as empty, and so does an item of a source the scope
 * leaves out; a withheld source's reading is the notice, its one point, and
 * its quotes are left out (a topic's points keep every other source's).
 */
export async function worldReading(
	db: CorpusDb,
	ref: WorldReadingRef,
	shape: WorldShape,
	scope?: ReadScope,
): Promise<WorldReading> {
	const read = async (): Promise<Omit<WorldReading, 'ref'>> => {
		switch (ref.kind) {
			case 'topic':
				return { keyPoints: await topicReading(db, ref, scope), quotes: [] }
			case 'perspective':
				return perspectiveReading(db, ref, scope)
			case 'document':
				return { keyPoints: await documentReading(db, ref, shape, scope), quotes: [] }
			case 'answer':
				return { keyPoints: await answerReading(db, ref, publishedOf(shape), scope), quotes: [] }
		}
	}
	return worldReadingSchema.parse({ ref, ...(await read()) } satisfies WorldReading)
}

/** A topic's own key points, each with the quotes the run drew for it, in the scope. */
async function topicReading(
	db: CorpusDb,
	ref: Extract<WorldReadingRef, { kind: 'topic' }>,
	scope: ReadScope | undefined,
): Promise<WorldPoint[]> {
	const [rows, quotes] = await Promise.all([
		db
			.select({
				id: clusterKeyPoint.clusterKeyPointId,
				point: clusterKeyPoint.keyPoint,
				details: clusterKeyPoint.details,
			})
			.from(clusterKeyPoint)
			.where(eq(clusterKeyPoint.topicClusterId, ref.topicId))
			.orderBy(asc(clusterKeyPoint.clusterKeyPointId)),
		db
			.select({
				pointId: clusterKeyPointQuote.clusterKeyPointId,
				text: clusterKeyPointQuote.quoteText,
				entityUuid: clusterKeyPointQuote.entityUuid,
				sourceId: entity.entityId,
			})
			.from(clusterKeyPointQuote)
			.innerJoin(
				clusterKeyPoint,
				eq(clusterKeyPoint.clusterKeyPointId, clusterKeyPointQuote.clusterKeyPointId),
			)
			.leftJoin(entity, eq(entity.id, clusterKeyPointQuote.entityUuid))
			.where(eq(clusterKeyPoint.topicClusterId, ref.topicId)),
	])
	const byPoint = grouped(
		quotes.filter((q) => isKept(scope, q.entityUuid) && !wordsOf(scope, q.entityUuid).withheld),
		(q) => q.pointId,
	)
	return rows.map((r) => ({
		point: r.point,
		details: r.details,
		quotes: (byPoint.get(r.id) ?? []).map((q) => ({ text: q.text, source: q.sourceId })),
	}))
}

/** How an owner's reading reads in the scope: absent, behind the notice, or as written (null). */
const scopedReading = (scope: ReadScope | undefined, entityUuid: string): WorldPoint[] | null => {
	if (!isKept(scope, entityUuid)) return []
	const words = wordsOf(scope, entityUuid)
	return words.withheld ? noticePoints(words.notice ?? '') : null
}

/** A source's perspective on a topic: its key points with their quotes, and its own quotes. */
async function perspectiveReading(
	db: CorpusDb,
	ref: Extract<WorldReadingRef, { kind: 'perspective' }>,
	scope: ReadScope | undefined,
): Promise<Omit<WorldReading, 'ref'>> {
	const [owner] = await db
		.select({
			id: clusterEntityPerspective.clusterEntityPerspectiveId,
			entityUuid: entity.id,
		})
		.from(clusterEntityPerspective)
		.innerJoin(entity, eq(entity.id, clusterEntityPerspective.entityUuid))
		.where(
			and(
				eq(clusterEntityPerspective.topicClusterId, ref.topicId),
				eq(entity.entityId, ref.sourceId),
			),
		)
		.limit(1)
	if (!owner) return { keyPoints: [], quotes: [] }
	const scoped = scopedReading(scope, owner.entityUuid)
	if (scoped) return { keyPoints: scoped, quotes: [] }
	const [rows, own] = await Promise.all([
		db
			.select({
				id: clusterEntityPerspectiveKeyPoint.keyPointId,
				point: clusterEntityPerspectiveKeyPoint.keyPoint,
				details: clusterEntityPerspectiveKeyPoint.details,
			})
			.from(clusterEntityPerspectiveKeyPoint)
			.where(eq(clusterEntityPerspectiveKeyPoint.clusterEntityPerspectiveId, owner.id))
			.orderBy(asc(clusterEntityPerspectiveKeyPoint.keyPointId)),
		db
			.select({ text: clusterEntityPerspectiveQuote.quoteText })
			.from(clusterEntityPerspectiveQuote)
			.where(eq(clusterEntityPerspectiveQuote.clusterEntityPerspectiveId, owner.id)),
	])
	const pointQuotes = rows.length
		? await db
				.select({
					pointId: clusterEntityPerspectiveKpQuote.keyPointId,
					text: clusterEntityPerspectiveKpQuote.quoteText,
				})
				.from(clusterEntityPerspectiveKpQuote)
				.where(
					inArray(
						clusterEntityPerspectiveKpQuote.keyPointId,
						rows.map((r) => r.id),
					),
				)
		: []
	const byPoint = grouped(pointQuotes, (q) => q.pointId)
	return {
		keyPoints: rows.map((r) => ({
			point: r.point,
			details: r.details,
			quotes: (byPoint.get(r.id) ?? []).map((q) => ({ text: q.text, source: ref.sourceId })),
		})),
		quotes: own.map((q): WorldQuote => ({ text: q.text, source: ref.sourceId })),
	}
}

/** A document's own key points, with the quotes the run verified — as the
 *  database keeps verification: a table, a column, or not at all. */
async function documentReading(
	db: CorpusDb,
	ref: Extract<WorldReadingRef, { kind: 'document' }>,
	shape: WorldShape,
	scope: ReadScope | undefined,
): Promise<WorldPoint[]> {
	const { document, keyPoint, keyQuote, keyQuoteVerification } = publishedOf(shape)
	const [owner] = await db
		.select({ sourceId: entity.entityId, entityUuid: entity.id })
		.from(document)
		.innerJoin(entity, eq(entity.id, document.entityUuid))
		.where(eq(document.documentId, ref.documentId))
		.limit(1)
	const scoped = owner ? scopedReading(scope, owner.entityUuid) : null
	if (scoped) return scoped
	const rows = await db
		.select({ id: keyPoint.keyPointId, point: keyPoint.keyPoint, details: keyPoint.details })
		.from(keyPoint)
		.where(eq(keyPoint.documentId, ref.documentId))
		.orderBy(asc(keyPoint.keyPointId))
	const ofPoints = inArray(
		keyQuote.keyPointId,
		rows.map((r) => r.id),
	)
	const selection = { pointId: keyQuote.keyPointId, text: keyQuote.quote }
	const verification = shape.verification
	const quotes =
		rows.length === 0
			? []
			: verification.kind === 'table'
				? await db
						.select(selection)
						.from(keyQuote)
						.innerJoin(
							keyQuoteVerification,
							eq(keyQuoteVerification.keyQuoteId, keyQuote.keyQuoteId),
						)
						.where(and(ofPoints, eq(keyQuoteVerification.verified, 1)))
				: verification.kind === 'column'
					? await db
							.select(selection)
							.from(keyQuote)
							.where(and(ofPoints, eq(verification.column, 1)))
					: await db.select(selection).from(keyQuote).where(ofPoints)
	const byPoint = grouped(quotes, (q) => q.pointId)
	return rows.map((r) => ({
		point: r.point,
		details: r.details,
		quotes: (byPoint.get(r.id) ?? []).map((q) => ({
			text: q.text,
			source: owner?.sourceId ?? null,
		})),
	}))
}

/** A document's answer to a task's prompt: from the question tables for a
 *  question task, from the criterion tables for a perspective or criteria
 *  task — the ledger says which the task is. */
async function answerReading(
	db: CorpusDb,
	ref: Extract<WorldReadingRef, { kind: 'answer' }>,
	{ document, questionResponse, questionResponseKeyPoint, questionResponseQuote }: WorldPublished,
	scope: ReadScope | undefined,
): Promise<WorldPoint[]> {
	const [entry] = await db
		.select({
			id: docCustomAnalysis.customAnalysisId,
			taskType: docCustomAnalysis.taskType,
			sourceId: entity.entityId,
			entityUuid: entity.id,
		})
		.from(docCustomAnalysis)
		.innerJoin(document, eq(document.documentId, docCustomAnalysis.documentId))
		.innerJoin(entity, eq(entity.id, document.entityUuid))
		.where(
			and(
				eq(docCustomAnalysis.documentId, ref.documentId),
				eq(docCustomAnalysis.taskId, ref.taskId),
			),
		)
		.limit(1)
	if (!entry) return []
	const scoped = scopedReading(scope, entry.entityUuid)
	if (scoped) return scoped
	if (entry.taskType === 'question_response') {
		const [response] = await db
			.select({ id: questionResponse.questionResponseId })
			.from(questionResponse)
			.innerJoin(question, eq(question.questionId, questionResponse.questionId))
			.where(
				and(
					eq(questionResponse.customAnalysisId, entry.id),
					eq(question.questionKey, ref.promptKey),
				),
			)
			.limit(1)
		if (!response) return []
		const rows = await db
			.select({
				id: questionResponseKeyPoint.questionResponseKeyPointId,
				point: questionResponseKeyPoint.keyPoint,
				details: questionResponseKeyPoint.details,
			})
			.from(questionResponseKeyPoint)
			.where(eq(questionResponseKeyPoint.questionResponseId, response.id))
			.orderBy(asc(questionResponseKeyPoint.questionResponseKeyPointId))
		const quotes = rows.length
			? await db
					.select({
						pointId: questionResponseQuote.questionResponseKeyPointId,
						text: questionResponseQuote.quote,
					})
					.from(questionResponseQuote)
					.where(
						inArray(
							questionResponseQuote.questionResponseKeyPointId,
							rows.map((r) => r.id),
						),
					)
			: []
		const byPoint = grouped(quotes, (q) => q.pointId)
		return rows.map((r) => ({
			point: r.point,
			details: r.details,
			quotes: (byPoint.get(r.id) ?? []).map((q) => ({ text: q.text, source: entry.sourceId })),
		}))
	}
	const criterionId = Number(ref.promptKey)
	if (!Number.isInteger(criterionId)) return []
	const rows = await db
		.select({
			id: criterionAnalysis.criterionAnalysisId,
			point: criterionAnalysis.keyPoint,
			details: criterionAnalysis.details,
		})
		.from(criterionAnalysis)
		.where(
			and(
				eq(criterionAnalysis.customAnalysisId, entry.id),
				eq(criterionAnalysis.analysisSubtopicId, criterionId),
			),
		)
		.orderBy(asc(criterionAnalysis.criterionAnalysisId))
	const quotes = rows.length
		? await db
				.select({ pointId: criterionQuote.criterionAnalysisId, text: criterionQuote.quote })
				.from(criterionQuote)
				.where(
					inArray(
						criterionQuote.criterionAnalysisId,
						rows.map((r) => r.id),
					),
				)
		: []
	const byPoint = grouped(quotes, (q) => q.pointId)
	return rows.map((r) => ({
		point: r.point,
		details: r.details,
		quotes: (byPoint.get(r.id) ?? []).map((q) => ({ text: q.text, source: entry.sourceId })),
	}))
}
