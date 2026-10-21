/**
 * Topic search — the reader's own words against the record, by meaning: the
 * human counterpart to the MCP find_topics tool. Relevance becomes distance
 * from the reader at the centre, and a small force simulation settles the
 * topics into place without overlapping. A topic opens its reading.
 *
 * The host owns the URL and the index: it hands the page the query in the
 * URL, is told when the reader asks a new one, and supplies `search`, which
 * embeds the query, asks its own vector index and returns core's
 * `topicSearch`. Moved from Training Data's routes/topic-search.tsx
 * (2026-10-21).
 */
import type { TopicHit } from '@aicolab/insight-bridge-contracts/explorer'
import { Eyebrow } from '@aicolab/ui-solid'
import { createEffect, createSignal, For, onSettled, Show, untrack } from 'solid-js'
import { type ReportSurface, ReportSurfaceContext, useReportSurface } from './surface.tsx'
import './report.css'

export function TopicSearchPage(props: {
	/** The query in the URL; absent when none has been asked. */
	query: string | undefined
	/** The reader asked a new query. */
	onQuery: (query: string) => void
	search: (query: string) => Promise<TopicHit[]>
	/** An example of a question, in the corpus's own terms. */
	placeholder: string
	surface: ReportSurface
}) {
	return (
		<ReportSurfaceContext value={props.surface}>
			<TopicSearchBody
				query={props.query}
				onQuery={props.onQuery}
				search={props.search}
				placeholder={props.placeholder}
			/>
		</ReportSurfaceContext>
	)
}

type OrbitNode = TopicHit & {
	x: number
	y: number
	vx: number
	vy: number
	r: number
	targetRadius: number
	angle: number
}

const hash = (value: number) => {
	let x = Math.sin(value * 999.91) * 43758.5453
	x -= Math.floor(x)
	return x
}

function TopicOrbit(props: { topics: TopicHit[]; query: string }) {
	const s = useReportSurface()
	let host!: HTMLElement
	let frame = 0
	const [size, setSize] = createSignal({ width: 900, height: 620 })
	const [nodes, setNodes] = createSignal<OrbitNode[]>([])

	onSettled(() => {
		if (typeof ResizeObserver === 'undefined' || !host) return
		const observer = new ResizeObserver(([entry]) => {
			if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
		})
		observer.observe(host)
		return () => observer.disconnect()
	})

	createEffect(
		() => ({ topics: props.topics, size: size() }),
		({ topics, size: { width, height } }) => {
			if (typeof requestAnimationFrame === 'undefined') return
			cancelAnimationFrame(frame)
			if (!topics.length) {
				setNodes([])
				return () => cancelAnimationFrame(frame)
			}
			const centreX = width / 2
			const centreY = height / 2
			const maxOrbit = Math.max(145, Math.min(width, height) / 2 - 72)
			const scores = topics.map((topic) => topic.relevance)
			const high = Math.max(...scores)
			const low = Math.min(...scores)
			const spread = Math.max(0.001, high - low)
			const previous = new Map(untrack(nodes).map((node) => [node.topicClusterId, node]))
			const next = topics.map((topic, index): OrbitNode => {
				const relevance = (topic.relevance - low) / spread
				const angle = index * 2.399963 + (hash(topic.topicClusterId) - 0.5) * 0.35
				const old = previous.get(topic.topicClusterId)
				return {
					...topic,
					x: old?.x ?? centreX + (hash(topic.topicClusterId) - 0.5) * 20,
					y: old?.y ?? centreY + (hash(topic.topicClusterId + 7) - 0.5) * 20,
					vx: 0,
					vy: 0,
					r: Math.min(66, 38 + Math.sqrt(topic.sources) * 1.35),
					targetRadius: 96 + (1 - relevance) * (maxOrbit - 96),
					angle,
				}
			})
			let tick = 0
			const simulate = () => {
				tick++
				for (const node of next) {
					const targetX = centreX + Math.cos(node.angle) * node.targetRadius
					const targetY = centreY + Math.sin(node.angle) * node.targetRadius
					node.vx += (targetX - node.x) * 0.035
					node.vy += (targetY - node.y) * 0.035
					const dx = node.x - centreX
					const dy = node.y - centreY
					const distance = Math.max(0.1, Math.hypot(dx, dy))
					const minimum = node.r + 72
					if (distance < minimum) {
						const force = (minimum - distance) * 0.12
						node.vx += (dx / distance) * force
						node.vy += (dy / distance) * force
					}
				}
				for (let a = 0; a < next.length; a++) {
					for (let b = a + 1; b < next.length; b++) {
						const left = next[a]
						const right = next[b]
						if (!left || !right) continue
						const dx = right.x - left.x
						const dy = right.y - left.y
						const distance = Math.max(0.1, Math.hypot(dx, dy))
						const minimum = left.r + right.r + 7
						if (distance >= minimum) continue
						const force = ((minimum - distance) / distance) * 0.075
						const fx = dx * force
						const fy = dy * force
						left.vx -= fx
						left.vy -= fy
						right.vx += fx
						right.vy += fy
					}
				}
				for (const node of next) {
					node.vx *= 0.82
					node.vy *= 0.82
					node.x = Math.max(node.r, Math.min(width - node.r, node.x + node.vx))
					node.y = Math.max(node.r, Math.min(height - node.r, node.y + node.vy))
				}
				setNodes(next.map((node) => ({ ...node })))
				if (tick < 180) frame = requestAnimationFrame(simulate)
			}
			frame = requestAnimationFrame(simulate)
			return () => cancelAnimationFrame(frame)
		},
	)

	return (
		<section ref={host} class="topic-orbit" aria-label="Semantic topic relevance map">
			<div class="topic-orbit-rings" aria-hidden="true" />
			<div class="topic-person" role="img" aria-label="Your area of interest">
				<span>You</span>
				<small>{props.query || 'Your interests'}</small>
			</div>
			<For each={nodes()}>
				{(node) => (
					<button
						type="button"
						class="topic-bubble"
						style={{
							left: `${node.x}px`,
							top: `${node.y}px`,
							width: `${node.r * 2}px`,
							height: `${node.r * 2}px`,
							'--relevance': `${Math.max(0, Math.min(1, 1 - (node.targetRadius - 96) / 260))}`,
						}}
						onClick={() => s.open({ kind: 'topic', key: node.topicClusterId })}
						title={`${node.title} · relevance ${node.relevance.toFixed(2)} · ${node.sources} ${s.words.nouns.entities}${node.lineage[0] ? ` · ${node.lineage[0].title}` : ''}`}
					>
						<span>{node.title}</span>
						<small>
							{node.sources} {s.words.nouns.entities}
						</small>
					</button>
				)}
			</For>
		</section>
	)
}

