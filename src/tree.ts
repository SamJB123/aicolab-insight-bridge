/**
 * The grouping tree — one definition for every reader of a run (2026-10-21:
 * explorer's treeOf, the Brief and the world record each built their own, and
 * the Brief and the record each named generations with an identical copy of
 * the same function).
 *
 * Pure: it takes rows and returns lookups, so a caller keeps its own queries
 * and its own row order — the order a caller passes nodes and edges in is the
 * order `byId` and `childrenOf` give them back, which is what keeps each
 * caller's output as it was. Imports types only, so a browser-side module can
 * use it without the database layer.
 */
import type { HierarchyNode } from '@aicolab/insight-bridge-contracts/explorer'

/** What the tree needs of a node; a caller may pass richer rows and gets them back from `byId`. */
export type TreeNode = Pick<
	HierarchyNode,
	'superclusterId' | 'generation' | 'topicClusterId' | 'title'
>

/** An edge of the tree; only primary edges shape it. */
export interface TreeEdge {
	child: number
	parent: number
	isPrimary: boolean
}

/** The committed build's tree by primary edge: each node's primary parent and children. */
export function treeOf<N extends TreeNode>(h: { nodes: readonly N[]; edges: readonly TreeEdge[] }) {
	const byId = new Map(h.nodes.map((node) => [node.superclusterId, node]))
	const parentOf = new Map<number, number>()
	const childrenOf = new Map<number, number[]>()
	for (const e of h.edges) {
		if (!e.isPrimary) continue
		parentOf.set(e.child, e.parent)
		childrenOf.set(e.parent, [...(childrenOf.get(e.parent) ?? []), e.child])
	}
	const baseOfTopic = new Map(
		h.nodes.flatMap((node) =>
			node.generation === 0 && node.topicClusterId !== null ? [[node.topicClusterId, node]] : [],
		),
	)
	const ancestorsOf = (id: number) => {
		const out: { superclusterId: number; generation: number; title: string | null }[] = []
		const seen = new Set([id])
		for (let at = parentOf.get(id); at !== undefined && !seen.has(at); at = parentOf.get(at)) {
			seen.add(at)
			const node = byId.get(at)
			if (!node) break
			out.push({
				superclusterId: node.superclusterId,
				generation: node.generation,
				title: node.title,
			})
		}
		return out
	}
	/** The topics beneath a node by primary edge, depth first in child order. */
	const topicsUnder = (id: number): number[] => {
		const out: number[] = []
		const walk = (at: number, seen: Set<number>) => {
			if (seen.has(at)) return
			seen.add(at)
			const node = byId.get(at)
			if (node?.generation === 0 && node.topicClusterId !== null) out.push(node.topicClusterId)
			for (const child of childrenOf.get(at) ?? []) walk(child, seen)
		}
		walk(id, new Set())
		return out
	}
	return {
		byId,
		baseOfTopic,
		ancestorsOf,
		topicsUnder,
		/** A node's primary parent, or null at a root. */
		parentOf: (id: number): number | null => parentOf.get(id) ?? null,
		childrenOf: (id: number) => childrenOf.get(id) ?? [],
	}
}

/** Human name for a grouping generation, counted from the top. */
export const generationLabel = (generation: number, top: number, plural = false): string => {
	const depth = top - generation
	if (depth === 0) return plural ? 'families' : 'family'
	if (depth === 1) return plural ? 'themes' : 'theme'
	return plural ? 'groups' : 'group'
}
