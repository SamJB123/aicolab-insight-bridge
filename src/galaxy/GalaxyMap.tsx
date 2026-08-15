/**
 * The Insight Galaxy — shared 3D dashboard organism (design settled
 * 2026-08-14 over 16 MCQs + reform rounds; IA convention settled 2026-08-16
 * over 12 MCQs).
 *
 * Corpus-agnostic: hosts hand it an `IBGalaxy` (a ~20-line adapter over
 * their landscape queries), a `loadContent` reader over their drawer
 * queries, and get every selection back through `onSelect`. The WebGPU gate
 * renders a styled panel with the host's own way back into flat exploration.
 *
 * THE CONVENTION (2026-08-16): the LEFT bar is a conventional menu — the
 * navigation modes (topic structure vs source facets), the lens controls
 * and the corpus census — and maps onto MOBILE as the BottomNavigation
 * (modes as bar items) plus a RADIAL fan on the raised centre trigger
 * (search / fly home / colour-by). The RIGHT bar is the reading surface —
 * the mode's three-level contextual DRILL at rest (families → superclusters
 * → topics, or facets → values → sources with the facet spotlight), the
 * reader when a node is selected — and maps onto mobile as the sliding
 * bottom drawer. Drill state survives selection: "Back to overview" returns
 * exactly where you left it. The stage breadcrumb narrates the SAME unified
 * trail (mode path or selection lineage).
 */

import {
	BottomNavigation,
	BottomNavigationCentreContent,
	Breadcrumb,
	type BreadcrumbItem,
	CommandPalette,
	type CommandPaletteItem,
	CommandPaletteTrigger,
	RadialMenu,
	type RadialMenuItem,
	ResponsiveInspector,
	SceneStage,
	StageHint,
	WorkspaceNavigation,
	WorkspaceShell,
	WorkspaceStage,
	WorkspaceStageTooltip,
} from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import {
	createEffect,
	createMemo,
	createSignal,
	createUniqueId,
	onSettled,
	Show,
} from 'solid-js'
import { probeWebGpu } from '@aicolab/kolo/webgpu/backend-guard'
import { createGalaxyAdapter, type GalaxyConfiguration } from './adapter.ts'
import { GalaxyDrill, type SourcePath, type TopicPath } from './chrome/drill.tsx'
import { GalaxyGatePanel } from './chrome/gate-panel.tsx'
import { GalaxyInspectorNode } from './chrome/inspector-content.tsx'
import { GalaxyMenu, type GalaxyMode } from './chrome/menu.tsx'
import { primaryParents } from './layout/cosmos.ts'
import type {
	GalaxyCommand,
	GalaxyEvents,
	IBGalaxy,
	IBIntensityMode,
	IBNode,
	IBNodeContent,
	IBNodeId,
	IBSourceFacet,
	IBTier,
} from './types.ts'
import './galaxy-map.css'

export interface GalaxyMapProps {
	galaxy: IBGalaxy
	/** The corpus's display name — labels the stage, breadcrumb and gate. */
	title: string
	/** The user chose a node (any tier). Hosts open their own drawer by `key`. */
	onSelect?: (node: IBNode) => void
	onHover?: (node: IBNode | null) => void
	/** Camera commands from host chrome (focus a node / return to overview). */
	command?: GalaxyCommand
	/** The reading contract: real drawer content for a node, shown in the
	 * inspector when a selection binds it. */
	loadContent?: (node: IBNode) => Promise<IBNodeContent | null>
	/** Header slot inside the bound inspector — the host's "open full view" link. */
	readerAction?: (node: IBNode) => JSX.Element
	/** Bench/status note shown under the left menu's census. */
	overviewNote?: string
	/** Onboarding hint text over the stage. */
	hint?: string
	/** Pre-rendered galaxy still for the unsupported-browser gate. */
	posterSrc?: string
	/** Lazy slot on the gate panel: the host's link into its 2D explorer. */
	gateAction?: () => JSX.Element
	class?: string
	/** Extra host chrome over the stage, rendered only when WebGPU is live. */
	children?: JSX.Element
}

/** Local (chrome-issued) command revisions live far above any plausible
 * host counter so the two streams never collide. */
const LOCAL_REVISION_BASE = 1_000_000_000

const DEFAULT_HINT = 'Drag to orbit · scroll to dive · choose a star to open its constellation'

