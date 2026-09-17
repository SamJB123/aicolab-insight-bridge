/**
 * @aicolab/insight-bridge/brief — the reading surfaces an Insight Bridge app
 * builds ABOVE the reader: the shape of a run, drawn from what its pipeline
 * built, with the host supplying the data and deciding what a click means.
 *
 * A SEPARATE subpath from the reader and the galaxy: this entry reaches
 * solid-js and nothing heavier, so a landing page can draw the structure of
 * its corpus without pulling in the reader's sheet or the WebGPU engine.
 *
 *   import { StructureTree } from '@aicolab/insight-bridge/brief'
 *
 * A server that only RUNS the queries — a Durable Object holding a run's
 * store, say — takes `@aicolab/insight-bridge/brief/data` instead, which
 * reaches drizzle and nothing heavier, so no reading UI lands in its bundle.
 */

export { BriefPage } from './brief-page.tsx'
export {
	analysedFacets,
	type BriefConfig,
	type BriefDb,
	briefData,
	chapterReading,
	type FacetHint,
	generationLabel,
	POSITIONS,
	type PositionScale,
	readTopics,
	splitTitle,
} from './data.ts'
export {
	Constellation,
	createHover,
	type Hover,
	PositionBar,
	PositionLegend,
	ReachBars,
} from './figures.tsx'
export * as briefSchema from './schema.ts'
export {
	StructureTree,
	type StructureTreeGeneration,
	type StructureTreeGroup,
	type StructureTreeNode,
	type StructureTreeProps,
	type StructureTreeTopic,
} from './structure-tree.tsx'
export { type BriefSurface, useBriefSurface } from './surface.tsx'
export type {
	BriefContributor,
	BriefData,
	BriefFamily,
	BriefNode,
	BriefStar,
	BriefTheme,
	BriefTopic,
	BriefVocabulary,
	ChapterReading,
	FacetPin,
	FacetShare,
	FacetSpec,
	Pushback,
	ReadingPoint,
	ReadingQuote,
} from './types.ts'
