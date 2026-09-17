/**
 * A chapter's reading, assembled from what the pipeline wrote for it: its
 * topics in reach order with their one-line descriptions, the key points of
 * its most-read topics with a verbatim quote each, who says what across EVERY
 * declared facet, and the contributors whose position contests a claim.
 *
 * The same view reads a grouping node (several topics, three points each) or
 * a single topic (every point).
 */
import { Loading } from '@solidjs/web'
import { createMemo, For, Show } from 'solid-js'
import { FacetMatrix, type Hover, PositionBar, topicsOf } from './figures.tsx'
import { SourceChip, TopicChip } from './nodes.tsx'
import { n, plural, useBriefSurface } from './surface.tsx'
import type { BriefData, BriefTopic, Pushback as PushbackRow, ReadingPoint } from './types.ts'

/** One quote with its contributor, as the pipeline attached it to a key point. */
export function Quote(props: { q: NonNullable<ReadingPoint['quote']> }) {
	const s = useBriefSurface()
	return (
		<blockquote class="ib-bp-rq">
			<p class="ib-bp-rq-text">{props.q.text}</p>
			<footer class="ib-bp-rq-src">
				<button type="button" class="ib-bp-rq-btn" onClick={() => s.openSource(props.q.entityId)}>
					{props.q.source}
				</button>
				<Show when={props.q.detail}>
					<span class="ib-bp-rq-meta">{props.q.detail}</span>
				</Show>
			</footer>
		</blockquote>
	)
}

/** Key points grouped by topic, in the pipeline's order. */
export function KeyPoints(props: {
	d: BriefData
	points: ReadingPoint[]
	hover?: Hover
	details?: boolean
	headings?: boolean
}) {
	const groups = createMemo(() => {
		const by = new Map<number, ReadingPoint[]>()
		for (const p of props.points) by.set(p.topicId, [...(by.get(p.topicId) ?? []), p])
		return [...by.entries()].map(([topicId, points]) => ({ topicId, points }))
	})
	return (
		<div class="ib-bp-kp">
			<For each={groups()}>
				{(g) => (
					<section class={['ib-bp-kp-topic', { 'is-active': props.hover?.active() === g.topicId }]}>
						<Show when={props.headings !== false}>
							<h4 class="ib-bp-kp-h">
								<TopicChip d={props.d} id={g.topicId} hover={props.hover} full />
							</h4>
						</Show>
						<ol class="ib-bp-kp-list">
							<For each={g.points}>
								{(p) => (
									<li>
										<p class="ib-bp-kp-point">{p.point}</p>
										<Show when={props.details && p.details}>
											<p class="ib-bp-kp-details">{p.details}</p>
										</Show>
										<Show when={p.quote}>{(q) => <Quote q={q()} />}</Show>
									</li>
								)}
							</For>
						</ol>
					</section>
				)}
			</For>
		</div>
	)
}

/** Every topic under a node, by reach, with its one-line description. With
 *  `headings`, each subject is an h3[id] so the shell lists them in place. */
export function TopicList(props: {
	d: BriefData
	ids: number[]
	hover?: Hover
	limit?: number
	headings?: boolean
}) {
	const s = useBriefSurface()
	const topics = createMemo(() => topicsOf(props.d, props.ids))
	const limit = () => props.limit ?? topics().length
	const rows = () => topics().slice(0, limit())
	const rest = () => topics().slice(limit())
	const Row = (t: BriefTopic) => {
		const single = () =>
			props.d.facets.map((f) => ({ f, value: t.singleValue[f.key] })).find((x) => x.value)
		return (
			<li
				class={['ib-bp-tl-row', { 'is-active': props.hover?.active() === t.id }]}
				onMouseEnter={() => props.hover?.set(t.id)}
				onMouseLeave={() => props.hover?.set(null)}
			>
				<Show
					when={props.headings}
					fallback={
						<button type="button" class="ib-bp-tl-title" onClick={() => s.openTopic(t.id)}>
							<span class="ib-bp-tl-subject">{t.subject}</span>
							<Show when={t.claim}>
								<span class="ib-bp-tl-claim">{t.claim}</span>
							</Show>
						</button>
					}
				>
					<h3 id={`tp-${t.id}`} class="ib-bp-tl-h3">
						<button type="button" class="ib-bp-tl-title" onClick={() => s.openTopic(t.id)}>
							<span class="ib-bp-tl-subject">{t.subject}</span>
						</button>
					</h3>
					<Show when={t.claim}>
						<p class="ib-bp-tl-claim-line">{t.claim}</p>
					</Show>
				</Show>
				<p class="ib-bp-tl-desc">{t.description}</p>
				<div class="ib-bp-tl-facts">
					<span class="ib-bp-tl-bar">
						<PositionBar positions={t.positions} height="5px" />
					</span>
					<span>{plural(t.sources, s.vocabulary.source, s.vocabulary.sources)}</span>
					<Show when={single()}>
						{(one) => (
							<span class="ib-bp-tl-flag" title={`Only ${one().value} speaks here`}>
								1 {one().f.label}
							</span>
						)}
					</Show>
				</div>
			</li>
		)
	}
	return (
		<div>
			<ol class="ib-bp-tl-list">
				<For each={rows()}>{Row}</For>
			</ol>
			<Show when={rest().length}>
				<details class="ib-bp-tl-rest">
					<summary>{plural(rest().length, 'more topic')}</summary>
					<ol class="ib-bp-tl-list" style={{ 'counter-reset': `ib-bp-tl ${limit()}` }}>
						<For each={rest()}>{Row}</For>
					</ol>
				</details>
			</Show>
		</div>
	)
}

