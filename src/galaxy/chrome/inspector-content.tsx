/**
 * Inspector content — what the workspace's ResponsiveInspector shows when a
 * node is selected: the shared Reading (../../reader) mounted in the rail.
 * The galaxy adds only what it alone knows — the node's weight line, its
 * stance mix, its flags, and the contributors computed from the graph — and
 * wires every action into the nav core. The resting surface (nothing
 * selected) is the drill (chrome/drill.tsx).
 */

import { createMemo } from 'solid-js'
import { Reading } from '../../reader/reader.tsx'
import { at } from '../engine/at.ts'
import type { IBDocumentRow, IBGalaxy, IBNode, IBNodeContent, IBNodeId } from '../types.ts'

export function GalaxyInspectorNode(props: {
	galaxy: IBGalaxy
	node: IBNode
	/** An async computation's read (a memo over the host's loadContent):
	 * not-ready reads suspend into the reader's Loading boundary. */
	content: () => IBNodeContent | null
	onVisit: (id: IBNodeId) => void
	/** The named up-destination (settled 2026-08-16: 'back' is replaced by a
	 * destination-labelled up-control at every level). */
	upLabel: string
	onUp: () => void
	onHoverNode?: (id: IBNodeId | null) => void
	/** Present only when the host can load document readings — the documents
	 * section's rows are actionable exactly then. */
	onOpenDocument?: (row: IBDocumentRow) => void
}) {
	const tierMeta = createMemo(() => props.galaxy.tiers.find((tier) => tier.tier === props.node.tier))
	/** A TOPIC's member sources, grouped by membership grade (settled
	 * 2026-08-16): the grade semantics — exemplar progenitors, high-value
	 * contributors, related members — become readable in prose land too.
	 * Computed from the galaxy itself, so it needs no host content. */
	const contributors = createMemo(() => {
		if (props.node.tier !== 0) return null
		const byId = new Map(props.galaxy.nodes.map((node) => [node.id, node]))
		const tiers: Array<{ label: string; rows: Array<{ id: IBNodeId; label: string }> }> = [
			{ label: 'Exemplars', rows: [] },
			{ label: 'High-value', rows: [] },
			{ label: 'Members', rows: [] },
		]
		for (const edge of props.galaxy.edges) {
			if (edge.parent !== props.node.id) continue
			const child = byId.get(edge.child)
			if (child?.tier !== -1) continue
			const slot = edge.membershipType === 'exemplar' ? 0 : edge.membershipType === 'high_value' ? 1 : 2
			at(tiers, slot).rows.push({ id: child.id, label: child.title })
		}
		for (const tier of tiers) tier.rows.sort((a, b) => a.label.localeCompare(b.label))
		const filled = tiers.filter((tier) => tier.rows.length > 0)
		return filled.length > 0 ? filled : null
	})
	return (
		<Reading
			eyebrow={tierMeta()?.label ?? ''}
			title={props.node.title}
			detail={`${props.node.weight} ${tierMeta()?.weightLabel ?? props.galaxy.weightLabel}${props.node.intensityLabel !== undefined ? ` · ${props.node.intensityLabel}` : ''}`}
			mix={props.node.mix}
			mixOrder={props.galaxy.mixOrder}
			mixColors={props.galaxy.mixColors}
			flags={props.node.flags}
			content={props.content}
			contributors={contributors()}
			onVisit={props.onVisit}
			onHoverNode={props.onHoverNode}
			onOpenDocument={props.onOpenDocument}
			upLabel={props.upLabel}
			onUp={props.onUp}
			errorLabel="Couldn't load this node"
		/>
	)
}

/** The DOCUMENT READING (settled 2026-08-16): a multi-document entity's
 * single document, read with the same anatomy as a source reading — that
 * document's engaged topics, key points and quotes — reached from the
 * documents section and left via the named up-control (the breadcrumb
 * gains a document crumb host-side). */
export function GalaxyInspectorDocument(props: {
	title: string
	/** The corpus's document noun — 'Report', 'Submission', 'Document'. */
	eyebrow: string
	content: () => IBNodeContent | null
	/** The named up-destination (the source entity's title). */
	upLabel: string
	onUp: () => void
	onVisit: (id: IBNodeId) => void
	onHoverNode?: (id: IBNodeId | null) => void
}) {
	return (
		<Reading
			eyebrow={props.eyebrow}
			title={props.title}
			content={props.content}
			onVisit={props.onVisit}
			onHoverNode={props.onHoverNode}
			upLabel={props.upLabel}
			onUp={props.onUp}
			errorLabel="Couldn't load this document"
		/>
	)
}
