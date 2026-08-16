/**
 * Content builders — THE panel standard (settled 2026-08-16 across a full
 * MCQ round, after the three consuming apps' readers drifted apart).
 * Adapters supply normalised DATA; the builders own section composition,
 * order and titles, so every corpus reads the same way:
 *
 *   SOURCE panel: one uniform engaged-topics section (analysed rows carry
 *   position + analysis + QUOTES — provenance is a hard requirement —
 *   member-grade rows follow as bare actionable titles; the title reads
 *   naturally whatever the mix); documents section ONLY when the entity has
 *   ≥2 documents (1:1 corpora: the entity reading IS the document reading);
 *   key points; optional structured-analysis blocks. Grades never badge in
 *   the panel — the sky owns them (whiskers/planetification). No related
 *   chips: the sections ARE the navigation.
 *
 *   TOPIC panel: key points; ONE lens section per facet the corpus ships
 *   (with quotes); a 'Member of' parent-membership section only when the
 *   topic genuinely has ≥2 parents (all three corpora carry the full
 *   supercluster_edge DAG). Contributors come from the package's
 *   grade-grouped accordion, never from adapter sections.
 *
 *   CONTAINER panel: lede + the DIRECT children as actionable rows.
 *
 *   DOCUMENT reading (multi-document entities): same anatomy as a source
 *   panel — that document's engaged topics, key points, quotes.
 *
 * Language: fixed English defaults, overridable per corpus through
 * `ContentVocabulary` (e.g. documents → 'Reports' / 'Submissions').
 */

import type {
	IBContentSection,
	IBDocumentRow,
	IBFacetRow,
	IBNodeContent,
	IBNodeId,
	IBPoint,
	IBQuote,
} from './types.ts'

/* ── Vocabulary ─────────────────────────────────────────────────────────── */

export interface ContentVocabulary {
	/** The source panel's per-topic section — 'Engaged topics'. */
	engagedTitle: string
	keyPointsTitle: string
	/** The multi-parent membership section — 'Member of'. */
	memberOfTitle: string
	/** The multi-document section — 'Documents' ('Reports', 'Submissions'…). */
	documentsTitle: string
	/** Unit noun for document counts in stats — 'documents'. */
	documentsUnit: string
	/** Unit noun for engaged-topic counts in stats — 'topics'. */
	topicsUnit: string
	/** Lens section titles — defaults to '{facet label} lens'. */
	lensTitle: (facetLabel: string) => string
}

export const DEFAULT_CONTENT_VOCABULARY: ContentVocabulary = {
	engagedTitle: 'Engaged topics',
	keyPointsTitle: 'Key points',
	memberOfTitle: 'Topic superclusters',
	documentsTitle: 'Documents',
	documentsUnit: 'documents',
	topicsUnit: 'topics',
	lensTitle: (facetLabel) => `${facetLabel} lens`,
}

const vocab = (overrides?: Partial<ContentVocabulary>): ContentVocabulary => ({
	...DEFAULT_CONTENT_VOCABULARY,
	...overrides,
})

/* ── Shared input shapes ────────────────────────────────────────────────── */

export interface StatChip {
	label: string
	value: string
}

/** An analysed engagement: the entity's own stance on one topic. Analysis
 * exists only for exemplar/high-value memberships (pipeline contract). */
export interface PerspectiveRow {
	/** Galaxy node id of the topic — the row is actionable. */
	id: IBNodeId
	label: string
	position?: string
	positionColor?: string
	analysis?: string
	quotes?: IBQuote[]
}

/** A bare engagement (member grade): title-only, still actionable. */
export interface EngagedRow {
	id: IBNodeId
	label: string
}

/** A structured-analysis block (basin's subtopic analysis, legal's claims
 * spine) — rendered as its own points section after the key points. */
export interface AnalysisBlock {
	title: string
	points: IBPoint[]
}

