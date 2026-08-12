/**
 * The Insight Bridge attribution mark.
 *
 * Sits directly under a consumer app's wordmark: a small glyph plus "Powered by
 * Insight Bridge", letterspaced and quiet. Deliberately subordinate — the app
 * keeps its own identity and this says what produced the corpus behind it.
 *
 * ADOPTION IS ONE COMPONENT, ONE PROP:
 *
 *   <PoweredByInsightBridge linkOptions={{ to: '/insight-bridge' }} />
 *
 * `linkOptions` is validated against the CONSUMER's route tree at the
 * consumer's call site, not here — so an app that never mounts the destination
 * fails to compile rather than shipping a dead mark. That works because
 * `RegisteredRouter` resolves through the `Register` interface by declaration
 * merging, which is module-scoped: this package keeps a live type reference to
 * `@tanstack/solid-router`, and the consumer's compiler resolves it in the
 * consumer's program where `Register` is augmented. Generic defaults resolve at
 * the call site, which is what lets one component serve three different apps
 * with three different route trees.
 *
 * This is the `ValidateLinkOptions` + two-signature pattern from TanStack's own
 * `docs/router/guide/type-utilities.md` (the `HeadingLink` example): a strict
 * public overload for type-checking, a loose implementation signature so the
 * body needs no assertions of its own.
 *
 * PACKAGING PRECONDITIONS — quiet failure if broken:
 *   • `@tanstack/solid-router` must stay a peerDependency so pnpm resolves ONE
 *     copy. Two copies means two `Register` interfaces, and `to` silently
 *     widens to `string` with no error to tell you.
 *   • This package must never declare its own `Register` augmentation.
 *
 * Colour comes from the host's tokens (--color-base-content-faint / --color-primary), so the mark
 * themes itself per app rather than importing a fixed brand palette.
 */

import type { RegisteredRouter, ValidateLinkOptions } from '@tanstack/solid-router'
import { Link } from '@tanstack/solid-router'
import type { JSX } from '@solidjs/web'
import aiColabIcon from './ai-colab-icon.svg?url'

/**
 * The AI CoLab mark.
 *
 * `ai-colab-icon.svg` is a byte-for-byte copy of `workers/landing/public/icon.svg`
 * — the real logo, unedited. It is referenced as an asset rather than inlined so
 * nothing about it is altered: its own fills are preserved (it does NOT inherit
 * currentColor), and its class names cannot collide with a host app's CSS.
 */
export function InsightBridgeGlyph(props: { size?: number }) {
	const s = () => props.size ?? 14
	return (
		<img
			class="ib-glyph"
			src={aiColabIcon}
			width={s()}
			height={s()}
			alt=""
			aria-hidden="true"
			decoding="async"
		/>
	)
}

export interface PoweredByInsightBridgeProps<
	TRouter extends RegisteredRouter = RegisteredRouter,
	TOptions = unknown,
> {
	/** Where the mark points, validated against the consumer's routes. */
	linkOptions: ValidateLinkOptions<TRouter, TOptions>
	/** Override the wordmark if a host needs a shorter form. */
	label?: string
	/** Appended to the mark's own class, for host-side positioning. */
	class?: string
}

// Strict public signature: TRouter pinned for TypeScript performance, TOptions
// left open so the consumer's `to` / `params` / `search` infer correctly.
export function PoweredByInsightBridge<
	TRouter extends RegisteredRouter = RegisteredRouter,
	TOptions = unknown,
>(props: PoweredByInsightBridgeProps<TRouter, TOptions>): JSX.Element

// Loose implementation signature — never called directly by consumers. Only
// `linkOptions` is spread, so `label` and `class` cannot leak onto the anchor
// as stray DOM attributes; props are read (not destructured) to stay reactive.
export function PoweredByInsightBridge(props: PoweredByInsightBridgeProps): JSX.Element {
	return (
		<Link
			{...props.linkOptions}
			class={`ib-mark ib-mark-link${props.class ? ` ${props.class}` : ''}`}
			preload="intent"
		>
			<InsightBridgeGlyph />
			<span>{props.label ?? 'Powered by Insight Bridge'}</span>
		</Link>
	)
}
