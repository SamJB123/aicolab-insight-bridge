/** @jsxImportSource @solidjs/web */
// The reading sheet of a report island: an item off a wall — a source's
// perspective, a facet's lens, a key point, a document, an answer — read
// through the Insight Bridge reader, the same component the report's own
// site reads with. Its words are its room's text (the room read it as it
// was built, so it is at hand: `words`), its key points and quotes are its
// reading, read through the report's door (../program.ts reportReading)
// when the sheet opens. Every room the item speaks of is a chip: choosing
// one walks you there.

import { AdaptiveModalSheet } from '@aicolab/ui-solid'
import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import { type IBNodeContent, type IBPoint, Reading } from '../../reader/index.ts'
import {
	type WorldReading,
	type WorldReadingRef,
	type WorldRecord,
	worldReadingSchema,
} from '../../world/index.ts'
import type { ReportItem } from '../world.ts'

/** One item's reading, as the host reads it through the report's door. */
export type ReadingDoor = (ref: WorldReadingRef) => Promise<WorldReading | null>

async function readingOf(read: ReadingDoor, item: ReportItem): Promise<WorldReading | null> {
	if (!item.reading) return null
	const answered = await read(item.reading)
	if (!answered) throw new Error('the reading could not be read through the report’s door')
	return worldReadingSchema.parse(answered)
}

export function ReportSheet(props: {
	item: ReportItem | null
	record: WorldRecord | null
	/** The item as its room's text writes it (the item itself where it has no text). */
	words: (item: ReportItem) => Promise<ReportItem>
	/** The report's readings, through its door. */
	reading: ReadingDoor
	onVisit(spaceId: string): void
	onClose(): void
}) {
	const nameOf = (sourceId: string | null): string | undefined =>
		sourceId ? props.record?.sources.find((s) => s.id === sourceId)?.name : undefined
	/** The item open, as its text writes it once that is read (the record's words until then). */
	const [written, setWritten] = createSignal<ReportItem | null>(null)
	createEffect(
		() => props.item,
		(item) => {
			setWritten(item)
			if (!item) return
			let gone = false
			props.words(item).then(
				(words) => {
					if (!gone) setWritten(words)
				},
				(err: unknown) => console.error('[report] the item’s words could not be read:', err),
			)
			return () => {
				gone = true
			}
		},
	)
	/** The content, loaded when an item opens (Solid 2 async idiom: a memo
	 *  over a promise, rendered inside the reader's own Loading boundary). */
	const content = createMemo(() => {
		const item = props.item
		if (!item) return null
		return Promise.all([props.words(item), readingOf(props.reading, item)]).then(
			([words, reading]): IBNodeContent => {
				const quoted = (q: { text: string; source: string | null }) => ({
					text: q.text,
					source: nameOf(q.source),
				})
				const points: IBPoint[] = (reading?.keyPoints ?? []).map((kp) => ({
					text: kp.point,
					detail: kp.details || undefined,
					quotes: kp.quotes.map(quoted),
				}))
				const quotes = [...words.quotes, ...(reading?.quotes ?? [])].map(quoted)
				const sections: IBNodeContent['sections'] = []
				if (points.length > 0) sections.push({ kind: 'points', title: 'Key points', points })
				if (quotes.length > 0) {
					sections.push({
						kind: 'points',
						title: points.length > 0 ? 'In their words' : 'What they said',
						points: [{ text: '', quotes }],
					})
				}
				return {
					lede: words.lede || undefined,
					stats: words.position ? [{ label: 'position', value: words.position }] : undefined,
					sections,
					related: words.visits.map((v) => ({ id: v.spaceId, label: v.label })),
				}
			},
		)
	})
	return (
		<AdaptiveModalSheet
			open={props.item !== null}
			label="Reading"
			eyebrow={written()?.eyebrow ?? ''}
			title={written()?.title ?? ''}
			onDismiss={() => props.onClose()}
		>
			<div class="cb-report">
				<Show when={props.item} keyed>
					{(item) => (
						<Reading
							eyebrow={written()?.eyebrow ?? item.eyebrow}
							title={written()?.title ?? item.title}
							detail={written()?.detail ?? item.detail}
							content={() => content()}
							onVisit={(id) => props.onVisit(String(id))}
							errorLabel="The reading could not be fetched"
						/>
					)}
				</Show>
			</div>
		</AdaptiveModalSheet>
	)
}
