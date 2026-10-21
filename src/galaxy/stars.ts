/**
 * Bake every topic's place in the sky into the rows `topic_star` holds, so a
 * page can draw a still constellation as plain SVG — no WebGPU, no client-side
 * solve. One bake for every host (2026-10-21: the pipeline's run store and
 * Training Data's bake script each carried their own): a run's store bakes
 * after its build, an app's script after its ETL, both from core's `galaxy`
 * read, so the constellation and the live galaxy are the same sky by
 * construction.
 *
 * Deterministic: the layout is seeded, so the same corpus bakes the same sky.
 * Positions are the disc plane (x, z) normalised 0..1 across the corpus with a
 * small margin; radius is normalised 0..1 across the topics.
 */
import type { GalaxyData } from '@aicolab/insight-bridge-contracts/explorer'
import { galaxyFromData } from './from-data.ts'
import { bakeGalaxyLayout } from './layout/cosmos.ts'

/** Margin left around the constellation so no star sits on the frame. */
const PAD = 0.03

export interface TopicStar {
	topicClusterId: number
	x: number
	y: number
	r: number
}

/** One row per topic, normalised; none when the corpus has no topics (no sky is not an error). */
export function bakeTopicStars(data: GalaxyData): TopicStar[] {
	const topics = data.nodes.filter((n) => n.tier === 0)
	if (!topics.length) return []
	const layout = bakeGalaxyLayout(galaxyFromData(data))
	const placed = topics.flatMap((topic) => {
		const i = layout.index.get(topic.id)
		if (i === undefined) return []
		return [
			{
				topicClusterId: Number(topic.key),
				x: layout.positions[i * 3] ?? 0,
				y: layout.positions[i * 3 + 2] ?? 0,
				r: layout.radii[i] ?? 0,
			},
		]
	})
	if (!placed.length) return []
	const xs = placed.map((p) => p.x)
	const ys = placed.map((p) => p.y)
	const maxR = Math.max(...placed.map((p) => p.r)) || 1
	const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
	const norm = (v: number, lo: number, hi: number) =>
		PAD + ((v - lo) / (hi - lo || 1)) * (1 - 2 * PAD)
	return placed.map((p) => ({
		topicClusterId: p.topicClusterId,
		x: norm(p.x, x0, x1),
		y: norm(p.y, y0, y1),
		r: p.r / maxR,
	}))
}
