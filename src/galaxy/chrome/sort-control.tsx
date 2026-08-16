/**
 * The reader's ordering control (settled 2026-08-15): everywhere the galaxy
 * lists child nodes it offers A–Z and Reach, each REVERSIBLE — so the least
 * mainstream concerns are one tap away — and defaults to alphabetical. The
 * package never pre-ranks these lists (the Respect principles: how common a
 * view is in a corpus does not say how much it matters; that judgement
 * belongs to the reader).
 *
 * One Segmented: choosing the other key switches to it; choosing the ACTIVE
 * key flips its direction (the labels carry the current direction).
 */

import { Segmented } from '@aicolab/ui-solid'

export interface GalaxySort {
	key: 'alpha' | 'reach'
	dir: 'asc' | 'desc'
}

export const DEFAULT_GALAXY_SORT: GalaxySort = { key: 'alpha', dir: 'asc' }

/** Order `rows` by the reader's chosen sort. Alphabetical compares labels
 * (locale-aware); reach compares weights, label as the deterministic tie. */
export function sortRows<T>(
	rows: readonly T[],
	sort: GalaxySort,
	label: (row: T) => string,
	weight: (row: T) => number,
): T[] {
	const flip = sort.dir === 'desc' ? -1 : 1
	return [...rows].sort((a, b) => {
		if (sort.key === 'reach') {
			const byWeight = weight(a) - weight(b)
			if (byWeight !== 0) return byWeight * flip
		}
		return label(a).localeCompare(label(b)) * flip
	})
}

export function GalaxySortControl(props: {
	sort: GalaxySort
	onChange: (sort: GalaxySort) => void
	label?: string
}) {
	const alphaLabel = () => (props.sort.key === 'alpha' && props.sort.dir === 'desc' ? 'Z–A' : 'A–Z')
	const reachLabel = () =>
		props.sort.key === 'reach'
			? props.sort.dir === 'desc'
				? 'Most reach'
				: 'Least reach'
			: 'Reach'
	const choose = (key: 'alpha' | 'reach'): void => {
		if (props.sort.key === key) {
			props.onChange({ key, dir: props.sort.dir === 'asc' ? 'desc' : 'asc' })
		} else {
			// Fresh key starts at its natural reading: A–Z ascending, reach
			// descending (flip once for least-mainstream-first).
			props.onChange({ key, dir: key === 'alpha' ? 'asc' : 'desc' })
		}
	}
	return (
		<Segmented
			class="ib-galaxy-sort"
			label={props.label ?? 'Order'}
			options={[
				{ id: 'alpha', label: alphaLabel() },
				{ id: 'reach', label: reachLabel() },
			]}
			value={props.sort.key}
			onChange={choose}
			fontSize="0.68rem"
			tabPadBlock="0.18rem"
			tabPadInline="0.55rem"
		/>
	)
}
