/**
 * A tagging task's page. Tags are dense — a document carries many — so the
 * raw count saturates: the view leads with each value's bar of documents and,
 * inside it, the documents that named it their PRIMARY tag, and beside it the
 * lens strip (each lens value's share against the overall share), which is
 * where a value tells one group from another. A nested vocabulary reads as a
 * tree that opens a level at a time. Opening a value lists its documents with
 * the model's own evidence for the tag. A second tab shows which top-level
 * values are tagged together on one document.
 */
import type {
	TagDocuments,
	TaggedDocument,
	TaggedValue,
	TaggingCategory,
	TaggingOverview,
} from '@aicolab/insight-bridge-contracts/explorer'
import { Segmented, SelectControl } from '@aicolab/ui-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { fmt, useReportSurface } from '../surface.tsx'
import {
	AnalysisHead,
	LensKey,
	LensStrip,
	lensWords,
	MoreButton,
	pctOf,
	usePaged,
	WordsNotice,
	wordsClass,
} from './common.tsx'

export type TagDocumentsLoader = (
	category: string,
	path: string,
	options: { offset: number; lensValue?: string | null },
) => Promise<TagDocuments | null>

export function TaggingView(props: {
	overview: TaggingOverview
	tagDocuments: TagDocumentsLoader
}) {
	const s = useReportSurface()
	const lens = () => lensWords(s)
	const [categoryAt, setCategoryAt] = createSignal(0)
	const category = () => props.overview.categories[categoryAt()] ?? props.overview.categories[0]
	const [mode, setMode] = createSignal<'taxonomy' | 'together'>('taxonomy')
	return (
		<div class="view-wrap ib-report-view-wide">
			<AnalysisHead
				task={props.overview.task}
				lede={`Each ${s.words.nouns.document} was tagged against ${props.overview.categories.length === 1 ? 'one vocabulary' : `${props.overview.categories.length} vocabularies`}, with the model's reason for every tag. A ${s.words.nouns.document} carries many tags, so the bars say most where they part: the dark share is the ${s.words.nouns.documents} that named a value their primary tag, and the cells beside it show which ${(lens().heading ?? 'group').toLowerCase()}s tagged it more or less than everyone else.`}
			/>
			<section class="sec" style={{ 'border-top': 'none' }}>
				<div class="ib-report-an-controls">
					<Show when={props.overview.categories.length > 1}>
						<Segmented
							label="Vocabulary"
							options={props.overview.categories.map((c, i) => ({ id: String(i), label: c.name }))}
							value={String(categoryAt())}
							onChange={(id) => setCategoryAt(Number(id))}
						/>
					</Show>
					<Segmented
						label="View"
						options={[
							{ id: 'taxonomy', label: 'Values' },
							{ id: 'together', label: 'Tagged together' },
						]}
						value={mode()}
						onChange={(id) => setMode(id)}
					/>
				</div>
				<Show when={category()}>
					{(c) => (
						<Show
							when={mode() === 'taxonomy'}
							fallback={<Together category={c()} documents={props.overview.task.documents} />}
						>
							<Taxonomy
								category={c()}
								overview={props.overview}
								tagDocuments={props.tagDocuments}
							/>
						</Show>
					)}
				</Show>
			</section>
		</div>
	)
}

