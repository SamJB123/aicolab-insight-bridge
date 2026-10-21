/// <reference types="node" />
/**
 * How every report's D1 is made from its pipeline run — node-only, for an
 * app's scripts (never its Worker): prepare the run (`prepareRun`), bake its
 * stars (`bakeStars`), seed the D1 (`seedD1`), with the two derived tables
 * every report carries (`docDominantTopic`, `chunkPrimaryTopic`, which an
 * app's schema re-exports). An app supplies its site's words, its galaxy's
 * options and its own layers; nothing else of it is per app.
 */
export { type SeedOptions, seedD1 } from './load.ts'
export { count, type PrepareOptions, prepareRun, type Row, requiredPath, rows } from './run.ts'
export { bakeStars, type GalaxyOptions } from './stars.ts'
export { chunkPrimaryTopic, docDominantTopic } from './tables.ts'