function TopicSearchBody(props: {
	query: string | undefined
	onQuery: (query: string) => void
	search: (query: string) => Promise<TopicHit[]>
	placeholder: string
}) {
	const s = useReportSurface()
	const lens = () => {
		const facet = s.words.lens
		return facet ? (s.words.facets[facet]?.heading ?? facet) : 'Group'
	}
	const [query, setQuery] = createSignal(untrack(() => props.query ?? ''))
	const [searchedQuery, setSearchedQuery] = createSignal('')
	const [topics, setTopics] = createSignal<TopicHit[]>([])
	const [searching, setSearching] = createSignal(false)
	const [error, setError] = createSignal('')

	// the URL's query is the one searched; a newer one supersedes an answer still on its way
	let request = 0
	createEffect(
		() => props.query,
		(value) => {
			const current = ++request
			setQuery(value ?? '')
			setError('')
			if (!value) {
				setTopics([])
				setSearchedQuery('')
				setSearching(false)
				return
			}
			setSearching(true)
			void props
				.search(value)
				.then((result) => {
					if (current !== request) return
					setSearchedQuery(value)
					setTopics(result)
				})
				.catch((cause) => {
					if (current === request)
						setError(
							cause instanceof Error ? cause.message : 'Topic search failed. Please try again.',
						)
				})
				.finally(() => {
					if (current === request) setSearching(false)
				})
		},
	)
	const submit = (event: SubmitEvent) => {
		event.preventDefault()
		const value = query().trim()
		if (!value || searching()) return
		props.onQuery(value)
	}

	return (
		<div class="view-wrap topic-search-view">
			<header class="view-head">
				<Eyebrow>§ Topic Search</Eyebrow>
				<h1 class="view-title">Find where your question meets the record</h1>
				<p class="view-stand">
					Describe a question, claim or worry in your own words. Topics closest to you are the
					strongest semantic matches across the embedded passages of every {s.words.nouns.document}.
					Click any topic to read its full profile, the {lens().toLowerCase()} lens and the{' '}
					{s.words.nouns.entities} behind it.
				</p>
			</header>

			<section class="sec" style={{ 'border-top': 'none' }}>
				<form class="topic-search-form" onSubmit={submit}>
					<label for="topic-query">What are you interested in?</label>
					<div class="topic-search-controls">
						<input
							id="topic-query"
							class="topic-search-input"
							type="search"
							placeholder={props.placeholder}
							value={query()}
							onInput={(event) => setQuery(event.currentTarget.value)}
						/>
						<button
							class="topic-search-submit"
							type="submit"
							aria-busy={searching() ? 'true' : 'false'}
						>
							{searching() ? 'Finding topics…' : 'Find topics'}
						</button>
					</div>
					<Show when={error()}>
						<p class="topic-search-error" role="alert">
							{error()}
						</p>
					</Show>
				</form>

				<div class="topic-search-legend">
					<span>
						<i class="topic-legend-near" /> Most relevant
					</span>
					<span>
						<i class="topic-legend-far" /> Less relevant
					</span>
					<Show when={topics().length}>
						<span>{topics().length} topics found</span>
					</Show>
				</div>
				<TopicOrbit topics={topics()} query={searchedQuery()} />
			</section>
		</div>
	)
}
