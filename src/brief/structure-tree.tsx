/**
 * The record's structure as a tree — the shape of ONE corpus run, drawn from
 * whatever the pipeline actually built above its topics. Every node is named
 * as the pipeline named it and counted live by the host; this component adds
 * no vocabulary of its own beyond the reader's words for a column head.
 *
 * Generation-agnostic, in the three shapes a run can take (settled
 * 2026-09-16, when the four Insight Bridge apps' copies were folded into
 * one — each had drifted to a different subset):
 *
 *   no grouping layer   the topics themselves are the first column, carrying
 *                       their full titles (subject and claim);
 *   one grouping layer  the roots are the first column and each root's own
 *                       TOPICS are the second;
 *   two or more         the roots are the first column and their direct
 *                       sub-groups are the second. (A deeper tree shows its
 *                       roots and their children only.)
 *
 * A tidy horizontal tree in SVG on wide containers; the same tree as an
 * indented outline where the container is too narrow for the labels. Both
 * are always rendered and a container query picks one, so the choice
 * follows the space the host gives it rather than the viewport.
 *
 * The host decides what opening a node means: `onOpen` gets the node's kind
 * and id, and typically opens a detail sheet.
 */
import { createMemo, createSignal, For, Show } from 'solid-js'
import './structure-tree.css'

/** A grouping node of any generation, counted over the topics beneath it. */
export interface StructureTreeGroup {
	id: number
	/** 1.. — grouping generations, increasing toward the roots. */
	generation: number
	title: string
	/** The grouping node directly above it; null at the root generation. */
	parentId: number | null
	/** Substantive topics beneath it. */
	topics: number
	/** Contributing sources beneath it — the sort key within a column. */
	sources: number
}

/** A base topic, placed under the grouping node directly above it. */
export interface StructureTreeTopic {
	id: number
	title: string
	/** The grouping node directly above it; null when the run built none. */
	parentId: number | null
	/** Contributing sources engaging it. */
	sources: number
}

/** One grouping generation and the reader's word for it ("family", "theme"). */
export interface StructureTreeGeneration {
	generation: number
	label: string
	labelPlural: string
}

export interface StructureTreeProps {
	/** Every grouping node the run built; empty when it built none. */
	groups: StructureTreeGroup[]
	/** Every substantive topic. */
	topics: StructureTreeTopic[]
	/** The root grouping generation; 0 when the run built none. */
	top: number
	generations: StructureTreeGeneration[]
	/** Total contributing sources — the trunk's count. */
	sources: number
	/** The corpus's plural noun for a contributor: "submitters", "episodes", "sources". */
	sourceLabel: string
	/** Open a node. The host decides what that means. The whole node rides
	 *  along, not just its id: a host whose drawer keys a family by name, or
	 *  splits one kind per generation, needs more than the number. */
	onOpen: (node: StructureTreeNode) => void
}

/** A node as the tree drew it, handed back when the reader opens it. */
export interface StructureTreeNode {
	kind: 'group' | 'topic'
	id: number
	/** 0 for a topic; the grouping generation otherwise. */
	generation: number
	/** The pipeline's full title, as the node was named. */
	title: string
}

const W = 960
const X_ROOT = 120
const X_FIRST = 316
const X_SECOND = 636
const ROW = 15
const BRANCH_GAP = 12
const PAD = 14
/** Characters a first-column label can carry on one line before the second column. */
const FIRST_LINE = 34
/** With no grouping layer the first column is wider: topics carry their full titles. */
const FIRST_LINE_FLAT = 58

/** The pipeline titles a node "subject: claim"; columns show the subject. */
const subject = (title: string) => title.split(': ')[0] ?? title

/** A label on one line, or two when it is long: break at the last space before the limit. */
const wrap = (s: string, limit: number): [string, string?] => {
	if (s.length <= limit) return [s]
	const at = s.lastIndexOf(' ', limit)
	return at > 0 ? [s.slice(0, at), s.slice(at + 1)] : [s]
}

type Node = {
	id: number
	kind: 'group' | 'topic'
	title: string
	count: number
	countLabel: string
	generation: number
}
type Row = { node: Node; y: number; children: { node: Node; y: number }[] }

