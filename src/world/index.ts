/**
 * @aicolab/insight-bridge/world — a report as an island.
 *
 * The CONTRACT only (zod schema, types, pure helpers): what a report island
 * is built from. Light enough for a browser or a relay. A server that READS
 * the record off a run takes `@aicolab/insight-bridge/world/record`, which
 * reaches drizzle and the canonical tables.
 */
export {
	isPromptTask,
	MEMBERSHIP_GRADES,
	PROMPT_TASK_KINDS,
	questionClause,
	type WorldAnswer,
	type WorldAnswerText,
	type WorldDocument,
	type WorldFacet,
	type WorldGroup,
	type WorldLens,
	type WorldLensText,
	type WorldMembership,
	type WorldPerspective,
	type WorldPerspectiveText,
	type WorldPoint,
	type WorldPrompt,
	type WorldPromptTask,
	type WorldQuote,
	type WorldReading,
	type WorldReadingRef,
	type WorldRecord,
	type WorldSite,
	type WorldSource,
	type WorldTask,
	type WorldText,
	type WorldTextRef,
	type WorldTopic,
	worldReadingRefSchema,
	worldReadingSchema,
	worldRecordSchema,
	worldTextRefSchema,
	worldTextSchema,
} from './schema.ts'
