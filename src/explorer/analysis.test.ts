/**
 * The custom analysis reads over a run built from the canonical schema's own
 * migrations, for the kinds no prepared run on disk carries yet: a criteria
 * assessment (scores, the joint distribution, the ranked documents and a
 * joint cell) and a metrics evaluation (names grouped across case and
 * spacing, north stars declared and aligned). The tagging, question and
 * perspective reads are held to real runs by the explorer test and the
 * analysis probes.
 */
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
	assessedDocumentsSchema,
	assessmentOverviewSchema,
	metricEntriesSchema,
	metricsOverviewSchema,
	type RunWords,
} from '@aicolab/insight-bridge-contracts/explorer'
import type { CorpusDb } from '@aicolab/insight-bridge-contracts/schema'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { migrate } from 'drizzle-orm/node-sqlite/migrator'
import { beforeAll, describe, expect, it } from 'vitest'
import * as analysis from './analysis.ts'

const MIGRATIONS = resolve(
	dirname(createRequire(import.meta.url).resolve('@aicolab/insight-bridge-contracts/package.json')),
	'drizzle',
)

const words: RunWords = {
	title: 'Test run',
	eyebrow: null,
	standfirst: null,
	source: null,
	nouns: { entity: 'body', entities: 'bodies', document: 'report', documents: 'reports' },
	scale: { order: [], supportive: [], contesting: [], unclear: null },
	lens: null,
	facets: {},
	tasks: {
		severity: { type: 'criteria_assessment', title: 'Severity' },
		measures: { type: 'metrics_evaluation', title: 'Measures' },
	},
	sections: ['overview', 'analysis'],
}

let db: CorpusDb
beforeAll(() => {
	const client = new DatabaseSync(':memory:')
	const orm = drizzle({ client })
	migrate(orm, { migrationsFolder: MIGRATIONS })
	client.exec(`
		INSERT INTO entity (id, entity_id, entity_name) VALUES ('a', 'a', 'Agency A'), ('b', 'b', 'Agency B'), ('c', 'c', 'Agency C');
		INSERT INTO document (document_id, entity_uuid, file_name) VALUES ('d1', 'a', 'd1.pdf'), ('d2', 'b', 'd2.pdf'), ('d3', 'c', 'd3.pdf');
		INSERT INTO doc_custom_analysis (document_id, task_id, task_type, created_at) VALUES
			('d1', 'severity', 'criteria_assessment', 1), ('d2', 'severity', 'criteria_assessment', 1), ('d3', 'severity', 'criteria_assessment', 1),
			('d1', 'measures', 'metrics_evaluation', 1), ('d2', 'measures', 'metrics_evaluation', 1);
		INSERT INTO analysis_topic (topic_name) VALUES ('Risk');
		INSERT INTO analysis_subtopic (analysis_topic_id, subtopic_name) VALUES (1, 'Severity'), (1, 'Systemic');
		INSERT INTO criterion_analysis (analysis_subtopic_id, custom_analysis_id, key_point, details, score) VALUES
			(1, 1, 'Serious failure', 'Why 1', 4), (2, 1, 'Recurring', 'Why 2', 5),
			(1, 2, 'Minor gap', 'Why 3', 2), (2, 2, 'Isolated', 'Why 4', 1),
			(1, 3, 'Serious failure again', 'Why 5', 4), (2, 3, 'Recurring again', 'Why 6', 5);
		INSERT INTO criterion_quote (criterion_analysis_id, quote) VALUES (1, 'the controls failed');
		INSERT INTO metric (custom_analysis_id, metric_type, metric_name, explicitness, metric_description) VALUES
			(4, 'strategy', 'Customer satisfaction', 'Explicit', 'Survey score'),
			(5, 'strategy', 'customer  satisfaction ', 'Implicit', ''),
			(5, 'subset', 'Incidents blocked', 'Explicit', 'Count');
		INSERT INTO metric_collection_requirement (metric_id, requirement) VALUES (1, 'Annual survey');
		INSERT INTO north_star (north_star_name) VALUES ('Trust');
		INSERT INTO metric_north_star_alignment (metric_id, north_star_id, alignment_how) VALUES (1, 1, 'Trust shows in satisfaction');`)
	db = orm
})

describe('custom analysis reads', () => {
	it('an assessment: distributions, the joint cells, the ranked documents and one cell', async () => {
		const o = assessmentOverviewSchema.parse(
			await analysis.assessmentOverview(db, words, 'severity'),
		)
		expect(o.task).toMatchObject({ kind: 'criteria_assessment', title: 'Severity', documents: 3 })
		expect(o.criteria.map((c) => [c.text, c.scored, c.mean])).toEqual([
			['Severity', 3, 3.33],
			['Systemic', 3, 3.67],
		])
		expect(o.criteria[0]?.distribution).toEqual([
			{ score: 2, documents: 1 },
			{ score: 4, documents: 2 },
		])
		expect(o.joint?.cells.sort((a, b) => a.x - b.x)).toEqual([
			{ x: 2, y: 1, documents: 1 },
			{ x: 4, y: 5, documents: 2 },
		])
		const ranked = assessedDocumentsSchema.parse(
			await analysis.assessedDocuments(db, words, 'severity', {
				sortBy: o.criteria[0]?.criterionId,
			}),
		)
		expect(ranked.documents.map((d) => d.entityName)).toEqual(['Agency A', 'Agency C', 'Agency B'])
		expect(ranked.documents[0]?.scores[0]).toMatchObject({
			score: 4,
			keyPoint: 'Serious failure',
			quotes: ['the controls failed'],
		})
		const x = o.joint?.x ?? 0
		const y = o.joint?.y ?? 0
		const cell = assessedDocumentsSchema.parse(
			await analysis.assessedDocuments(db, words, 'severity', {
				cell: { xCriterion: x, x: 2, yCriterion: y, y: 1 },
			}),
		)
		expect(cell.documents.map((d) => d.entityName)).toEqual(['Agency B'])
	})

	it('a metrics evaluation: names grouped across case and spacing, north stars with their documents', async () => {
		const o = metricsOverviewSchema.parse(await analysis.metricsOverview(db, words, 'measures'))
		expect(o.metrics.map((m) => [m.name, m.documents, m.explicit, m.implicit])).toEqual([
			['Customer satisfaction', 2, 1, 1],
			['Incidents blocked', 1, 1, 0],
		])
		expect(o.northStars).toEqual([
			{ name: 'Trust', declared: false, metrics: 1, documents: 1, byLens: [] },
		])
		const entries = metricEntriesSchema.parse(
			await analysis.metricEntries(db, words, 'measures', { name: 'CUSTOMER satisfaction' }),
		)
		expect(entries.total).toBe(2)
		expect(entries.entries[0]).toMatchObject({
			requirements: ['Annual survey'],
			alignments: [{ northStar: 'Trust' }],
		})
	})

	it('a task the run never performed reads as nothing', async () => {
		expect(await analysis.assessmentOverview(db, words, 'absent')).toBeNull()
		expect(await analysis.metricsOverview(db, words, 'severity')).toBeNull()
	})
})
