/**
 * @aicolab/insight-bridge/reader — the one reading surface.
 *
 * A SEPARATE subpath from the galaxy: this entry reaches ui-solid and
 * nothing heavier, so an app's detail sheet can mount the reader on every
 * page without pulling three.js or the WebGPU engine into its bundle. The
 * galaxy imports from here too, so both surfaces render one component.
 *
 *   import { Reading, buildTopicContent } from '@aicolab/insight-bridge/reader'
 */

export {
	type AnalysisBlock,
	buildContainerContent,
	buildDocumentContent,
	buildSourceContent,
	buildTopicContent,
	type ContainerContentInput,
	type ContentVocabulary,
	type ContributorGroup,
	DEFAULT_CONTENT_VOCABULARY,
	type DocumentContentInput,
	type EngagedRow,
	type ParentMembership,
	type PerspectiveRow,
	type SourceContentInput,
	type StatChip,
	type TopicContentInput,
	type TopicLens,
} from './content-builders.ts'
export {
	createDetailSheet,
	type DetailLevel,
	type DetailSheet,
	type DetailSheetConfig,
	type ReadingView,
} from './detail-sheet.tsx'
export { Reading, type ReadingProps } from './reader.tsx'
export { DEFAULT_READING_SORT, type ReadingSort, ReadingSortControl, sortRows } from './sort-control.tsx'
export type {
	IBContentSection,
	IBDocumentRow,
	IBEntityRow,
	IBFacetRow,
	IBFlag,
	IBNodeContent,
	IBNodeId,
	IBNodeRow,
	IBPoint,
	IBQuote,
} from '../galaxy/types.ts'