export function StructureTree(props: StructureTreeProps) {
	const [hot, setHot] = createSignal<number | null>(null)
	const flat = () => props.groups.length === 0
	const byReach = (a: { sources: number }, b: { sources: number }) => b.sources - a.sources
	const groupNode = (g: StructureTreeGroup): Node => ({
		id: g.id,
		kind: 'group',
		title: g.title,
		count: g.topics,
		countLabel: 'topics',
		generation: g.generation,
	})
	const topicNode = (t: StructureTreeTopic): Node => ({
		id: t.id,
		kind: 'topic',
		title: t.title,
		count: t.sources,
		countLabel: props.sourceLabel,
		generation: 0,
	})
	/** First column: the root groups, or the topics when the run built none. */
	const firsts = createMemo((): Node[] =>
		flat()
			? [...props.topics].sort(byReach).map(topicNode)
			: props.groups
					.filter((g) => g.generation === props.top)
					.sort(byReach)
					.map(groupNode),
	)
	/** Second column: a root's direct children — sub-groups when there is a
	 *  generation below the roots, its topics when the roots sit on them. */
	const childrenOf = (f: Node): Node[] =>
		props.top > 1
			? props.groups
					.filter((g) => g.parentId === f.id)
					.sort(byReach)
					.map(groupNode)
			: props.topics
					.filter((t) => t.parentId === f.id)
					.sort(byReach)
					.map(topicNode)
	const rows = createMemo((): Row[] => {
		// Two-line topic titles start lower so the column head clears the first one.
		let y = flat() ? PAD + 12 : PAD
		return firsts().map((f) => {
			const children = flat()
				? []
				: childrenOf(f).map((node) => {
						const row = { node, y: y + ROW / 2 }
						y += ROW
						return row
					})
			// A parent sits at the centre of its children; a node with none takes a row of its own.
			const yNode = children.length
				? ((children[0]?.y ?? 0) + (children[children.length - 1]?.y ?? 0)) / 2
				: y + ROW / 2
			// With no groups the topics carry their full titles, which wrap to two lines.
			if (!children.length) y += flat() ? ROW * 2.3 : ROW
			y += BRANCH_GAP
			return { node: f, y: yNode, children }
		})
	})
	const height = () => {
		const last = rows().at(-1)
		const lastY = last ? Math.max(last.y, last.children.at(-1)?.y ?? 0) : 0
		return Math.max(PAD * 2 + ROW, lastY + ROW + PAD)
	}
	const rootY = () => {
		const r = rows()
		return r.length ? (r[0]?.y ?? 0) / 2 + (r[r.length - 1]?.y ?? 0) / 2 : height() / 2
	}
	const link = (x1: number, y1: number, x2: number, y2: number) => {
		const mx = (x1 + x2) / 2
		return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
	}
	const genLabel = (generation: number, plural = false) => {
		const g = props.generations.find((x) => x.generation === generation)
		return (plural ? g?.labelPlural : g?.label) ?? (plural ? 'groups' : 'group')
	}
	const kindOf = (node: Node) => (node.kind === 'group' ? genLabel(node.generation) : 'topic')
	const open = (node: Node) =>
		props.onOpen({ kind: node.kind, id: node.id, generation: node.generation, title: node.title })
	const topicsHead = () => `topics · ${props.sourceLabel} in each`
	const firstHead = () => (flat() ? topicsHead() : `${genLabel(props.top, true)} · topics in each`)
	const secondHead = () =>
		props.top > 1 ? `${genLabel(props.top - 1, true)} · topics in each` : topicsHead()
	/** With no groups there is room for the topics' full titles (subject and claim); groups show their subject. */
	const firstLabel = (node: Node) => (flat() ? node.title : subject(node.title))
	const firstLine = () => (flat() ? FIRST_LINE_FLAT : FIRST_LINE)

	return (
		<div class="ib-structure-tree">
			<svg
				class="ib-st-svg"
				viewBox={`0 0 ${W} ${height()}`}
				role="img"
				aria-label={`The record's structure: ${props.sources.toLocaleString()} ${props.sourceLabel}, then the topics and any groups above them`}
			>
				<For each={rows()}>
					{(f) => (
						<g
							class={[
								'ib-st-branch',
								{ 'is-hot': hot() === f.node.id, 'is-dim': hot() != null && hot() !== f.node.id },
							]}
							onMouseEnter={() => setHot(f.node.id)}
							onMouseLeave={() => setHot(null)}
						>
							<path
								class="ib-st-link ib-st-link-first"
								d={link(X_ROOT + 8, rootY(), X_FIRST - 8, f.y)}
							/>
							<For each={f.children}>
								{(t) => <path class="ib-st-link" d={link(X_FIRST + 7, f.y, X_SECOND - 6, t.y)} />}
							</For>
							<g
								class="ib-st-node ib-st-first"
								tabindex="0"
								role="button"
								aria-label={`Open ${kindOf(f.node)}: ${firstLabel(f.node)}`}
								onClick={() => open(f.node)}
								onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open(f.node)}
							>
								<circle cx={X_FIRST} cy={f.y} r={5.5} />
								{(() => {
									const [first, second] = wrap(firstLabel(f.node), firstLine())
									return (
										<text x={X_FIRST + 11} y={second ? f.y - 7 : f.y} class="ib-st-t ib-st-t-first">
											{first}
											<Show
												when={second}
												fallback={
													<tspan class="ib-st-n">
														{' '}
														· {f.node.count} {f.node.countLabel}
													</tspan>
												}
											>
												<tspan x={X_FIRST + 11} dy={14}>
													{second}
													<tspan class="ib-st-n">
														{' '}
														· {f.node.count} {f.node.countLabel}
													</tspan>
												</tspan>
											</Show>
										</text>
									)
								})()}
							</g>
							<For each={f.children}>
								{(t) => (
									<g
										class="ib-st-node ib-st-second"
										tabindex="0"
										role="button"
										aria-label={`Open ${kindOf(t.node)}: ${subject(t.node.title)}`}
										onClick={() => open(t.node)}
										onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open(t.node)}
									>
										<circle cx={X_SECOND} cy={t.y} r={3.4} />
										<text x={X_SECOND + 9} y={t.y} class="ib-st-t">
											{subject(t.node.title)}
											<tspan class="ib-st-n"> · {t.node.count}</tspan>
										</text>
									</g>
								)}
							</For>
						</g>
					)}
				</For>
				<g class="ib-st-node ib-st-root">
					<circle cx={X_ROOT} cy={rootY()} r={7} />
					<text x={X_ROOT - 12} y={rootY() - 8} class="ib-st-t ib-st-t-root" text-anchor="end">
						{props.sources.toLocaleString()} {props.sourceLabel}
					</text>
					<text x={X_ROOT - 12} y={rootY() + 9} class="ib-st-t ib-st-t-root-sub" text-anchor="end">
						{props.topics.length.toLocaleString()} topics
					</text>
				</g>
				<text x={X_FIRST + 11} y={6} class="ib-st-head">
					{firstHead()}
				</text>
				<Show when={!flat()}>
					<text x={X_SECOND + 9} y={6} class="ib-st-head">
						{secondHead()}
					</text>
				</Show>
			</svg>

			{/* the same tree, as an outline, where the labels would not fit */}
			<ol class="ib-st-outline" aria-label="The record's structure">
				<li class="ib-st-o-root">
					<span class="ib-st-o-count">
						{props.sources.toLocaleString()} {props.sourceLabel} ·{' '}
						{props.topics.length.toLocaleString()} topics
					</span>
				</li>
				<For each={rows()}>
					{(f) => (
						<li>
							<button type="button" class="ib-st-o-first" onClick={() => open(f.node)}>
								{firstLabel(f.node)}{' '}
								<span class="ib-st-o-count">
									· {f.node.count} {f.node.countLabel}
								</span>
							</button>
							<Show when={f.children.length}>
								<ol>
									<For each={f.children}>
										{(t) => (
											<li>
												<button type="button" class="ib-st-o-second" onClick={() => open(t.node)}>
													{subject(t.node.title)}{' '}
													<span class="ib-st-o-count">· {t.node.count}</span>
												</button>
											</li>
										)}
									</For>
								</ol>
							</Show>
						</li>
					)}
				</For>
			</ol>
		</div>
	)
}
