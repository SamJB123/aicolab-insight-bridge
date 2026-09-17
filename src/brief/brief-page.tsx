/**
 * The Brief — the canonical Topics page, for every Insight Bridge corpus.
 *
 * A layered reading of the record in DocsShell: chapters on the left, "on
 * this page" on the right, a reading-progress bar, and a compass on phones.
 *
 * Generation-agnostic in the three shapes a run can take. Each app used to
 * implement a different subset, which is how High Water and Long Form both
 * shipped a broken one-generation page:
 *
 *   no grouping layer   the TOPICS are the chapters, with the whole sky and a
 *                       reach figure up top;
 *   one grouping layer  the ROOTS are the chapters, each listing its own
 *                       topics and reading as a theme;
 *   two or more         the roots are the chapters and their children are
 *                       theme sections within them.
 *
 * All text is the pipeline's. All figures are live. The only per-app content
 * is the vocabulary on the surface.
 */
import { DocsShell } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { Constellation, createHover, type Hover, PositionLegend, ReachBars } from './figures.tsx'
import { Claim, FactsStrip, ScaleLine } from './nodes.tsx'
import { ChapterReadingView, TopicList } from './reading.tsx'
import { type BriefSurface, BriefSurfaceContext, n, plural, useBriefSurface } from './surface.tsx'
import type { BriefData, BriefFamily, BriefNode, BriefTheme } from './types.ts'
import './brief.css'

/** Chapters this small get a compact section: claim, description and facts, no figure row. */
const SMALL_TOPICS = 3

export function BriefPage(props: { d: BriefData; surface: BriefSurface }) {
	return (
		<BriefSurfaceContext value={props.surface}>
			<div class="ib-brief">
				<BriefBody d={props.d} />
			</div>
		</BriefSurfaceContext>
	)
}

function BriefBody(props: { d: BriefData }) {
	const s = useBriefSurface()
	// `props.d` is read only inside this accessor: props are reactive values in
	// Solid 2, and the property ACCESS is what tracks — a top-level read in the
	// component body both warns and reads once.
	const d = () => props.d
	const hover = createHover()
	const [expandAll, setExpandAll] = createSignal(false)
	const single = () => d().singleGeneration
	const themeCount = () => Object.keys(d().themes).length
	/** With no tree, or one generation, the whole sky sits above the chapters. */
	const skyUpTop = () => d().flat || single()
	const nav = () =>
		d().flat
			? d().topicOrder.map((id) => ({ label: d().topics[id]?.subject ?? '', href: `#t-${id}` }))
			: d().families.map((f) => ({
					label: f.subject,
					href: single() ? `#t-${f.id}` : `#f-${f.id}`,
				}))
	const navLabel = () => (d().flat ? 'Topics' : single() ? 'Themes' : 'Families')
	const unit = () => (d().flat ? 'topic' : 'theme')

	return (
		<DocsShell
			nav={nav()}
			navLabel={navLabel()}
			maxWidth="92rem"
			sideWidth="15rem"
			stickyTop="var(--mast-h)"
		>
			<header class="ib-bp-head">
				<h1 class="ib-bp-title">{s.vocabulary.title}</h1>
				<p class="ib-bp-stand">
					<Show when={s.vocabulary.standfirst} fallback={<Standfirst d={d()} />}>
						{s.vocabulary.standfirst}
					</Show>
				</p>
				<ol class="ib-bp-chapters" aria-label={navLabel()}>
					<Show
						when={!d().flat}
						fallback={
							<For each={d().topicOrder}>
								{(id, i) => (
									<Show when={d().chapters[id]}>
										{(c) => <ChapterLink href={`#t-${id}`} num={i() + 1} node={c()} />}
									</Show>
								)}
							</For>
						}
					>
						<For each={d().families}>
							{(f, i) => (
								<ChapterLink
									href={single() ? `#t-${f.id}` : `#f-${f.id}`}
									num={i() + 1}
									node={f}
									themes={single() ? undefined : f.themeIds.length}
								/>
							)}
						</For>
					</Show>
				</ol>
				<Show when={skyUpTop()}>
					<div class="ib-bp-figs-wide">
						<figure class="ib-bp-cst-fig">
							<Constellation
								d={d()}
								ids={d().topicOrder}
								hover={hover}
								ratio={2.1}
								label={`The ${d().topicOrder.length} topics as stars`}
							/>
							<figcaption class="ib-bp-fig-k">
								The topics in the galaxy · size is reach, warmth is how contested
							</figcaption>
						</figure>
						<ReachBars
							d={d()}
							ids={d().topicOrder}
							hover={hover}
							title={`Topics, by how many ${s.vocabulary.sources} engage them`}
						/>
					</div>
				</Show>
				<div class="ib-bp-tools">
					<button
						type="button"
						class="ib-bp-btn"
						onClick={() => setExpandAll((v) => !v)}
						aria-pressed={expandAll() ? 'true' : 'false'}
					>
						{expandAll() ? `Fold every ${unit()}` : `Unfold every ${unit()}`}
					</button>
					<PositionLegend />
				</div>
			</header>

			<Show
				when={!d().flat}
				fallback={
					<For each={d().topicOrder}>
						{(id, i) => (
							<TopicChapter d={d()} id={id} num={i() + 1} hover={hover} expandAll={expandAll()} />
						)}
					</For>
				}
			>
				<Show
					when={!single()}
					fallback={
						<For each={d().families}>
							{(f, i) => (
								<Show when={d().themes[f.id]}>
									{(t) => (
										<ThemeChapter
											d={d()}
											t={t()}
											num={i() + 1}
											hover={hover}
											expandAll={expandAll()}
										/>
									)}
								</Show>
							)}
						</For>
					}
				>
					<For each={d().families}>
						{(f, i) => (
							<FamilyChapter d={d()} f={f} num={i() + 1} hover={hover} expandAll={expandAll()} />
						)}
					</For>
				</Show>
			</Show>

			<Show when={d().deeperTree}>
				<p class="ib-bp-fig-k">
					This run's tree has more than two grouping generations; the brief shows the roots and
					their direct children only.
				</p>
			</Show>
			<Show when={themeCount() === 0 && !d().flat}>
				<p class="ib-bp-fig-k">This run built no themes beneath its roots.</p>
			</Show>
		</DocsShell>
	)
}