function Taxonomy(props: {
	category: TaggingCategory
	overview: TaggingOverview
	tagDocuments: TagDocumentsLoader
}) {
	const s = useReportSurface()
	const lens = () => lensWords(s)
	const total = () => props.overview.task.documents
	const [order, setOrder] = createSignal<'vocabulary' | 'documents'>('vocabulary')
	const [openPaths, setOpenPaths] = createSignal<ReadonlySet<string>>(new Set())
	const [chosen, setChosen] = createSignal<string | null>(null)
	const childrenOf = createMemo(() => {
		const byParent = new Map<string | null, TaggedValue[]>()
		for (const v of props.category.values)
			byParent.set(v.parentPath, [...(byParent.get(v.parentPath) ?? []), v])
		if (order() === 'documents')
			for (const list of byParent.values()) list.sort((a, b) => b.documents - a.documents)
		return byParent
	})
	/** The rows shown: the roots, and the children of every opened value, depth first. */
	const rows = createMemo(() => {
		const out: TaggedValue[] = []
		const walk = (parent: string | null) => {
			for (const v of childrenOf().get(parent) ?? []) {
				out.push(v)
				if (openPaths().has(v.path)) walk(v.path)
			}
		}
		walk(null)
		return out
	})
	const toggle = (path: string) =>
		setOpenPaths((held) => {
			const next = new Set(held)
			if (next.has(path)) next.delete(path)
			else next.add(path)
			return next
		})
	const max = () => Math.max(1, ...props.category.values.map((v) => v.documents))
	return (
		<div class="ib-report-an-taxonomy">
			<div class="ib-report-an-controls">
				<p class="fig-note">
					{`${fmt(props.category.documentsTagged)} of ${fmt(total())} ${s.words.nouns.documents} tagged${props.category.levels.length ? ` · levels: ${props.category.levels.join(' › ')}` : ''}${props.category.vocabulary === 'open' ? ' · open vocabulary' : ''}`}
				</p>
				<Segmented
					label="Order"
					options={[
						{ id: 'vocabulary', label: 'Vocabulary order' },
						{ id: 'documents', label: 'Most tagged' },
					]}
					value={order()}
					onChange={(id) => setOrder(id)}
				/>
			</div>
			<Show when={props.category.description}>{(d) => <p class="fig-note">{d()}</p>}</Show>
			<ul class="ib-report-an-tree" aria-label={props.category.name}>
				<For each={rows()}>
					{(v) => {
						const hasChildren = () => (childrenOf().get(v.path)?.length ?? 0) > 0
						const open = () => openPaths().has(v.path)
						return (
							<li
								class={['ib-report-an-node', { 'ib-report-on': chosen() === v.path }]}
								style={{ '--depth': String(v.depth) }}
							>
								<div class="ib-report-an-node-row">
									<button
										type="button"
										class="ib-report-an-caret"
										disabled={!hasChildren()}
										aria-expanded={hasChildren() ? (open() ? 'true' : 'false') : undefined}
										aria-label={open() ? `Close ${v.name}` : `Open ${v.name}`}
										onClick={() => toggle(v.path)}
									>
										{hasChildren() ? (open() ? '▾' : '▸') : ''}
									</button>
									<button
										type="button"
										class="ib-report-an-node-name"
										aria-pressed={chosen() === v.path ? 'true' : 'false'}
										onClick={() => setChosen(chosen() === v.path ? null : v.path)}
									>
										<span>{v.name}</span>
										<Show when={!v.declared}>
											<small class="ib-report-an-chip">outside the vocabulary</small>
										</Show>
									</button>
									<span
										class="ib-report-an-bar"
										title={`${v.documents} ${s.words.nouns.documents} (${pctOf(v.documents, total())}%)${props.category.primary ? `; ${v.primary} name it their primary tag` : ''}`}
									>
										<span
											class="ib-report-an-bar-fill"
											style={{ '--w': `${(100 * v.documents) / max()}%` }}
										>
											<span
												class="ib-report-an-bar-primary"
												style={{ '--w': `${v.documents ? (100 * v.primary) / v.documents : 0}%` }}
											/>
										</span>
									</span>
									<span class="ib-report-an-n">
										{fmt(v.documents)}
										<Show when={props.category.primary && v.primary > 0}>
											<small>{` · ${fmt(v.primary)} primary`}</small>
										</Show>
									</span>
									<Show when={props.overview.lens.length > 1}>
										<LensStrip
											lens={props.overview.lens}
											counts={v.byLens}
											of="documents"
											overall={total() ? v.documents / total() : 0}
											label={lens().label}
											noun={lens().heading ?? 'group'}
										/>
									</Show>
								</div>
								<Show when={chosen() === v.path}>
									<TagDocumentsList
										category={props.category.name}
										value={v}
										overview={props.overview}
										tagDocuments={props.tagDocuments}
									/>
								</Show>
							</li>
						)
					}}
				</For>
			</ul>
			<Show when={props.overview.lens.length > 1 && lens().heading}>
				{(heading) => (
					<LensKey lens={props.overview.lens} label={lens().label} heading={heading()} />
				)}
			</Show>
		</div>
	)
}

