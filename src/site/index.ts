/**
 * @aicolab/insight-bridge/site — the reading site's frame.
 *
 * A corpus explorer is a masthead, a scrolling pane and a handful of figure
 * primitives, and every one of them had been written twice by 2026-09-17 (First
 * Resort and Longform carry ~2,600 near-identical lines each). The pipeline
 * zone's generated run sites are the third consumer, so the frame moves here
 * rather than being copied again.
 *
 *   import { SiteShell, StatTiles, BarList } from '@aicolab/insight-bridge/site'
 *   import '@aicolab/insight-bridge/site.css'
 *
 * The stylesheet is a SEPARATE import and keeps the apps' own class names
 * (`.mast`, `.view-wrap`, `.sec`, `.fig`, `.door`), so adopting it is deleting a
 * copy rather than renaming markup.
 *
 * A theme is the host's: import one (`@aicolab/ui-solid/themes/night-ochre.css`
 * is the default for generated sites) and load its font files. Nothing here
 * carries a palette.
 */
export { BarList, type BarRow, DoorCard, SectionHead, StatTiles } from './figures.tsx'
export { SiteShell, type SiteShellProps } from './SiteShell.tsx'
