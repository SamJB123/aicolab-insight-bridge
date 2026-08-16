/**
 * The unsupported-browser gate (settled 2026-08-14: the galaxy is
 * WebGPU-only — no WebGL2 tier). Composes ui-solid's Panel so it takes the
 * host's theme; the host supplies its own way back into flat exploration via
 * the `action` slot (typically a router Link to its 2D explorer), keeping
 * this package free of the consumer's route types.
 */

import { Panel } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { Show } from 'solid-js'

export interface GalaxyGatePanelProps {
	/** The corpus's display name — "Watchful State", "One Basin"… */
	corpusTitle: string
	/** Pre-rendered galaxy still for this corpus, shown in place of the scene. */
	posterSrc?: string
	/** Lazy slot (hydration-safe): the host's link into its 2D explorer. */
	action?: () => JSX.Element
}

export function GalaxyGatePanel(props: GalaxyGatePanelProps) {
	return (
		<div class="ib-galaxy-gate">
			<Panel title="A WebGPU sky" kicker="Insight Galaxy" action={props.action}>
				<Show when={props.posterSrc !== undefined}>
					<img
						class="ib-galaxy-gate-poster"
						src={props.posterSrc}
						alt={`A still of the ${props.corpusTitle} galaxy`}
						decoding="async"
						loading="lazy"
					/>
				</Show>
				<p>
					The galaxy map draws {props.corpusTitle} with compute shaders and needs a browser that
					exposes WebGPU — current Chrome or Edge, or Safari 26 on recent hardware. This browser
					doesn't offer one, so the sky stays a picture here.
				</p>
				<p class="ib-galaxy-gate-hint">
					Everything in the galaxy is also reachable through the flat views.
				</p>
			</Panel>
		</div>
	)
}
