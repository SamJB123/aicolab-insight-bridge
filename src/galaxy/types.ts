/**
 * The generic galaxy contract — the ONE shape all three corpus explorers
 * (Second Chair, Watchful State, One Basin) map their landscape data onto so
 * a single galaxy-map component can render any of them.
 *
 * Designed as the common denominator of the three apps' query layers
 * (settled 2026-08-14):
 *   • audit-corpus  `FamilyGraph`  → near-1:1 (true multi-parent DAG with
 *     similarity weights; `intensity = sev / 5`)
 *   • legal-ai      `Landscape`    → edges synthesised from gen1Id/gen2Id
 *     (`intensity = contestedPct / 100`, tree hole → `flags`)
 *   • basin         `Landscape`    → two tiers only (groups ARE the top tier)
 *
 * The component never sees drawers, server functions or router types: hosts
 * receive the selected `IBNode` back and open their own detail surfaces
 * keyed by `key`.
 */
import { z } from 'zod'

/** Integer hierarchy depth: -1 = source/contributor, 0 = leaf topic,
 * positive tiers = successive container generations, increasing toward roots.
 * Container names come from IBTierMeta; their number is not capped. */
export type IBTier = number

/** Namespaced so ids can't collide across tiers:
 * `s:acme-inst` | `t:106` | `g1:14` | `g2:3`. */
export type IBNodeId = string

/* The content shapes below are declared as zod schemas and their types inferred, so a
 * reading can be published as an operation's output (the report catalogue's four
 * `*_reading` tools) from the same definition the reader renders. Plain data, no
 * functions: the schemas add nothing a consumer of the types sees. */

export const ibFlagSchema = z.object({
	/** Short chip text — "1 voice", "unscrutinised", "no theme". */
	label: z.string(),
	/** Hot flags read as warnings (host explorers' red-chip class). */
	hot: z.boolean().optional(),
	tip: z.string().optional(),
})
export type IBFlag = z.infer<typeof ibFlagSchema>

export interface IBNode {
	id: IBNodeId
	tier: IBTier
	title: string
	/** The host's native drawer key: topicClusterId | gen1Id | gen2Id | family string. */
	key: number | string
	/** Reach — the size axis. The host names it via `IBGalaxy.weightLabel`. */
	weight: number
	/** Volume (documents/reports), where distinct from reach. */
	volume?: number
	/**
	 * The score axis, normalised 0..1 BY THE HOST (sev/5, contestedPct/100…).
	 * Drives stellar colour-temperature at galactic distance and mini-world
	 * climate at close zoom. Absent → neutral temperature.
	 */
	intensity?: number
	/** Display form of the un-normalised score — "sev 3.8" | "41% contested". */
	intensityLabel?: string
	/**
	 * Categorical stance mix (Supports…Opposes), shown in chrome only
	 * (tooltip/selection PositionBar) — never encoded in the 3D scene
	 * (settled 2026-08-14). Keys follow `IBGalaxy.mixOrder`.
	 */
	mix?: Record<string, number>
	/** Primary children, for cluster sizing and breadcrumb counts. */
	childCount?: number
	flags?: IBFlag[]
	/** Source nodes only: facet values keyed by `IBGalaxy.sourceFacets` keys
	 * (e.g. { Voice: 'Academia', Era: '2020s' }) — drives the colour-by-facet
	 * dust lens. */
	facets?: Record<string, string>
}

/** Child→parent membership across adjacent tiers. Multi-parent is legal
 * everywhere: audit topics belong to several superclusters, and SOURCES
 * (tier -1 children of topics) typically feed many topics — exactly one
 * edge per child should be primary (highest membership grade; it names the
 * source's "sun"). Source→topic edges are the layout's input signal: their
 * membershipType maps to the legacy intensity grades
 * {exemplar: 10, high_value: 5, standard/member: 1}. */
export interface IBEdge {
	child: IBNodeId
	parent: IBNodeId
	isPrimary: boolean
	/** exemplar | high_value | standard/member — membership strength tiers. */
	membershipType?: string | null
	/** 0..1 where known. */
	similarity?: number | null
	/** Continuous membership weight (aggregated chunk soft scores) — the
	 * alternative layout signal to the 3-step grades. Any positive scale;
	 * the bake normalises per edge class. */
	softIntensity?: number | null
}

/** Which signal drives the force layout: the legacy 3-step membership
 * grades, or the continuous soft scores (where the corpus supplies them). */
