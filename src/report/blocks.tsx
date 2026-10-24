/**
 * A report's own blocks (./additions.ts `Block`), drawn through the report's surface:
 * a row of figures, a paragraph, link cards to its sections or its own pages. Each kind
 * is drawn here once, whichever report sends it.
 */
import type { JSX } from '@solidjs/web'
import { Dynamic } from '@solidjs/web'
import { For, Match, Switch } from 'solid-js'
import { DoorCard } from '../site/figures.tsx'
import type { Block, LinkTarget } from './additions.ts'
import { StatRow } from './figures.tsx'
import { ProseText } from './prose.tsx'
import { useReportSurface } from './surface.tsx'

/** A link to a section or to a page of the report's own, through the host. */
function BlockLink(props: { to: LinkTarget; class: string; children: JSX.Element }) {
	const s = useReportSurface()
	const to = props.to
	if ('section' in to)
		return (
			<s.Link
				section={to.section}
				{...(to.taskId ? { taskId: to.taskId } : {})}
				class={props.class}
			>
				{props.children}
			</s.Link>
		)
	return (
		<Dynamic component={s.Page} to={to.page} class={props.class}>
			{props.children}
		</Dynamic>
	)
}

/** The report's blocks, in the order it sent them, as one section. */
export function Blocks(props: { blocks: readonly Block[] }) {
	return (
		<section class="sec ib-report-blocks">
			<For each={props.blocks}>
				{(block) => (
					<Switch>
						<Match when={block.kind === 'figures' ? block : undefined}>
							{(b) => <StatRow items={b().items} />}
						</Match>
						<Match when={block.kind === 'paragraph' ? block : undefined}>
							{(b) => (
								<p class="ib-report-block-p">
									<ProseText prose={b().prose} />
								</p>
							)}
						</Match>
						<Match when={block.kind === 'cards' ? block : undefined}>
							{(b) => (
								<div class="grid2 ib-report-block-cards">
									<For each={b().items}>
										{(card) => (
											<BlockLink to={card.to} class="fig reveal door">
												<DoorCard eyebrow={card.eyebrow} title={card.title} go={card.go}>
													<p>
														<ProseText prose={card.body} />
													</p>
												</DoorCard>
											</BlockLink>
										)}
									</For>
								</div>
							)}
						</Match>
					</Switch>
				)}
			</For>
		</section>
	)
}