/* ── Source / document panels ───────────────────────────────────────────── */

export interface SourceContentInput {
	/** Lede fragments (facet values · role/publication · year); empties are
	 * dropped and the rest joined with ' · '. */
	meta?: Array<string | null | undefined>
	/** Analysed engagements (exemplar/high-value) — position + analysis. */
	perspectives?: PerspectiveRow[]
	/** Bare member-grade engagements, listed after the analysed rows. */
	engaged?: EngagedRow[]
	/** The entity's documents. The section renders ONLY at ≥2 (1:1 corpora
	 * never see it); counts join the baseline stats at the same threshold. */
	documents?: IBDocumentRow[]
	keyPoints?: IBPoint[]
	analysis?: AnalysisBlock[]
	/** Corpus-specific stat extensions, appended after the baseline. */
	stats?: StatChip[]
}

const engagedSection = (
	input: Pick<SourceContentInput, 'perspectives' | 'engaged'>,
	vocabulary: ContentVocabulary,
): IBContentSection | null => {
	const rows: IBFacetRow[] = [
		...(input.perspectives ?? []).map(
			(row): IBFacetRow => ({
				id: row.id,
				label: row.label,
				badge: row.position,
				badgeColor: row.positionColor,
				analysis: row.analysis,
				quotes: row.quotes,
			}),
		),
		...(input.engaged ?? []).map((row): IBFacetRow => ({ id: row.id, label: row.label })),
	]
	return rows.length > 0 ? { kind: 'facets', title: vocabulary.engagedTitle, rows } : null
}

const pointsSections = (
	input: Pick<SourceContentInput, 'keyPoints' | 'analysis'>,
	vocabulary: ContentVocabulary,
): IBContentSection[] => [
	...((input.keyPoints?.length ?? 0) > 0
		? [{ kind: 'points' as const, title: vocabulary.keyPointsTitle, points: input.keyPoints ?? [] }]
		: []),
	...(input.analysis ?? [])
		.filter((block) => block.points.length > 0)
		.map(
			(block): IBContentSection => ({ kind: 'points', title: block.title, points: block.points }),
		),
]

export function buildSourceContent(
	input: SourceContentInput,
	overrides?: Partial<ContentVocabulary>,
): IBNodeContent {
	const vocabulary = vocab(overrides)
	const engagedCount = (input.perspectives?.length ?? 0) + (input.engaged?.length ?? 0)
	const documents = input.documents ?? []
	const engaged = engagedSection(input, vocabulary)
	return {
		lede:
			(input.meta ?? []).filter((part): part is string => Boolean(part)).join(' · ') || undefined,
		stats: [
			...(engagedCount > 0 ? [{ label: vocabulary.topicsUnit, value: String(engagedCount) }] : []),
			...(documents.length >= 2
				? [{ label: vocabulary.documentsUnit, value: String(documents.length) }]
				: []),
			...(input.stats ?? []),
		],
		sections: [
			...(engaged ? [engaged] : []),
			...(documents.length >= 2
				? [{ kind: 'documents' as const, title: vocabulary.documentsTitle, rows: documents }]
				: []),
			...pointsSections(input, vocabulary),
		],
	}
}

/** A document reading is a source panel minus the documents section — the
 * same anatomy, traced to ONE document. */
export type DocumentContentInput = Omit<SourceContentInput, 'documents'>

export function buildDocumentContent(
	input: DocumentContentInput,
	overrides?: Partial<ContentVocabulary>,
): IBNodeContent {
	return buildSourceContent(input, overrides)
}

/* ── Topic panels ───────────────────────────────────────────────────────── */

/** One facet lens over the topic — a section per facet the corpus ships. */
export interface TopicLens {
	/** Facet display label ('Voice', 'Era', 'Body type', 'Sector'…). */
	label: string
	rows: Array<{
		label: string
		position?: string
		positionColor?: string
		analysis?: string
		quotes?: IBQuote[]
		share?: number
	}>
}

