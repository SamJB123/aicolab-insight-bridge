/**
 * The reading site's chrome — the masthead, the skip link and the scrolling
 * pane, shared by every corpus explorer and by the pipeline zone's generated
 * run sites.
 *
 * WHAT IT OWNS: the frame. The sticky masthead, the identity column, the
 * section row, the phone-width fold, the skip link, and `<main>` as the one
 * element that scrolls.
 *
 * WHAT IT DOES NOT OWN: routing. A package cannot resolve a host's routes —
 * `Link`'s `to` is validated against a route tree that only exists in the
 * consumer's program (see brand.tsx for the full account). So the host renders
 * its own links and passes them in. That is the same division ui-solid's
 * WorkspaceShell draws, and it is why the apps' own `<Sections>` stays a
 * twenty-line component in each of them rather than moving here.
 *
 * THE THEME CONTROL is ui-solid's `ThemeToggle`, not a copy: it already exists,
 * already persists the choice, and already pairs with `themeBootScript` to stop
 * a light flash before hydration. Render that script in your document head.
 */
import { ThemeToggle } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { Show } from 'solid-js'

export interface SiteShellProps {
	/**
	 * The identity column: the site's wordmark, and under it the Insight Bridge
	 * attribution. A generated run site passes the run's name and
	 * `<PoweredByInsightBridge linkOptions={…} />`; an app passes its own mark.
	 */
	brand: JSX.Element
	/**
	 * The section links in nav order, as the host's own router links. Give the
	 * current one `class="active"`, and any call to action `class="mast-cta"`.
	 */
	sections: JSX.Element
	/**
	 * The same destinations as menu items, shown behind ☰ below 720px where the
	 * section row cannot fit. Omit it and the sections simply disappear at phone
	 * widths, so only omit it if the site has one section.
	 */
	menu?: JSX.Element
	/** Passed to ui-solid's ThemeToggle so several sites can keep separate choices. */
	themeStorageKey?: string
	/**
	 * Appended to the site element's class. A host that serves this site beside
	 * something else — the pipeline zone serves an operator console from the same
	 * document root — passes nothing extra; a host that wants a different theme
	 * on the site passes that theme's class instead of the default `ui-theme`.
	 */
	class?: string
	/** The route's output. */
	children: JSX.Element
}

/**
 * `ib-site` is site.css's scope root, and `ui-theme` is how a ui-solid theme is
 * opted into — the themes anchor that class rather than `:root` precisely so a
 * theme can cover part of a document. Together they mean everything this frame
 * brings, rules and tokens alike, stops at this element.
 */
export function SiteShell(props: SiteShellProps) {
	return (
		<div class={`ib-site ui-theme${props.class ? ` ${props.class}` : ''}`}>
			<a class="skip" href="#main">
				Skip to content
			</a>
			<header class="mast">
				<div class="mast-in">
					<div class="mast-id">{props.brand}</div>
					<nav class="mast-nav" aria-label="Sections">
						{props.sections}
					</nav>
					<ThemeToggle class="mast-theme" storageKey={props.themeStorageKey} />
					<Show when={props.menu}>{props.menu}</Show>
				</div>
			</header>
			<main id="main">{props.children}</main>
		</div>
	)
}
