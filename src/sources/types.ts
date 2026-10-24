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
 *
 * The page of the record (`SourcesResult`) crosses a wire as an operation's
 * output too, so it and its rows are declared as zod schemas with their types
 * inferred: one definition for the page and the report catalogue.
 */
import { z } from 'zod'
import { type FacetSpec, facetSpecSchema } from '../brief/types.ts'
import type { ReadScope } from '../explorer/scope.ts'

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
	/** The reader's scope (explorer/scope.ts): its excluded contributors are left out of the record. */
	scope?: ReadScope
	/**
	 * Facets the host derives from its own tables, beside the run's: who holds
	 * which value, by contributor uuid. A derived facet filters, counts and
	 * sorts exactly as a run facet does when `filters` names its key, and its
	 * values ride on each row's `facets` so the row can show them (High Water:
	 * a submitter's campaign role, its documents' primary report theme).
	 */
	derived?: DerivedFacet[]
}

/** A host's own facet over the contributors: its key, and who holds which value. */
export interface DerivedFacet {
	key: string
	holders: ReadonlyArray<{ entityUuid: string; value: string }>
}

/** One value of one facet, with how many contributors hold it. */
export const sourceFacetValueSchema = z.object({
	value: z.string(),
	sources: z.number().int(),
})
export type SourceFacetValue = z.infer<typeof sourceFacetValueSchema>

/** A facet as the filter bar meets it: resolved label, and its vocabulary. */
export const sourceFacetSchema = facetSpecSchema.extend({
	label: z.string(),
	values: z.array(sourceFacetValueSchema),
})
export type SourceFacet = z.infer<typeof sourceFacetSchema>

/** One document of one contributor, with its own facets. */
export const sourceDocumentSchema = z.object({
	documentId: z.string(),
	/** The document-granularity facets this corpus carries. */
	facets: z.record(z.string(), z.array(z.string())),
})
export type SourceDocument = z.infer<typeof sourceDocumentSchema>

/** One row of the record: a contributor, as the canonical tables describe it. */
export const sourceRowSchema = z.object({
	/** The contributor's own slug — what `openSource` takes. */
	entityId: z.string(),
	name: z.string(),
	/** Every declared facet's values for this contributor, filters and carried. */
	facets: z.record(z.string(), z.array(z.string())),
	documents: z.array(sourceDocumentSchema),
})
export type SourceRow = z.infer<typeof sourceRowSchema>

/** A page of the record, grouped when the corpus asked for grouping. */
export const sourceGroupSchema = z.object({
	/** The facet value this group is under; null for the ungrouped remainder. */
	value: z.string().nullable(),
	rows: z.array(sourceRowSchema),
})
export type SourceGroup = z.infer<typeof sourceGroupSchema>

export const sourcesResultSchema = z.object({
	rows: z.array(sourceRowSchema),
	/** The same rows under their `groupBy` value; one group when ungrouped. */
	groups: z.array(sourceGroupSchema),
	page: z.number().int(),
	pages: z.number().int(),
	pageSize: z.number().int(),
	/** Contributors matching this filter. */
	total: z.number().int(),
	/** Contributors in the whole record. */
	grandTotal: z.number().int(),
	/** Each declared filter with its vocabulary, counted over the whole record. */
	facets: z.array(sourceFacetSchema),
	groupBy: z.string().nullable(),
})
export type SourcesResult = z.infer<typeof sourcesResultSchema>

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