/** Contributors whose written position contests a topic's claim. */
export function Pushback(props: {
	d: BriefData
	rows: PushbackRow[]
	hover?: Hover
	single?: boolean
}) {
	const s = useBriefSurface()
	return (
		<Show
			when={props.rows.length}
			fallback={
				<p class="ib-bp-pb-none">
					No {s.vocabulary.source}'s position contests{' '}
					{props.single ? "this topic's claim" : "these topics' claims"}.
				</p>
			}
		>
			<ul class="ib-bp-pb">
				<For each={props.rows}>
					{(r) => (
						<li class={['ib-bp-pb-row', { 'is-active': props.hover?.active() === r.topicId }]}>
							<div class="ib-bp-pb-head">
								<SourceChip id={r.entityId} name={r.name} detail={r.detail} />
								<Show when={r.detail}>
									<span class="ib-bp-rq-meta">{r.detail}</span>
								</Show>
								<span class="ib-bp-pb-chip">
									<span class="ib-bp-pb-dot" style={{ background: s.positionColors[r.position] }} />
									{r.position}
								</span>
							</div>
							<p class="ib-bp-pb-title">{r.title}</p>
							<Show when={!props.single}>
								<p class="ib-bp-pb-on">
									on <TopicChip d={props.d} id={r.topicId} hover={props.hover} />
								</p>
							</Show>
						</li>
					)}
				</For>
			</ul>
		</Show>
	)
}

/**
 * The full reading for one chapter. Fetches on first render and shows the
 * pipeline's sections in a fixed order, so every chapter reads the same way:
 * what they say, who says what (once per declared facet), who pushes back.
 */
export function ChapterReadingView(props: {
	d: BriefData
	chapterId: number
	topicIds: number[]
	hover?: Hover
	/** A single topic reads every point it has; a group reads three per topic. */
	single?: boolean
	/** False when the chapter already lists its topics above the fold. */
	showTopics?: boolean
	topicLimit?: number
}) {
	const s = useBriefSurface()
	const reading = createMemo(() =>
		s.loadReading(props.chapterId, props.topicIds, props.single === true),
	)
	return (
		<div class="ib-bp-reading">
			<Show when={props.showTopics !== false && !props.single}>
				<section class="ib-bp-reading-sec">
					<h4 class="ib-bp-reading-h">
						Topics here <span class="ib-bp-reading-n">{n(props.topicIds.length)}</span>
					</h4>
					<TopicList
						d={props.d}
						ids={props.topicIds}
						hover={props.hover}
						limit={props.topicLimit ?? 8}
					/>
				</section>
			</Show>
			<Loading fallback={<p class="ib-bp-reading-loading">Reading the record…</p>}>
				<Show when={reading()}>
					{(r) => (
						<>
							<section class="ib-bp-reading-sec">
								<h4 class="ib-bp-reading-h">
									What the {s.vocabulary.sources} say{' '}
									<span class="ib-bp-reading-sub">
										{props.single
											? `${plural(r().points.length, 'key point')} the pipeline wrote for this topic`
											: `key points from the ${r().topicIds.length} most-read topics`}
									</span>
								</h4>
								<KeyPoints
									d={props.d}
									points={r().points}
									hover={props.hover}
									headings={!props.single}
									details={props.single}
								/>
							</section>
							{/* One section per DECLARED facet — but only where the run
							    actually wrote perspectives for it. A corpus may surface a
							    facet for its shares and distributions without the
							    clustering stage having analysed positions along it. */}
							<For each={props.d.facets}>
								{(f) => (
									<Show when={r().pins.some((p) => p.facet === f.key)}>
										<section class="ib-bp-reading-sec">
											<h4 class="ib-bp-reading-h">Who says what, by {f.label}</h4>
											<p class="ib-bp-reading-note">
												Each {f.label}'s overall position on the topic's claim, as the pipeline
												read that {f.label}'s {s.vocabulary.sources} together.
											</p>
											<FacetMatrix
												d={props.d}
												ids={r().topicIds}
												pins={r().pins}
												facet={f.key}
												label={f.label}
												hover={props.hover}
											/>
										</section>
									</Show>
								)}
							</For>
							<section class="ib-bp-reading-sec">
								<h4 class="ib-bp-reading-h">
									{s.vocabulary.sources.charAt(0).toUpperCase() + s.vocabulary.sources.slice(1)}{' '}
									that push back <span class="ib-bp-reading-n">{r().pushback.length}</span>
								</h4>
								<Pushback
									d={props.d}
									rows={r().pushback}
									hover={props.hover}
									single={props.single}
								/>
							</section>
						</>
					)}
				</Show>
			</Loading>
		</div>
	)
}
