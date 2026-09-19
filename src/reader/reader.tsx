/**
 * The Reading — ONE reader for every Insight Bridge surface (settled
 * 2026-09-14, twelve MCQs): the galaxy mounts it in its 21rem inspector
 * rail, an app mounts the very same component in its wide detail sheet.
 * Same order, same anatomy, same section rules; the container's width is
 * the only thing that changes the layout (reader.css, container queries).
 *
 *   header   eyebrow, title, a detail line, the stance mix, flags
 *   lede     the pipeline's description
 *   stats    headline figures as chips
 *   sections stacked when two or fewer, behind a picker past that
 *              points   — accordion, first open, several may be open
 *              facets   — analysed rows as an accordion (badge, analysis,
 *                         PROVENANCE QUOTES, share meter, visit chip); bare
 *                         rows as a subordinate list
 *              nodes    — actionable child rows with A–Z / reach ordering
 *              documents— rows that open a document reading (host-wired)
 *              entities — rows with a count meter
 *   contributors  grade-grouped accordion (a topic's members)
 *   related  jump chips
 *
 * Text from the pipeline keeps its paragraph breaks (`white-space:
 * pre-line`). Every action is a host callback: `onVisit(id)` flies a
 * galaxy or opens a drawer, `onOpenDocument(row)` drills into a document,
 * `visitLabel(row)` names the chip in the host's own words.
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
	SelectControl,
} from '@aicolab/ui-solid'
import { createMemo, createSignal, Errored, For, Loading, Show } from 'solid-js'
import type {
	IBContentSection,
	IBDocumentRow,
	IBFacetRow,
	IBFlag,
	IBNodeContent,
	IBNodeId,
	IBPoint,
	IBQuote,
} from '../galaxy/types.ts'
import { DEFAULT_READING_SORT, ReadingSortControl, sortRows } from './sort-control.tsx'
import './reader.css'

export interface ReadingProps {
 /** Optional host-owned section title for shareable readings. */
 section?: string
 onSectionChange?: (section: string) => void
	/** Tier or kind name above the title — 'Topic', 'Submitter', 'Family'. */
	eyebrow?: string
	title: string
	/** A quiet line under the title — '86 submitters', 'Submission 13 · gave evidence 2026-03-12'. */
	detail?: string
	/** The stance mix drawn as a bar; keys follow `mixOrder`. */
	mix?: Record<string, number>
	mixOrder?: string[]
	mixColors?: Record<string, string>
	flags?: IBFlag[]
	/** An async read of the content: not-ready reads suspend into the Loading boundary. */
	content: () => IBNodeContent | null
	/** Grade-grouped contributors. Overrides `content.contributors` when given (the galaxy computes its own). */
	contributors?: NonNullable<IBNodeContent['contributors']> | null
	onVisit: (id: IBNodeId) => void
	/** Row hover mirrored into the host (the galaxy highlights the body). */
	onHoverNode?: (id: IBNodeId | null) => void
	/** Present only when the host can open document readings — the documents section's rows are actionable exactly then. */
	onOpenDocument?: (row: IBDocumentRow) => void
	/** The named up-destination; the control renders only when given. */
	upLabel?: string
	onUp?: () => void
	/** The visit chip inside an actionable analysed row. */
	visitLabel?: (row: IBFacetRow) => string
	errorLabel?: string
	class?: string
}

