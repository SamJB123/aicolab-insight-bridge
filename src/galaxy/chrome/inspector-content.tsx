/**
 * Inspector content — what the workspace's ResponsiveInspector shows.
 *
 * RESTING (nothing selected): the corpus at a glance — census, the largest
 * groups and (where the corpus has a real score) the hottest topics as jump
 * links that fly the camera.
 *
 * BOUND (a node selected): the reading surface — InspectorHeader, stats,
 * stance mix, flags, then the real drawer content through the IBNodeContent
 * contract (key points with verbatim quotes, lens tables, entity lists,
 * related links), loaded under a Loading boundary.
 */

import {
	Accordion,
	AccordionItem,
	Eyebrow,
	InspectorHeader,
	Meter,
	RichList,
	RichListItem,
	Rule,
} from '@aicolab/ui-solid'
import { createMemo, createSignal, Errored, For, Loading, Show } from 'solid-js'
import type {
	IBContentSection,
	IBDocumentRow,
	IBFacetRow,
	IBGalaxy,
	IBNode,
	IBNodeContent,
	IBNodeId,
	IBPoint,
	IBQuote,
} from '../types.ts'
import { DEFAULT_GALAXY_SORT, GalaxySortControl, sortRows } from './sort-control.tsx'

function MixBar(props: { galaxy: IBGalaxy; node: IBNode }) {
	const segments = () => {
		const mix = props.node.mix
		if (!mix) return []
		const order = props.galaxy.mixOrder ?? Object.keys(mix)
		const total = order.reduce((sum, key) => sum + (mix[key] ?? 0), 0)
		if (total === 0) return []
		return order
			.filter((key) => (mix[key] ?? 0) > 0)
			.map((key) => ({
				key,
				share: ((mix[key] ?? 0) / total) * 100,
				color: props.galaxy.mixColors?.[key] ?? 'var(--color-base-content-faint)',
			}))
	}
	return (
		<Show when={segments().length > 0}>
			<div class="ib-galaxy-mix" role="img" aria-label="Stance mix">
				<For each={segments()}>
					{(segment) => (
						<span
							style={{ 'inline-size': `${segment.share}%`, background: segment.color }}
							title={segment.key}
						/>
					)}
				</For>
			</div>
		</Show>
	)
}

function Quotes(props: { quotes: IBQuote[] | undefined }) {
	return (
		<For each={props.quotes ?? []}>
			{(quote) => (
				<blockquote>
					{quote.text}
					<Show when={quote.source}>{(source) => <cite>{source()}</cite>}</Show>
				</blockquote>
			)}
		</For>
	)
}

/** Key points as an exclusive-open accordion — headline as the summary, the
 * elaboration and that point's verbatim quotes inside; the first point
 * starts open so something is always readable without a click (settled
 * 2026-08-15). */
function PointsSection(props: { points: IBPoint[]; label: string }) {
	return (
		<Accordion density="compact" spacing="joined" label={props.label}>
			<For each={props.points}>
				{(point, at) => (
					<Show
						when={point.text.length > 0}
						fallback={
							<div class="ib-galaxy-point">
								<Quotes quotes={point.quotes} />
							</div>
						}
					>
						<AccordionItem summary={point.text} open={at() === 0}>
							<div class="ib-galaxy-point">
								<Show when={point.detail}>{(detail) => <p>{detail()}</p>}</Show>
								<Quotes quotes={point.quotes} />
							</div>
						</AccordionItem>
					</Show>
				)}
			</For>
		</Accordion>
	)
}

/** Wifi-signal strength glyph (settled 2026-08-16): a dot and three arcs;
 * `strength` of 3 inks them all, weaker levels fade the outer arcs. The
 * accessible name comes from the row's badge text. */
