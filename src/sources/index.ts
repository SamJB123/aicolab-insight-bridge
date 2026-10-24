/**
 * The source record, shared.
 *
 * One browsable, server-filtered, URL-addressable page over the canonical
 * corpus tables. A corpus declares which FACETS its readers filter by and how
 * one row should read; everything else — the search, the paging, the URL
 * contract, the counts, the pager — is the same everywhere.
 *
 *   import { sourcesData, SourcesPage } from '@aicolab/insight-bridge/sources'
 *
 * A server that only RUNS the query takes `@aicolab/insight-bridge/sources/data`
 * (and `/sources/types` for the shapes), which reach drizzle and nothing
 * heavier, so no page lands in its bundle.
 */
export { sourcesData, sourcesSearchOf } from './data.ts'
export { SourcesPage } from './sources-page.tsx'
export { SourcesSurfaceContext, SourcesSurfaceProvider, useSourcesSurface } from './surface.tsx'
export type {
	DerivedFacet,
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
export {
	type RowChip,
	type RowFlag,
	type RowPath,
	rowChipSchema,
	rowFlagSchema,
	rowPathSchema,
	type SourceRowView,
	sourceRowViewSchema,
} from './types.ts'
