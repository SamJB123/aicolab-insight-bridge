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

/** What the page asks its host for when the reader opens something. */
export interface AnalysisLoaders {
	tagDocuments: TagDocumentsLoader
	questionDetail: QuestionDetailLoader
	perspectiveDocuments: PerspectiveDocumentsLoader
	perspectiveGroups: PerspectiveGroupsLoader
	assessedDocuments: AssessedDocumentsLoader
	metricEntries: MetricEntriesLoader
}

/**
 * The page's loaders over one host door: `fetch` sends a drill-down request
 * (served by `analysisDrill`) and each answer is held to its contract shape.
 */
export function analysisLoaders(
	taskId: string,
	fetch: (request: AnalysisDrill) => Promise<unknown>,
): AnalysisLoaders {
	return {
		tagDocuments: async (category, path, options) =>
			tagDocumentsSchema
				.nullable()
				.parse(await fetch({ kind: 'tagDocuments', taskId, category, path, ...options })),
		questionDetail: async (questionId) =>
			questionDetailSchema.nullable().parse(await fetch({ kind: 'questionDetail', questionId })),
		perspectiveDocuments: async (options) =>
			perspectiveDocumentsSchema
				.nullable()
				.parse(await fetch({ kind: 'perspectiveDocuments', taskId, ...options })),
		perspectiveGroups: async (options) =>
			perspectiveGroupsSchema
				.nullable()
				.parse(await fetch({ kind: 'perspectiveGroups', taskId, ...options })),
		assessedDocuments: async (options) =>
			assessedDocumentsSchema
				.nullable()
				.parse(await fetch({ kind: 'assessedDocuments', taskId, ...options })),
		metricEntries: async (options) =>
			metricEntriesSchema
				.nullable()
				.parse(await fetch({ kind: 'metricEntries', taskId, ...options })),
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
		</ReportSurfaceProvider>
	)
}
