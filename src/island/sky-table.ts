// The SKY TABLE at the square's heart: the record as a sky, every topic
// a star at its baked place — the report's galaxy, whose place it is, and
// the one thing on its island the report draws itself (scenes/owner.ts).
// What the declaration says of it (@aicolab/atlas square-declaration.ts
// SquareHeartSpec) and what the oracle plan stands there (an IslandOwned)
// are said once here.
//
// Worker-safe: content only.

import type { IslandOwned, IslandPlaza } from '@aicolab/atlas/chessboard/content/island/plan.ts'
import type { SquareHeartSpec } from '@aicolab/atlas/chessboard/content/island/square-declaration.ts'
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

/** What the report is told to draw: the table's radius and the stars. */
export const skyTableDrawn = (radius: number, stars: readonly SkyStar[]) => ({
	by: REPORT_OWNER,
	model: SKY_TABLE_ID,
	props: { radius, stars: stars.map((star) => ({ ...star })) },
})

/** The sky table as the declaration stands it at the square's heart: the
 *  report's galaxy, whose place it is. */
export const skyTableHeart = (record: WorldRecord | null): SquareHeartSpec => ({
	id: SKY_TABLE_ID,
	label: SKY_TABLE_WORDS.label,
	description: SKY_TABLE_WORDS.description,
	radius: SKY_TABLE_RADIUS,
	drawn: skyTableDrawn(SKY_TABLE_RADIUS, starsOf(record)),
	place: 'galaxy',
})

/** The sky table as the oracle plan stands it: what the realisation reads
 *  back from the declaration's feature. */
export const skyTableOwned = (plaza: IslandPlaza, stars: readonly SkyStar[]): IslandOwned => {
	const drawn = skyTableDrawn(SKY_TABLE_RADIUS, stars)
	return {
		id: SKY_TABLE_ID,
		owner: drawn.by,
		model: drawn.model,
		props: drawn.props,
		label: SKY_TABLE_WORDS.label,
		description: SKY_TABLE_WORDS.description,
		position: plaza.centre,
		yaw: 0,
		ground: null,
		radius: SKY_TABLE_RADIUS,
		door: null,
		words: { type: 'infrastructure', class: 'artwork' },
	}
}
