/**
 * The detail sheet — the app-side host for the Reading. Any view calls
 * `openDrawer(selection)` from a click handler; the single `<DetailDrawer/>`
 * resolves that selection into a READING through the app's own adapter and
 * renders it with the shared reader inside ui-solid's AdaptiveModalSheet.
 *
 * The sheet owns everything that was being copied per app (settled
 * 2026-09-16, when four apps were found running the same 122-line file that
 * differed only in its nouns): the selection store, the opener-focus
 * restore, the document level with its named way back, routing a reading's
 * row actions back into a new selection, and the AdaptiveModalSheet itself
 * (a native top-layer dialog — modality, Escape, focus containment and the
 * backdrop are the platform's).
 *
 * The APP owns what a selection is and how to load it, so a corpus whose
 * drawer keys a family by name or splits a kind per generation configures
 * that here rather than forking the sheet. `S` is the app's own selection
 * union.
 *
 * STYLING IS THE HOST'S, deliberately, and unlike the structure tree: this
 * renders the `dw`, `dw-loading`, `dw-chip`, `dw-dot` and `cite` classes that
 * every consuming app already defines and also uses in its own prose and
 * browsers, and several apps flavour differently on purpose. The sheet
 * therefore ships no stylesheet of its own.
 */
import { AdaptiveModalSheet } from '@aicolab/ui-solid'
import { type JSX, Loading } from '@solidjs/web'
import { createMemo, createSignal, Show } from 'solid-js'
import type { IBFlag, IBNodeContent, IBNodeId } from '../galaxy/types.ts'
import { Reading } from './reader.tsx'

/** What an app's adapter hands the sheet: the reader's content plus its chrome. */
export interface ReadingView {
	eyebrow: string
	title: string
	detail?: string
	mix?: Record<string, number>
	flags?: IBFlag[]
	content: IBNodeContent
	/** Set when this reading sits a level down — names the way back. */
	upLabel?: string
}

/** One document of a multi-document source, read on its own. */
export type DetailLevel = { kind: 'document'; documentId: string; label: string }

export interface DetailSheetConfig<S> {
	/** The app's readings. `level` is set when a documents row was chosen. */
	load: (selection: S, level: DetailLevel | null) => Promise<ReadingView | null>
	/** A reading's row action carries a node id; turn it into a selection. */
	parseNodeId: (id: IBNodeId) => S | null
	/** What the sheet's header calls the current selection. */
	kindLabel: (selection: S, level: DetailLevel | null) => string
	/** What a row action offers — "Open the submitter →". */
	visitLabel?: (id: IBNodeId | undefined) => string
	/** The corpus's position vocabulary, for the mix strip and PositionChip. */
	mixOrder: string[]
	mixColors: Record<string, string>
	/** Build a selection from a source key, for `openSource` and `<Cite>`. */
	sourceSelection?: (key: string) => S
	/** Tooltip on an inline citation — "Open this submitter". */
	citeTitle?: string
}

export interface DetailSheet<S> {
	openDrawer: (selection: S) => void
	closeDrawer: () => void
	/** Cite a source by its key. Throws if no `sourceSelection` was configured. */
	openSource: (key: string) => void
	selection: () => S | null
	DetailDrawer: () => JSX.Element
	/** Inline citation of a source, for prose. */
	Cite: (props: { id: string; label?: string; muted?: boolean }) => JSX.Element
	PositionChip: (props: { position: string | null }) => JSX.Element
}

export function createDetailSheet<S>(config: DetailSheetConfig<S>): DetailSheet<S> {
	const [selection, setSelection] = createSignal<S | null>(null)
	const [level, setLevel] = createSignal<DetailLevel | null>(null)
	let opener: HTMLElement | null = null

	const openDrawer = (s: S) => {
		const active = document.activeElement
		opener = active instanceof HTMLElement ? active : null
		setLevel(null)
		setSelection(() => s)
	}
	const closeDrawer = () => {
		setSelection(null)
		setLevel(null)
		opener?.focus?.()
		opener = null
	}
	const openSource = (key: string) => {
		if (!config.sourceSelection)
			throw new Error('createDetailSheet: openSource needs a `sourceSelection` in the config')
		openDrawer(config.sourceSelection(key))
	}

	const Cite = (props: { id: string; label?: string; muted?: boolean }) => (
		<button
			type="button"
			class={['cite', { 'cite-muted': !!props.muted }]}
			onClick={() => openSource(props.id)}
			title={config.citeTitle}
		>
			{props.label ?? props.id}
		</button>
	)

	const PositionChip = (props: { position: string | null }) => (
		<span class="dw-chip">
			<span
				class="dw-dot"
				style={{
					background: config.mixColors[props.position ?? ''] ?? 'var(--color-base-content-faint)',
				}}
			/>
			{props.position ?? 'no stance written'}
		</span>
	)

	const DetailDrawer = () => {
		const view = createMemo(() => {
			const s = selection()
			return s === null ? null : config.load(s, level())
		})
		const title = () => {
			const s = selection()
			return s === null ? '' : config.kindLabel(s, level())
		}
		const visit = (id: string) => {
			const target = config.parseNodeId(id)
			if (target !== null) openDrawer(target)
		}
		return (
			<AdaptiveModalSheet
				open={selection() !== null}
				label="Detail"
				eyebrow="From the record"
				title={title()}
				onDismiss={closeDrawer}
				scrollLabel="Detail content"
				class="dw-sheet"
			>
				<Show when={selection() !== null}>
					<div class="dw">
						<Loading fallback={<div class="dw-loading">Reading the record…</div>}>
							<Show
								when={view()}
								fallback={<div class="dw-loading">Nothing in the record for this selection.</div>}
							>
								{(v) => (
									<Reading
										eyebrow={v().eyebrow}
										title={v().title}
										detail={v().detail}
										mix={v().mix}
										mixOrder={config.mixOrder}
										mixColors={config.mixColors}
										flags={v().flags}
										content={() => v().content}
										onVisit={visit}
										onOpenDocument={(row) =>
											setLevel({ kind: 'document', documentId: row.documentId, label: row.label })
										}
										upLabel={v().upLabel}
										onUp={() => setLevel(null)}
										visitLabel={
											config.visitLabel ? (row) => config.visitLabel?.(row.id) ?? '' : undefined
										}
									/>
								)}
							</Show>
						</Loading>
					</div>
				</Show>
			</AdaptiveModalSheet>
		)
	}

	return { openDrawer, closeDrawer, openSource, selection, DetailDrawer, Cite, PositionChip }
}
