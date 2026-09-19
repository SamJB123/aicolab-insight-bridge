/** Shared, validated URL state. Page-specific filters remain on their own routes. */
export interface ReadingSearch {
	detail?: string
	document?: string
	section?: string
}

const text = (value: unknown, max = 300) =>
	typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined

export function readingSearch(search: Record<string, unknown>): ReadingSearch {
	const value = text(search.detail)
	const detail =
		value &&
		((/^(?:t|g[12]?):[1-9]\d*$/.test(value) &&
			Number.isSafeInteger(Number(value.slice(value.indexOf(':') + 1)))) ||
			/^[sfb]:.+/.test(value))
			? value
			: undefined
	return {
		detail,
		document: detail?.startsWith('s:') ? text(search.document) : undefined,
		section: detail ? text(search.section) : undefined,
	}
}

export function expandedSearch(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined
	const keys = [
		...new Set(
			value.filter((key): key is string => typeof key === 'string' && /^[tf]-[1-9]\d*$/.test(key)),
		),
	].slice(0, 100)
	return keys.length ? keys : undefined
}
