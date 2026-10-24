/**
 * A reading as an app's adapter hands the sheet: the reader's content plus its chrome.
 * Declared as a schema so the report catalogue publishes a reading as an operation's
 * output from the same definition the detail sheet renders; plain TypeScript, no Solid,
 * so a server module imports it without the components.
 */
import { z } from 'zod'
import { ibFlagSchema, ibNodeContentSchema } from '../galaxy/types.ts'

export const readingViewSchema = z.object({
	eyebrow: z.string(),
	title: z.string(),
	detail: z.string().optional(),
	mix: z.record(z.string(), z.number()).optional(),
	flags: z.array(ibFlagSchema).optional(),
	content: ibNodeContentSchema,
	/** Set when this reading sits a level down — names the way back. */
	upLabel: z.string().optional(),
})
export type ReadingView = z.infer<typeof readingViewSchema>
