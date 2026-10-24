/**
 * The report's one reader as a view: a reading (what `topic_reading`, `group_reading`,
 * `source_reading` and `document_reading` answer) rendered with the shared Reading, the
 * component every report's drawer and the galaxy's rail render. Written against app-kit's
 * `ViewHost` only, so the same component is the MCP App a model host renders and a page a
 * report serves over the socket's capability object. Where the host lets the view call the
 * report, a row opens its reading in place, on a stack with a way back; where it does not,
 * rows are text. A result that is not a reading is shown as its JSON.
 */
import type { ViewHost } from '@aicolab/app-kit/solid/view-host'
import { createMemo, createSignal, Show } from 'solid-js'
import { parseNodeId } from '../explorer/readings.ts'
import type { IBDocumentRow, IBNodeId } from '../galaxy/types.ts'
import { Reading } from './reader.tsx'
import { type ReadingView, readingViewSchema } from './reading-view.ts'

/** The pages opened from inside the view, belonging to the result they were opened from. */
interface Opened {
	base: unknown
	pages: ReadingView[]
}

const readingOf = (result: unknown): ReadingView | null => {
	const parsed = readingViewSchema.safeParse(result)
	return parsed.success ? parsed.data : null
}

export function ReportReadingView(props: { host: ViewHost; result: unknown }) {
	const [opened, setOpened] = createSignal<Opened>({ base: undefined, pages: [] })
	const [busy, setBusy] = createSignal<string | null>(null)
	const [problem, setProblem] = createSignal<string | null>(null)
	const stack = createMemo(() => (opened().base === props.result ? opened().pages : []))
	const base = createMemo(() => readingOf(props.result))
	const current = createMemo(() => stack().at(-1) ?? base())

	const open = async (name: string, input: Record<string, unknown>, label: string) => {
		if (!props.host.canCall()) return
		setBusy(label)
		setProblem(null)
		try {
			const next = readingOf(await props.host.call(name, input))
			if (next) setOpened({ base: props.result, pages: [...stack(), next] })
			else setProblem(`${name} answered something that is not a reading`)
		} catch (error) {
			setProblem(error instanceof Error ? error.message : String(error))
		} finally {
			setBusy(null)
		}
	}
	const visit = (id: IBNodeId) => {
		const target = parseNodeId(id)
		if (!target) return
		if (target.kind === 'topic') void open('topic_reading', { topic_id: target.key }, id)
		else if (target.kind === 'group')
			void open('group_reading', { supercluster_id: target.key }, id)
		else void open('source_reading', { source: target.key }, id)
	}
	const openDocument = (row: IBDocumentRow) =>
		void open('document_reading', { document_id: row.documentId }, row.label)
	const back = () => setOpened({ base: props.result, pages: stack().slice(0, -1) })

	return (
		<article class="ib-report-view">
			<Show when={problem()}>{(text) => <p class="ib-report-view-problem">{text()}</p>}</Show>
			<Show when={busy()}>{(label) => <p class="ib-report-view-busy">Opening {label()}…</p>}</Show>
			<Show
				when={current()}
				fallback={
					<pre class="ib-report-view-raw">
						{props.result === undefined
							? 'Waiting for the report…'
							: JSON.stringify(props.result, null, 1)}
					</pre>
				}
			>
				{(view) => (
					<Reading
						eyebrow={view().eyebrow}
						title={view().title}
						detail={view().detail}
						mix={view().mix}
						mixOrder={view().mixOrder}
						mixColors={view().mixColors}
						flags={view().flags}
						content={() => view().content}
						onVisit={visit}
						onOpenDocument={props.host.canCall() ? openDocument : undefined}
						upLabel={stack().length > 0 ? (stack().at(-2) ?? base())?.title : undefined}
						onUp={stack().length > 0 ? back : undefined}
					/>
				)}
			</Show>
		</article>
	)
}
