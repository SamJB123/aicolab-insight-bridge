/**
 * A report's header sections as LINKS (`ReportSections`, rendered through the
 * host's own Link, so the router marks the current one), from the sections as
 * data (./nav-items.ts: the site's own list, each custom analysis task by its
 * title, the host's own pages after the sections they name, the menus they
 * fold into).
 */
import { Menu, MenuItem, type MenuItemLinkProps } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { For, Show } from 'solid-js'
import { entryKey, headerEntries, isMenu, type MenuEntry, navKey } from './nav-items.ts'
import type { HostNavItem } from './own-pages.ts'
import type { ReportSurface } from './surface.tsx'

/** How the host renders a link to one of its pages, through its router: as a header link, or — given a menu item's attributes — as that item's anchor. */
export type HostLink = (
	item: { to: string; label: string },
	attributes?: MenuItemLinkProps,
) => JSX.Element

/**
 * A host page's link, made ONCE: the host's link function is called with its
 * path and label as getters, so a reload of the run's words (new objects, the
 * same values) updates the link in place. Called again, the host's router Link
 * would be rebuilt and re-read a menu item's attributes outside any tracking
 * scope.
 */
function HostPageLink(props: {
	link: HostLink | undefined
	to: string
	label: string
	attributes?: MenuItemLinkProps
}) {
	const item = {
		get to() {
			return props.to
		},
		get label() {
			return props.label
		},
	}
	return <>{props.link?.(item, props.attributes)}</>
}

/** Several pages behind one header entry: ui-solid's Menu, each item the host's own Link (MenuItem `linkComponent`), so choosing one navigates in the app and the router marks it. The trigger reads as current when one of its pages is. */
function HeaderMenu(props: { surface: ReportSurface; entry: MenuEntry; hostLink?: HostLink }) {
	return (
		<Menu
			label={props.entry.menu}
			class="ib-report-nav-menu"
			trigger={(wiring) => (
				<button
					type="button"
					class="ib-report-nav-trigger"
					aria-haspopup="menu"
					popovertarget={wiring.popoverTarget}
					style={wiring.style}
				>
					{props.entry.menu}
				</button>
			)}
		>
			<For each={props.entry.items} keyed={navKey}>
				{(item) => {
					const page = () => {
						const i = item()
						return i.section === null ? i : null
					}
					const section = () => {
						const i = item()
						return i.section === null ? null : i
					}
					return (
						<MenuItem
							linkComponent={(attributes) => (
								<>
									<Show when={section()}>
										{(s) => (
											<props.surface.Link
												section={s().section}
												taskId={s().taskId}
												{...attributes}
											/>
										)}
									</Show>
									<Show when={page()}>
										{(p) => (
											<HostPageLink
												link={props.hostLink}
												to={p().to}
												label={p().label}
												attributes={attributes}
											/>
										)}
									</Show>
								</>
							)}
						>
							{item().label}
						</MenuItem>
					)
				}}
			</For>
		</Menu>
	)
}

/** The header's links, through the host's Link; Connect carries the call-to-action class. */
export function ReportSections(props: {
	surface: ReportSurface
	ctaClass?: string
	/** The host's own pages, and how it renders a link to one (through its router). */
	host?: {
		items: readonly HostNavItem[]
		link: HostLink
	}
}) {
	return (
		// Keyed by what each entry IS, so a reload of the run's words (a route's
		// loader runs again) updates a row in place rather than building it anew:
		// a rebuilt menu or link re-reads its attributes outside any tracking scope.
		<For each={headerEntries(props.surface.words, props.host?.items)} keyed={entryKey}>
			{(entry) => {
				const menu = () => {
					const e = entry()
					return isMenu(e) ? e : null
				}
				const page = () => {
					const e = entry()
					return !isMenu(e) && e.section === null ? e : null
				}
				const section = () => {
					const e = entry()
					return !isMenu(e) && e.section !== null ? e : null
				}
				return (
					<>
						<Show when={menu()}>
							{(m) => (
								<HeaderMenu surface={props.surface} entry={m()} hostLink={props.host?.link} />
							)}
						</Show>
						<Show when={page()}>
							{(p) => <HostPageLink link={props.host?.link} to={p().to} label={p().label} />}
						</Show>
						<Show when={section()}>
							{(s) => (
								<props.surface.Link
									section={s().section}
									taskId={s().taskId}
									class={s().section === 'connect' ? props.ctaClass : undefined}
								>
									{s().label}
								</props.surface.Link>
							)}
						</Show>
					</>
				)
			}}
		</For>
	)
}