export function GalaxyMap(props: GalaxyMapProps) {
	// undefined while probing (and on the server) — the frame renders either
	// way, so the verdict landing never shifts layout.
	const [supported, setSupported] = createSignal<boolean | undefined>(undefined)
	onSettled(() => {
		void probeWebGpu().then(setSupported)
	})

	const adapter = createGalaxyAdapter()
	// The intensity mode weights the force layout itself, so switching it
	// deliberately re-bakes the sky (an engine remount via configuration).
	const [intensityMode, setIntensityMode] = createSignal<IBIntensityMode>('grades')
	// Only corpora carrying continuous scores can offer the choice.
	const hasSoftScores = createMemo(() =>
		props.galaxy.edges.some((edge) => edge.softIntensity !== undefined && edge.softIntensity !== null),
	)
	// Stable unless the corpus (or bake mode) changes — a fresh configuration
	// object every render would remount the renderer.
	const configuration = createMemo(
		(): GalaxyConfiguration => ({ galaxy: props.galaxy, intensityMode: intensityMode() }),
	)

	// The colour-by lens: which source facet paints the dust.
	const facets = createMemo(() => props.galaxy.sourceFacets ?? [])
	const [chosenFacet, setChosenFacet] = createSignal<string | undefined>(undefined)
	const activeFacet = createMemo(() => chosenFacet() ?? facets()[0]?.key)

	// ── Unified navigation state (the 2026-08-16 IA) ──────────────────────
	const [mode, setMode] = createSignal<GalaxyMode>('topics')
	const [topicPath, setTopicPath] = createSignal<TopicPath>({ family: null, group: null })
	const [sourcePath, setSourcePath] = createSignal<SourcePath>({ facet: null, value: null })

	const [hovered, setHovered] = createSignal<IBNode | null>(null)
	const [selected, setSelected] = createSignal<IBNode | null>(null)
	const [interacted, setInteracted] = createSignal(false)
	const [command, setCommand] = createSignal<GalaxyCommand | undefined>(undefined)
	let localRevision = LOCAL_REVISION_BASE
	const issue = (part: Omit<GalaxyCommand, 'revision'>): void => {
		localRevision += 1
		setCommand({ ...part, revision: localRevision })
	}
	createEffect(
		() => props.command,
		(hostCommand) => {
			if (hostCommand !== undefined) setCommand(hostCommand)
		},
	)

	const nodesById = createMemo(() => {
		const map = new Map<IBNodeId, IBNode>()
		for (const node of props.galaxy.nodes) map.set(node.id, node)
		return map
	})
	const parents = createMemo(() => primaryParents(props.galaxy))
	const parentNode = (node: IBNode): IBNode | undefined => {
		const parentId = parents().get(node.id)
		return parentId !== undefined ? nodesById().get(parentId) : undefined
	}

	const resetAll = (): void => {
		setSelected(null)
		setTopicPath({ family: null, group: null })
		setSourcePath((path) => ({ ...path, value: null }))
		issue({
			focus: null,
			spotlight: null,
			labelSources: mode() === 'sources' ? {} : null,
		})
	}
	/** Chrome-initiated node choice: select AND fly (drill leaves, palette,
	 * related, reader rows). */
	const chooseNode = (node: IBNode): void => {
		setSelected(node)
		setInteracted(true)
		issue({ focus: node.id })
	}
	const chooseFacet = (key: string): void => {
		setChosenFacet(key)
		issue({ colorFacet: key })
	}
	/** Chrome hover → scene highlight (rows, chips). Scene pointer hover
	 * wins engine-side while the pointer is over the canvas. */
	const hoverNode = (id: IBNodeId | null): void => {
		issue({ highlight: id })
	}
	const chooseIntensityMode = (nextMode: IBIntensityMode): void => {
		setIntensityMode(nextMode)
		// The re-baked engine starts on the default lens — restate the choice
		// so the fresh mount picks it up from the buffered command.
		const facet = activeFacet()
		if (facet !== undefined) issue({ colorFacet: facet })
	}

	// ── Drill actions (camera-coupled; settled 2026-08-16) ────────────────
	/** A drill row press: containers drill+fly WITHOUT selecting; leaves
	 * (topics/sources) select. */
	const pickNode = (node: IBNode): void => {
		setInteracted(true)
		if (node.tier === 2) {
			setTopicPath({ family: node.id, group: null })
			setSelected(null)
			issue({ focus: node.id })
		} else if (node.tier === 1) {
			const family = parentNode(node)
			setTopicPath({ family: family?.id ?? null, group: node.id })
			setSelected(null)
			issue({ focus: node.id })
		} else {
			chooseNode(node)
		}
	}
	const pickFacet = (facet: IBSourceFacet): void => {
		setInteracted(true)
		setSourcePath({ facet: facet.key, value: null })
	}
	/** Facet value = the SPOTLIGHT (settled 2026-08-16): the cohort stays
	 * lit, the rest recedes, and the colour-by lens follows the facet. */
	const pickValue = (value: string): void => {
		const facet = sourcePath().facet
		if (facet === null) return
		setInteracted(true)
		setSourcePath({ facet, value })
		setChosenFacet(facet)
		// The value filters the source-pin field down to its cohort.
		issue({
			spotlight: { facet, value },
			colorFacet: facet,
			labelSources: { facet, value },
		})
	}
	const drillBack = (): void => {
		if (mode() === 'sources') {
			const path = sourcePath()
			if (path.value !== null) {
				setSourcePath({ facet: path.facet, value: null })
				// Back to the unfiltered pin field.
				issue({ spotlight: null, labelSources: {} })
			} else if (path.facet !== null) {
				setSourcePath({ facet: null, value: null })
			}
			return
		}
		const path = topicPath()
		if (path.group !== null) {
			setTopicPath({ family: path.family, group: null })
			if (path.family !== null) issue({ focus: path.family })
			else issue({ focus: null })
		} else if (path.family !== null) {
			setTopicPath({ family: null, group: null })
			issue({ focus: null })
		}
	}
	const switchMode = (next: GalaxyMode): void => {
		if (next === mode()) return
		setMode(next)
		setInteracted(true)
		// Sources mode fields SOURCE PINS at rest (experiment 2026-08-16):
		// all of them until a facet value filters the cohort; its spotlight
		// re-applies with the path it still holds. Topics mode restores the
		// standard resting labels.
		const path = sourcePath()
		if (next === 'topics') {
			issue({ spotlight: null, labelSources: null })
		} else if (path.facet !== null && path.value !== null) {
			issue({
				spotlight: { facet: path.facet, value: path.value },
				labelSources: { facet: path.facet, value: path.value },
			})
		} else {
			issue({ labelSources: {} })
		}
	}

	const engineEvents: GalaxyEvents = {
		onHover: (node) => {
			setHovered(node)
			props.onHover?.(node)
		},
		onSelect: (node) => {
			setSelected(node)
			setInteracted(true)
			props.onSelect?.(node)
		},
		onFocusChange: (node) => {
			setInteracted(true)
			// The sky's commitment updates the drill path — panel and sky
			// never disagree about where you are.
			if (node && node.tier === 1) {
				const family = parentNode(node)
				setTopicPath({ family: family?.id ?? null, group: node.id })
			} else if (node && node.tier === 2) {
				setTopicPath({ family: node.id, group: null })
			}
			// A topic selection belongs to its constellation; leaving it
			// retires the stale reading.
			if (node === null && selected()?.tier === 0) setSelected(null)
		},
	}

	const visit = (id: IBNodeId): void => {
		const target = nodesById().get(id)
		if (target) chooseNode(target)
	}

	// ── The unified trail (settled 2026-08-16: breadcrumb = drill state) ──
	const facetLabelOf = (key: string | null): string | undefined =>
		facets().find((facet) => facet.key === key)?.label
	const crumbs = createMemo((): BreadcrumbItem[] => {
		const items: BreadcrumbItem[] = [{ label: props.title, onSelect: resetAll }]
		const chosen = selected()
		const lineage = (node: IBNode): IBNode[] => {
			const chain: IBNode[] = [node]
			let cursor: IBNode | undefined = node
			for (let hop = 0; hop < 3 && cursor; hop++) {
				cursor = parentNode(cursor)
				if (cursor) chain.unshift(cursor)
			}
			return chain
		}
		const pushNodeTrail = (nodes: IBNode[]): void => {
			nodes.forEach((node, index) => {
				items.push(
					index < nodes.length - 1
						? { label: node.title, onSelect: () => pickNode(node) }
						: { label: node.title },
				)
			})
		}
		if (chosen) {
			if (chosen.tier === -1 && mode() === 'sources' && sourcePath().value !== null) {
				const facetLabel = facetLabelOf(sourcePath().facet)
				if (facetLabel) {
					items.push({
						label: facetLabel,
						onSelect: () => {
							setSelected(null)
							setSourcePath((path) => ({ facet: path.facet, value: null }))
							issue({ spotlight: null, select: null })
						},
					})
				}
				const value = sourcePath().value
				if (value !== null) {
					items.push({
						label: value,
						onSelect: () => {
							setSelected(null)
							issue({ select: null })
						},
					})
				}
				items.push({ label: chosen.title })
			} else {
				pushNodeTrail(lineage(chosen))
			}
			return items
		}
		if (mode() === 'sources') {
			const path = sourcePath()
			const facetLabel = facetLabelOf(path.facet)
			if (facetLabel) {
				items.push(
					path.value !== null
						? {
								label: facetLabel,
								onSelect: () => {
									setSourcePath({ facet: path.facet, value: null })
									issue({ spotlight: null })
								},
							}
						: { label: facetLabel },
				)
			}
			if (path.value !== null) items.push({ label: path.value })
			return items
		}
		const path = topicPath()
		const family = path.family !== null ? nodesById().get(path.family) : undefined
		const group = path.group !== null ? nodesById().get(path.group) : undefined
		if (family) {
			items.push(
				group
					? { label: family.title, onSelect: () => pickNode(family) }
					: { label: family.title },
			)
		}
		if (group) items.push({ label: group.title })
		return items
	})

	/** What a tier's weight counts (sources' weight counts topics, etc.). */
	const weightLabelFor = (tier: IBTier): string =>
		props.galaxy.tiers.find((meta) => meta.tier === tier)?.weightLabel ??
		props.galaxy.weightLabel

	const paletteId = `ib-galaxy-palette-${createUniqueId()}`
	const radialId = `ib-galaxy-radial-${createUniqueId()}`
	const paletteItems = createMemo((): CommandPaletteItem[] => {
		const tierLabel = new Map(props.galaxy.tiers.map((tier) => [tier.tier, tier.label]))
		return props.galaxy.nodes.map((node) => ({
			id: node.id,
			label: node.title,
			detail: `${node.weight} ${weightLabelFor(node.tier)}${
				node.intensityLabel ? ` · ${node.intensityLabel}` : ''
			}`,
			kind: tierLabel.get(node.tier),
			keywords: node.flags?.map((flag) => flag.label),
		}))
	})

	// The radial fan — the left-bar convention's mobile actions (settled
	// 2026-08-16: search, fly home, colour-by).
	const radialItems = createMemo((): RadialMenuItem[] => {
		const items: RadialMenuItem[] = [
			{
				id: 'search',
				label: 'Search',
				icon: <span aria-hidden="true">⌕</span>,
				onSelect: () => {
					document.getElementById(paletteId)?.showPopover()
				},
			},
			{
				id: 'home',
				label: 'Fly home',
				icon: <span aria-hidden="true">⌂</span>,
				onSelect: resetAll,
			},
		]
		const list = facets()
		if (list.length > 1) {
			items.push({
				id: 'facet',
				label: `Colour: ${facetLabelOf(activeFacet() ?? null) ?? ''}`,
				icon: <span aria-hidden="true">◔</span>,
				onSelect: () => {
					const at = list.findIndex((facet) => facet.key === activeFacet())
					const next = list[(at + 1) % list.length]
					if (next) chooseFacet(next.key)
				},
			})
		}
		return items
	})

	// The reading contract: an async computation over the selection — reads
	// under the inspector's Loading boundary until the host's fetch lands.
	const readerContent = createMemo((): Promise<IBNodeContent | null> | null => {
		const node = selected()
		const load = props.loadContent
		return node && load ? load(node) : null
	})

	const tierPlural = (tier: IBTier): string =>
		props.galaxy.tiers.find((entry) => entry.tier === tier)?.labelPlural ?? ''

	return (
		<div class={['ib-galaxy', props.class]}>
			<Show
				when={supported() !== false}
				fallback={
					<GalaxyGatePanel
						corpusTitle={props.title}
						posterSrc={props.posterSrc}
						action={props.gateAction}
					/>
				}
			>
				<Show when={supported() === true}>
					<WorkspaceShell
						class="ib-galaxy-workspace"
						navigation={
							<WorkspaceNavigation label={`${props.title} navigation`}>
								<GalaxyMenu
									galaxy={props.galaxy}
									mode={mode()}
									onMode={switchMode}
									facets={facets()}
									activeFacet={activeFacet()}
									onFacet={chooseFacet}
									hasSoftScores={hasSoftScores()}
									intensityMode={intensityMode()}
									onIntensityMode={chooseIntensityMode}
									note={props.overviewNote}
								/>
							</WorkspaceNavigation>
						}
						stage={
							<WorkspaceStage label={`${props.title} galaxy`} class="ib-galaxy-workspace-stage">
								<SceneStage
									adapter={adapter}
									configuration={configuration()}
									command={command()}
									events={engineEvents}
									label={`${props.title} galaxy map`}
									loadingLabel="Charting the galaxy…"
									class="ib-galaxy-stage"
								>
									<div class="ib-galaxy-chrome">
										<div class="ib-galaxy-breadcrumb">
											<Breadcrumb items={crumbs()} label="Galaxy position" />
										</div>
										<div class="ib-galaxy-search">
											<CommandPaletteTrigger target={paletteId} label="Search the galaxy">
												Search the galaxy
											</CommandPaletteTrigger>
											<CommandPalette
												id={paletteId}
												items={paletteItems()}
												placeholder="Jump to a topic, theme or family…"
												onSelect={(item) => visit(item.id)}
											/>
										</div>
										<Show when={!interacted()}>
											<div class="ib-galaxy-hint">
												<StageHint>{props.hint ?? DEFAULT_HINT}</StageHint>
											</div>
										</Show>
										<Show when={hovered()}>
											{(node) => (
												<Show when={node().id !== selected()?.id}>
													<div class="ib-galaxy-hover">
														<WorkspaceStageTooltip
															label={node().title}
															detail={`${node().weight} ${weightLabelFor(node().tier)}${
																node().intensityLabel
																	? ` · ${node().intensityLabel}`
																	: ''
															}`}
														/>
													</div>
												</Show>
											)}
										</Show>
									</div>
									{props.children}
								</SceneStage>
							</WorkspaceStage>
						}
						inspector={
							<ResponsiveInspector
								label={selected()?.title ?? props.title}
								activeKey={selected()?.id ?? null}
								class="ib-galaxy-inspector"
							>
								<Show
									when={selected()}
									fallback={
										<GalaxyDrill
											galaxy={props.galaxy}
											title={props.title}
											mode={mode()}
											topicPath={topicPath()}
											sourcePath={sourcePath()}
											hovered={hovered()}
											onPickNode={pickNode}
											onPickFacet={pickFacet}
											onPickValue={pickValue}
											onBack={drillBack}
											onHoverNode={hoverNode}
										/>
									}
								>
									{(node) => (
										<GalaxyInspectorNode
											galaxy={props.galaxy}
											node={node()}
											content={readerContent}
											onVisit={visit}
											onClear={() => {
												// Clear the ENGINE's selection too (in place, no
												// flight) so anchors/fleets match the chrome.
												setSelected(null)
												issue({ select: null })
											}}
											onHoverNode={hoverNode}
											action={props.readerAction}
										/>
									)}
								</Show>
							</ResponsiveInspector>
						}
						mobileNavigation={
							<BottomNavigation
								label="Galaxy"
								items={[
									{
										id: 'topics' as const,
										label: tierPlural(0) || 'Topics',
										icon: <span aria-hidden="true">✦</span>,
									},
									{
										id: 'sources' as const,
										label: tierPlural(-1) || 'Sources',
										icon: <span aria-hidden="true">◍</span>,
									},
								]}
								activeId={mode()}
								onSelect={(id) => switchMode(id)}
								centre={
									<RadialMenu
										id={radialId}
										items={radialItems()}
										label="Galaxy actions"
										triggerClass="ib-galaxy-bnav-radial"
									>
										<BottomNavigationCentreContent
											icon={<span aria-hidden="true">✳</span>}
											label="Actions"
										/>
									</RadialMenu>
								}
							/>
						}
					/>
				</Show>
			</Show>
		</div>
	)
}