export type IBIntensityMode = 'grades' | 'soft'

/** A colour-by lens over the source dust (voice, era, body type, sector…). */
export interface IBSourceFacet {
	/** Key into `IBNode.facets`. */
	key: string
	/** Display name for the picker. */
	label: string
}

export interface IBTierMeta {
	tier: IBTier
	/** Singular display name — "Family" | "Theme" | "Topic". */
	label: string
	labelPlural: string
	/** What this tier's `weight` counts, when it differs from the galaxy's
	 * `weightLabel` — e.g. a source's weight counts topic memberships while
	 * every other tier counts sources. */
	weightLabel?: string
}

/* ── Node content (full drawer parity, settled 2026-08-14) ──────────────
 * What the in-galaxy reader renders when a node is selected. Hosts map
 * their drawer queries onto these sections; the package renders them
 * natively (RaisedSheet + RichList + Chip + Meter) so every corpus gets the
 * same reading surface beside the living galaxy. Pure data — the loader
 * callback lives on GalaxyMapProps, never in IBGalaxy (which must stay
 * serialisable across the server boundary). */

export const ibQuoteSchema = z.object({
	text: z.string(),
	/** Attribution — entity/body/source name, year, etc. */
	source: z.string().optional(),
	/** The quote's words are WITHHELD and `text` is the notice standing in
	 * for them (a source whose content is gated — Indigenous Cultural and
	 * Intellectual Property under a restricted deployment). Renders as a
	 * notice, never as a quotation. */
	withheld: z.boolean().optional(),
	/** A notice shown beside the words (a cultural notice on gated material
	 * a reader may see); unused when `withheld`, whose text is the notice. */
	notice: z.string().optional(),
})
export type IBQuote = z.infer<typeof ibQuoteSchema>

const linkSchema = z.object({ label: z.string(), href: z.string() })

/** A notice the content itself carries — a cultural notice on gated
 * material, a withheld-content card. Rendered as a banded callout, first
 * among the sections, with the attribution and any way forward. */
export const ibNoticeSchema = z.object({
	/** 'withheld' reads as a warning band; 'info' as a quiet one. */
	tone: z.enum(['withheld', 'info']),
	title: z.string(),
	body: z.string(),
	/** Who the notice is about — the custodian, as the record names them. */
	attribution: z.string().optional(),
	/** Links the reader can follow (a sign-in, a contact). `href` may be a
	 * `mailto:`. */
	links: z.array(linkSchema).optional(),
})
export type IBNotice = z.infer<typeof ibNoticeSchema>

export const ibPointSchema = z.object({
	/** The headline — an accordion summary, so keep it one scannable line. */
	text: z.string(),
	/** Elaboration shown inside the opened point (never concatenated into
	 * `text`: the headline/detail split IS the reading anatomy). */
	detail: z.string().optional(),
	quotes: z.array(ibQuoteSchema).optional(),
})
export type IBPoint = z.infer<typeof ibPointSchema>

/** One row of a lens table (voice/era/sector × stance × analysis). */
export const ibFacetRowSchema = z.object({
	label: z.string(),
	/** The galaxy node this row speaks about — rows carrying it are
	 * ACTIONABLE (choosing flies there; hovering highlights the body). */
	id: z.string().optional(),
	/** Stance/position badge for this slice. */
	badge: z.string().optional(),
	/** CSS colour for the badge (host's position colours). */
	badgeColor: z.string().optional(),
	/** 0..1 share for a trailing meter (reach/coverage). */
	share: z.number().optional(),
	/** Membership-strength glyph, 1..3 of 3 — rendered as a wifi-signal icon
	 * (settled 2026-08-16: primary = 3/full, exemplar = 2, high-value = 1).
	 * When set, the renderer shows the icon INSTEAD of the badge chip and
	 * uses `badge` as the icon's accessible name. */
	signal: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
	analysis: z.string().optional(),
	/** Verbatim quotes backing the row — provenance is a HARD requirement
	 * (settled 2026-08-16): every corpus ships perspective quote tables, and
	 * lens/perspective rows must carry them. */
	quotes: z.array(ibQuoteSchema).optional(),
})
export type IBFacetRow = z.infer<typeof ibFacetRowSchema>

/** One document belonging to a source entity. Multi-document corpora list
 * them in a `documents` section; choosing a row opens the DOCUMENT READING
 * level (settled 2026-08-16) via the host's `loadDocument`. 1:1 corpora
 * (source = document = entity) never emit the section — the entity reading
 * IS the document reading. */