function Standfirst(props: { d: BriefData }) {
	const s = useBriefSurface()
	const themeCount = () => Object.keys(props.d.themes).length
	return (
		<Show
			when={!props.d.flat}
			fallback={
				<>
					The pipeline sorted the {s.vocabulary.sources} into {n(props.d.scale.topics)} topics and
					wrote a claim and a description for each. This page shows those claims with the figures
					behind them. Every number is computed when the page loads.
				</>
			}
		>
			The pipeline sorted the {s.vocabulary.sources} into {n(props.d.scale.topics)} topics
			{props.d.singleGeneration ? '' : `, ${themeCount()} themes`} and {props.d.families.length}{' '}
			{props.d.singleGeneration ? 'themes' : 'families'}, and wrote a claim and a description for
			each. This page shows those claims with the figures behind them. Every number is computed when
			the page loads.
		</Show>
	)
}

function ChapterLink(props: { href: string; num: number; node: BriefNode; themes?: number }) {
	const s = useBriefSurface()
	return (
		<li>
			<a href={props.href} class="ib-bp-chapter-link">
				<span class="ib-bp-chapter-num">{String(props.num).padStart(2, '0')}</span>
				<span class="ib-bp-chapter-body">
					<span class="ib-bp-chapter-subject">{props.node.subject}</span>
					<span class="ib-bp-chapter-claim">{props.node.claim}</span>
					<span class="ib-bp-chapter-n">
						<Show when={props.themes != null}>{plural(props.themes ?? 0, 'theme')} · </Show>
						<Show when={props.node.kind !== 'topic'}>{plural(props.node.topics, 'topic')} · </Show>
						{plural(props.node.sources, s.vocabulary.source, s.vocabulary.sources)}
					</span>
				</span>
			</a>
		</li>
	)
}

/** A folded reading, with the summary line every chapter shares. The children
 *  are a JSX getter, so nothing inside is built until the fold is open. */