function MixBar(props: { mix: Record<string, number> | undefined; order?: string[]; colors?: Record<string, string> }) {
	const segments = () => {
		const mix = props.mix
		if (!mix) return []
		const order = props.order ?? Object.keys(mix)
		const total = order.reduce((sum, key) => sum + (mix[key] ?? 0), 0)
		if (total === 0) return []
		return order
			.filter((key) => (mix[key] ?? 0) > 0)
			.map((key) => ({
				key,
				share: ((mix[key] ?? 0) / total) * 100,
				color: props.colors?.[key] ?? 'var(--color-base-content-faint)',
			}))
	}
	return (
		<Show when={segments().length > 0}>
			<div class="ib-reader-mix" role="img" aria-label="Stance mix">
				<For each={segments()}>
					{(segment) => (
						<span style={{ 'inline-size': `${segment.share}%`, background: segment.color }} title={segment.key} />
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

/** Key points as an accordion — headline as the summary, the elaboration and
 * that point's verbatim quotes inside. The first point starts open so
 * something is always readable without a click; opening another does not
 * close it (settled 2026-09-14). */
function PointsSection(props: { points: IBPoint[]; label: string }) {
	return (
		<Accordion density="compact" spacing="joined" exclusive={false} label={props.label}>
			<For each={props.points}>
				{(point, at) => (
					<Show
						when={point.text.length > 0}
						fallback={
							<div class="ib-reader-point">
								<Quotes quotes={point.quotes} />
							</div>
						}
					>
						<AccordionItem summary={point.text} open={at() === 0}>
							<div class="ib-reader-point">
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
	const arcs = ['M8.4 15.2 A 5.1 5.1 0 0 1 15.6 15.2', 'M5.6 12.4 A 9.1 9.1 0 0 1 18.4 12.4', 'M2.8 9.6 A 13.1 13.1 0 0 1 21.2 9.6']
	return (
		<svg class="ib-reader-signal" viewBox="0 0 24 24" role="img" aria-label={props.label}>
			<title>{props.label}</title>
			<circle cx="12" cy="19" r="1.9" fill="currentColor" />
			<For each={arcs}>
				{(d, at) => <path d={d} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity={at() < props.strength ? 1 : 0.22} />}
			</For>
		</svg>
	)
}

function FacetBadge(props: { badge: string; badgeColor?: string }) {
	return (
		<span class="ib-reader-badge" style={props.badgeColor ? { background: props.badgeColor, color: '#fff' } : undefined}>
			{props.badge}
		</span>
	)
}

/** Actionable child-node rows with the reader's A–Z/reach ordering — never
 * pre-ranked (the Respect principles). */
function NodesSection(props: { section: Extract<IBContentSection, { kind: 'nodes' }>; onVisit: (id: IBNodeId) => void; onHoverNode?: (id: IBNodeId | null) => void }) {
	const [sort, setSort] = createSignal(DEFAULT_READING_SORT)
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
			<div class="ib-reader-nodes-head">
				<ReadingSortControl sort={sort()} onChange={setSort} />
			</div>
			<RichList label={props.section.title}>
				<For each={rows()}>
					{(row) => <RichListItem title={row.label} description={row.detail} onSelect={() => props.onVisit(row.id)} onHoverChange={(hovering) => props.onHoverNode?.(hovering ? row.id : null)} />}
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
 * accordion (badge and share in the summary; analysis, PROVENANCE QUOTES —
 * a hard requirement, 2026-08-16 — and a visit chip inside; first open,
 * several may be open). Bare rows (member-grade engagements, share-only
 * slices) follow as a subordinate list, previewed behind an expander when
 * long, actionable when they carry a node id. */
function FacetsSection(props: {
	section: Extract<IBContentSection, { kind: 'facets' }>
	onVisit: (id: IBNodeId) => void
	onHoverNode?: (id: IBNodeId | null) => void
	visitLabel: (row: IBFacetRow) => string
}) {
	const analysed = createMemo(() => props.section.rows.filter((row) => row.analysis || (row.quotes?.length ?? 0) > 0))
	const plain = createMemo(() => props.section.rows.filter((row) => !(row.analysis || (row.quotes?.length ?? 0) > 0)))
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
				<Accordion density="compact" spacing="joined" exclusive={false} label={props.section.title}>
					<For each={analysed()}>
						{(row, at) => (
							<AccordionItem
								summary={() => (
									<span class="ib-reader-acc-summary">
										<span class="ib-reader-acc-label">{row.label}</span>
										<Show when={row.badge}>{(badge) => <FacetBadge badge={badge()} badgeColor={row.badgeColor} />}</Show>
										<Show when={row.share !== undefined}>
											<span class="ib-reader-acc-share" title={`${Math.round((row.share ?? 0) * 100)}% of the written stances`}>
												<Meter value={(row.share ?? 0) * 100} max={100} />
											</span>
										</Show>
									</span>
								)}
								open={at() === 0}
							>
								<div class="ib-reader-point">
									<Show when={row.analysis}>{(analysis) => <p>{analysis()}</p>}</Show>
									<Quotes quotes={row.quotes} />
									<Show when={row.id}>
										{(id) => (
											<button type="button" class="ib-reader-chip" onClick={() => props.onVisit(id())} onPointerEnter={() => props.onHoverNode?.(id())} onPointerLeave={() => props.onHoverNode?.(null)}>
												{props.visitLabel(row)}
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
				<RichList label={props.section.title} titleSize="var(--t-sm)" titleInk="var(--color-base-content-muted)" rowPadBlock="0.35rem">
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
									row.signal !== undefined || row.badge !== undefined || row.share !== undefined ? (
										<span class="ib-reader-trailing">
											<Show when={row.signal} fallback={<Show when={row.badge}>{(badge) => <FacetBadge badge={badge()} badgeColor={row.badgeColor} />}</Show>}>
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
					<button type="button" class="ib-reader-show-all" onClick={() => setAllPlain((expanded) => !expanded)}>
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
	onOpenDocument?: (row: IBDocumentRow) => void
	visitLabel: (row: IBFacetRow) => string
}) {
	const section = props.section
	if (section.kind === 'points') return <PointsSection points={section.points} label={section.title} />
	if (section.kind === 'nodes') return <NodesSection section={section} onVisit={props.onVisit} onHoverNode={props.onHoverNode} />
	if (section.kind === 'facets') return <FacetsSection section={section} onVisit={props.onVisit} onHoverNode={props.onHoverNode} visitLabel={props.visitLabel} />
	if (section.kind === 'documents') {
		// Multi-document entities: rows open the DOCUMENT READING level
		// (settled 2026-08-16) when the host supplies onOpenDocument.
		return (
			<RichList label={section.title}>
				<For each={section.rows}>{(row) => <RichListItem title={row.label} description={row.detail} onSelect={props.onOpenDocument && (() => props.onOpenDocument?.(row))} />}</For>
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
								<span class="ib-reader-trailing">
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

function JumpChips(props: { entries: Array<{ id: IBNodeId; label: string }>; onVisit: (id: IBNodeId) => void; onHoverNode?: (id: IBNodeId | null) => void }) {
	return (
		<div class="ib-reader-related">
			<For each={props.entries}>
				{(entry) => (
					<button type="button" class="ib-reader-chip" onClick={() => props.onVisit(entry.id)} onPointerEnter={() => props.onHoverNode?.(entry.id)} onPointerLeave={() => props.onHoverNode?.(null)}>
						{entry.label}
					</button>
				)}
			</For>
		</div>
	)
}

/** Readings with more sections than this switch them with a section picker
 * instead of stacking them (settled 2026-09-03, kept for every surface
 * 2026-09-14): a source with stances, key points and documents was a very
 * long scroll. Lede and stats stay above the picker; the first section opens.
 * The picker is a SelectControl, not a tab strip: the pipeline's full titles
 * do not fit a narrow rail side by side. */
const STACKED_SECTIONS_MAX = 2

/** The sections of one reading — stacked when few, picked when many. The
 * chosen section is remembered against the sections array itself, so a new
 * reading starts on its first section without any reactive write. */
function ReaderSections(props: {
 section?: string
 onSectionChange?: (section: string) => void
	sections: IBContentSection[]
	onVisit: (id: IBNodeId) => void
	onHoverNode?: (id: IBNodeId | null) => void
	onOpenDocument?: (row: IBDocumentRow) => void
	visitLabel: (row: IBFacetRow) => string
}) {
	const [picked, setPicked] = createSignal<{ of: IBContentSection[]; id: string } | null>(null)
	const activeId = createMemo(() => {
		if (props.onSectionChange) {
   const at = props.sections.findIndex(section => section.title === props.section)
   return String(Math.max(0, at))
  }
  const pick = picked()
		return pick && pick.of === props.sections ? pick.id : '0'
	})
	const active = createMemo(() => props.sections[Number(activeId())] ?? props.sections[0])
	return (
		<Show
			when={props.sections.length > STACKED_SECTIONS_MAX}
			fallback={
				<For each={props.sections}>
					{(section) => (
						<section class="ib-reader-section">
							<Rule label={section.title} />
							<SectionBody section={section} onVisit={props.onVisit} onHoverNode={props.onHoverNode} onOpenDocument={props.onOpenDocument} visitLabel={props.visitLabel} />
						</section>
					)}
				</For>
			}
		>
			<div class="ib-reader-tabs">
				<SelectControl aria-label="Reading section" value={activeId()} onChange={(event) => {
     setPicked({ of: props.sections, id: event.currentTarget.value })
     const section = props.sections[Number(event.currentTarget.value)]
     if (section) props.onSectionChange?.(section.title)
    }}>
					<For each={props.sections}>{(section, at) => <option value={String(at())}>{section.title}</option>}</For>
				</SelectControl>
			</div>
			{/* KEYED: SectionBody reads its section once at creation (it branches
			    on `kind` in the component body), so switching must create a
			    fresh body rather than update the old one's props. */}
			<Show when={active()} keyed>
				{(section) => (
					<section class="ib-reader-section" aria-label={section.title}>
						<SectionBody section={section} onVisit={props.onVisit} onHoverNode={props.onHoverNode} onOpenDocument={props.onOpenDocument} visitLabel={props.visitLabel} />
					</section>
				)}
			</Show>
		</Show>
	)
}

function Contributors(props: { groups: NonNullable<IBNodeContent['contributors']>; onVisit: (id: IBNodeId) => void; onHoverNode?: (id: IBNodeId | null) => void }) {
	return (
		<section class="ib-reader-section">
			<Rule label="Contributors" />
			<Accordion density="compact" spacing="joined" exclusive={false} label="Contributors by grade">
				<For each={props.groups}>
					{(group, at) => (
						<AccordionItem summary={`${group.label} (${group.rows.length})`} open={at() === 0}>
							<RichList label={group.label}>
								<For each={group.rows}>{(row) => <RichListItem title={row.label} description={row.detail} onSelect={() => props.onVisit(row.id)} onHoverChange={(hovering) => props.onHoverNode?.(hovering ? row.id : null)} />}</For>
							</RichList>
						</AccordionItem>
					)}
				</For>
			</Accordion>
		</section>
	)
}

const DEFAULT_VISIT_LABEL = () => 'Open in the galaxy →'

export function Reading(props: ReadingProps) {
	const visitLabel = () => props.visitLabel ?? DEFAULT_VISIT_LABEL
	return (
		<div class={['ib-reader', props.class]}>
			<Show when={props.upLabel}>
				{(label) => (
					<button type="button" class="ib-reader-up" onClick={() => props.onUp?.()}>
						<span aria-hidden="true">‹</span> {label()}
					</button>
				)}
			</Show>
			<InspectorHeader eyebrow={props.eyebrow ? <Eyebrow>{props.eyebrow}</Eyebrow> : undefined} title={props.title}>
				<Show when={props.detail}>{(detail) => <p class="ib-reader-detail">{detail()}</p>}</Show>
				<MixBar mix={props.mix} order={props.mixOrder} colors={props.mixColors} />
				<Show when={(props.flags?.length ?? 0) > 0}>
					<div class="ib-reader-flags">
						<For each={props.flags}>
							{(flag) => (
								<span class={['ib-reader-flag', { 'ib-reader-flag-hot': flag.hot === true }]} title={flag.tip}>
									{flag.label}
								</span>
							)}
						</For>
					</div>
				</Show>
			</InspectorHeader>
			<Errored fallback={(err) => <p class="ib-reader-error">{`${props.errorLabel ?? "Couldn't load this reading"}: ${String(err())}`}</p>}>
				<Loading fallback={<p class="ib-reader-pending">Reading the record…</p>}>
					{(() => {
						const value = props.content()
						return (
							<Show when={value}>
								{(content) => (
									<>
										<div class="ib-reader-head">
											<Show when={content().lede}>{(lede) => <p class="ib-reader-lede">{lede()}</p>}</Show>
											<Show when={(content().stats?.length ?? 0) > 0}>
												<div class="ib-reader-stats">
													<For each={content().stats}>
														{(stat) => (
															<span class="ib-reader-badge">
																<strong>{stat.value}</strong> {stat.label}
															</span>
														)}
													</For>
												</div>
											</Show>
											<Show when={(content().flags?.length ?? 0) > 0}>
												<div class="ib-reader-flags">
													<For each={content().flags}>
														{(flag) => (
															<span class={['ib-reader-flag', { 'ib-reader-flag-hot': flag.hot === true }]} title={flag.tip}>
																{flag.label}
															</span>
														)}
													</For>
												</div>
											</Show>
										</div>
										<ReaderSections section={props.section} onSectionChange={props.onSectionChange} sections={content().sections} onVisit={props.onVisit} onHoverNode={props.onHoverNode} onOpenDocument={props.onOpenDocument} visitLabel={visitLabel()} />
										<Show when={props.contributors ?? content().contributors}>{(groups) => <Contributors groups={groups()} onVisit={props.onVisit} onHoverNode={props.onHoverNode} />}</Show>
										<Show when={(content().related?.length ?? 0) > 0}>
											<section class="ib-reader-section">
												<Rule label="Related" />
												<JumpChips entries={content().related ?? []} onVisit={props.onVisit} onHoverNode={props.onHoverNode} />
											</section>
										</Show>
										<Show when={(content().links?.length ?? 0) > 0}>
											<div class="ib-reader-links">
												<For each={content().links}>
													{(link) => (
														<a class="ib-reader-chip" href={link.href} target="_blank" rel="noreferrer">
															{link.label} ↗
														</a>
													)}
												</For>
											</div>
										</Show>
									</>
								)}
							</Show>
						)
					})()}
				</Loading>
			</Errored>
		</div>
	)
}
