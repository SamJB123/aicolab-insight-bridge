/**
 * The Insight Galaxy — shared 3D dashboard organism (design settled
 * 2026-08-14 over 16 MCQs + two DS-adoption rounds).
 *
 * Corpus-agnostic: hosts hand it an `IBGalaxy` (a ~20-line adapter over
 * their landscape queries), a `loadContent` reader over their drawer
 * queries, and get every selection back through `onSelect`. The WebGPU gate
 * renders a styled panel with the host's own way back into flat exploration.
 *
 * Supported browsers get the WORKSPACE organism — the shell ui-solid
 * designed for three.js stages: hierarchy tree in the left navigation
 * (families as group labels, groups as items, the focused constellation's
 * topics indented beneath), the SceneStage canvas in the workspace stage
 * (breadcrumb, palette, hint and hover tooltip floating over it), and the
 * ResponsiveInspector on the right — corpus overview at rest, the real
 * drawer content when a node binds it. On ≤900px the organism takes over:
 * the nav hides, the inspector becomes a draggable bottom drawer, and a
 * BottomNavigation carries Galaxy · Search.
 */

import {
	BottomNavigation,
	BottomNavigationCentreContent,
	Breadcrumb,
	type BreadcrumbItem,
	CommandPalette,
	type CommandPaletteItem,
	CommandPaletteTrigger,
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
import { GalaxyGatePanel } from './chrome/gate-panel.tsx'
import {
	GalaxyInspectorNode,
	GalaxyInspectorOverview,
} from './chrome/inspector-content.tsx'
import { GalaxyNavigator } from './chrome/navigator.tsx'
import { primaryParents } from './layout/spiral-seed.ts'
import type {
	GalaxyCommand,
	GalaxyEvents,
	IBGalaxy,
	IBNode,
	IBNodeContent,
	IBNodeId,
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
	/** Bench/status note shown in the inspector's resting overview. */
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
	// Stable unless the corpus itself changes — a fresh configuration object
	// every render would remount the renderer.
	const configuration = createMemo(
		(): GalaxyConfiguration => ({ galaxy: props.galaxy }),
	)

	const [hovered, setHovered] = createSignal<IBNode | null>(null)
	const [selected, setSelected] = createSignal<IBNode | null>(null)
	const [focused, setFocused] = createSignal<IBNode | null>(null)
	const [interacted, setInteracted] = createSignal(false)
	const [command, setCommand] = createSignal<GalaxyCommand | undefined>(undefined)
	let localRevision = LOCAL_REVISION_BASE
	createEffect(
		() => props.command,
		(hostCommand) => {
			if (hostCommand !== undefined) setCommand(hostCommand)
		},
	)
	const navigate = (target: IBNodeId | null): void => {
		localRevision += 1
		setCommand({ focus: target, revision: localRevision })
		if (target === null) setSelected(null)
	}
	/** Chrome-initiated node choice: select AND fly (nav, palette, related). */
	const chooseNode = (node: IBNode): void => {
		setSelected(node)
		setInteracted(true)
		localRevision += 1
		setCommand({ focus: node.id, revision: localRevision })
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
			setFocused(node)
			setInteracted(true)
			// A topic selection belongs to its constellation; leaving it
			// retires the stale reading.
			if (node === null && selected()?.tier === 0) setSelected(null)
		},
	}

	const nodesById = createMemo(() => {
		const map = new Map<IBNodeId, IBNode>()
		for (const node of props.galaxy.nodes) map.set(node.id, node)
		return map
	})
	const parents = createMemo(() => primaryParents(props.galaxy))
	const visit = (id: IBNodeId): void => {
		const target = nodesById().get(id)
		if (target) chooseNode(target)
	}

	const trail = createMemo((): IBNode[] => {
		const crumbs: IBNode[] = []
		const focus = focused()
		const chosen = selected()
		const anchor = focus ?? (chosen && chosen.tier > 0 ? chosen : null)
		if (anchor) {
			const parentId = parents().get(anchor.id)
			const parent = parentId !== undefined ? nodesById().get(parentId) : undefined
			if (parent && parent !== anchor) crumbs.push(parent)
			crumbs.push(anchor)
		}
		if (focus && chosen && chosen.tier === 0) crumbs.push(chosen)
		return crumbs
	})
	const crumbs = createMemo((): BreadcrumbItem[] => {
		const nodes = trail()
		return [
			{ label: props.title, onSelect: () => navigate(null) },
			...nodes.map((node, index) =>
				index < nodes.length - 1
					? { label: node.title, onSelect: () => navigate(node.id) }
					: { label: node.title },
			),
		]
	})

	const paletteId = `ib-galaxy-palette-${createUniqueId()}`
	const paletteItems = createMemo((): CommandPaletteItem[] => {
		const tierLabel = new Map(props.galaxy.tiers.map((tier) => [tier.tier, tier.label]))
		return props.galaxy.nodes.map((node) => ({
			id: node.id,
			label: node.title,
			detail: `${node.weight} ${props.galaxy.weightLabel}${
				node.intensityLabel ? ` · ${node.intensityLabel}` : ''
			}`,
			kind: tierLabel.get(node.tier),
			keywords: node.flags?.map((flag) => flag.label),
		}))
	})

	// The reading contract: an async computation over the selection — reads
	// under the inspector's Loading boundary until the host's fetch lands.
	const readerContent = createMemo((): Promise<IBNodeContent | null> | null => {
		const node = selected()
		const load = props.loadContent
		return node && load ? load(node) : null
	})

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
							<WorkspaceNavigation label={`${props.title} structure`}>
								<GalaxyNavigator
									galaxy={props.galaxy}
									title={props.title}
									focused={focused()}
									selected={selected()}
									onChoose={chooseNode}
									onRoot={() => navigate(null)}
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
															detail={`${node().weight} ${props.galaxy.weightLabel}${
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
										<GalaxyInspectorOverview
											galaxy={props.galaxy}
											title={props.title}
											note={props.overviewNote}
											onVisit={visit}
										/>
									}
								>
									{(node) => (
										<GalaxyInspectorNode
											galaxy={props.galaxy}
											node={node()}
											content={readerContent}
											onVisit={visit}
											onClear={() => setSelected(null)}
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
										id: 'galaxy',
										label: 'Galaxy',
										icon: <span aria-hidden="true">✦</span>,
									},
								]}
								activeId={focused() || selected() ? null : 'galaxy'}
								onSelect={() => navigate(null)}
								centre={
									<button
										type="button"
										class="ib-galaxy-bnav-search"
										popovertarget={paletteId}
									>
										<BottomNavigationCentreContent
											icon={<span aria-hidden="true">⌕</span>}
											label="Search"
										/>
									</button>
								}
							/>
						}
					/>
				</Show>
			</Show>
		</div>
	)
}
