/// <reference types="node" />
/**
 * Bake every topic's place in the sky ONCE per run, into the prepared sqlite's
 * canonical `topic_star` table, so reading pages can draw a still
 * constellation of the topics as plain SVG — no WebGPU, no client-side solve.
 *
 * The same galaxy the report's /galaxy page draws, by construction: core's
 * one galaxy read (explorer/pages `galaxy`, with the app's seed and facets) and
 * core's one bake (galaxy/stars `bakeTopicStars`). The bake reads the whole
 * record: a reader's scope changes what is shown, never where a topic sits.
 */
import { writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { RunWords } from '@aicolab/insight-bridge-contracts/explorer'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { runWords } from '../explorer/data.ts'
import { galaxy } from '../explorer/pages.ts'
import { bakeTopicStars } from '../galaxy/stars.ts'

/** The galaxy's options, as the app's /galaxy page passes them (from the run's words). */
export type GalaxyOptions = (words: RunWords) => {
	seed: number
	facets: { key: string; label: string }[]
}

/**
 * Bake the stars into `prepared`. With `--export-galaxy=<file>` on the command
 * line, write the galaxy read to that file as JSON instead, and bake nothing.
 */
export async function bakeStars(
	prepared: string,
	options: GalaxyOptions,
	argv: readonly string[] = [],
): Promise<void> {
	const exportTo = argv
		.find((a) => a.startsWith('--export-galaxy='))
		?.slice('--export-galaxy='.length)
	const client = new DatabaseSync(prepared, { readOnly: Boolean(exportTo) })
	console.info(`bake-stars: ${prepared}`)
	const db = drizzle({ client })
	const words = await runWords(db)
	const data = await galaxy(db, words, options(words))
	const tiers = (tier: number) => data.nodes.filter((n) => n.tier === tier).length
	console.info(
		`  · ${data.nodes.length - tiers(0) - tiers(-1)} groups, ${tiers(0)} topics, ${tiers(-1)} contributors, ${data.edges.length} edges`,
	)
	if (exportTo) {
		writeFileSync(exportTo, JSON.stringify(data))
		client.close()
		console.info(`✅ galaxy written to ${exportTo}`)
		return
	}
	const t0 = performance.now()
	const stars = bakeTopicStars(data)
	console.info(`  · baked in ${((performance.now() - t0) / 1000).toFixed(1)}s`)
	// The canonical table, emptied and rewritten (a bake is per build).
	const insert = client.prepare(
		'INSERT INTO topic_star (topic_cluster_id, x, y, r) VALUES (?, ?, ?, ?)',
	)
	client.exec('BEGIN; DELETE FROM topic_star;')
	for (const s of stars) insert.run(s.topicClusterId, s.x, s.y, s.r)
	client.exec('COMMIT')
	console.info(`  · topic_star: ${stars.length} rows`)
	client.close()
	console.info('✅ stars baked')
}