export interface ParentMembership {
	/** Galaxy node id of the parent — the row is actionable. */
	id: IBNodeId
	label: string
	isPrimary: boolean
	membershipType?: string | null
	/** 0..1 where known. */
	similarity?: number | null
}

export interface TopicContentInput {
	description?: string
	/** Baseline stat: contributing entities ('14' + the corpus noun). */
	contributors?: { value: number; unit: string }
	/** Baseline stat: document count ('22' + the corpus document noun). */
	documents?: { value: number; unit: string }
	/** Corpus-specific stat extensions, appended after the baseline. */
	stats?: StatChip[]
	keyPoints?: IBPoint[]
	lenses?: TopicLens[]
	/** ALL parent memberships. The builder keeps only the STRONG ones —
	 * primary, exemplar, high-value (settled 2026-08-16; member-grade noise
	 * dropped) — sorts them by strength (primary leads), and renders the
	 * section only when ≥2 survive: single parents are the breadcrumb's job. */
	parents?: ParentMembership[]
}

/** Wifi-signal strength for a parent membership (3 = full). */
const parentSignal = (parent: ParentMembership): 0 | 1 | 2 | 3 => {
	if (parent.isPrimary) return 3
	if (parent.membershipType === 'exemplar') return 2
	if (parent.membershipType === 'high_value') return 1
	return 0
}

export function buildTopicContent(
	input: TopicContentInput,
	overrides?: Partial<ContentVocabulary>,
): IBNodeContent {
	const vocabulary = vocab(overrides)
	const parents = (input.parents ?? [])
		.map((parent) => ({ parent, signal: parentSignal(parent) }))
		.filter((entry): entry is { parent: ParentMembership; signal: 1 | 2 | 3 } => entry.signal > 0)
		.sort((a, b) => b.signal - a.signal || (b.parent.similarity ?? 0) - (a.parent.similarity ?? 0))
	return {
		lede: input.description || undefined,
		stats: [
			...(input.contributors
				? [{ label: input.contributors.unit, value: String(input.contributors.value) }]
				: []),
			...(input.documents
				? [{ label: input.documents.unit, value: String(input.documents.value) }]
				: []),
			...(input.stats ?? []),
		],
		sections: [
			...pointsSections(input, vocabulary),
			...(input.lenses ?? [])
				.filter((lens) => lens.rows.length > 0)
				.map(
					(lens): IBContentSection => ({
						kind: 'facets',
						title: vocabulary.lensTitle(lens.label),
						rows: lens.rows.map(
							(row): IBFacetRow => ({
								label: row.label,
								badge: row.position,
								badgeColor: row.positionColor,
								analysis: row.analysis,
								quotes: row.quotes,
								share: row.share,
							}),
						),
					}),
				),
			...(parents.length >= 2
				? [
						{
							kind: 'facets' as const,
							title: vocabulary.memberOfTitle,
							rows: parents.map(
								({ parent, signal }): IBFacetRow => ({
									id: parent.id,
									label: parent.label,
									// The badge names the strength for assistive tech;
									// visually the wifi-signal icon carries it.
									badge: parent.isPrimary ? 'primary' : (parent.membershipType ?? ''),
									signal,
								}),
							),
						},
					]
				: []),
		],
	}
}

/* ── Container panels ───────────────────────────────────────────────────── */

export interface ContainerContentInput {
	lede?: string
	/** Section title — the children tier's plural from the corpus vocab. */
	childrenTitle: string
	/** DIRECT children only (settled 2026-08-16), as actionable node rows. */
	rows: Array<{ id: IBNodeId; label: string; detail?: string; weight?: number }>
}

export function buildContainerContent(input: ContainerContentInput): IBNodeContent {
	return {
		lede: input.lede,
		sections: [{ kind: 'nodes', title: input.childrenTitle, rows: input.rows }],
	}
}
