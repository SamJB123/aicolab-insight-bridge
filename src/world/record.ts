/**
 * The world record, read off a run's canonical tables — ONE query for every
 * report, whichever app holds the run.
 *
 * Whole-table reads joined in TypeScript, the way the Brief reads (the
 * corpus tables are small and D1 caps bound parameters at ~100). Everything
 * reads the `current_*` views, so nothing here names a build. Facets are
 * resolved by provenance rank exactly as the pipeline does, and only the
 * ANALYSED facets (those `cluster_key_perspective` holds) are carried: they
 * are the only facets that become doorways.
 */

import { provenanceRank } from '@aicolab/insight-bridge-contracts/manifest'
import {
	chunk,
	clusterEntityPerspective,
	clusterEntityPerspectiveKeyPoint,
	clusterEntityPerspectiveKpQuote,
	clusterEntityPerspectiveQuote,
	clusterKeyPerspective,
	clusterKeyPoint,
	clusterKeyPointQuote,
	clusterPerspectiveQuote,
	currentChunkMembership,
	currentEntityMembership,
	currentSupercluster,
	currentSuperclusterEdge,
	currentTopic,
	document,
	entity,
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
import { and, asc, count, countDistinct, eq, inArray } from 'drizzle-orm'
import type { SQLiteAsyncDatabase } from 'drizzle-orm/sqlite-core'
import {
	MEMBERSHIP_GRADES,
	questionClause,
	type WorldGroup,
	type WorldMembership,
	type WorldPerspective,
	type WorldPoint,
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

export interface WorldRecordConfig {
	/** The report's stable key (the app's slug, or a run id). */
	slug: string
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

export async function worldRecord(db: WorldDb, config: WorldRecordConfig): Promise<WorldRecord> {
	const [meta] = await db.select().from(runMeta).where(eq(runMeta.singleton, 1)).limit(1)
	if (!meta) throw new Error('run_meta is empty: the run cannot account for itself')
	if (!meta.profile) throw new Error('run_meta.profile is null: the run cannot account for itself')
	const profile = meta.profile
	const site = meta.site

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
		questionRows,
		responseRows,
		responsePointRows,
		starRows,
	] = await Promise.all([
		db.select({ uuid: entity.id, id: entity.entityId, name: entity.entityName }).from(entity),
		db
			.select({
				id: document.documentId,
				entityUuid: document.entityUuid,
				title: document.documentTitle,
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
		db
			.select({
				topicId: currentChunkMembership.topicClusterId,
				documents: countDistinct(chunk.documentId),
			})
			.from(currentChunkMembership)
			.innerJoin(chunk, eq(chunk.id, currentChunkMembership.chunkId))
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
		db.select().from(question),
		db
			.select({
				id: questionResponse.questionResponseId,
				documentId: questionResponse.documentId,
				questionId: questionResponse.questionId,
				position: questionResponse.position,
			})
			.from(questionResponse)
			.where(eq(questionResponse.addressed, 1)),
		// Each answer's points in writing order: the first is the plaque's lead,
		// the count says how much more a reading holds.
		db
			.select({
				responseId: questionResponseKeyPoint.questionResponseId,
				point: questionResponseKeyPoint.keyPoint,
			})
			.from(questionResponseKeyPoint)
			.orderBy(asc(questionResponseKeyPoint.questionResponseKeyPointId)),
		db.select().from(topicStar),
	])

	/* ── identities ── */
	const slugOf = new Map(entityRows.map((e) => [e.uuid, e.id]))
	const topicIds = new Set(topicRows.map((t) => t.id))
	const strong = memberRows.filter(
		(m): m is typeof m & { grade: (typeof MEMBERSHIP_GRADES)[number] } =>
			topicIds.has(m.topicId) && (MEMBERSHIP_GRADES as readonly string[]).includes(m.grade),
	)

	/* ── the analysed facets, by weight ── */
	const lensWeight = new Map<string, number>()
	for (const row of lensRows) {
		if (!topicIds.has(row.topicId)) continue
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

	const facets = analysed.map((key) => {
		const declared = profile.facets.find((f) => f.name === key)
		const excluded = new Set(declared?.excluded_values ?? [])
		const counts = new Map<string, number>()
		for (const e of entityRows) {
			for (const value of facetsOf(e.uuid)[key] ?? [])
				counts.set(value, (counts.get(value) ?? 0) + 1)
		}
		const order = (declared?.values ?? []).filter((v) => !excluded.has(v))
		const values = [...new Set([...order, ...counts.keys()])]
			.filter((v) => !excluded.has(v) && (counts.get(v) ?? 0) > 0)
			.sort((a, b) => {
				const ia = order.indexOf(a)
				const ib = order.indexOf(b)
				if (ia >= 0 || ib >= 0) return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib)
				return (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b)
			})
		const siteFacet = site?.facets[key]
		const noun = declared?.noun ?? key
		return {
			key,
			heading: siteFacet?.heading ?? noun.charAt(0).toUpperCase() + noun.slice(1),
			values: values.map((value) => ({
				value,
				label: siteFacet?.values[value] ?? value,
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
		(sc) => primaryParent.get(sc.id) as number,
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
	const membersByTopic = grouped(
		memberRows.filter((m) => topicIds.has(m.topicId)),
		(m) => m.topicId,
	)
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
			sources: new Set((membersByTopic.get(t.id) ?? []).map((m) => m.entityUuid)).size,
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
			lenses: (lensesByTopic.get(t.id) ?? [])
				.filter((l) => analysedSet.has(l.facet))
				.map((l) => ({
					facet: l.facet,
					value: l.value,
					position: l.position,
					analysis: l.analysis,
					quotes: (lensQuotes.get(l.id) ?? []).map((q) => ({
						text: q.text,
						source: slugOf.get(q.entityUuid) ?? null,
					})),
				})),
			star: star ? { x: star.x, y: star.y, r: star.r } : null,
		}
	})

	/* ── groups ── */
	const groups: WorldGroup[] = groupNodes.map((g) => {
		const under = topicsUnder(g.id)
		const sources = new Set<string>()
		const stances: { position: string }[] = []
		for (const topicId of under) {
			for (const m of membersByTopic.get(topicId) ?? []) sources.add(m.entityUuid)
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
		if (!topicIds.has(m.topicId) || (MEMBERSHIP_GRADES as readonly string[]).includes(m.grade))
			continue
		weakByEntity.set(m.entityUuid, (weakByEntity.get(m.entityUuid) ?? 0) + 1)
	}
	const sources: WorldSource[] = entityRows.map((e) => ({
		id: e.id,
		name: e.name,
		facets: facetsOf(e.uuid),
		documents: (docsByEntity.get(e.uuid) ?? []).map((d) => ({
			id: d.id,
			title: d.title ?? d.fileName,
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

	/* ── the custom analyses ── */
	const ownerOfDocument = new Map(documentRows.map((d) => [d.id, slugOf.get(d.entityUuid) ?? null]))
	const responsePoints = grouped(responsePointRows, (p) => p.responseId)
	const responsesByQuestion = grouped(responseRows, (r) => r.questionId)
	const tasks: WorldTask[] = profile.analysis_tasks.map((task) => {
		const title = taskTitle(task)
		if (task.task_type !== 'question_response') {
			return { kind: task.task_type, id: task.task_id, title, description: task.task_description }
		}
		return {
			kind: 'question_response',
			id: task.task_id,
			title,
			description: task.task_description,
			questions: [...questionRows]
				.sort((a, b) => a.ordinal - b.ordinal)
				.map((q) => ({
					key: q.questionKey,
					clause: questionClause(q.questionKey, q.questionText),
					text: q.questionText,
					ordinal: q.ordinal,
					answers: (responsesByQuestion.get(q.questionId) ?? []).flatMap((r) => {
						const sourceId = ownerOfDocument.get(r.documentId)
						if (!sourceId) return []
						const points = responsePoints.get(r.id) ?? []
						return [
							{
								sourceId,
								documentId: r.documentId,
								position: r.position,
								lead: points[0]?.point ?? null,
								keyPoints: points.length,
							},
						]
					}),
				})),
		}
	})

	const stance = profile.stance
	const params = profile.prompts.params
	return worldRecordSchema.parse({
		site: {
			slug: config.slug,
			title: site?.title ?? meta.name,
			eyebrow: site?.eyebrow ?? null,
			standfirst: site?.standfirst ?? params.corpus_description,
			source: site?.source ?? null,
			nouns: {
				entity: params.entity_noun,
				entities: params.entity_noun_plural,
				document: params.document_noun,
				documents: params.document_noun_plural,
			},
			scale: {
				order: stance.labels,
				supportive: stance.agreement?.supportive ?? [],
				contesting: stance.agreement?.contesting ?? [],
				unclear: stance.agreement?.unclear ?? null,
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

/**
 * One item's reading, fetched when a visitor opens it: the key points (with
 * their verified quotes) the record only counts. Unknown ids read as empty.
 */
export async function worldReading(db: WorldDb, ref: WorldReadingRef): Promise<WorldReading> {
	const points = async (): Promise<WorldPoint[]> => {
		if (ref.kind === 'perspective') {
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
		if (ref.kind === 'document') {
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
			const quotes = rows.length
				? await db
						.select({ pointId: keyQuote.keyPointId, text: keyQuote.quote })
						.from(keyQuote)
						.innerJoin(
							keyQuoteVerification,
							eq(keyQuoteVerification.keyQuoteId, keyQuote.keyQuoteId),
						)
						.where(
							and(
								inArray(
									keyQuote.keyPointId,
									rows.map((r) => r.id),
								),
								eq(keyQuoteVerification.verified, 1),
							),
						)
				: []
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
		const [response] = await db
			.select({ id: questionResponse.questionResponseId, sourceId: entity.entityId })
			.from(questionResponse)
			.innerJoin(question, eq(question.questionId, questionResponse.questionId))
			.innerJoin(document, eq(document.documentId, questionResponse.documentId))
			.innerJoin(entity, eq(entity.id, document.entityUuid))
			.where(
				and(
					eq(question.questionKey, ref.questionKey),
					eq(questionResponse.documentId, ref.documentId),
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
			quotes: (byPoint.get(r.id) ?? []).map((q) => ({ text: q.text, source: response.sourceId })),
		}))
	}
	return worldReadingSchema.parse({ ref, keyPoints: await points() } satisfies WorldReading)
}
