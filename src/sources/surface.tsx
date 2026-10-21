/**
 * What the source record needs from its host, in one place.
 *
 * The app passes this to `<SourcesPage>`; the filter bar, the counts line and
 * the pager read it from context rather than threading it through. It is the
 * whole of the per-app surface: the corpus's nouns, where the reader is, how
 * to move them, and what opening a row means.
 */
import type { JSX } from '@solidjs/web'
import { createContext, useContext } from 'solid-js'
import type { SourcesSurface } from './types.ts'

/**
 * Solid 2: the context object IS the provider component, and the
 * default-less form already throws when there is no provider above — so this
 * needs no re-throwing wrapper and `useContext` is typed `SourcesSurface`.
 */
export const SourcesSurfaceContext = createContext<SourcesSurface>()

export const useSourcesSurface = () => useContext(SourcesSurfaceContext)

/**
 * The page's surface for its subtree. A context value is read once, and the
 * reader's place (`search`) changes with every filter, so the value's fields
 * read through to the current props: every consumer reading them in JSX or a
 * memo stays live.
 */
export function SourcesSurfaceProvider(props: { surface: SourcesSurface; children: JSX.Element }) {
	return (
		<SourcesSurfaceContext
			value={{
				get vocabulary() {
					return props.surface.vocabulary
				},
				get search() {
					return props.surface.search
				},
				onSearch: (patch, kind) => props.surface.onSearch(patch, kind),
				openSource: (entityId) => props.surface.openSource(entityId),
			}}
		>
			{props.children}
		</SourcesSurfaceContext>
	)
}
