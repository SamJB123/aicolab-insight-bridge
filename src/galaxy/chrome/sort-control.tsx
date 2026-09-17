/**
 * The galaxy's ordering control IS the reader's (moved to ../../reader on
 * 2026-09-14 when the app drawers adopted the shared reading). The galaxy's
 * own names stay as aliases for the drill.
 */

export {
	DEFAULT_READING_SORT as DEFAULT_GALAXY_SORT,
	ReadingSortControl as GalaxySortControl,
	type ReadingSort as GalaxySort,
	sortRows,
} from '../../reader/sort-control.tsx'