function SignalIcon(props: { strength: 1 | 2 | 3; label: string }) {
	const arcs = [
		'M8.4 15.2 A 5.1 5.1 0 0 1 15.6 15.2',
		'M5.6 12.4 A 9.1 9.1 0 0 1 18.4 12.4',
		'M2.8 9.6 A 13.1 13.1 0 0 1 21.2 9.6',
	]
	return (
		<svg class="ib-galaxy-signal" viewBox="0 0 24 24" role="img" aria-label={props.label}>
			<title>{props.label}</title>
			<circle cx="12" cy="19" r="1.9" fill="currentColor" />
			<For each={arcs}>
				{(d, at) => (
					<path
						d={d}
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						opacity={at() < props.strength ? 1 : 0.22}
					/>
				)}
			</For>
		</svg>
	)
}

function FacetBadge(props: { badge: string; badgeColor?: string }) {
	return (
		<span
			class="ib-galaxy-badge"
			style={props.badgeColor ? { background: props.badgeColor, color: '#fff' } : undefined}
		>
			{props.badge}
		</span>
	)
}

/** Actionable child-node rows with the reader's A–Z/reach ordering — never
 * pre-ranked (the Respect principles). Choosing a row flies there; hovering
 * highlights its body in the scene. */
function NodesSection(props: {
	section: Extract<IBContentSection, { kind: 'nodes' }>
	onVisit: (id: IBNodeId) => void
	onHoverNode?: (id: IBNodeId | null) => void
}) {
	const [sort, setSort] = createSignal(DEFAULT_GALAXY_SORT)
	const rows = createMemo(() =>
		sortRows(
			props.section.rows,
			sort(),
			(row) => row.label,
			(row) => row.weight ?? 0,
		),
	)
	return (
		<>
			<div class="ib-galaxy-nodes-head">
				<GalaxySortControl sort={sort()} onChange={setSort} />
			</div>
			<RichList label={props.section.title}>
				<For each={rows()}>
					{(row) => (
						<RichListItem
							title={row.label}
							description={row.detail}
							onSelect={() => props.onVisit(row.id)}
							onHoverChange={(hovering) => props.onHoverNode?.(hovering ? row.id : null)}
						/>
					)}
				</For>
			</RichList>
		</>
	)
}

/** Bare member-grade rows preview at a few before an expander; lists at or
 * under the cap render whole — an expander hiding one or two rows is noise. */
const PLAIN_ROWS_PREVIEW = 6
const PLAIN_ROWS_CAP = 8

/** Lens/perspective rows. Rows carrying analysis or quotes read as an
 * accordion (badge in the summary; analysis, PROVENANCE QUOTES — a hard
 * requirement, 2026-08-16 — and a visit chip inside; first open). Bare rows
 * (member-grade engagements, share-only slices) follow as a subordinate
 * list — accordion-summary type, muted ink — previewed behind an expander
 * when long, actionable when they carry a node id. */
