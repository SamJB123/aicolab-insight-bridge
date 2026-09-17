/**
 * The source record, shared.
 *
 * One browsable, server-filtered, URL-addressable page over the canonical
 * corpus tables. A corpus declares which FACETS its readers filter by and how
 * one row should read; everything else — the search, the paging, the URL
 * contract, the counts, the pager — is the same everywhere.
 *
 *   import { sourcesData, SourcesPage } from '@aicolab/insight-bridge/sources'
 */
export { sourcesData, type SourcesDb, sourcesSearchValidator } from './data.ts'
export { SourcesPage } from './sources-page.tsx'
export { SourcesSurfaceContext, useSourcesSurface } from './surface.tsx'
export type {
	FacetSpec,
	SourceDocument,
	SourceFacet,
	SourceFacetValue,
	SourceGroup,
	SourceRow,
	SourcesConfig,
	SourcesResult,
	SourcesSearch,
	SourcesSurface,
	SourcesVocabulary,
} from './types.ts'
