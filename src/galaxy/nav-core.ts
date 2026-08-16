/**
 * GalaxyNavCore — the HEADLESS navigation core for the galaxy (settled
 * 2026-08-16 across 12 MCQs, replacing the split-brain state that lived half
 * in the web UI and half in the 3D renderer, synced by hand across ~17 code
 * paths). Built on the house headless-core convention (see
 * threejs-playground components/insight-note/core.ts): all state + logic,
 * solid-js ONLY — no DOM, no three. Every face (the web UI's drawer,
 * breadcrumb and menus; the 3D renderer's camera, labels, fleets and
 * dimming) subscribes to the SAME signals and mutates ONLY through the
 * named actions here.
 *
 * THE MODEL — one shape for every place a user can be, per mode:
 *
 *   { trail: NavStep[], reading: node | null, document | null }
 *     NavStep = container node (family/supercluster/topic) | facet | value
 *
 * Sources are EQUAL CITIZENS: a source reading keeps the trail it was
 * opened over. Opened from a topic reading, that topic is PUSHED onto the
 * trail (trail [F,S] → [F,S,T], reading = source) — so "up" from the source
 * unambiguously restores the topic reading; opened from a facet cohort,
 * "up" restores the cohort. Nothing is remembered by side effect; the
 * context IS the state. 'Back' does not exist — faces render ONE up-control
 * NAMED for its destination (`upDestination()`).
 *
 * Per-mode trails are PRESERVED across Topics⇄Sources switches (settled).
 * Camera poses are remembered per state key (`poseMemory`) so "up" can
 * restore the exact view you left — the 3D face records and consumes them;
 * the core only stores them (opaque values).
 *
 * Reactivity discipline (the convention's): mutable state is signals
 * (ownerless-safe — a core can be constructed outside a reactive root);
 * derivations over the STATIC galaxy are plain functions.
 */

import { type Accessor, createSignal, type Setter } from 'solid-js'
import type { CameraPose } from '@aicolab/kolo/camera/pose-camera'
import { primaryParents } from './layout/cosmos.ts'
import type { IBGalaxy, IBNode, IBNodeId } from './types.ts'

/** A remembered camera view: the pose plus the visible-strip aspect it was
 * captured under (the type imports are erased at runtime — the core only
 * stores what the 3D face hands it). */
export interface RememberedView {
	pose: CameraPose
	aspect: number
}

export type GalaxyNavMode = 'topics' | 'sources'

export type NavStep =
	| { kind: 'node'; id: IBNodeId }
	| { kind: 'facet'; facet: string }
	| { kind: 'value'; facet: string; value: string }

export interface NavDocument {
	documentId: string
	label: string
}

interface ModeState {
	trail: NavStep[]
	reading: IBNodeId | null
	document: NavDocument | null
}

const EMPTY_STATE: ModeState = { trail: [], reading: null, document: null }

/** Where the up-control leads: 'root' = the corpus overview (faces label it
 * with the corpus title); otherwise a display label. `null` = already at
 * root — hide the control. */
export type UpDestination = 'root' | { label: string } | null

/** The classified current place — shared by BOTH faces (the drawer renders
 * rows/headers from it; the 3D renderer projects camera/labels/fleets). */
export type NavLevel =
	| { kind: 'root' }
	| { kind: 'children'; anchor: IBNode }
	| { kind: 'facets' }
	| { kind: 'values'; facet: string }
	| { kind: 'cohort'; facet: string; value: string }
	| { kind: 'reading'; node: IBNode; trail: NavStep[] }
	| { kind: 'document'; document: NavDocument; source: IBNode }

export class GalaxyNavCore {
	readonly galaxy: IBGalaxy
	readonly mode: Accessor<GalaxyNavMode>
	/** The colour-by lens (facet key painting the dust + source pins). */
	readonly lens: Accessor<string | undefined>
	/** Scene pointer hover (3D face writes; both faces read). */
	readonly hovered: Accessor<IBNodeId | null>
	/** UI-row hover mirrored into the scene (web face writes). */
	readonly highlight: Accessor<IBNodeId | null>
	/** Any navigation/pointer interaction happened (dismisses the hint). */
	readonly interacted: Accessor<boolean>

	/** Pixels of canvas covered by web-UI overlays from the bottom (the
	 * mobile drawer sheet; 0 on desktop where the panel shrinks the canvas
	 * instead). The web face writes it; the 3D face fits framing into the
	 * visible strip that remains (settled 2026-08-16). */
	readonly viewportInset: Accessor<number>

	/** Camera poses remembered per state key — written and consumed by the
	 * 3D face so "up" restores the exact view you left. Each memory carries
	 * the visible-strip aspect it was captured under: restoring into a
	 * meaningfully different canvas shape discards it in favour of a fresh
	 * fit (settled 2026-08-16). */
	readonly poseMemory = new Map<string, RememberedView>()