function FacetsSection(props: {
	section: Extract<IBContentSection, { kind: 'facets' }>
	onVisit: (id: IBNodeId) => void
	onHoverNode?: (id: IBNodeId | null) => void
}) {
	const analysed = createMemo(() =>
		props.section.rows.filter((row) => row.analysis || (row.quotes?.length ?? 0) > 0),
	)
	const plain = createMemo(() =>
		props.section.rows.filter((row) => !(row.analysis || (row.quotes?.length ?? 0) > 0)),
	)
	const [allPlain, setAllPlain] = createSignal(false)
	const visiblePlain = createMemo(() => {
		const rows = plain()
		return allPlain() || rows.length <= PLAIN_ROWS_CAP ? rows : rows.slice(0, PLAIN_ROWS_PREVIEW)
	})
	const visitOf = (row: IBFacetRow): (() => void) | undefined => {
		const id = row.id
		return id === undefined ? undefined : () => props.onVisit(id)
	}
	const hoverOf = (row: IBFacetRow): ((hovering: boolean) => void) | undefined => {
		const id = row.id
		const onHoverNode = props.onHoverNode
		if (id === undefined || onHoverNode === undefined) return undefined
		return (hovering) => onHoverNode(hovering ? id : null)
	}
	return (
		<>
			<Show when={analysed().length > 0}>
				<Accordion density="compact" spacing="joined" label={props.section.title}>
					<For each={analysed()}>
						{(row, at) => (
							<AccordionItem
								summary={() => (
									<span class="ib-galaxy-acc-summary">
										<span class="ib-galaxy-acc-label">{row.label}</span>
										<Show when={row.badge}>
											{(badge) => <FacetBadge badge={badge()} badgeColor={row.badgeColor} />}
										</Show>
									</span>
								)}
								open={at() === 0}
							>
								<div class="ib-galaxy-point">
									<Show when={row.analysis}>{(analysis) => <p>{analysis()}</p>}</Show>
									<Quotes quotes={row.quotes} />
									<Show when={row.id}>
										{(id) => (
											<button
												type="button"
												class="ib-galaxy-related-chip"
												onClick={() => props.onVisit(id())}
												onPointerEnter={() => props.onHoverNode?.(id())}
												onPointerLeave={() => props.onHoverNode?.(null)}
											>
												Open in the galaxy →
											</button>
										)}
									</Show>
								</div>
							</AccordionItem>
						)}
					</For>
				</Accordion>
			</Show>
			<Show when={plain().length > 0}>
				<RichList
					label={props.section.title}
					titleSize="var(--t-sm)"
					titleInk="var(--color-base-content-muted)"
					rowPadBlock="0.35rem"
				>
					<For each={visiblePlain()}>
						{(row) => (
							<RichListItem
								title={row.label}
								onSelect={visitOf(row)}
								onHoverChange={hoverOf(row)}
								/* An empty trailing edge still reserves its aligned
								   min-inline-size, wrapping every title early — rows
								   with nothing to show get no trailing at all. */
								trailing={
									row.signal !== undefined ||
									row.badge !== undefined ||
									row.share !== undefined ? (
										<span class="ib-galaxy-facet-trailing">
											<Show
												when={row.signal}
												fallback={
													<Show when={row.badge}>
														{(badge) => <FacetBadge badge={badge()} badgeColor={row.badgeColor} />}
													</Show>
												}
											>
												{(signal) => <SignalIcon strength={signal()} label={row.badge ?? ''} />}
											</Show>
											<Show when={row.share !== undefined}>
												<Meter value={(row.share ?? 0) * 100} max={100} />
											</Show>
										</span>
									) : undefined
								}
							/>
						)}
					</For>
				</RichList>
				<Show when={plain().length > PLAIN_ROWS_CAP}>
					<button
						type="button"
						class="ib-galaxy-show-all"
						onClick={() => setAllPlain((expanded) => !expanded)}
					>
						{allPlain() ? 'Show fewer ▴' : `Show all ${plain().length} ▾`}
					</button>
				</Show>
			</Show>
		</>
	)
}

function SectionBody(props: {
	section: IBContentSection
	onVisit: (id: IBNodeId) => void
	onHoverNode?: (id: IBNodeId | null) => void
	/** Present only when the host can load document readings. */
	onOpenDocument?: (row: IBDocumentRow) => void
}) {
	const section = props.section
	if (section.kind === 'points') {
		return <PointsSection points={section.points} label={section.title} />
	}
	if (section.kind === 'nodes') {
		return (
			<NodesSection section={section} onVisit={props.onVisit} onHoverNode={props.onHoverNode} />
		)
	}
	if (section.kind === 'facets') {
		return (
			<FacetsSection section={section} onVisit={props.onVisit} onHoverNode={props.onHoverNode} />
		)
	}
	if (section.kind === 'documents') {
		// Multi-document entities: rows open the DOCUMENT READING level
		// (settled 2026-08-16) when the host supplies loadDocument.
		return (
			<RichList label={section.title}>
				<For each={section.rows}>
					{(row) => (
						<RichListItem
							title={row.label}
							description={row.detail}
							onSelect={props.onOpenDocument && (() => props.onOpenDocument?.(row))}
						/>
					)}
				</For>
			</RichList>
		)
	}
	const max = Math.max(1, ...section.rows.map((row) => row.max ?? row.count ?? 0))
	return (
		<RichList label={section.title}>
			<For each={section.rows}>
				{(row) => (
					<RichListItem
						title={row.label}
						description={row.detail}
						trailing={
							<Show when={row.count !== undefined}>
								<span class="ib-galaxy-entity-trailing">
									<span>{row.count}</span>
									<Meter value={row.count ?? 0} max={row.max ?? max} />
								</span>
							</Show>
						}
					/>
				)}
			</For>
		</RichList>
	)
}

