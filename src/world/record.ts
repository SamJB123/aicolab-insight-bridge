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
 * WHAT THE APP DECLARES. Two facts differ between an app on the canonical
 * schema verbatim and one prepared to hold a single build, and the app's own
 * schema already states both, so the app passes them (`WorldShape`): which
 * column holds a document's title, and how a quote's verification is kept.
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

import { provenanceRank } from '@aicolab/insight-bridge-contracts/manifest'
import {
	analysisSubtopic,
	analysisTopic,
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
	currentChunkMembership,
	currentEntityMembership,
	currentSupercluster,
	currentSuperclusterEdge,
	currentTopic,
	docCustomAnalysis,
	document,
	entity,
	facet,
	facetAssignment,
	keyPoint,
	keyQuote,
	keyQuoteVerification,
	question,
	questionResponse,
	questionResponseKeyPoint,
	questionResponseQuote,
	runMeta,
	topicStar,
} from '@aicolab/insight-bridge-contracts/schema'
import { taskTitle } from '@aicolab/insight-bridge-contracts/tasks'
import { and, asc, count, countDistinct, eq, inArray, sql } from 'drizzle-orm'
import type { AnySQLiteColumn, SQLiteAsyncDatabase } from 'drizzle-orm/sqlite-core'
import { DEFAULT_SCALE, type PositionScale } from '../brief/data.ts'
import {
	MEMBERSHIP_GRADES,
	PROMPT_TASK_KINDS,
	questionClause,
	type WorldAnswer,
	type WorldGroup,
	type WorldMembership,
	type WorldPerspective,
	type WorldPoint,
	type WorldPrompt,
	type WorldReading,
	type WorldReadingRef,
	type WorldRecord,
	type WorldSource,
	type WorldTask,
	type WorldTopic,
	worldGenerationLabel,
	worldReadingSchema,
	worldRecordSchema,
} from './schema.ts'

export type WorldDb = SQLiteAsyncDatabase<'sync' | 'async', unknown>

/**
 * The two column shapes an app's schema decides. An app on the canonical
 * schema verbatim passes the contracts' `document.documentTitle` and
 * `{ kind: 'table' }`; a prepared app passes its own `document.title` and
 * its `keyQuote.verified` column (or `'none'` when it kept no verification).
 */
export interface WorldShape {
	/** The column that holds a document's displayed title (null falls back to the file name). */
	documentTitle: AnySQLiteColumn<{ data: string }>
	/** How a Step 1 quote's verification is kept. */
	verification:
		| { kind: 'table' }
		| { kind: 'column'; column: AnySQLiteColumn<{ data: number }> }
		| { kind: 'none' }
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
}

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
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const STRONG: readonly string[] = MEMBERSHIP_GRADES
const isStrong = (grade: string): grade is (typeof MEMBERSHIP_GRADES)[number] =>
	STRONG.includes(grade)
const isPromptKind = (kind: string): kind is (typeof PROMPT_TASK_KINDS)[number] =>
	(PROMPT_TASK_KINDS as readonly string[]).includes(kind)

/** The tables and views the database says it has. */
async function tablesOf(db: WorldDb): Promise<Set<string>> {
	const rows = await db.all<{ name: string }>(
		sql`SELECT name FROM sqlite_master WHERE type IN ('table', 'view')`,
	)
	return new Set(rows.map((r) => r.name))
}

/** The run's own account of itself, where the database carries one. */
async function runMetaOf(db: WorldDb, tables: ReadonlySet<string>) {
	if (!tables.has('run_meta')) return null
	const [meta] = await db.select().from(runMeta).where(eq(runMeta.singleton, 1)).limit(1)
	return meta ?? null
}

