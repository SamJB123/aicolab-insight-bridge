/**
 * The source record's contract — ONE shape for every corpus.
 *
 * Five apps had each hand-named their filters (`sectors`, `voices`, `eras`,
 * `periods`) and written a WHERE clause per filter against a denormalised
 * `entity` column. A filter here is a FACET, resolved against
 * `facet_assignment`; a corpus declares which facets its readers filter by.
 *
 * What stays per corpus is how a row READS — a submitter, an episode and an
 * oversight body want different chrome — and that arrives as a render prop.
 */
import type { FacetSpec } from '../brief/types.ts'

export type { FacetSpec }

/** How a corpus declares its record. */
export interface SourcesConfig {
	/** The facets a reader filters by, in the order they meet them. */
	filters: FacetSpec[]
	/** Group each page under one facet's value. */
	groupBy?: string
	/**
	 * Row order before the contributor's name. An ordinal facet sorts by its
	 * declared `order`, anything else by value; `desc` reads newest-first.
	 */
	sort?: Array<{ facet: string; desc?: boolean }>
	/** Rows per page. Default 40. */
	pageSize?: number
	/** Contributors to leave out — a corpus that collapses duplicates. */
	excludeEntities?: ReadonlySet<string>
}

/** One value of one facet, with how many contributors hold it. */
export interface SourceFacetValue {
	value: string
	sources: number
}

/** A facet as the filter bar meets it: resolved label, and its vocabulary. */
export type SourceFacet = FacetSpec & {
	label: string
	values: SourceFacetValue[]
}

/** One document of one contributor, with its own facets. */
export interface SourceDocument {
	documentId: string
	/** The document-granularity facets this corpus carries. */
	facets: Record<string, string[]>
}

/** One row of the record: a contributor, as the canonical tables describe it. */
export interface SourceRow {
	/** The contributor's own slug — what `openSource` takes. */
	entityId: string
	name: string
	/** Every declared facet's values for this contributor, filters and carried. */
	facets: Record<string, string[]>
	documents: SourceDocument[]
}

/** A page of the record, grouped when the corpus asked for grouping. */
export interface SourceGroup {
	/** The facet value this group is under; null for the ungrouped remainder. */
	value: string | null
	rows: SourceRow[]
}

export interface SourcesResult {
	rows: SourceRow[]
	/** The same rows under their `groupBy` value; one group when ungrouped. */
	groups: SourceGroup[]
	page: number
	pages: number
	pageSize: number
	/** Contributors matching this filter. */
	total: number
	/** Contributors in the whole record. */
	grandTotal: number
	/** Each declared filter with its vocabulary, counted over the whole record. */
	facets: SourceFacet[]
	groupBy: string | null
}

/**
 * The reader's place in the record, and the whole of the URL contract.
 *
 * Flat by design: a facet's key IS its search param, so a link reads
 * `?sector=Government&page=2` and a reader can see what it says.
 */
export interface SourcesSearch {
	q?: string
	page?: number
	/** One chosen value per declared facet, keyed by the facet's own name. */
	[facet: string]: string | number | undefined
}

/** The corpus's nouns. The only per-app content in the whole layer. */
export interface SourcesVocabulary {
	/** 'submitter' / 'episode' / 'body' / 'source'. */
	source: string
	sources: string
	/** What the page is called in its own words. */
	title: string
	standfirst?: string
	/** The filter bar's own line of help. */
	filterNote?: string
	/** Appended to the counts line — "Counts describe who wrote in, never prevalence." */
	countsNote?: string
}

/** What the record needs from its host. */
export interface SourcesSurface {
	vocabulary: SourcesVocabulary
	/** Where the reader is, read from the route's own search params. */
	search: SourcesSearch
	/**
	 * Apply a change. A FILTER change should reset to page 1 and replace
	 * history; a page change should push. The route owns that, because the
	 * router is the host's.
	 */
	onSearch: (patch: SourcesSearch, kind: 'filter' | 'page') => void
	/** Opening a row — the app's drawer, keyed by the contributor's slug. */
	openSource: (entityId: string) => void
}