	#setMode: Setter<GalaxyNavMode>
	#setLens: Setter<string | undefined>
	#setHovered: Setter<IBNodeId | null>
	#setHighlight: Setter<IBNodeId | null>
	#setInteracted: Setter<boolean>
	#setViewportInset: Setter<number>
	#topics: Accessor<ModeState>
	#setTopics: Setter<ModeState>
	#sources: Accessor<ModeState>
	#setSources: Setter<ModeState>

	#nodes: Map<IBNodeId, IBNode>
	#parents: Map<IBNodeId, IBNodeId>

	constructor(galaxy: IBGalaxy) {
		this.galaxy = galaxy
		this.#nodes = new Map(galaxy.nodes.map((node) => [node.id, node]))
		this.#parents = primaryParents(galaxy)
		const [mode, setMode] = createSignal<GalaxyNavMode>('topics')
		this.mode = mode
		this.#setMode = setMode
		const [lens, setLens] = createSignal<string | undefined>(galaxy.sourceFacets?.[0]?.key)
		this.lens = lens
		this.#setLens = setLens
		const [hovered, setHovered] = createSignal<IBNodeId | null>(null)
		this.hovered = hovered
		this.#setHovered = setHovered
		const [highlight, setHighlight] = createSignal<IBNodeId | null>(null)
		this.highlight = highlight
		this.#setHighlight = setHighlight
		const [interacted, setInteracted] = createSignal(false)
		this.interacted = interacted
		this.#setInteracted = setInteracted
		const [viewportInset, setViewportInset] = createSignal(0)
		this.viewportInset = viewportInset
		this.#setViewportInset = setViewportInset
		const [topics, setTopics] = createSignal<ModeState>(EMPTY_STATE)
		this.#topics = topics
		this.#setTopics = setTopics
		const [sources, setSources] = createSignal<ModeState>(EMPTY_STATE)
		this.#sources = sources
		this.#setSources = setSources
	}

	/* ── Static lookups (plain functions — the galaxy never changes) ────── */

	nodeOf(id: IBNodeId): IBNode | undefined {
		return this.#nodes.get(id)
	}

	parentOf(id: IBNodeId): IBNode | undefined {
		const parentId = this.#parents.get(id)
		return parentId !== undefined ? this.#nodes.get(parentId) : undefined
	}

	/** Container lineage as trail steps, outermost first, EXCLUDING `node`
	 * itself (a topic's lineage = [family?, supercluster?]). */
	containerLineage(node: IBNode): NavStep[] {
		const chain: NavStep[] = []
		let cursor: IBNode | undefined = this.parentOf(node.id)
		for (let hop = 0; hop < 3 && cursor; hop++) {
			if (cursor.tier >= 1) chain.unshift({ kind: 'node', id: cursor.id })
			cursor = this.parentOf(cursor.id)
		}
		return chain
	}

	facetLabelOf(key: string): string {
		return this.galaxy.sourceFacets?.find((facet) => facet.key === key)?.label ?? key
	}

	stepLabel(step: NavStep): string {
		if (step.kind === 'node') return this.#nodes.get(step.id)?.title ?? step.id
		if (step.kind === 'facet') return this.facetLabelOf(step.facet)
		return step.value
	}

	/* ── Active-mode state ──────────────────────────────────────────────── */

	state(): ModeState {
		return this.mode() === 'topics' ? this.#topics() : this.#sources()
	}

	trail(): NavStep[] {
		return this.state().trail
	}

	reading(): IBNode | null {
		const id = this.state().reading
		return id === null ? null : (this.#nodes.get(id) ?? null)
	}

	document(): NavDocument | null {
		return this.state().document
	}

	/** Serialised identity of the current place (camera-relevant parts only —
	 * an open document reuses its source's framing). */
	stateKey(): string {
		const state = this.state()
		const steps = state.trail
			.map((step) =>
				step.kind === 'node'
					? `n:${step.id}`
					: step.kind === 'facet'
						? `f:${step.facet}`
						: `v:${step.value}`,
			)
			.join('/')
		return `${this.mode()}|${steps}|${state.reading ?? ''}`
	}

	/* ── Classification (shared by both faces) ──────────────────────────── */

	level(): NavLevel {
		const state = this.state()
		const reading = this.reading()
		if (reading && state.document) {
			return { kind: 'document', document: state.document, source: reading }
		}
		if (reading) return { kind: 'reading', node: reading, trail: state.trail }
		const tail = state.trail.at(-1)
		if (tail === undefined) return this.mode() === 'sources' ? { kind: 'facets' } : { kind: 'root' }
		if (tail.kind === 'facet') return { kind: 'values', facet: tail.facet }
		if (tail.kind === 'value') return { kind: 'cohort', facet: tail.facet, value: tail.value }
		const anchor = this.#nodes.get(tail.id)
		return anchor ? { kind: 'children', anchor } : { kind: 'root' }
	}

	/** The up-control's destination — ALWAYS named (settled 2026-08-16:
	 * 'back' is replaced by an explicit, destination-named control). */
	upDestination(): UpDestination {
		const state = this.state()
		if (state.document) {
			const reading = this.reading()
			return reading ? { label: reading.title } : 'root'
		}
		const tail = state.trail.at(-1)
		if (state.reading !== null) {
			if (tail === undefined) return 'root'
			return { label: this.stepLabel(tail) }
		}
		if (tail === undefined) return null
		const beneath = state.trail.at(-2)
		return beneath === undefined ? 'root' : { label: this.stepLabel(beneath) }
	}

	/* ── Actions — the ONLY way navigation state changes ────────────────── */

	#setState(next: ModeState): void {
		this.#setInteracted(true)
		if (this.mode() === 'topics') this.#setTopics(next)
		else this.#setSources(next)
	}

