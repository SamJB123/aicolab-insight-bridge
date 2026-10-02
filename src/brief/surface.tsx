/**
 * What the Brief needs from its host, in one place.
 *
 * The app passes this to `<BriefPage>`; everything below reads it from
 * context rather than threading it through four levels of component. It is
 * the whole of the per-app surface: the corpus's nouns, its position colours,
 * what opening a node means, and how to fetch a chapter's reading.
 */
import { createContext, useContext } from 'solid-js'
import type { BriefVocabulary, ChapterReading } from './types.ts'

export interface BriefSurface {
	/**
	 * Optional URL-owned folded chapters, as an ACCESSOR. Omit to keep local
	 * state.
	 *
	 * An accessor, not a value, on purpose (Solid 2): the surface is handed to
	 * a context, which captures the object once, so anything that changes
	 * over the page's life must be read lazily through a function. A function
	 * also survives being copied — a host that spreads a navigation helper
	 * into this object copies the accessor by reference, where a plain value
	 * or a getter would be snapshotted at the moment of the spread.
	 */
	expandedChapters?: () => string[]
	onExpandedChaptersChange?: (keys: string[]) => void
	vocabulary: BriefVocabulary
	/** The position vocabulary in canonical order, supportive first. */
	positions: string[]
	positionColors: Record<string, string>
	openTopic: (topicClusterId: number) => void
	openGroup: (superclusterId: number) => void
	openSource: (entityId: string) => void
	/** A chapter's reading: every declared facet's pins, points and pushback. */
	loadReading: (
		chapterId: number,
		topicIds: number[],
		full: boolean,
	) => Promise<ChapterReading | null>
}

/**
 * Solid 2: the context object IS the provider component, and the
 * default-less form already throws when there is no provider above — so this
 * needs no re-throwing wrapper and `useContext` is typed `BriefSurface`.
 */
export const BriefSurfaceContext = createContext<BriefSurface>()

export const useBriefSurface = () => useContext(BriefSurfaceContext)

export const n = (v: number | undefined | null) => (v == null ? '—' : v.toLocaleString('en-US'))
export const plural = (v: number, one: string, many = `${one}s`) =>
	`${n(v)} ${v === 1 ? one : many}`