/** A value's documents: whose, the leaf each was given, primary or not, how relevant, and the model's reason. */
function TagDocumentsList(props: {
	category: string
	value: TaggedValue
	overview: TaggingOverview
	tagDocuments: TagDocumentsLoader
}) {
	const s = useReportSurface()
	const lens = () => lensWords(s)
	const [lensAt, setLensAt] = createSignal<string>('all')
	const lensValue = () => {
		const at = lensAt()
		if (at === 'all') return undefined
		return props.overview.lens[Number(at)]?.value ?? undefined
	}
	const paged = usePaged(
		() => ({ path: props.value.path, lensValue: lensValue() }),
		(k, offset) => props.tagDocuments(props.category, k.path, { offset, lensValue: k.lensValue }),
		(page) => page.documents,
	)
	return (
		<div class="ib-report-an-drill">
			<div class="ib-report-an-controls">
				<strong>{`${props.value.name}: ${fmt(props.value.documents)} ${s.words.nouns.documents}`}</strong>
				<Show when={props.overview.lens.length > 1}>
					<SelectControl
						aria-label={lens().heading ?? 'Group'}
						value={lensAt()}
						onChange={(e) => setLensAt(e.currentTarget.value)}
					>
						<option value="all">{`Every ${(lens().heading ?? 'group').toLowerCase()}`}</option>
						<For each={props.overview.lens}>
							{(l, i) => <option value={String(i())}>{lens().label(l.value)}</option>}
						</For>
					</SelectControl>
				</Show>
			</div>
			<Show when={paged.failed()}>
				{(e) => (
					<p class="fig-note" role="alert">
						{e()}
					</p>
				)}
			</Show>
			<ul class="ib-report-an-evidence">
				<For each={paged.items()}>{(d) => <TaggedDocumentRow d={d} value={props.value} />}</For>
			</ul>
			<MoreButton
				shown={paged.items().length}
				total={paged.total()}
				busy={paged.busy()}
				onMore={paged.more}
				noun={s.words.nouns.documents}
			/>
		</div>
	)
}

function TaggedDocumentRow(props: { d: TaggedDocument; value: TaggedValue }) {
	const s = useReportSurface()
	const lens = () => lensWords(s)
	/** The leaf beneath the opened value, when it was given one deeper. */
	const deeper = () =>
		props.d.tag === props.value.path
			? null
			: props.d.tag.slice(props.value.path.length).replace(/^\s*›\s*/, '')
	return (
		<li class={['ib-report-an-evidence-row', wordsClass(props.d)]}>
			<div class="ib-report-an-evidence-who">
				<button
					type="button"
					class="dw-inline-link"
					onClick={() => s.open({ kind: 'source', key: props.d.documentId })}
				>
					{props.d.entityName}
				</button>
				<Show when={props.d.lensValue !== null || s.words.lens}>
					<small class="ib-report-an-chip">{lens().label(props.d.lensValue)}</small>
				</Show>
				<Show when={props.d.isPrimary}>
					<small class="ib-report-an-chip ib-report-an-chip-strong">primary</small>
				</Show>
				<Show when={props.d.relevance}>
					{(r) => <small class="ib-report-an-chip">{`${r()} relevance`}</small>}
				</Show>
			</div>
			<Show when={deeper()}>{(leaf) => <p class="ib-report-an-leaf">{leaf()}</p>}</Show>
			<Show when={props.d.context}>{(c) => <p class="ib-report-an-context">{c()}</p>}</Show>
			<WordsNotice of={props.d} />
			<p class="fig-note">{props.d.documentTitle ?? props.d.fileName}</p>
		</li>
	)
}

/** The commonest sets of top-level values tagged on one document, as the bars of an UpSet chart. */
function Together(props: { category: TaggingCategory; documents: number }) {
	const s = useReportSurface()
	const max = () => Math.max(1, ...props.category.combinations.map((c) => c.documents))
	return (
		<div class="ib-report-an-together">
			<p class="fig-note">
				{`The ${props.category.combinations.length} commonest sets of top-level values found together on one ${s.words.nouns.document}, and how many ${s.words.nouns.documents} carry exactly that set.`}
			</p>
			<ul class="ib-report-an-combos">
				<For each={props.category.combinations}>
					{(c) => (
						<li class="ib-report-an-combo">
							<span class="ib-report-an-combo-set">
								<For each={c.paths}>{(p) => <span class="ib-report-an-chip">{p}</span>}</For>
							</span>
							<span class="ib-report-an-bar" title={`${c.documents} ${s.words.nouns.documents}`}>
								<span
									class="ib-report-an-bar-fill"
									style={{ '--w': `${(100 * c.documents) / max()}%` }}
								/>
							</span>
							<span class="ib-report-an-n">{fmt(c.documents)}</span>
						</li>
					)}
				</For>
			</ul>
		</div>
	)
}