function Fold(props: { label: string; note: string; expandAll: boolean; children?: JSX.Element }) {
	const [opened, setOpened] = createSignal(false)
	const isOpen = () => props.expandAll || opened()
	return (
		<details
			class="ib-bp-read"
			open={isOpen() || undefined}
			onToggle={(e) => e.currentTarget.open && setOpened(true)}
		>
			<summary class="ib-bp-read-s">
				<span class="ib-bp-read-t">{props.label}</span>
				<span class="ib-bp-read-n">{props.note}</span>
			</summary>
			<Show when={isOpen()}>{props.children}</Show>
		</details>
	)
}

/* ── no grouping layer: each topic is a chapter ─────────────────────────── */

function TopicChapter(props: {
	d: BriefData
	id: number
	num: number
	hover: Hover
	expandAll: boolean
}) {
	const s = useBriefSurface()
	const c = () => props.d.chapters[props.id]
	return (
		<Show when={c()}>
			{(c) => (
				<section
					class="ib-bp-chapter is-topic"
					onMouseEnter={() => props.hover.set(props.id)}
					onMouseLeave={() => props.hover.set(null)}
				>
					<ScaleLine node={c()} kicker={`Topic ${String(props.num).padStart(2, '0')}`} />
					<h2 id={`t-${props.id}`} class="ib-bp-h2">
						{c().subject}
					</h2>
					<Claim node={c()} />
					<p class="ib-bp-desc">{c().description}</p>
					<FactsStrip d={props.d} node={c()} />
					<Fold
						label="Read the topic"
						note={`key points and quotes · who says what · ${s.vocabulary.sources} that push back`}
						expandAll={props.expandAll}
					>
						<ChapterReadingView
							d={props.d}
							chapterId={props.id}
							topicIds={[props.id]}
							hover={props.hover}
							single
						/>
					</Fold>
				</section>
			)}
		</Show>
	)
}

/* ── one grouping layer: each root is a chapter, its topics beneath ─────── */

function ThemeChapter(props: {
	d: BriefData
	t: BriefTheme
	num: number
	hover: Hover
	expandAll: boolean
}) {
	const s = useBriefSurface()
	const small = () => props.t.topics <= SMALL_TOPICS
	return (
		<section class={['ib-bp-chapter', { 'is-small': small() }]}>
			<ScaleLine node={props.t} kicker={`Theme ${String(props.num).padStart(2, '0')}`} />
			<h2 id={`t-${props.t.id}`} class="ib-bp-h2">
				{props.t.subject}
			</h2>
			<Claim node={props.t} />
			<p class="ib-bp-desc">{props.t.description}</p>
			<FactsStrip d={props.d} node={props.t} compact={small()} />
			<Show when={!small()}>
				<div class="ib-bp-figs">
					<ReachBars
						d={props.d}
						ids={props.t.topicIds}
						hover={props.hover}
						title={`Topics, by how many ${s.vocabulary.sources} engage them`}
					/>
					<figure class="ib-bp-cst-fig">
						<Constellation
							d={props.d}
							ids={props.t.topicIds}
							hover={props.hover}
							ratio={1.3}
							label={`The ${props.t.topics} topics of this theme as stars`}
						/>
						<figcaption class="ib-bp-fig-k">
							The same topics in the galaxy · size is reach, warmth is how contested
						</figcaption>
					</figure>
				</div>
			</Show>
			{/* The theme's topics as h3[id]s, so "On this page" lists them under it. */}
			<section class="ib-bp-reading-sec">
				<h4 class="ib-bp-reading-h">
					Topics in this theme <span class="ib-bp-reading-n">{n(props.t.topics)}</span>
				</h4>
				<TopicList d={props.d} ids={props.t.topicIds} hover={props.hover} headings />
			</section>
			<Fold
				label="Read the theme"
				note={`key points and quotes · who says what · ${s.vocabulary.sources} that push back`}
				expandAll={props.expandAll}
			>
				<ChapterReadingView
					d={props.d}
					chapterId={props.t.id}
					topicIds={props.t.topicIds}
					hover={props.hover}
					showTopics={false}
				/>
			</Fold>
		</section>
	)
}

/* ── two generations or more: families with theme sections ──────────────── */

