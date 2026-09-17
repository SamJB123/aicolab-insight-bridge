/**
 * Content builders — THE reading standard (settled 2026-08-16 across a full
 * MCQ round, after the three consuming apps' readers drifted apart; moved
 * out of the galaxy on 2026-09-14 when the app drawers adopted the same
 * reader). Adapters supply normalised DATA; the builders own section
 * composition, order and titles, so every corpus — and every surface, the
 * galaxy rail and the app's wide sheet alike — reads the same way:
 *
 *   SOURCE reading: key points and optional structured-analysis blocks lead;
 *   then one uniform engaged-topics section (analysed rows carry position +
 *   analysis + QUOTES — provenance is a hard requirement — member-grade
 *   rows follow as bare actionable titles; the title reads naturally
 *   whatever the mix); documents section ONLY when the entity has ≥2
 *   documents (1:1 corpora: the entity reading IS the document reading).
 *   Grades never badge in the reading — the sky owns them
 *   (whiskers/planetification). No related chips: the sections ARE the
 *   navigation.
 *
 *   TOPIC reading: key points; ONE lens section per facet the corpus ships
 *   (with quotes, and a share meter where the host supplies one); a
 *   'Member of' parent-membership section only when the topic genuinely
 *   has ≥2 parents. Contributors ride separately, grouped by grade.
 *
 *   CONTAINER reading: lede + the DIRECT children as actionable rows.
 *
 *   DOCUMENT reading (multi-document entities): same anatomy as a source
 *   reading — that document's engaged topics, key points, quotes.
 *
 * Language: fixed English defaults, overridable per corpus through
 * `ContentVocabulary` (e.g. documents → 'Reports' / 'Submissions').
 */

import type {
	IBContentSection,
	IBDocumentRow,
	IBFacetRow,
	IBFlag,
	IBNodeContent,
	IBNodeId,
	IBPoint,
	IBQuote,
} from '../galaxy/types.ts'

/* ── Vocabulary ─────────────────────────────────────────────────────────── */

export interface ContentVocabulary {
	/** The source reading's per-topic section — 'Engaged topics'. */
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
	/** Reading node id of the topic — the row is actionable. */
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

/** Grade-grouped contributors of a topic (exemplars, high-value, members). */
export interface ContributorGroup {
	label: string
	rows: Array<{ id: IBNodeId; label: string; detail?: string }>
}

/* ── Source / document readings ─────────────────────────────────────────── */

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
	flags?: IBFlag[]
	/** Outbound links (the original document on its publisher's site). */
	links?: IBNodeContent['links']
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
		flags: input.flags,
		links: input.links,
		sections: [
			...pointsSections(input, vocabulary),
			...(engaged ? [engaged] : []),
			...(documents.length >= 2
				? [{ kind: 'documents' as const, title: vocabulary.documentsTitle, rows: documents }]
				: []),
		],
	}
}

/** A document reading is a source reading minus the documents section — the
 * same anatomy, traced to ONE document. */
export type DocumentContentInput = Omit<SourceContentInput, 'documents'>

export function buildDocumentContent(
	input: DocumentContentInput,
	overrides?: Partial<ContentVocabulary>,
): IBNodeContent {
	return buildSourceContent(input, overrides)
}

/* ── Topic readings ─────────────────────────────────────────────────────── */

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
		/** 0..1 — this slice's share of the topic's written stances. */
		share?: number
	}>
}

export interface ParentMembership {
	/** Reading node id of the parent — the row is actionable. */
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
	flags?: IBFlag[]
	keyPoints?: IBPoint[]
	lenses?: TopicLens[]
	/** ALL parent memberships. The builder keeps only the STRONG ones —
	 * primary, exemplar, high-value (settled 2026-08-16; member-grade noise
	 * dropped) — sorts them by strength (primary leads), and renders the
	 * section only when ≥2 survive: single parents are the breadcrumb's job. */
	parents?: ParentMembership[]
	/** Contributors by grade. The galaxy computes these from its graph when
	 * the host leaves them out; a host without a graph (the app sheet)
	 * supplies them here. */
	contributorGroups?: ContributorGroup[]
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
		flags: input.flags,
		contributors: input.contributorGroups?.filter((group) => group.rows.length > 0),
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

/* ── Container readings ─────────────────────────────────────────────────── */

export interface ContainerContentInput {
	lede?: string
	/** Section title — the children tier's plural from the corpus vocab. */
	childrenTitle: string
	/** DIRECT children only (settled 2026-08-16), as actionable node rows. */
	rows: Array<{ id: IBNodeId; label: string; detail?: string; weight?: number }>
	stats?: StatChip[]
}

export function buildContainerContent(input: ContainerContentInput): IBNodeContent {
	return {
		lede: input.lede,
		stats: input.stats,
		sections: [{ kind: 'nodes', title: input.childrenTitle, rows: input.rows }],
	}
}
