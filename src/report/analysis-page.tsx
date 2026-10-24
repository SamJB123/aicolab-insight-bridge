/**
 * A custom analysis page, for every Insight Bridge report: one per task the
 * run performed, drawn by the task's kind (analysis/*: tagging, questions,
 * perspectives, assessment, metrics), each designed around what its results
 * are. The host reads the overview (`analysisPage` in
 * @aicolab/insight-bridge/explorer/analysis) and hands the page loaders for
 * the drill-downs the reader opens, each a call to the same module's read.
 */
import {
	type AnalysisPage as AnalysisPageData,
	assessedDocumentsSchema,
	metricEntriesSchema,
	perspectiveDocumentsSchema,
	perspectiveGroupsSchema,
	questionDetailSchema,
	tagDocumentsSchema,
} from '@aicolab/insight-bridge-contracts/explorer'
import { Match, Switch } from 'solid-js'
import type { AnalysisDrill } from '../explorer/analysis.ts'
import {
	type AssessedDocumentsLoader,
	AssessmentView,
	type ScoreBandsOf,
} from './analysis/assessment-view.tsx'
import { DocumentNameContext } from './analysis/common.tsx'
import { type MetricEntriesLoader, MetricsView } from './analysis/metrics-view.tsx'
import {
	type PerspectiveDocumentsLoader,
	type PerspectiveGroupsLoader,
	PerspectiveView,
} from './analysis/perspective-view.tsx'
import { type QuestionDetailLoader, QuestionsView } from './analysis/questions-view.tsx'
import { type TagDocumentsLoader, TaggingView } from './analysis/tagging-view.tsx'
import { type ReportSurface, ReportSurfaceProvider } from './surface.tsx'
import './report.css'

/** What the page asks its host for when the reader opens something, and the name of every document those answers list. */
export interface AnalysisLoaders {
	tagDocuments: TagDocumentsLoader
	questionDetail: QuestionDetailLoader
	perspectiveDocuments: PerspectiveDocumentsLoader
	perspectiveGroups: PerspectiveGroupsLoader
	assessedDocuments: AssessedDocumentsLoader
	metricEntries: MetricEntriesLoader
	/** A listed document's name, as its drill-down was answered with. */
	documentName: (documentId: string) => string
}

/**
 * The page's loaders over one host door: `fetch` sends a drill-down request (served by
 * `analysisDrillOf`), each answer is held to its contract shape, and the names it came
 * with are kept for the views.
 */
export function analysisLoaders(
	taskId: string,
	fetch: (request: AnalysisDrill) => Promise<{ data: unknown; names: Record<string, string> }>,
): AnalysisLoaders {
	const names = new Map<string, string>()
	const answer = async (request: AnalysisDrill) => {
		const answered = await fetch(request)
		for (const [documentId, name] of Object.entries(answered.names)) names.set(documentId, name)
		return answered.data
	}
	return {
		tagDocuments: async (category, path, options) =>
			tagDocumentsSchema
				.nullable()
				.parse(await answer({ kind: 'tagDocuments', taskId, category, path, ...options })),
		questionDetail: async (questionId) =>
			questionDetailSchema.nullable().parse(await answer({ kind: 'questionDetail', questionId })),
		perspectiveDocuments: async (options) =>
			perspectiveDocumentsSchema
				.nullable()
				.parse(await answer({ kind: 'perspectiveDocuments', taskId, ...options })),
		perspectiveGroups: async (options) =>
			perspectiveGroupsSchema
				.nullable()
				.parse(await answer({ kind: 'perspectiveGroups', taskId, ...options })),
		assessedDocuments: async (options) =>
			assessedDocumentsSchema
				.nullable()
				.parse(await answer({ kind: 'assessedDocuments', taskId, ...options })),
		metricEntries: async (options) =>
			metricEntriesSchema
				.nullable()
				.parse(await answer({ kind: 'metricEntries', taskId, ...options })),
		documentName: (documentId) => names.get(documentId) ?? '',
	}
}

export function AnalysisPage(props: {
	page: AnalysisPageData
	loaders: AnalysisLoaders
	surface: ReportSurface
	/** An assessment's bands, by criterion, where the host names its own; else each whole point of the scale. */
	scoreBands?: ScoreBandsOf
}) {
	return (
		<ReportSurfaceProvider surface={props.surface}>
			<DocumentNameContext value={(documentId) => props.loaders.documentName(documentId)}>
				<Switch>
					<Match when={props.page.kind === 'metadata_tagging' ? props.page.overview : null}>
						{(overview) => (
							<TaggingView overview={overview()} tagDocuments={props.loaders.tagDocuments} />
						)}
					</Match>
					<Match when={props.page.kind === 'question_response' ? props.page.overview : null}>
						{(overview) => (
							<QuestionsView overview={overview()} questionDetail={props.loaders.questionDetail} />
						)}
					</Match>
					<Match when={props.page.kind === 'perspective_analysis' ? props.page.overview : null}>
						{(overview) => (
							<PerspectiveView
								overview={overview()}
								perspectiveDocuments={props.loaders.perspectiveDocuments}
								perspectiveGroups={props.loaders.perspectiveGroups}
							/>
						)}
					</Match>
					<Match when={props.page.kind === 'criteria_assessment' ? props.page.overview : null}>
						{(overview) => (
							<AssessmentView
								overview={overview()}
								assessedDocuments={props.loaders.assessedDocuments}
								bands={props.scoreBands}
							/>
						)}
					</Match>
					<Match when={props.page.kind === 'metrics_evaluation' ? props.page.overview : null}>
						{(overview) => (
							<MetricsView overview={overview()} metricEntries={props.loaders.metricEntries} />
						)}
					</Match>
				</Switch>
			</DocumentNameContext>
		</ReportSurfaceProvider>
	)
}
