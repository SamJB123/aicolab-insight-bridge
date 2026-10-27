// A report island's room texts (core's `worldText`), as they are read: the
// writing a room's walls carry arrives when the room is built (its scene
// waits for it) and is kept for the visit, so the reading sheet opened from
// one of its walls reads the same words without asking again. One cache per
// island, keyed by whose room it is (a topic, a source, a cohort, a task);
// a text the door would not give is forgotten, so the next entry asks again.

import { type WorldText, type WorldTextRef, worldTextSchema } from '../world/index.ts'

export interface ReportTexts {
	/** The text of the room `ref` names: read once, then kept; null where the door gives none. */
	of(ref: WorldTextRef): Promise<WorldText | null>
}

const keyOf = (ref: WorldTextRef): string => {
	switch (ref.kind) {
		case 'topic':
			return `topic:${ref.topicId}`
		case 'source':
			return `source:${ref.sourceId}`
		case 'cohort':
			return `cohort:${ref.facet}:${ref.value}`
		case 'task':
			return `task:${ref.taskId}`
	}
}

/** The texts read through `read` (the host's door to the report), kept for the island's life. */
export function createReportTexts(read: (ref: WorldTextRef) => Promise<unknown>): ReportTexts {
	const kept = new Map<string, Promise<WorldText | null>>()
	return {
		of(ref) {
			const key = keyOf(ref)
			const have = kept.get(key)
			if (have) return have
			const reading = read(ref).then(
				(answer) => (answer == null ? null : worldTextSchema.parse(answer)),
				(err: unknown) => {
					console.error(`[report] the text of ${key} could not be read:`, err)
					kept.delete(key)
					return null
				},
			)
			kept.set(key, reading)
			return reading
		},
	}
}
