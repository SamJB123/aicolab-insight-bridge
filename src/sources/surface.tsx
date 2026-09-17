/**
 * What the source record needs from its host, in one place.
 *
 * The app passes this to `<SourcesPage>`; the filter bar, the counts line and
 * the pager read it from context rather than threading it through. It is the
 * whole of the per-app surface: the corpus's nouns, where the reader is, how
 * to move them, and what opening a row means.
 */
import { createContext, useContext } from 'solid-js'
import type { SourcesSurface } from './types.ts'

/**
 * Solid 2: the context object IS the provider component, and the
 * default-less form already throws when there is no provider above — so this
 * needs no re-throwing wrapper and `useContext` is typed `SourcesSurface`.
 */
export const SourcesSurfaceContext = createContext<SourcesSurface>()

export const useSourcesSurface = () => useContext(SourcesSurfaceContext)