	/** Open any node — the ONE entry point for drill rows, pins, stars,
	 * palette results, engaged-topic rows and contributor rows alike.
	 * Containers re-root the topics trail; topics read within their lineage;
	 * SOURCES keep the trail they were opened over (a current topic reading
	 * is pushed onto the trail so "up" restores it — equal-citizen rule). */
	openNode(id: IBNodeId): void {
		const node = this.#nodes.get(id)
		if (!node) return
		if (node.tier >= 1) {
			this.#setMode('topics')
			this.#setInteracted(true)
			this.#setTopics({
				trail: [...this.containerLineage(node), { kind: 'node', id: node.id }],
				reading: null,
				document: null,
			})
			return
		}
		if (node.tier === 0) {
			this.#setMode('topics')
			this.#setInteracted(true)
			this.#setTopics({ trail: this.containerLineage(node), reading: node.id, document: null })
			return
		}
		const state = this.state()
		if (state.reading === node.id) return
		const current = state.reading !== null ? this.#nodes.get(state.reading) : undefined
		const trail =
			current && current.tier === 0
				? [...state.trail, { kind: 'node' as const, id: current.id }]
				: state.trail
		this.#setState({ trail, reading: node.id, document: null })
	}

	/** One level up — destination is whatever `upDestination()` names. */
	upOneLevel(): void {
		const state = this.state()
		if (state.document) {
			this.#setState({ ...state, document: null })
			return
		}
		if (state.reading !== null) {
			const tail = state.trail.at(-1)
			if (tail?.kind === 'node' && this.#nodes.get(tail.id)?.tier === 0) {
				// The source was opened from a topic reading — restore it.
				this.#setState({ trail: state.trail.slice(0, -1), reading: tail.id, document: null })
			} else {
				this.#setState({ ...state, reading: null, document: null })
			}
			return
		}
		if (state.trail.length > 0) {
			this.#setState({ trail: state.trail.slice(0, -1), reading: null, document: null })
		}
	}

	/** Breadcrumb jump: land AT trail step `index` (truncates deeper steps
	 * and any reading). */
	jumpToStep(index: number): void {
		const state = this.state()
		this.#setState({ trail: state.trail.slice(0, index + 1), reading: null, document: null })
	}

	/** The active mode's overview (root crumb, fly-home). Forgets the root's
	 * remembered camera pose so "home" is always the authored overview, not
	 * wherever the camera last idled at root. */
	reset(): void {
		this.poseMemory.delete(`${this.mode()}||`)
		this.#setState(EMPTY_STATE)
	}

	/** Per-mode trails are PRESERVED across switches (settled 2026-08-16). */
	switchMode(mode: GalaxyNavMode): void {
		this.#setInteracted(true)
		this.#setMode(mode)
	}

	openFacet(facet: string): void {
		this.#setMode('sources')
		this.#setInteracted(true)
		this.#setSources({ trail: [{ kind: 'facet', facet }], reading: null, document: null })
	}

	/** Choosing a value also aligns the colour-by lens to its facet. */
	openValue(facet: string, value: string): void {
		this.#setMode('sources')
		this.#setInteracted(true)
		this.#setSources({
			trail: [
				{ kind: 'facet', facet },
				{ kind: 'value', facet, value },
			],
			reading: null,
			document: null,
		})
		this.#setLens(facet)
	}

	/** Open one document of the current source reading. */
	openDocument(document: NavDocument): void {
		const state = this.state()
		if (state.reading === null) return
		this.#setState({ ...state, document })
	}

	setLens(facet: string): void {
		this.#setLens(facet)
	}

	setHovered(id: IBNodeId | null): void {
		this.#setHovered(id)
	}

	setHighlight(id: IBNodeId | null): void {
		this.#setHighlight(id)
	}

	markInteracted(): void {
		this.#setInteracted(true)
	}

	setViewportInset(px: number): void {
		this.#setViewportInset(Math.max(0, Math.round(px)))
	}
}