function JumpChips(props: {
	entries: Array<{ id: IBNodeId; label: string }>
	onVisit: (id: IBNodeId) => void
	/** Chip hover mirrored into the scene (null on leave). */
	onHoverNode?: (id: IBNodeId | null) => void
}) {
	return (
		<div class="ib-galaxy-reader-related">
			<For each={props.entries}>
				{(entry) => (
					<button
						type="button"
						class="ib-galaxy-related-chip"
						onClick={() => props.onVisit(entry.id)}
						onPointerEnter={() => props.onHoverNode?.(entry.id)}
						onPointerLeave={() => props.onHoverNode?.(null)}
					>
						{entry.label}
					</button>
				)}
			</For>
		</div>
	)
}

// The resting-overview component was RETIRED 2026-08-16 (IA reform): the
// inspector's resting surface is now the drill (chrome/drill.tsx), the
// census lives in the left menu, and the "hottest topics" section and
// standalone facet legend were retired outright.

/** The reading body shared by the NODE reader and the DOCUMENT reader:
 * lede, stat chips, sections and related chips under the async boundary. */
function ReaderBody(props: {
	content: () => IBNodeContent | null
	onVisit: (id: IBNodeId) => void
	onHoverNode?: (id: IBNodeId | null) => void
	onOpenDocument?: (row: IBDocumentRow) => void
	errorLabel: string
}) {
	return (
		<Errored
			fallback={(err) => (
				<p class="ib-galaxy-reader-error">
					{props.errorLabel}: {String(err())}
				</p>
			)}
		>
			<Loading fallback={<p class="ib-galaxy-reader-pending">Reading the corpus…</p>}>
				{(() => {
					const value = props.content()
					return (
						<Show when={value}>
							{(content) => (
								<>
									<Show when={content().lede}>
										{(lede) => <p class="ib-galaxy-reader-lede">{lede()}</p>}
									</Show>
									<Show when={(content().stats?.length ?? 0) > 0}>
										<div class="ib-galaxy-reader-stats">
											<For each={content().stats}>
												{(stat) => (
													<span class="ib-galaxy-badge">
														<strong>{stat.value}</strong> {stat.label}
													</span>
												)}
											</For>
										</div>
									</Show>
									<For each={content().sections}>
										{(section) => (
											<section class="ib-galaxy-reader-section">
												<Rule label={section.title} />
												<SectionBody
													section={section}
													onVisit={props.onVisit}
													onHoverNode={props.onHoverNode}
													onOpenDocument={props.onOpenDocument}
												/>
											</section>
										)}
									</For>
									<Show when={(content().related?.length ?? 0) > 0}>
										<section class="ib-galaxy-reader-section">
											<Rule label="Related" />
											<JumpChips
												entries={content().related ?? []}
												onVisit={props.onVisit}
												onHoverNode={props.onHoverNode}
											/>
										</section>
									</Show>
								</>
							)}
						</Show>
					)
				})()}
			</Loading>
		</Errored>
	)
}

