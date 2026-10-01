/**
 * @aicolab/insight-bridge/world — a report as an island.
 *
 * The CONTRACT only (zod schema, types, pure helpers): what a report island
 * is built from. Light enough for a browser or a relay. A server that READS
 * the record off a run takes `@aicolab/insight-bridge/world/record`, which
 * reaches drizzle and the canonical tables.
 */
export {
	MEMBERSHIP_GRADES,
	questionClause,
	type WorldAnswer,
	type WorldDocument,
	type WorldFacet,
	type WorldGroup,
	type WorldLens,
	type WorldMembership,
	type WorldPerspective,
	type WorldPoint,
	type WorldQuestion,
	type WorldQuote,
	type WorldReading,
	type WorldReadingRef,
	type WorldRecord,
	type WorldSite,
	type WorldSource,
	type WorldTask,
	type WorldTopic,
	worldGenerationLabel,
	worldReadingRefSchema,
	worldReadingSchema,
	worldRecordSchema,
} from './schema.ts'