function FamilyChapter(props: {
	d: BriefData
	f: BriefFamily
	num: number
	hover: Hover
	expandAll: boolean
}) {
	const topicIds = createMemo(() =>
		props.f.themeIds.flatMap((id) => props.d.themes[id]?.topicIds ?? []),
	)
	const [litTheme, setLitTheme] = createSignal<number | null>(null)
	const lit = (topicId: number) => {
		const t = litTheme()
		return t == null || props.d.topics[topicId]?.parentId === t
	}
	return (
		<section class="ib-bp-chapter">
			<ScaleLine
				node={props.f}
				themes={props.f.themeIds.length}
				kicker={`Family ${String(props.num).padStart(2, '0')}`}
			/>
			<h2 id={`f-${props.f.id}`} class="ib-bp-h2">
				{props.f.subject}
			</h2>
			<Claim node={props.f} />
			<p class="ib-bp-desc">{props.f.description}</p>
			<div class="ib-bp-figs-wide">
				<div class="ib-bp-sky">
					<Constellation
						d={props.d}
						ids={topicIds()}
						hover={props.hover}
						ratio={2.1}
						lit={lit}
						label={`The ${topicIds().length} topics of this family as stars`}
					/>
					<ul class="ib-bp-sky-key" aria-label="Themes">
						<For each={props.f.themeIds}>
							{(id) => (
								<li>
									<a
										href={`#t-${id}`}
										onMouseEnter={() => setLitTheme(id)}
										onMouseLeave={() => setLitTheme(null)}
										onFocus={() => setLitTheme(id)}
										onBlur={() => setLitTheme(null)}
									>
										<span>{props.d.themes[id]?.subject}</span>
										<span class="ib-bp-sky-key-n">{props.d.themes[id]?.topics}</span>
									</a>
								</li>
							)}
						</For>
					</ul>
				</div>
				<FactsStrip d={props.d} node={props.f} />
			</div>
			<For each={props.f.themeIds}>
				{(id, j) => (
					<Show when={props.d.themes[id]}>
						{(t) => (
							<ThemeSection
								d={props.d}
								t={t()}
								num={`${props.num}.${j() + 1}`}
								hover={props.hover}
								expandAll={props.expandAll}
							/>
						)}
					</Show>
				)}
			</For>
		</section>
	)
}

function ThemeSection(props: {
	d: BriefData
	t: BriefTheme
	num: string
	hover: Hover
	expandAll: boolean
}) {
	const s = useBriefSurface()
	const small = () => props.t.topics <= SMALL_TOPICS
	return (
		<section class={['ib-bp-theme', { 'is-small': small() }]}>
			<ScaleLine node={props.t} kicker={`Theme ${props.num}`} />
			<h3 id={`t-${props.t.id}`} class="ib-bp-h3">
				{props.t.subject}
			</h3>
			<Claim node={props.t} />
			<p class="ib-bp-desc">{props.t.description}</p>
			<FactsStrip d={props.d} node={props.t} compact={small()} />
			<Show when={!small()}>
				<div class="ib-bp-figs">
					<ReachBars
						d={props.d}
						ids={props.t.topicIds}
						hover={props.hover}
						title={`Topics, by how many ${s.vocabulary.sources} engage them`}
					/>
					<figure class="ib-bp-cst-fig">
						<Constellation
							d={props.d}
							ids={props.t.topicIds}
							hover={props.hover}
							ratio={1.3}
							label={`The ${props.t.topics} topics of this theme as stars`}
						/>
						<figcaption class="ib-bp-fig-k">
							The same topics in the galaxy · size is reach, warmth is how contested
						</figcaption>
					</figure>
				</div>
			</Show>
			<Fold
				label="Read the theme"
				note={`${plural(props.t.topics, 'topic')} · key points and quotes · who says what · ${s.vocabulary.sources} that push back`}
				expandAll={props.expandAll}
			>
				<ChapterReadingView
					d={props.d}
					chapterId={props.t.id}
					topicIds={props.t.topicIds}
					hover={props.hover}
					topicLimit={small() ? 12 : 8}
				/>
			</Fold>
		</section>
	)
}
