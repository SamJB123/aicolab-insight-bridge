/**
 * What a report adds to core's pages, as data (settled 2026-10-25). A report computes
 * its additions on the server — a note's numbers come from its own tables — through its
 * host's page hooks (explorer/catalogue `ReportHost.pages`); the site's loaders and the
 * door serve the same data, and core's pages render it, so any host shows any report
 * with core alone.
 *
 * Words are prose: a paragraph is a list of segments — plain text, bold, code, a link to
 * one of the report's sections or to a page of the host's own, and a source's name that
 * opens its reading (rendered by ./prose.tsx).
 */
import { siteSectionSchema } from '@aicolab/insight-bridge-contracts/site'
import { z } from 'zod'

export const proseSegmentSchema = z.union([
	z.string(),
	z.object({ strong: z.string() }).strict(),
	z.object({ code: z.string() }).strict(),
	/** A link to one of the report's sections; to a custom analysis task's page with `taskId`. */
	z
		.object({ text: z.string(), section: siteSectionSchema, taskId: z.string().optional() })
		.strict(),
	/** A link to a page of the report's own (High Water's /campaigns), by its path on the report's site. */
	z.object({ text: z.string(), page: z.string() }).strict(),
	/** A source's name: opens its reading, by its entity id. */
	z.object({ text: z.string(), source: z.string() }).strict(),
])
export type ProseSegment = z.infer<typeof proseSegmentSchema>

/** One paragraph (or list item) of a report's own words. */
export const proseSchema = z.array(proseSegmentSchema)
export type Prose = z.infer<typeof proseSchema>

/** Where a link card goes: one of the report's sections, or a page of the report's own. */
export const linkTargetSchema = z.union([
	z.object({ section: siteSectionSchema, taskId: z.string().optional() }).strict(),
	z.object({ page: z.string() }).strict(),
])
export type LinkTarget = z.infer<typeof linkTargetSchema>

/**
 * A block of a report's own content, in kinds any report may send (settled 2026-10-25):
 * a row of figures, a paragraph, link cards. Core draws each kind once and names no
 * report's block.
 */
export const blockSchema = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('figures'),
			items: z.array(z.object({ n: z.string(), l: z.string() }).strict()),
		})
		.strict(),
	z.object({ kind: z.literal('paragraph'), prose: proseSchema }).strict(),
	z
		.object({
			kind: z.literal('cards'),
			items: z.array(
				z
					.object({
						eyebrow: z.string(),
						title: z.string(),
						body: proseSchema,
						go: z.string(),
						to: linkTargetSchema,
					})
					.strict(),
			),
		})
		.strict(),
])
export type Block = z.infer<typeof blockSchema>

/** The overview's: notes under its headline figures, a sentence after the source, the facet its documents are counted by, the galaxy's poster beside the title, and blocks of its own after the doors. */
export const overviewAdditionsSchema = z.object({
	notes: z.object({ sources: z.string().optional(), documents: z.string().optional() }).optional(),
	/** The facet whose values `overview.documentsBy` counts, so they can be named. */
	documentFacet: z.string().optional(),
	/** Follows "The evidence came from …" — what the report's records promise about it. */
	sourceNote: z.string().optional(),
	/** The galaxy's poster, as a whole URL: drawn beside the title, opening the galaxy. */
	poster: z.string().optional(),
	/** The report's own blocks, after the doors. */
	blocks: z.array(blockSchema).optional(),
})
export type OverviewAdditions = z.infer<typeof overviewAdditionsSchema>

/** The Method page's: where the deployment serves its data from, the report's notes on its own record, and more closing chips. */
export const methodAdditionsSchema = z.object({
	/** After the opening account: where this deployment serves its data from. */
	serving: z.array(proseSchema).optional(),
	/** After the run's own notes: the report's notes on particular sources, one paragraph each. */
	notes: z.array(proseSchema).optional(),
	/** More figures for the closing chips. */
	chips: z.array(z.string()).optional(),
})
export type MethodAdditions = z.infer<typeof methodAdditionsSchema>

/** The Connect page's: more reading notes, one list item each — what only this record can say. */
export const connectAdditionsSchema = z.object({ notes: z.array(proseSchema).optional() })
export type ConnectAdditions = z.infer<typeof connectAdditionsSchema>
