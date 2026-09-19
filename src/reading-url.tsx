import { readingSearch, expandedSearch, type ReadingSearch } from './reading-search'
export { readingSearch, expandedSearch, type ReadingSearch } from './reading-search'

import { createEffect, createSignal, onCleanup, onSettled, untrack } from 'solid-js'
import { useLocation, useRouter, type AnyRouter } from '@tanstack/solid-router'

/** Created alongside the drawer store; mounted once inside its ClientOnly boundary. */
export function createReadingUrlBridge(restore: (search: ReadingSearch) => void) {
	let write: ((search: ReadingSearch) => void) | undefined
	return {
		change: (search: ReadingSearch) => write?.(search),
		Sync() {
			const location = useLocation()
			const navigation = useReadingNavigation()
			const [ready, setReady] = createSignal(false)
			onSettled(() => {
				setReady(true)
			})
			write = navigation.change
			onCleanup(() => {
				write = undefined
				untrack(() => restore({}))
			})
			createEffect(
				() => ({
					ready: ready(),
					path: location().pathname,
					search: readingSearch(location().search),
				}),
				({ ready, path, search }) => {
					if (ready) untrack(() => restore(path === '/galaxy' ? {} : search))
				},
			)
			return null
		},
	}
}

/** Router-backed state shared by the Brief, Galaxy and detail drawers. */
export function useReadingNavigation() {
	const location = useLocation()
	const router = useRouter<AnyRouter>()
	const change = (patch: ReadingSearch & { expanded?: string[] }, hash?: string) => {
		void router.navigate<AnyRouter, '.'>({
			to: '.',
			search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }),
			hash: (prev) => hash ?? prev ?? '',
			replace: true,
			resetScroll: false,
			hashScrollIntoView: false,
		})
	}
	return {
		change,
		brief: {
			get expandedChapters() {
				return expandedSearch(location().search.expanded) ?? []
			},
			onExpandedChaptersChange(expanded: string[]) {
				const previous = expandedSearch(location().search.expanded) ?? []
				change(
					{ expanded: expanded.length ? expanded : undefined },
					expanded.find((key) => !previous.includes(key)),
				)
			},
		},
		galaxy: {
			get navigation() {
				const search = readingSearch(location().search)
				return { nodeId: search.detail, documentId: search.document }
			},
			onNavigationChange(state: { nodeId?: string; documentId?: string }) {
				change({ detail: state.nodeId, document: state.documentId, section: undefined })
			},
			get section() {
				return readingSearch(location().search).section
			},
			onSectionChange(section: string | undefined) {
				change({ section })
			},
		},
	}
}
