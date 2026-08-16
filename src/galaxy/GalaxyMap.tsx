/**
 * The Insight Galaxy — shared 3D dashboard organism (design settled
 * 2026-08-14 over 16 MCQs + reform rounds; IA convention 2026-08-16; the
 * HEADLESS-CORE navigation rewrite 2026-08-16 over 12 MCQs).
 *
 * Corpus-agnostic: hosts hand it an `IBGalaxy` (a ~20-line adapter over
 * their landscape queries), a `loadContent` reader over their drawer
 * queries, and get every selection back through `onSelect`. The WebGPU gate
 * renders a styled panel with the host's own way back into flat exploration.
 *
 * NAVIGATION (the 2026-08-16 rewrite): ONE brain — `GalaxyNavCore` — owns
 * "where the user is" ({ mode, trail, reading, document, lens }). This file
 * is the WEB-UI FACE over that core: the drawer (drill + readers), the
 * breadcrumb, the menus and the palette all read the core's signals and
 * call its actions. The 3D renderer inside the canvas is the SECOND face
 * (engine/engine.ts): it subscribes to the same core and projects it into
 * camera/labels/fleets. There is no command wire and no state sync — the
 * core IS the state. 'Back' does not exist: every level shows ONE up-control
 * NAMED for its destination, plus a uniform "you are here" header.
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
import { createEffect, createMemo, createSignal, createUniqueId, onSettled, Show } from 'solid-js'
import { probeWebGpu } from '@aicolab/kolo/webgpu/backend-guard'
import { createGalaxyAdapter, type GalaxyConfiguration } from './adapter.ts'
import { GalaxyDrill } from './chrome/drill.tsx'
import { GalaxyGatePanel } from './chrome/gate-panel.tsx'
import { GalaxyInspectorDocument, GalaxyInspectorNode } from './chrome/inspector-content.tsx'
import { GalaxyMenu } from './chrome/menu.tsx'
import { GalaxyNavCore } from './nav-core.ts'
import type { IBGalaxy, IBIntensityMode, IBNode, IBNodeContent, IBTier } from './types.ts'
import './galaxy-map.css'

export interface GalaxyMapProps {
	galaxy: IBGalaxy
	/** The corpus's display name — labels the stage, breadcrumb and gate. */
	title: string
	/** The user chose a node (any tier). Hosts open their own drawer by `key`. */
	onSelect?: (node: IBNode) => void
	onHover?: (node: IBNode | null) => void
	/** The reading contract: real drawer content for a node, shown in the
	 * inspector when a selection binds it. */
	loadContent?: (node: IBNode) => Promise<IBNodeContent | null>
	/** The DOCUMENT READING loader (settled 2026-08-16) for multi-document
	 * corpora: content for ONE document of a source entity, opened from the
	 * reader's documents section. 1:1 corpora omit it (the entity reading IS
	 * the document reading) and never render the level. */
	loadDocument?: (documentId: string) => Promise<IBNodeContent | null>
	/** The corpus's document noun for the document reading's eyebrow —
	 * 'Report', 'Submission'; defaults to 'Document'. */
	documentLabel?: string
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
		props.galaxy.edges.some(
			(edge) => edge.softIntensity !== undefined && edge.softIntensity !== null,
		),
	)

	// THE navigation brain — one per corpus; identity-stable across engine
	// remounts (intensity re-bakes keep trails, lens and remembered poses).
	const core = createMemo(() => new GalaxyNavCore(props.galaxy))
	// Resolved in a TRACKED scope so the handler the inspector calls from its
	// own effect touches no reactive values (the split-effect contract).
	const occlusionHandler = createMemo(() => {
		const instance = core()
		return (px: number) => instance.setViewportInset(px)
	})
	const configuration = createMemo(
		(): GalaxyConfiguration => ({
			galaxy: props.galaxy,
			intensityMode: intensityMode(),
			core: core(),
		}),
	)

	const facets = createMemo(() => props.galaxy.sourceFacets ?? [])

	// Host events derive from the core (no engine event wire). Handlers are
	// read in the COMPUTE so the callbacks touch no reactive values.
	createEffect(
		() => ({ node: core().reading(), onSelect: props.onSelect }),
		({ node, onSelect }, previous) => {
			if (node && node !== previous?.node) onSelect?.(node)
		},
	)
	const hoveredNode = createMemo((): IBNode | null => {
		const id = core().hovered()
		return id !== null ? (core().nodeOf(id) ?? null) : null
	})
	createEffect(
		() => ({ node: hoveredNode(), onHover: props.onHover }),
		({ node, onHover }) => {
			onHover?.(node)
		},
	)

	/** The up-control's display label (destination-NAMED, settled
	 * 2026-08-16); null = at root, control hidden. */
	const upLabel = createMemo((): string | null => {
		const destination = core().upDestination()
		if (destination === null) return null
		return destination === 'root' ? props.title : destination.label
	})

	// ── The unified trail: ONE breadcrumb builder over the core ───────────
	const crumbs = createMemo((): BreadcrumbItem[] => {
		const c = core()
		const items: BreadcrumbItem[] = [{ label: props.title, onSelect: () => c.reset() }]
		const trail = c.trail()
		const reading = c.reading()
		const doc = c.document()
		trail.forEach((step, index) => {
			const label = c.stepLabel(step)
			const isCurrent = reading === null && index === trail.length - 1
			items.push(isCurrent ? { label } : { label, onSelect: () => c.jumpToStep(index) })
		})
		if (reading) {
			if (doc) {
				items.push({ label: reading.title, onSelect: () => c.upOneLevel() })
				items.push({ label: doc.label })
			} else {
				items.push({ label: reading.title })
			}
		}
		return items
	})

	/** What a tier's weight counts (sources' weight counts topics, etc.). */
	const weightLabelFor = (tier: IBTier): string =>
		props.galaxy.tiers.find((meta) => meta.tier === tier)?.weightLabel ?? props.galaxy.weightLabel

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
				onSelect: () => core().reset(),
			},
		]
		const list = facets()
		if (list.length > 1) {
			items.push({
				id: 'facet',
				label: `Colour: ${core().facetLabelOf(core().lens() ?? '')}`,
				icon: <span aria-hidden="true">◔</span>,
				onSelect: () => {
					const at = list.findIndex((facet) => facet.key === core().lens())
					const next = list[(at + 1) % list.length]
					if (next) core().setLens(next.key)
				},
			})
		}
		return items
	})

	// The reading contract: async computations over the core's state — reads
	// under the inspector's Loading boundary until the host's fetch lands.
	const readerContent = createMemo((): Promise<IBNodeContent | null> | null => {
		const node = core().reading()
		const load = props.loadContent
		return node && load ? load(node) : null
	})
	const documentContent = createMemo((): Promise<IBNodeContent | null> | null => {
		const doc = core().document()
		const load = props.loadDocument
		return doc && load ? load(doc.documentId) : null
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
									mode={core().mode()}
									onMode={(mode) => core().switchMode(mode)}
									facets={facets()}
									activeFacet={core().lens()}
									onFacet={(key) => core().setLens(key)}
									hasSoftScores={hasSoftScores()}
									intensityMode={intensityMode()}
									onIntensityMode={setIntensityMode}
									note={props.overviewNote}
								/>
							</WorkspaceNavigation>
						}
						stage={
							<WorkspaceStage label={`${props.title} galaxy`} class="ib-galaxy-workspace-stage">
								<SceneStage
									adapter={adapter}
									configuration={configuration()}
									events={{}}
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
												onSelect={(item) => core().openNode(item.id)}
											/>
										</div>
										<Show when={!core().interacted()}>
											<div class="ib-galaxy-hint">
												<StageHint>{props.hint ?? DEFAULT_HINT}</StageHint>
											</div>
										</Show>
										<Show when={hoveredNode()}>
											{(node) => (
												<Show when={node().id !== core().reading()?.id}>
													<div class="ib-galaxy-hover">
														<WorkspaceStageTooltip
															label={node().title}
															detail={`${node().weight} ${weightLabelFor(node().tier)}${
																node().intensityLabel ? ` · ${node().intensityLabel}` : ''
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
								label={core().reading()?.title ?? props.title}
								activeKey={core().reading()?.id ?? null}
								onOcclusionChange={occlusionHandler()}
								class="ib-galaxy-inspector"
							>
								<Show
									when={core().reading()}
									fallback={
										<GalaxyDrill
											galaxy={props.galaxy}
											title={props.title}
											core={core()}
											hoveredId={core().hovered()}
											upLabel={upLabel()}
										/>
									}
								>
									{(node) => (
										<Show
											when={core().document()}
											fallback={
												<GalaxyInspectorNode
													galaxy={props.galaxy}
													node={node()}
													content={readerContent}
													onVisit={(id) => core().openNode(id)}
													upLabel={upLabel() ?? props.title}
													onUp={() => core().upOneLevel()}
													onHoverNode={(id) => core().setHighlight(id)}
													onOpenDocument={
														props.loadDocument &&
														((row) =>
															core().openDocument({
																documentId: row.documentId,
																label: row.label,
															}))
													}
												/>
											}
										>
											{(doc) => (
												<GalaxyInspectorDocument
													title={doc().label}
													eyebrow={props.documentLabel ?? 'Document'}
													content={documentContent}
													upLabel={node().title}
													onUp={() => core().upOneLevel()}
													onVisit={(id) => core().openNode(id)}
													onHoverNode={(id) => core().setHighlight(id)}
												/>
											)}
										</Show>
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
								activeId={core().mode()}
								onSelect={(id) => core().switchMode(id)}
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
