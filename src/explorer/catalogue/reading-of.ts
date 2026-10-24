/**
 * A drawer's reading, built once on the server (settled 2026-10-25): a topic, a grouping
 * node, a source or a document as the reader shows it, written with the run's words and
 * scale and with what the report adds from its own tables (its host's `readings`). The
 * catalogue's reading operations trim it to an agent's measure; the site's drawer and
 * galaxy fetch it whole through a server function, and the hub through the report's
 * door — one reading wherever it is shown.
 */
import type { RunWords } from '@aicolab/insight-bridge-contracts/explorer'
import { z } from 'zod'
import type { ReadingView } from '../../reader/reading-view.ts'
import { positionColors } from '../../site/palette.ts'
import * as x from '../data.ts'
import {
	documentReading,
	groupReading,
	type ReadingContext,
	sourceReading,
	topicReading,
} from '../readings.ts'
import type { ReportCtx } from './context.ts'

/** What every reading is written with: the run's words and scale colours, and the host's own words for the reader. */
export const readingContextOf = (ctx: ReportCtx): ReadingContext => {
	const w = ctx.run.words
	const own = ctx.host.readings
	return {
		words: w,
		positionColors: positionColors(w.scale),
		...(own?.vocabulary ? { vocabulary: own.vocabulary } : {}),
		...(own?.documentLabel ? { documentLabel: own.documentLabel } : {}),
		...(own?.documentOrder ? { documentOrder: own.documentOrder } : {}),
	}
}

/** The run's scale on a reading: its position mix's order and colours. */
const withScale = (view: ReadingView, w: RunWords): ReadingView => ({
	...view,
	mixOrder: w.scale.order,
	mixColors: positionColors(w.scale),
})

/** What a reading is of: a topic or grouping node by id, a source by its slug, uuid or one of its document ids, a document by id. */
export const readingTargetSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('topic'), key: z.number().int() }),
	z.object({ kind: z.literal('group'), key: z.number().int() }),
	z.object({ kind: z.literal('source'), key: z.string().min(1).max(200) }),
	z.object({ kind: z.literal('document'), key: z.string().min(1).max(200) }),
])
export type ReadingRequest = z.infer<typeof readingTargetSchema>

/** One reading, whole; null when the record has no such subject (or the reader's scope leaves it out), and for a topic confirmed as junk (settled 2026-10-25). */
export async function readingOf(
	ctx: ReportCtx,
	target: ReadingRequest,
): Promise<ReadingView | null> {
	const c = readingContextOf(ctx)
	const w = ctx.run.words
	const own = ctx.host.readings?.additions
	switch (target.kind) {
		case 'topic': {
			const d = await x.topicById(ctx.db, target.key, ctx.scope)
			return d && d.junkStatus !== 'confirmed'
				? withScale(topicReading(d, c, await own?.topic?.(d, ctx)), w)
				: null
		}
		case 'group': {
			const d = await x.groupById(ctx.db, target.key, ctx.scope)
			return d ? withScale(groupReading(d, c, await own?.group?.(d, ctx)), w) : null
		}
		case 'source': {
			const e = await x.entityByKey(ctx.db, target.key, ctx.scope)
			if (!e) return null
			const [only, ...more] = e.documentItems
			const sole =
				only && !more.length ? await x.documentById(ctx.db, only.documentId, ctx.scope) : null
			return withScale(sourceReading(e, sole, c, await own?.source?.(e, sole, ctx)), w)
		}
		case 'document': {
			const d = await x.documentById(ctx.db, target.key, ctx.scope)
			return d ? withScale(documentReading(d, c, await own?.document?.(d, ctx)), w) : null
		}
	}
}
