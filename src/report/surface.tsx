/**
 * What a report's pages need from their host, in one place: the run's words,
 * the host's position colours, what opening a reading means, and the host's
 * own link to each section — the package cannot know a route, so a host
 * (an app's router, the pipeline's run site, the hub's tabs) renders it.
 * Every page reads it from context, as the Brief reads its own surface.
 */
import type { RunWords } from '@aicolab/insight-bridge-contracts/explorer'
import { SITE_SECTIONS, type SiteSection } from '@aicolab/insight-bridge-contracts/site'
import type { MenuItemLinkProps } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { createContext, useContext } from 'solid-js'
import type { ReadingTarget } from '../explorer/readings.ts'

/** A report's sections, in the order its header lists them: the site contract's own. */
export const REPORT_SECTIONS = SITE_SECTIONS
export type ReportSection = SiteSection

export interface ReportSurface {
	words: RunWords
	/** The host's colour for each position (its palette). */
	positionColors: Readonly<Record<string, string>>
	/** Open a topic, a grouping node or a source in the host's reader. */
	open: (target: ReadingTarget) => void
	/**
	 * The host's own link to a section; to one custom analysis task's page when
	 * `taskId` names it. When it stands as a header menu's item it is also
	 * given what makes an anchor a menu item (ui-solid's MenuItemLinkProps:
	 * role, tabindex, style, data attributes, the click that closes the menu)
	 * and puts them on the anchor it renders.
	 */
	Link: (
		props: Partial<Omit<MenuItemLinkProps, 'class' | 'children'>> & {
			section: ReportSection
			taskId?: string
			class?: string
			children: JSX.Element
		},
	) => JSX.Element
	/** The host's own link to a page of the report's own (High Water's /campaigns), by its path on the report's site; a plain anchor to that path when absent. */
	Page?: (props: { to: string; class?: string; children: JSX.Element }) => JSX.Element
}

/** A page of the report's own, where the host has no link of its own: an anchor to its path. */
const PageAnchor = (props: { to: string; class?: string; children: JSX.Element }) => (
	<a href={props.to} class={props.class}>
		{props.children}
	</a>
)

/** Solid 2: the context object is the provider; the default-less form throws without one. */
export const ReportSurfaceContext = createContext<
	ReportSurface & { Page: NonNullable<ReportSurface['Page']> }
>()
export const useReportSurface = () => useContext(ReportSurfaceContext)

/** A page's surface for its subtree. A context value is read once, so its
 *  fields read through to the current props: a consumer reading them in JSX
 *  or a memo follows the host's surface wherever it changes. */
export function ReportSurfaceProvider(props: { surface: ReportSurface; children: JSX.Element }) {
	return (
		<ReportSurfaceContext
			value={{
				get words() {
					return props.surface.words
				},
				get positionColors() {
					return props.surface.positionColors
				},
				open: (target) => props.surface.open(target),
				get Link() {
					return props.surface.Link
				},
				get Page() {
					return props.surface.Page ?? PageAnchor
				},
			}}
		>
			{props.children}
		</ReportSurfaceContext>
	)
}

export const fmt = (v: number) => v.toLocaleString('en-AU')
export { cap } from '../grammar.ts'
