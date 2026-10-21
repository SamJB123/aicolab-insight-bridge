/**
 * The explorer contract's galaxy (`GalaxyData`: every field present, null
 * where absent) as the galaxy's own shape (`IBGalaxy`: absent means omitted).
 * One translation for the live map and the star bake alike (2026-10-21: the
 * pipeline's results view and its bake each carried their own), so what the
 * page draws and what the bake lays out are the same sky.
 */
import type { GalaxyData } from '@aicolab/insight-bridge-contracts/explorer'
import type { IBEdge, IBGalaxy, IBNode } from './types.ts'

/** `mixColors`: each position's colour (core's positionColors); the bake needs none. */
export function galaxyFromData(data: GalaxyData, mixColors?: Record<string, string>): IBGalaxy {
	const nodes: IBNode[] = data.nodes.map((n) => ({
		id: n.id,
		tier: n.tier,
		title: n.title,
		key: n.key,
		weight: n.weight,
		...(n.volume === null ? {} : { volume: n.volume }),
		...(n.mix === null ? {} : { mix: n.mix }),
		...(n.childCount === null ? {} : { childCount: n.childCount }),
		...(n.facets === null ? {} : { facets: n.facets }),
		...(n.flags.length
			? {
					flags: n.flags.map((f) => ({
						label: f.label,
						hot: f.hot,
						...(f.tip === null ? {} : { tip: f.tip }),
					})),
				}
			: {}),
	}))
	const edges: IBEdge[] = data.edges.map((e) => ({
		child: e.child,
		parent: e.parent,
		isPrimary: e.isPrimary,
		membershipType: e.membershipType,
		similarity: e.similarity,
		...(e.softIntensity === null ? {} : { softIntensity: e.softIntensity }),
	}))
	return {
		tiers: data.tiers.map((t) => ({
			tier: t.tier,
			label: t.label,
			labelPlural: t.labelPlural,
			...(t.weightLabel === null ? {} : { weightLabel: t.weightLabel }),
		})),
		sourceFacets: data.sourceFacets,
		nodes,
		edges,
		weightLabel: data.weightLabel,
		mixOrder: data.mixOrder,
		...(mixColors ? { mixColors } : {}),
		seed: data.seed,
	}
}
