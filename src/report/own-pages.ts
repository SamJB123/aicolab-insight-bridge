/**
 * A report's own pages, as data: what a host needs to list a page of the report's own
 * (High Water's Top 30, Watchful State's Explorer) in the report's header — its path on
 * the report's site, its label, the section it follows and the menu it folds into.
 * Declared once by the report (its host's `ownPages`, explorer/catalogue `ReportHost`)
 * and served through its door beside the run's words (`navPage`), so the report's site
 * and the hub list the same entries. Plain TypeScript: a server module reads it without
 * the header's components.
 */
import { siteSectionSchema } from '@aicolab/insight-bridge-contracts/site'
import { z } from 'zod'

/** A page of the host's own in the header, after the section it names. */
export const hostNavItemSchema = z
	.object({
		/** The host's path for it. */
		to: z.string(),
		label: z.string(),
		/** The section it follows; after the last task's entry when `analysis`. */
		after: siteSectionSchema,
		/**
		 * A header menu to fold it into, by that menu's label: the pages naming the same
		 * menu become one entry, where the first of them stands, so a host with many pages
		 * of its own keeps the row to one line (the audit corpus's eleven, the user's choice
		 * 2026-10-22). The phone menu lists each page.
		 */
		menu: z.string().optional(),
	})
	.strict()
export type HostNavItem = z.infer<typeof hostNavItemSchema>
