/**
 * A report's sections as VIEWS, for every host that embeds a report (settled
 * 2026-10-25, "the view is the page"): each of core's pages (../report, ../brief,
 * ../sources — the components the report's own site renders) over the page its door
 * answered (./reads.ts), with everything a page asks of its host supplied here from the
 * host's seam alone (./host.ts) — its links to the report's other sections (the host's
 * navigator, in the report's own address vocabulary), its readings (the detail sheet
 * over the report's object, its words from the run's), a chapter's reading, a search, a
 * drill-down (the same object, each answer held to its contract), and where the page
 * keeps its own state (a reading open on the page, the record's filters, a search's
 * query, the Brief's folds: ./address.ts). The host mounts `ReportSectionView` where its
 * place for the section is; the hub's page face and a report's own routes are two such
 * hosts of the one view.
 */
import type { ViewHost } from '@aicolab/app-kit/solid/view-host'
import type { RunWords } from '@aicolab/insight-bridge-contracts/explorer'
import { topicHitSchema } from '@aicolab/insight-bridge-contracts/explorer'
import { EmptyState, Notice } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { createEffect, Match, omit, Show, Switch } from 'solid-js'
import { z } from 'zod'
import { BriefPage } from '../brief/brief-page.tsx'
import type { BriefSurface } from '../brief/surface.tsx'
import { chapterReadingSchema } from '../brief/types.ts'
import { parseNodeId, type ReadingTarget } from '../explorer/readings.ts'
import type { IBNode, IBNodeContent } from '../galaxy/types.ts'
import { createDetailSheet, type DetailLevel } from '../reader/detail-sheet.tsx'
import { readingViewSchema } from '../reader/reading-view.ts'
import { expandedSearch } from '../reading-search.ts'
import { AnalysisPage, analysisLoaders } from '../report/analysis-page.tsx'
import { ConnectPage } from '../report/connect-page.tsx'
import { GalaxyPage } from '../report/galaxy-page.tsx'
import { MethodPage } from '../report/method-page.tsx'
import { OverviewPage } from '../report/overview-page.tsx'
import type { ReportSurface } from '../report/surface.tsx'
import { TopicSearchPage } from '../report/topic-search-page.tsx'
import { positionColors } from '../site/palette.ts'
import { sourcesSearchOf } from '../sources/data.ts'
import { SourcesPage } from '../sources/sources-page.tsx'
import type { SourcesSurface } from '../sources/types.ts'
import { type ReportTarget, sectionId } from './address.ts'
import type { ReportAppletHost } from './host.ts'
import type { ReportPage } from './reads.ts'

const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

/** A drill-down's answer, as the door hands it: the answer and the name of every document it lists. */
const drillAnswerSchema = z.object({ data: z.unknown(), names: z.record(z.string(), z.string()) })

/** A reading's target as the door's `reading` read takes it: the drawer's, or one document. */
type ReadingRequest = ReadingTarget | { kind: 'document'; key: string }

/** The report's reads a section's page runs, each through the host's door and held to its contract. */
function readsOf(door: ViewHost) {
	return {
		reading: async (target: ReadingRequest) =>
			readingViewSchema.nullable().parse(await door.call('reading', target)),
		chapter: async (chapterId: number, topicIds: number[], full: boolean) =>
			chapterReadingSchema
				.nullable()
				.parse(await door.call('chapterPage', { chapterId, topicIds, full })),
		topicSearch: async (query: string) =>
			topicHitSchema.array().parse(await door.call('topicSearch', { query })),
		drill: async (request: Record<string, unknown>) =>
			drillAnswerSchema.parse(await door.call('analysisDrill', request)),
	}
}

export interface ReportSectionViewProps {
	host: ReportAppletHost
	/** The section's page, as the door answered the host's loader. */
	page: ReportPage
	/** Where the reader is: this section, a reading open on it, the page's own query. */
	at: ReportTarget
}

/**
 * One section of a report, drawn as the report's own site draws it. The page's heading
 * is core's page's own; the host draws no heading of its own above it.
 */
