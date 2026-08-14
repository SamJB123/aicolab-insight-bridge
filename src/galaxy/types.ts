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

/** 0 = leaf topic · 1 = mid group (theme/supercluster) · 2 = top family. */
export type IBTier = 0 | 1 | 2

/** Namespaced so ids can't collide across tiers: `t:106` | `g1:14` | `g2:3`. */
export type IBNodeId = string

export interface IBFlag {
	/** Short chip text — "1 voice", "unscrutinised", "no theme". */
	label: string
	/** Hot flags read as warnings (host explorers' red-chip class). */
	hot?: boolean
	tip?: string
}

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
}

/** Child→parent membership across adjacent tiers. Multi-parent is legal:
 * audit topics genuinely belong to several superclusters — exactly one edge
 * per child should be primary (it wins placement; the rest tug the bake and
 * light up as secondary beams). */
export interface IBEdge {
	child: IBNodeId
	parent: IBNodeId
	isPrimary: boolean
	/** exemplar | high_value | member — audit's membership strength tiers. */
	membershipType?: string | null
	/** 0..1 where known; brightens the beam. */
	similarity?: number | null
}

export interface IBTierMeta {
	tier: IBTier
	/** Singular display name — "Family" | "Theme" | "Topic". */
	label: string
	labelPlural: string
}

/* ── Node content (full drawer parity, settled 2026-08-14) ──────────────
 * What the in-galaxy reader renders when a node is selected. Hosts map
 * their drawer queries onto these sections; the package renders them
 * natively (RaisedSheet + RichList + Chip + Meter) so every corpus gets the
 * same reading surface beside the living galaxy. Pure data — the loader
 * callback lives on GalaxyMapProps, never in IBGalaxy (which must stay
 * serialisable across the server boundary). */

export interface IBQuote {
	text: string
	/** Attribution — entity/body/source name, year, etc. */
	source?: string
}

export interface IBPoint {
	text: string
	quotes?: IBQuote[]
}

/** One row of a lens table (voice/era/sector × stance × analysis). */
export interface IBFacetRow {
	label: string
	/** Stance/position badge for this slice. */
	badge?: string
	/** CSS colour for the badge (host's position colours). */
	badgeColor?: string
	/** 0..1 share for a trailing meter (reach/coverage). */
	share?: number
	analysis?: string
}

/** One row of an entity list (top bodies/sources/sectors with counts). */
export interface IBEntityRow {
	label: string
	detail?: string
	count?: number
	/** Denominator for the trailing meter; defaults to the section max. */
	max?: number
}

export type IBContentSection =
	| { kind: 'points'; title: string; points: IBPoint[] }
	| { kind: 'facets'; title: string; rows: IBFacetRow[] }
	| { kind: 'entities'; title: string; rows: IBEntityRow[] }

export interface IBNodeContent {
	/** One-paragraph framing, rendered under the title. */
	lede?: string
	/** Headline figures as label/value chips. */
	stats?: Array<{ label: string; value: string }>
	sections: IBContentSection[]
	/** Cross-links — choosing one flies the camera there. */
	related?: Array<{ id: IBNodeId; label: string }>
}

/** Imperative commands into the stage (delivered via SceneStage). Bump
 * `revision` on every change — command objects are compared by content the
 * host controls, not identity. */
export interface GalaxyCommand {
	/** Fly the camera to a node (`null` returns to the overview). Selection
	 * itself flies too; this exists so hosts can drive the camera from list
	 * rows and deep links. */
	focus?: IBNodeId | null
	revision: number
}

/** Engine→host facts. Read live at event time — replacing handlers never
 * rebuilds the renderer. */
export interface GalaxyEvents {
	onHover?: (node: IBNode | null) => void
	onSelect?: (node: IBNode) => void
	/** The focused constellation's group (null when back at the galaxy). */
	onFocusChange?: (node: IBNode | null) => void
}

export interface IBGalaxy {
	/** One entry per tier PRESENT — basin passes two, the others three. */
	tiers: IBTierMeta[]
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
