/**
 * A report's own words on its pages (./additions.ts `Prose`), rendered through the
 * report's surface: bold, code, a link to a section or to a page of the report's own,
 * and a source's name that opens its reading.
 */
import { Dynamic } from '@solidjs/web'
import { For } from 'solid-js'
import type { Prose } from './additions.ts'
import { useReportSurface } from './surface.tsx'

/** One paragraph's segments (inside the `<p>` or `<li>` the page draws). */
export function ProseText(props: { prose: Prose }) {
	const s = useReportSurface()
	return (
		<For each={props.prose}>
			{(segment) => {
				if (typeof segment === 'string') return segment
				if ('strong' in segment) return <strong>{segment.strong}</strong>
				if ('code' in segment) return <code>{segment.code}</code>
				if ('section' in segment)
					return (
						<s.Link
							section={segment.section}
							{...(segment.taskId ? { taskId: segment.taskId } : {})}
							class="dw-inline-link"
						>
							{segment.text}
						</s.Link>
					)
				if ('page' in segment)
					return (
						<Dynamic component={s.Page} to={segment.page} class="dw-inline-link">
							{segment.text}
						</Dynamic>
					)
				return (
					<button
						type="button"
						class="dw-inline-link"
						onClick={() => s.open({ kind: 'source', key: segment.source })}
					>
						{segment.text}
					</button>
				)
			}}
		</For>
	)
}