export async function worldRecord(db: WorldDb, config: WorldRecordConfig): Promise<WorldRecord> {
	const tables = await tablesOf(db)
	const meta = await runMetaOf(db, tables)
	const profile = meta?.profile ?? null
	const site = meta?.site ?? null
	const words = config.words ?? {}
	const params = profile?.prompts.params ?? null

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
		entityRows,
		documentRows,
		docPointRows,
		topicRows,
		scRows,
		edgeRows,
		memberRows,
		topicDocRows,
		topicPointRows,
		topicPointQuoteRows,
		lensRows,
		lensQuoteRows,
		perspectiveRows,
		perspectivePointCounts,
		perspectiveQuoteRows,
		facetRows,
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
			.select({ documentId: keyPoint.documentId, point: keyPoint.keyPoint })
			.from(keyPoint)
			.orderBy(asc(keyPoint.keyPointId)),
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
		// Documents strongly linked to a topic: its exemplar and high-value
		// passage memberships, whichever tiers the database kept.
		db
			.select({
				topicId: currentChunkMembership.topicClusterId,
				documents: countDistinct(chunk.documentId),
			})
			.from(currentChunkMembership)
			.innerJoin(chunk, eq(chunk.id, currentChunkMembership.chunkId))
			.where(inArray(currentChunkMembership.membershipType, [...MEMBERSHIP_GRADES]))
			.groupBy(currentChunkMembership.topicClusterId),
		db
			.select({
				id: clusterKeyPoint.clusterKeyPointId,
				topicId: clusterKeyPoint.topicClusterId,
				point: clusterKeyPoint.keyPoint,
				details: clusterKeyPoint.details,
			})
			.from(clusterKeyPoint),
		db
			.select({
				pointId: clusterKeyPointQuote.clusterKeyPointId,
				text: clusterKeyPointQuote.quoteText,
				entityUuid: clusterKeyPointQuote.entityUuid,
			})
			.from(clusterKeyPointQuote),
		db
			.select({
				id: clusterKeyPerspective.clusterKeyPerspectiveId,
				topicId: clusterKeyPerspective.topicClusterId,
				facet: clusterKeyPerspective.facet,
				value: clusterKeyPerspective.facetValue,
				position: clusterKeyPerspective.position,
				analysis: clusterKeyPerspective.positionAnalysis,
			})
			.from(clusterKeyPerspective),
		db
			.select({
				lensId: clusterPerspectiveQuote.clusterKeyPerspectiveId,
				text: clusterPerspectiveQuote.quoteText,
				entityUuid: clusterPerspectiveQuote.entityUuid,
			})
			.from(clusterPerspectiveQuote),
		db
			.select({
				id: clusterEntityPerspective.clusterEntityPerspectiveId,
				topicId: clusterEntityPerspective.topicClusterId,
				entityUuid: clusterEntityPerspective.entityUuid,
				title: clusterEntityPerspective.title,
				description: clusterEntityPerspective.description,
				position: clusterEntityPerspective.position,
				analysis: clusterEntityPerspective.positionAnalysis,
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
				text: clusterEntityPerspectiveQuote.quoteText,
			})
			.from(clusterEntityPerspectiveQuote),
		db
			.select({
				subjectId: facetAssignment.subjectId,
				facet: facetAssignment.facet,
				value: facetAssignment.facetValue,
				provenance: facetAssignment.provenance,
				confidence: facetAssignment.confidence,
				id: facetAssignment.facetAssignmentId,
			})
			.from(facetAssignment)
			.where(eq(facetAssignment.subjectType, 'entity')),
		db.select({ facet: facet.facet, noun: facet.noun }).from(facet),
		db.select().from(topicStar),
	])

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

	/* ── facets by provenance rank, analysed facets only ── */
	const best = new Map<string, Map<string, { rank: number; values: string[] }>>()
	const ranked = [...facetRows]
		.filter((r) => analysedSet.has(r.facet))
		.sort((a, b) => num(b.confidence) - num(a.confidence) || a.id - b.id)
	for (const r of ranked) {
		const rank = provenanceRank(r.provenance)
		const facets = best.get(r.subjectId) ?? new Map<string, { rank: number; values: string[] }>()
		best.set(r.subjectId, facets)
		const cur = facets.get(r.facet)
		if (!cur || rank < cur.rank) facets.set(r.facet, { rank, values: [r.value] })
		else if (rank === cur.rank) cur.values.push(r.value)
	}
	const facetsOf = (uuid: string): Record<string, string[]> =>
		Object.fromEntries([...(best.get(uuid) ?? [])].map(([f, { values }]) => [f, values]))

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
		const order = (appFacet?.order ?? declared?.values ?? []).filter((v) => !excluded.has(v))
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

	/* ── the tree ── */
	const primaryParent = new Map<number, number>()
	for (const e of edgeRows) if (e.isPrimary === 1) primaryParent.set(e.child, e.parent)
	const baseOfTopic = new Map<number, number>()
	for (const sc of scRows)
		if (sc.generation === 0 && sc.topicId != null) baseOfTopic.set(sc.topicId, sc.id)
	const groupNodes = scRows.filter((sc) => sc.generation > 0)
	const groupIds = new Set(groupNodes.map((g) => g.id))
	const generationsPresent = [...new Set(groupNodes.map((g) => g.generation))].sort((a, b) => b - a)
	const top = generationsPresent[0] ?? 0
	const childrenOf = grouped(
		scRows.filter((sc) => primaryParent.has(sc.id)),
		(sc) => primaryParent.get(sc.id) ?? -1,
	)
	const topicsUnder = (groupId: number): number[] =>
		(childrenOf.get(groupId) ?? []).flatMap((child) =>
			child.generation === 0
				? child.topicId != null && topicIds.has(child.topicId)
					? [child.topicId]
					: []
				: topicsUnder(child.id),
		)

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
	const pointQuotes = grouped(topicPointQuoteRows, (q) => q.pointId)
	const pointsByTopic = grouped(topicPointRows, (p) => p.topicId)
	const lensQuotes = grouped(lensQuoteRows, (q) => q.lensId)
	const lensesByTopic = grouped(lensRows, (l) => l.topicId)
	const starByTopic = new Map(starRows.map((s) => [s.topicClusterId, s]))
	const edgesByChild = grouped(edgeRows, (e) => e.child)

	const topics: WorldTopic[] = topicRows.map((t) => {
		const base = baseOfTopic.get(t.id)
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
			keyPoints: (pointsByTopic.get(t.id) ?? []).map(
				(p): WorldPoint => ({
					point: p.point,
					details: p.details,
					quotes: (pointQuotes.get(p.id) ?? []).map((q) => ({
						text: q.text,
						source: slugOf.get(q.entityUuid) ?? null,
					})),
				}),
			),
			lenses: (lensesByTopic.get(t.id) ?? []).flatMap((l) => {
				if (!analysedSet.has(l.facet) || l.value == null) return []
				return [
					{
						facet: l.facet,
						value: l.value,
						position: l.position,
						analysis: l.analysis,
						quotes: (lensQuotes.get(l.id) ?? []).map((q) => ({
							text: q.text,
							source: slugOf.get(q.entityUuid) ?? null,
						})),
					},
				]
			}),
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
			parentId: primaryParent.get(g.id) ?? null,
			topics: under.length,
			sources: sources.size,
			positions: positionsOf(stances),
		}
	})

	/* ── sources ── */
	const docPoints = grouped(docPointRows, (r) => r.documentId)
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
			points: (docPoints.get(d.id) ?? []).map((r) => r.point),
		})),
		memberOnly: weakByEntity.get(e.uuid) ?? 0,
	}))

	/* ── the relations, once ── */
	const memberships: WorldMembership[] = strong.flatMap((m) => {
		const sourceId = slugOf.get(m.entityUuid)
		return sourceId ? [{ topicId: m.topicId, sourceId, grade: m.grade }] : []
	})
	const perspectivePoints = new Map(perspectivePointCounts.map((r) => [r.perspectiveId, num(r.n)]))
	const perspectiveQuotes = grouped(perspectiveQuoteRows, (q) => q.perspectiveId)
	const perspectives: WorldPerspective[] = perspectiveRows.flatMap((p) => {
		const sourceId = slugOf.get(p.entityUuid)
		if (!sourceId || !topicIds.has(p.topicId)) return []
		return [
			{
				topicId: p.topicId,
				sourceId,
				title: p.title,
				description: p.description,
				position: p.position,
				analysis: p.analysis,
				keyPoints: perspectivePoints.get(p.id) ?? 0,
				quotes: (perspectiveQuotes.get(p.id) ?? []).map((q) => q.text),
			},
		]
	})

	/* ── the custom analyses, from the run's ledger ── */
	const ownerOfDocument = new Map(documentRows.map((d) => [d.id, slugOf.get(d.entityUuid) ?? null]))
	const tasks = await tasksOf(db, tables, {
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
			label: worldGenerationLabel(generation, top),
			labelPlural: worldGenerationLabel(generation, top, true),
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
	db: WorldDb,
	tables: ReadonlySet<string>,
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
					position: questionResponse.position,
				})
				.from(questionResponse)
				.where(eq(questionResponse.addressed, 1)),
			// Each answer's points in writing order: the first is the plaque's
			// lead, the count says how much more a reading holds.
			db
				.select({
					responseId: questionResponseKeyPoint.questionResponseId,
					point: questionResponseKeyPoint.keyPoint,
				})
				.from(questionResponseKeyPoint)
				.orderBy(asc(questionResponseKeyPoint.questionResponseKeyPointId)),
		])
		const taskOfAnalysis = new Map(ledger.map((row) => [row.id, row.taskId]))
		const pointsByResponse = grouped(responsePoints, (p) => p.responseId)
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
								if (!sourceId) return []
								const points = pointsByResponse.get(r.id) ?? []
								return [
									{
										sourceId,
										documentId: r.documentId,
										position: r.position,
										lead: points[0]?.point ?? null,
										keyPoints: points.length,
									},
								]
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
					point: criterionAnalysis.keyPoint,
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
								return [
									{
										sourceId,
										documentId,
										position: null,
										lead: points[0]?.point ?? null,
										keyPoints: points.length,
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

/* ───────────────────────── the readings ───────────────────────── */

/**
 * One item's reading, fetched when a visitor opens it: the key points (with
 * their quotes) the record only counts. Unknown ids read as empty.
 */
export async function worldReading(
	db: WorldDb,
	ref: WorldReadingRef,
	shape: WorldShape,
): Promise<WorldReading> {
	const points = async (): Promise<WorldPoint[]> => {
		if (ref.kind === 'perspective') return perspectiveReading(db, ref)
		if (ref.kind === 'document') return documentReading(db, ref, shape)
		return answerReading(db, ref)
	}
	return worldReadingSchema.parse({ ref, keyPoints: await points() } satisfies WorldReading)
}

async function perspectiveReading(
	db: WorldDb,
	ref: Extract<WorldReadingRef, { kind: 'perspective' }>,
): Promise<WorldPoint[]> {
	const [owner] = await db
		.select({ id: clusterEntityPerspective.clusterEntityPerspectiveId })
		.from(clusterEntityPerspective)
		.innerJoin(entity, eq(entity.id, clusterEntityPerspective.entityUuid))
		.where(
			and(
				eq(clusterEntityPerspective.topicClusterId, ref.topicId),
				eq(entity.entityId, ref.sourceId),
			),
		)
		.limit(1)
	if (!owner) return []
	const rows = await db
		.select({
			id: clusterEntityPerspectiveKeyPoint.keyPointId,
			point: clusterEntityPerspectiveKeyPoint.keyPoint,
			details: clusterEntityPerspectiveKeyPoint.details,
		})
		.from(clusterEntityPerspectiveKeyPoint)
		.where(eq(clusterEntityPerspectiveKeyPoint.clusterEntityPerspectiveId, owner.id))
		.orderBy(asc(clusterEntityPerspectiveKeyPoint.keyPointId))
	const quotes = rows.length
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
	const byPoint = grouped(quotes, (q) => q.pointId)
	return rows.map((r) => ({
		point: r.point,
		details: r.details,
		quotes: (byPoint.get(r.id) ?? []).map((q) => ({ text: q.text, source: ref.sourceId })),
	}))
}

/** A document's own key points, with the quotes the run verified — as the
 *  database keeps verification: a table, a column, or not at all. */
async function documentReading(
	db: WorldDb,
	ref: Extract<WorldReadingRef, { kind: 'document' }>,
	shape: WorldShape,
): Promise<WorldPoint[]> {
	const [owner] = await db
		.select({ sourceId: entity.entityId })
		.from(document)
		.innerJoin(entity, eq(entity.id, document.entityUuid))
		.where(eq(document.documentId, ref.documentId))
		.limit(1)
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
	db: WorldDb,
	ref: Extract<WorldReadingRef, { kind: 'answer' }>,
): Promise<WorldPoint[]> {
	const [entry] = await db
		.select({
			id: docCustomAnalysis.customAnalysisId,
			taskType: docCustomAnalysis.taskType,
			sourceId: entity.entityId,
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