export const ibDocumentRowSchema = z.object({
	documentId: z.string(),
	label: z.string(),
	/** Quiet metadata — year, corpus score, etc. */
	detail: z.string().optional(),
})
export type IBDocumentRow = z.infer<typeof ibDocumentRowSchema>

/** One row of an entity list (top bodies/sources/sectors with counts). */
export const ibEntityRowSchema = z.object({
	label: z.string(),
	detail: z.string().optional(),
	count: z.number().optional(),
	/** Denominator for the trailing meter; defaults to the section max. */
	max: z.number().optional(),
})
export type IBEntityRow = z.infer<typeof ibEntityRowSchema>

/** One ACTIONABLE child-node row (a theme's topics, a family's themes):
 * choosing it flies the camera there, hovering it highlights the body in the
 * scene. Rendered with the reader-switchable A–Z/reach ordering — the
 * package NEVER pre-ranks these (the Respect principles: how common a view
 * is does not say how much it matters). */
export const ibNodeRowSchema = z.object({
	id: z.string(),
	label: z.string(),
	/** Quiet corpus-describing metadata ("12 sources") — text, never a bar. */
	detail: z.string().optional(),
	/** Reach value for the reader's optional reach ordering. */
	weight: z.number().optional(),
})
export type IBNodeRow = z.infer<typeof ibNodeRowSchema>

export const ibContentSectionSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('notice'), title: z.string(), notice: ibNoticeSchema }),
	z.object({ kind: z.literal('points'), title: z.string(), points: z.array(ibPointSchema) }),
	z.object({ kind: z.literal('facets'), title: z.string(), rows: z.array(ibFacetRowSchema) }),
	z.object({ kind: z.literal('entities'), title: z.string(), rows: z.array(ibEntityRowSchema) }),
	z.object({ kind: z.literal('nodes'), title: z.string(), rows: z.array(ibNodeRowSchema) }),
	z.object({ kind: z.literal('documents'), title: z.string(), rows: z.array(ibDocumentRowSchema) }),
])
export type IBContentSection = z.infer<typeof ibContentSectionSchema>

export const ibNodeContentSchema = z.object({
	/** One-paragraph framing, rendered under the title. */
	lede: z.string().optional(),
	/** Headline figures as label/value chips. */
	stats: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
	/** Flags the content itself carries (a single-sector topic, a document
	 * the pipeline could not analyse) — the header's own flags come from the
	 * node. */
	flags: z.array(ibFlagSchema).optional(),
	sections: z.array(ibContentSectionSchema),
	/** A topic's contributors grouped by grade. The galaxy computes these
	 * from its graph; a host without a graph (an app's detail sheet)
	 * supplies them here. */
	contributors: z
		.array(
			z.object({
				label: z.string(),
				rows: z.array(
					z.object({ id: z.string(), label: z.string(), detail: z.string().optional() }),
				),
			}),
		)
		.optional(),
	/** Cross-links — choosing one flies the camera there. */
	related: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
	/** Outbound links — the original document on its publisher's site. */
	links: z.array(linkSchema).optional(),
})
export type IBNodeContent = z.infer<typeof ibNodeContentSchema>

/* The GalaxyCommand/GalaxyEvents wire was DELETED by the headless-core
 * rewrite (settled 2026-08-16): navigation truth lives in GalaxyNavCore
 * (nav-core.ts); both faces — the web UI and the 3D renderer — subscribe to
 * the same core and mutate only through its actions. */

export interface IBGalaxy {
	/** One entry per tier PRESENT (include -1 when sources ride along). */
	tiers: IBTierMeta[]
	/** Colour-by lenses available for the source dust, picker order. */
	sourceFacets?: IBSourceFacet[]
	nodes: IBNode[]
	edges: IBEdge[]
	/** Legend name for `weight` — "sources" | "bodies" | "entities". */
	weightLabel: string
	/** Legend name for `intensity` — "contested" | "mean severity". */
	intensityLabel?: string
	/** Display order for `mix` keys (the host's POSITION_ORDER). */
	mixOrder?: string[]
	/** Colour per mix key (the host's POSITION_COLORS) — used by the hover
	 * card's stance bar. CSS color strings. */
	mixColors?: Record<string, string>
	/** Seeds layout and every authored-random flourish — the same galaxy for
	 * every visitor, every visit. */
	seed: number
}
