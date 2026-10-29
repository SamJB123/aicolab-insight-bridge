// The SKY TABLE at the square's heart: the record as a sky, every topic
// a star at its baked place — the report's galaxy, whose place it is, and
// the one thing on its island the report draws itself (scenes/owner.ts).
// What the island says of it (hex-island.ts: the heart at the square's
// centre, told its radius and the stars) is said in these words.
//
// Worker-safe: content only.

import type { WorldRecord } from '../world/index.ts'

/** The accent a topic burns in: its star on the sky table, its rooms in
 *  the Hall (world.ts reads it from here). */
export const TOPIC_ACCENT = '#d9a441'

/** The stars the record is, as the sky table shows them. */
export interface SkyStar {
	x: number
	y: number
	r: number
	accent: string
	label: string
}

/** The record as a sky: every topic a star at its baked place. */
export const starsOf = (record: WorldRecord | null): SkyStar[] =>
	(record?.topics ?? []).flatMap((t) =>
		t.star ? [{ x: t.star.x, y: t.star.y, r: t.star.r, accent: TOPIC_ACCENT, label: t.title }] : [],
	)

/** The owner the report is to its island (owners.ts), and its one model. */
export const REPORT_OWNER = 'report'
export const SKY_TABLE_ID = 'sky-table'
/** The table's radius: the disc it claims at the square's heart. */
export const SKY_TABLE_RADIUS = 3.2
export const SKY_TABLE_WORDS = {
	label: 'Galaxy',
	description: 'The record as a sky: every topic a star. Ask it the way to any of them.',
} as const