export function GalaxyInspectorNode(props: {
	galaxy: IBGalaxy
	node: IBNode
	/** An async computation's read (a memo over the host's loadContent):
	 * not-ready reads suspend into the Loading boundary below. */
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
	const tierMeta = createMemo(() =>
		props.galaxy.tiers.find((tier) => tier.tier === props.node.tier),
	)
	const tierLabel = createMemo(() => tierMeta()?.label ?? '')
	/** A TOPIC's member sources, grouped by membership grade (settled
	 * 2026-08-16): the grade semantics — exemplar progenitors, high-value
	 * contributors, related members — become readable in prose land too.
	 * Computed from the galaxy itself, so it needs no host content. */
	const contributors = createMemo(() => {
		if (props.node.tier !== 0) return null
		const byId = new Map(props.galaxy.nodes.map((node) => [node.id, node]))
		const tiers: Array<{ label: string; rows: IBNode[] }> = [
			{ label: 'Exemplars', rows: [] },
			{ label: 'High-value', rows: [] },
			{ label: 'Members', rows: [] },
		]
		for (const edge of props.galaxy.edges) {
			if (edge.parent !== props.node.id) continue
			const child = byId.get(edge.child)
			if (child?.tier !== -1) continue
			const at =
				edge.membershipType === 'exemplar' ? 0 : edge.membershipType === 'high_value' ? 1 : 2
			tiers[at].rows.push(child)
		}
		for (const tier of tiers) tier.rows.sort((a, b) => a.title.localeCompare(b.title))
		const filled = tiers.filter((tier) => tier.rows.length > 0)
		return filled.length > 0 ? filled : null
	})
	return (
		<>
			{/* The named up-control — same anatomy as every drill level. */}
			<button type="button" class="ib-galaxy-nav-up" onClick={() => props.onUp()}>
				<span aria-hidden="true">‹</span> {props.upLabel}
			</button>
			<InspectorHeader eyebrow={<Eyebrow>{tierLabel()}</Eyebrow>} title={props.node.title}>
				<p class="ib-galaxy-node-stats">
					{props.node.weight} {tierMeta()?.weightLabel ?? props.galaxy.weightLabel}
					<Show when={props.node.intensityLabel !== undefined}> · {props.node.intensityLabel}</Show>
				</p>
				<MixBar galaxy={props.galaxy} node={props.node} />
				<Show when={(props.node.flags?.length ?? 0) > 0}>
					<div class="ib-galaxy-node-flags">
						<For each={props.node.flags}>
							{(flag) => (
								<span class={['ib-galaxy-flag', { 'ib-galaxy-flag-hot': flag.hot === true }]}>
									{flag.label}
								</span>
							)}
						</For>
					</div>
				</Show>
			</InspectorHeader>
			<ReaderBody
				content={props.content}
				onVisit={props.onVisit}
				onHoverNode={props.onHoverNode}
				onOpenDocument={props.onOpenDocument}
				errorLabel="Couldn't load this node"
			/>
			<Show when={contributors()}>
				{(tiers) => (
					<section class="ib-galaxy-reader-section">
						<Rule label="Contributors" />
						<Accordion density="compact" spacing="joined" label="Contributors by grade">
							<For each={tiers()}>
								{(tier, at) => (
									<AccordionItem summary={`${tier.label} (${tier.rows.length})`} open={at() === 0}>
										<RichList label={tier.label}>
											<For each={tier.rows}>
												{(row) => (
													<RichListItem
														title={row.title}
														onSelect={() => props.onVisit(row.id)}
														onHoverChange={(hovering) =>
															props.onHoverNode?.(hovering ? row.id : null)
														}
													/>
												)}
											</For>
										</RichList>
									</AccordionItem>
								)}
							</For>
						</Accordion>
					</section>
				)}
			</Show>
		</>
	)
}

/** The DOCUMENT READING (settled 2026-08-16): a multi-document entity's
 * single document, read with the same anatomy as a source panel — that
 * document's engaged topics, key points and quotes — reached from the
 * documents section and left via the standard ‹ Back (the breadcrumb gains
 * a document crumb host-side). */
export function GalaxyInspectorDocument(props: {
	title: string
	/** The corpus's document noun — 'Report', 'Submission', 'Document'. */
	eyebrow: string
	/** Async read over the host's loadDocument (same contract as the node
	 * reader's content). */
	content: () => IBNodeContent | null
	/** The named up-destination (the source entity's title). */
	upLabel: string
	onUp: () => void
	onVisit: (id: IBNodeId) => void
	onHoverNode?: (id: IBNodeId | null) => void
}) {
	return (
		<>
			<button type="button" class="ib-galaxy-nav-up" onClick={() => props.onUp()}>
				<span aria-hidden="true">‹</span> {props.upLabel}
			</button>
			<InspectorHeader eyebrow={<Eyebrow>{props.eyebrow}</Eyebrow>} title={props.title} />
			<ReaderBody
				content={props.content}
				onVisit={props.onVisit}
				onHoverNode={props.onHoverNode}
				errorLabel="Couldn't load this document"
			/>
		</>
	)
}