export function ReportSectionView(props: ReportSectionViewProps) {
	const reads = () => readsOf(props.host.door)
	const words = (): RunWords => props.page.data.words
	/** This section, as a target with nothing open: the links' and the page's own moves' base. */
	const here = (): ReportTarget => ({
		section: props.at.section,
		...(props.at.taskId === undefined ? {} : { taskId: props.at.taskId }),
		reading: null,
		page: props.at.page,
	})
	/** A move that stays on this page: the reading open, the page's query with a patch. */
	const stay = (
		reading: ReadingTarget | null,
		patch: Record<string, unknown>,
		opened?: { document?: string; tab?: string },
	): ReportTarget => ({
		...here(),
		reading,
		...(opened?.document ? { document: opened.document } : {}),
		...(opened?.tab ? { tab: opened.tab } : {}),
		page: { ...props.at.page, ...patch },
	})

	/* ── a section's link: an anchor to the host's URL, moved by the navigator ── */

	const SectionLink = (link: Parameters<ReportSurface['Link']>[0]) => {
		const anchor = omit(link, 'section', 'taskId', 'children', 'class')
		const target = (): ReportTarget => ({
			section: link.section,
			...(link.taskId === undefined ? {} : { taskId: link.taskId }),
			reading: null,
			page: {},
		})
		const current = () =>
			sectionId(link.section, link.taskId) === sectionId(props.at.section, props.at.taskId)
		return (
			<a
				{...anchor}
				href={props.host.navigator.href(target())}
				class={[link.class ?? '', { active: current() }]}
				aria-current={current() ? 'page' : undefined}
				onClick={(event) => {
					anchor.onClick?.(event)
					if (event.defaultPrevented || event.button !== 0) return
					if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
					event.preventDefault()
					props.host.navigator.go(target())
				}}
			>
				{link.children}
			</a>
		)
	}

	/* ── the readings: the detail sheet over the report's object, its words the run's ── */

	const sheet = createDetailSheet<ReadingTarget>({
		onChange: ({ selection, level, section }) =>
			props.host.navigator.go(stay(selection, {}, { document: level?.documentId, tab: section }), {
				replace: true,
			}),
		load: async (selection, level) => {
			if (level) {
				const [document, parent] = await Promise.all([
					reads().reading({ kind: 'document', key: level.documentId }),
					reads().reading(
						selection.kind === 'source'
							? { kind: 'source', key: selection.key }
							: { kind: 'source', key: level.documentId },
					),
				])
				return document
					? { ...document, upLabel: parent?.title ?? cap(words().nouns.entity) }
					: null
			}
			return reads().reading(selection)
		},
		parseNodeId,
		kindLabel: (selection, level) =>
			level
				? cap(words().nouns.document)
				: selection.kind === 'source'
					? cap(words().nouns.entity)
					: selection.kind === 'group'
						? 'Group'
						: 'Topic',
		visitLabel: (id) =>
			id?.startsWith('s:')
				? `Open the ${words().nouns.entity} →`
				: id?.startsWith('g:')
					? 'Open the group →'
					: 'Open the topic →',
		get mixOrder() {
			return words().scale.order
		},
		get mixColors() {
			return positionColors(words().scale)
		},
		sourceSelection: (key) => ({ kind: 'source', key }),
		citeTitle: `Open this ${words().nouns.entity}`,
	})

	// ADDRESS → SHEET: the reading the address names is the one open (the
	// galaxy keeps its own rail, so its page restores no sheet). Client-only
	// by construction: effects never run during SSR.
	createEffect(
		() => ({
			section: props.at.section,
			reading: props.at.reading,
			document: props.at.document,
			tab: props.at.tab,
		}),
		({ section, reading, document, tab }) => {
			if (section === 'galaxy') return
			const level: DetailLevel | null =
				reading && document
					? { kind: 'document', documentId: document, label: cap(words().nouns.document) }
					: null
			sheet.restore({ selection: reading, level, section: reading ? tab : undefined })
		},
	)

	/* ── what core's pages read of their host ── */

	const surface = (w: RunWords): ReportSurface => ({
		words: w,
		positionColors: positionColors(w.scale),
		open: (target) => sheet.openDrawer(target),
		Link: SectionLink,
	})

	/* ── the galaxy's readings: a node's content from the same readings ── */

	const loadContent = async (node: IBNode): Promise<IBNodeContent | null> => {
		if (node.tier === -1)
			return typeof node.key === 'string'
				? ((await reads().reading({ kind: 'source', key: node.key }))?.content ?? null)
				: null
		if (typeof node.key !== 'number') return null
		if (node.tier === 0)
			return (await reads().reading({ kind: 'topic', key: node.key }))?.content ?? null
		return (await reads().reading({ kind: 'group', key: node.key }))?.content ?? null
	}
	const loadDocument = async (documentId: string): Promise<IBNodeContent | null> =>
		(await reads().reading({ kind: 'document', key: documentId }))?.content ?? null

	/* ── the Brief's surface: its folds in the query, its chapter readings through the door ── */

	const briefSurface = (
		data: Extract<ReportPage, { section: 'topics' }>['data'],
	): BriefSurface => ({
		expandedChapters: () => expandedSearch(props.at.page.expanded) ?? [],
		onExpandedChaptersChange: (expanded) => {
			const previous = expandedSearch(props.at.page.expanded) ?? []
			props.host.navigator.go(
				stay(props.at.reading, { expanded: expanded.length ? expanded : undefined }),
				{ replace: true, hash: expanded.find((key) => !previous.includes(key)) },
			)
		},
		vocabulary: {
			get source() {
				return data.words.nouns.entity
			},
			get sources() {
				return data.words.nouns.entities
			},
			get title() {
				return data.title
			},
		},
		get positions() {
			return [...data.words.scale.order]
		},
		get positionColors() {
			return positionColors(data.words.scale)
		},
		openTopic: (topicClusterId) => sheet.openDrawer({ kind: 'topic', key: topicClusterId }),
		openGroup: (superclusterId) => sheet.openDrawer({ kind: 'group', key: superclusterId }),
		openSource: (entityId) => sheet.openSource(entityId),
		loadReading: (chapterId, topicIds, full) => reads().chapter(chapterId, topicIds, full),
	})

	/* ── the record's surface: its filters and page in the query ── */

	const sourcesSurface = (
		data: Extract<ReportPage, { section: 'sources' }>['data'],
	): SourcesSurface => ({
		vocabulary: data.vocabulary,
		search: sourcesSearchOf(props.at.page),
		// A filter change resets to page 1 and REPLACES history; a page change pushes.
		onSearch: (patch, kind) =>
			props.host.navigator.go(
				stay(props.at.reading, { ...patch, ...(kind === 'filter' ? { page: undefined } : {}) }),
				{ replace: kind === 'filter' },
			),
		openSource: (entityId) => sheet.openDrawer({ kind: 'source', key: entityId }),
	})

	const query = (): string | undefined => {
		const value = props.at.page.query
		return typeof value === 'string' && value ? value : undefined
	}

	return (
		<div class="ib-applet-section" data-section={props.at.section}>
			<Switch>
				<Match when={props.page.section === 'overview' ? props.page.data : undefined}>
					{(data) => (
						<OverviewPage
							overview={data().overview}
							landscape={data().landscape}
							surface={surface(data().words)}
							additions={data().additions}
						/>
					)}
				</Match>
				<Match when={props.page.section === 'galaxy' ? props.page.data : undefined}>
					{(data) => (
						<Show
							when={data().data.nodes.some((node) => node.tier === 0)}
							fallback={
								<Notice colorBase="warning" variant="soft">
									The record has no galaxy yet.
								</Notice>
							}
						>
							<GalaxyPage
								data={data().data}
								surface={surface(data().words)}
								navigation={{
									nodeId: props.at.reading ? nodeIdOf(props.at.reading) : undefined,
									documentId: props.at.document,
								}}
								onNavigationChange={({ nodeId, documentId }) =>
									props.host.navigator.go(
										stay(nodeId ? parseNodeId(nodeId) : null, {}, { document: documentId }),
										{ replace: true },
									)
								}
								section={props.at.tab}
								onSectionChange={(tab) =>
									props.host.navigator.go(
										stay(props.at.reading, {}, { document: props.at.document, tab }),
										{ replace: true },
									)
								}
								loadContent={loadContent}
								loadDocument={loadDocument}
								posterSrc={data().poster ?? undefined}
								gateAction={() => (
									<SectionLink section="topics" class="ib-galaxy-related-chip">
										Read the topics instead
									</SectionLink>
								)}
							/>
						</Show>
					)}
				</Match>
				<Match when={props.page.section === 'topics' ? props.page.data : undefined}>
					{(data) => <BriefPage d={data()} surface={briefSurface(data())} />}
				</Match>
				<Match when={props.page.section === 'sources' ? props.page.data : undefined}>
					{(data) => <SourcesPage d={data()} surface={sourcesSurface(data())} />}
				</Match>
				<Match when={props.page.section === 'search' ? props.page.data : undefined}>
					{(data) => (
						<TopicSearchPage
							query={query()}
							onQuery={(next) =>
								props.host.navigator.go(stay(null, { query: next }), { replace: true })
							}
							search={(text) => reads().topicSearch(text)}
							placeholder={data().placeholder}
							surface={surface(data().words)}
						/>
					)}
				</Match>
				<Match when={props.page.section === 'method' ? props.page.data : undefined}>
					{(data) => (
						<MethodPage
							method={data().method}
							data={data().data}
							surface={surface(data().words)}
							additions={data().additions}
						/>
					)}
				</Match>
				<Match when={props.page.section === 'connect' ? props.page.data : undefined}>
					{(data) => (
						<ConnectPage
							endpoint={data().endpoint}
							serverName={data().serverName}
							access={{ kind: 'public' }}
							surface={surface(data().words)}
							additions={data().additions}
						/>
					)}
				</Match>
				<Match when={props.page.section === 'analysis' ? props.page : undefined}>
					{(analysis) => (
						<Show
							when={analysis().data.page}
							fallback={
								<EmptyState
									title="Not in this report"
									hint="The run performed no analysis by that name."
								/>
							}
						>
							{(found) => (
								<AnalysisPage
									page={found()}
									surface={surface(analysis().data.words)}
									loaders={analysisLoaders(analysis().taskId, (request) => reads().drill(request))}
								/>
							)}
						</Show>
					)}
				</Match>
			</Switch>
			<Show when={props.at.section !== 'galaxy'}>
				<sheet.DetailDrawer />
			</Show>
		</div>
	)
}

/** The reader's node id of a reading, as the galaxy's navigation names it. */
const nodeIdOf = (target: ReadingTarget): string =>
	`${target.kind === 'topic' ? 't' : target.kind === 'group' ? 'g' : 's'}:${target.key}`

/** A host's slot for the section view's problem, where its door did not answer a page. */
export function ReportProblem(props: { children: JSX.Element }) {
	return (
		<Notice colorBase="warning" variant="soft" class="ib-applet-problem">
			{props.children}
		</Notice>
	)
}
