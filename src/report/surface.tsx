/**
 * What a report's pages need from their host, in one place: the run's words,
 * the host's position colours, what opening a reading means, and the host's
 * own link to each section — the package cannot know a route, so a host
 * (an app's router, the pipeline's run site, the hub's tabs) renders it.
 * Every page reads it from context, as the Brief reads its own surface.
 */
import type { RunWords } from '@aicolab/insight-bridge-contracts/explorer'
import type { JSX } from '@solidjs/web'
import { createContext, useContext } from 'solid-js'
import type { DocumentLine, ReadingTarget } from '../explorer/readings.ts'

/** A report's sections, in the order its header lists them. */
export const REPORT_SECTIONS = [
	'overview',
	'galaxy',
	'topics',
	'sources',
	'search',
	'questions',
	'method',
	'connect',
] as const
export type ReportSection = (typeof REPORT_SECTIONS)[number]

/** How the run's questions read, where the corpus names them (an inquiry's terms of reference). */
export interface ReportVocabulary {
	/** A heading — 'Terms of reference'. Default 'Questions'. */
	questionsTitle?: string
	/** In a sentence — 'the terms of reference'. Default 'the questions'. */
	questionsPhrase?: string
	/** One question — 'clause'. Default 'question'. */
	question?: string
}

export interface ReportSurface {
	words: RunWords
	/** The host's colour for each position (its palette). */
	positionColors: Readonly<Record<string, string>>
	/** Open a topic, a grouping node or a source in the host's reader. */
	open: (target: ReadingTarget) => void
	/** The host's own link to a section. */
	Link: (props: { section: ReportSection; class?: string; children: JSX.Element }) => JSX.Element
	vocabulary?: ReportVocabulary
	/** A document's name in a list; its title, else its file name. The same as the readings'. */
	documentLabel?: (d: DocumentLine) => string
}

/** The surface's document name, with its default. */
export const documentLabelOf = (s: ReportSurface, d: DocumentLine) =>
	s.documentLabel ? s.documentLabel(d) : (d.title ?? d.fileName)

/** The surface's vocabulary with its defaults. */
export const vocabularyOf = (s: ReportSurface) => ({
	questionsTitle: s.vocabulary?.questionsTitle ?? 'Questions',
	questionsPhrase: s.vocabulary?.questionsPhrase ?? 'the questions',
	question: s.vocabulary?.question ?? 'question',
})

/** Solid 2: the context object is the provider; the default-less form throws without one. */
export const ReportSurfaceContext = createContext<ReportSurface>()
export const useReportSurface = () => useContext(ReportSurfaceContext)

export const fmt = (v: number) => v.toLocaleString('en-AU')
export const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
