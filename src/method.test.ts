/**
 * The Method page's account is DERIVED, and the thing worth proving is that it
 * cannot claim a stage that did not run.
 *
 * A method page is a truth claim about how a corpus was read, so the failure
 * that matters is not a typo — it is a page telling a reader that positions were
 * assessed on a run configured with `run_synthesis: false`, where there are no
 * positions at all. Each test below turns one phase off and checks the account
 * loses it. (Moved from the pipeline zone's run-method.node.test.ts with the
 * builder, 2026-10-21.)
 */
import {
	clusteringParamsSchema,
	recordedClusteringParams,
	storedClusteringParamsSchema,
} from '@aicolab/insight-bridge-contracts/clustering'
import type { MethodData } from '@aicolab/insight-bridge-contracts/explorer'
import { profileSchema } from '@aicolab/insight-bridge-contracts/profile'
import { runConfigSchema } from '@aicolab/insight-bridge-contracts/run-config'
import { clusteringTuningSchema } from '@aicolab/insight-bridge-contracts/run-notes'
import { describe, expect, it } from 'vitest'
import { buildMethod } from './method.ts'

const params = {
	analyst_role: 'a policy analyst',
	corpus_description: 'submissions to an inquiry',
	entity_noun: 'submitter',
	entity_noun_plural: 'submitters',
	document_noun: 'submission',
	document_noun_plural: 'submissions',
	extraction_focus: 'what is argued',
	consolidation_focus: 'the shared claims',
	entity_summary_focus: 'the submitter’s case',
	cluster_content_focus: 'the shared proposition',
	title_grammar: 'a noun phrase',
	title_guidance: 'name the argument',
	perspective_framing: 'against the proposition',
	writing_style: 'plain',
}

const profile = profileSchema.parse({
	name: 'test',
	prompts: { params },
	stance: {
		labels: ['Opposes', 'Redirects', 'Supports'],
		definitions: { Opposes: 'rejects it', Redirects: 'shifts it', Supports: 'backs it' },
		agreement: { supportive: ['Supports'], contesting: ['Opposes'], unclear: 'Redirects' },
	},
	facets: [
		{ name: 'sector', noun: 'kind of organisation', values: ['Academic', 'NGO'] },
		{
			name: 'era',
			noun: 'time period',
			derive: { from_facet: 'year', buckets: [{ label: '2015–22' }] },
		},
		{ name: 'author', noun: 'who wrote it', kind: 'free' },
	],
	facets_to_analyse: ['sector'],
	exclusions: { analysis: [{ facet: 'sector', values: ['Unknown'] }] },
})

const data: MethodData = {
	overview: {
		sources: 90,
		documents: 120,
		documentsBy: [],
		unanalysedDocuments: 0,
		passages: 4300,
		keyPoints: 800,
		quotes: 1600,
		quotesVerified: 1584,
		quotesVerifiedPct: 99,
		topics: 23,
		junkTopics: 1,
		generations: [{ generation: 1, label: 'family', labelPlural: 'families', count: 5 }],
		groups: 5,
		memberships: 900,
		stances: 300,
		stancedSources: 80,
		lensRows: 40,
		positionMix: {},
		lensMix: {},
		supportivePct: 80,
		lensSupportivePct: 90,
		hardFriction: 3,
		hardFrictionPct: 1,
		frictionSources: 3,
		lensValues: [],
		singleSourceTopics: 0,
		questions: 0,
		answers: 0,
		answeringSources: 0,
	},
	junk: [],
	unanalysed: [],
	build: null,
	clusteredPassages: 3900,
}

const keys = (config: Record<string, unknown>) =>
	buildMethod(profile, runConfigSchema.parse(config), data).stages.map((s) => s.key)

describe('buildMethod — the stages are the phases that ran', () => {
	it('reports every phase on a default run', () => {
		expect(keys({})).toEqual([
			'ingest',
			'analysis',
			'entity-review',
			'clustering',
			'synthesis',
			'junk-review',
			'hierarchy',
			'stars',
		])
	})

	it('does not claim positions were assessed when synthesis was off', () => {
		const stages = buildMethod(
			profile,
			runConfigSchema.parse({ run_synthesis: false }),
			data,
		).stages
		expect(stages.map((s) => s.key)).not.toContain('synthesis')
		expect(stages.some((s) => /position/i.test(s.body))).toBe(false)
	})

	it('drops the review, the tree and the name-settling when each is off', () => {
		expect(keys({ junk_review: { enabled: false } })).not.toContain('junk-review')
		expect(keys({ hierarchy: { enabled: false } })).not.toContain('hierarchy')
		expect(keys({ entity_review: { enabled: false } })).not.toContain('entity-review')
	})

	it("states the run's own minimum cluster size, not the default", () => {
		const stage = buildMethod(
			profile,
			runConfigSchema.parse({ clustering: { min_cluster_size: 7, entity_penalty: 0.4 } }),
			data,
		).stages.find((s) => s.key === 'clustering')
		expect(stage?.body).toContain('at least 7 passages')
	})

	it('says what the output guarantees and never how it is produced', () => {
		// The account is public. It may state properties a reader can verify from
		// the outputs; it may not name the clustering's other settings, the
		// membership thresholds, an algorithm, or the order the writing-up runs
		// in. The rule is at the top of method.ts.
		const stages = buildMethod(
			profile,
			runConfigSchema.parse({
				clustering: {
					entity_penalty: 0.4,
					exemplar_threshold: 0.93,
					high_value_threshold: 0.83,
					member_threshold: 0.63,
				},
			}),
			data,
		).stages
		const text = stages.map((s) => `${s.title} ${s.body}`).join('\n')
		expect(text).not.toMatch(/penalt/i)
		expect(text).not.toMatch(/HDBSCAN|catalogue/i)
		expect(text).not.toMatch(/0\.4|0\.93|0\.83|0\.63/)
		expect(text).not.toMatch(/\bFIRST\b|only then/i)
	})

	it('uses the profile’s own nouns rather than "source" and "document"', () => {
		const ingest = buildMethod(profile, runConfigSchema.parse({}), data).stages[0]
		expect(ingest?.title).toContain('submissions')
		expect(ingest?.body).toContain('submitters')
	})

	it('puts what the host authored around the derived account, in its place', () => {
		const method = buildMethod(profile, runConfigSchema.parse({}), data, {
			before: [{ key: 'collection', title: 'Collecting', body: 'From the inquiry page.' }],
			ingest: 'Each submitter carries its submission number.',
			after: [{ key: 'app', title: 'Loading this site', body: 'Copied whole.' }],
		})
		expect(method.stages[0]?.key).toBe('collection')
		expect(method.stages.at(-1)?.key).toBe('app')
		expect(method.stages.find((s) => s.key === 'ingest')?.body).toMatch(/submission number\.$/)
	})

	it('states the committed build’s settings and its attempts, not the config’s', () => {
		const tuned: MethodData = {
			...data,
			build: {
				buildId: 2,
				kind: 'initial',
				points: 4300,
				params: clusteringParamsSchema.parse({ min_cluster_size: 12 }),
				tuning: clusteringTuningSchema.parse({
					attempts: [8, 12].map((size) => ({
						min_cluster_size: size,
						min_samples: 2,
						entity_penalty: 0.3,
						cluster_selection_epsilon: 0,
						clusters: size === 8 ? 60 : 24,
						noise: size === 8 ? 900 : 400,
						orphans: 1,
					})),
					min_cluster_size: 12,
					min_samples: 2,
					entity_penalty: 0.3,
					cluster_selection_epsilon: 0,
					clusters: 24,
					noise: 400,
					orphans: [],
					knn_backend: null,
					knn_recall: null,
					points: 4300,
					completed_at: '2026-10-21T00:00:00Z',
				}),
				hierarchy: null,
				labels: null,
			},
		}
		const method = buildMethod(
			profile,
			runConfigSchema.parse({ clustering: { min_cluster_size: 5 } }),
			tuned,
		)
		expect(method.stages.find((s) => s.key === 'clustering')?.body).toContain(
			'at least 12 passages',
		)
		expect(method.attempts.map((a) => a.minClusterSize)).toEqual([8, 12])
	})

	it('says a build recorded no settings, and never states the config’s defaults as the run’s', () => {
		const params = storedClusteringParamsSchema.parse({})
		expect(recordedClusteringParams(params)).toBeNull()
		expect(
			recordedClusteringParams(storedClusteringParamsSchema.parse({ min_cluster_size: 12 }))
				?.min_cluster_size,
		).toBe(12)
		const lifted: MethodData = {
			...data,
			build: {
				buildId: 1,
				kind: 'initial',
				points: 4300,
				params,
				tuning: null,
				hierarchy: null,
				labels: null,
			},
		}
		const body = buildMethod(
			profile,
			runConfigSchema.parse({ clustering: { auto_relax: true } }),
			lifted,
		).stages.find((s) => s.key === 'clustering')?.body
		expect(body).toContain('did not record the settings')
		expect(body).not.toMatch(/at least \d+ passages|relaxed/)
	})
})

describe('buildMethod — what the run declared', () => {
	const method = buildMethod(profile, runConfigSchema.parse({}), data)

	it('marks only the facets that were compared', () => {
		expect(method.facets.find((f) => f.key === 'sector')?.analysed).toBe(true)
		expect(method.facets.find((f) => f.key === 'era')?.analysed).toBe(false)
	})

	it('carries a derived facet’s buckets as its values, and its source', () => {
		const era = method.facets.find((f) => f.key === 'era')
		expect(era?.values).toEqual(['2015–22'])
		expect(era?.derivedFrom).toBe('year')
	})

	it('reports a free facet as free, with no values', () => {
		const author = method.facets.find((f) => f.key === 'author')
		expect(author?.kind).toBe('free')
		expect(author?.values).toEqual([])
	})

	it('passes the stance scale and its agreement through as declared', () => {
		expect(method.scale.labels).toEqual(['Opposes', 'Redirects', 'Supports'])
		expect(method.scale.agreement?.unclear).toBe('Redirects')
	})

	it('reports no agreement when the scale does not measure it', () => {
		const severity = profileSchema.parse({
			name: 'audit',
			prompts: { params },
			stance: {
				labels: ['Assurance', 'Systemic'],
				definitions: { Assurance: 'no finding', Systemic: 'a systemic failure' },
			},
			facets: [{ name: 'body', noun: 'type of body', values: ['Agency'] }],
			facets_to_analyse: ['body'],
		})
		expect(buildMethod(severity, runConfigSchema.parse({}), data).scale.agreement).toBeNull()
	})

	it('carries the exclusions that kept sources out of the analysis', () => {
		expect(method.exclusions).toEqual([{ facet: 'sector', values: ['Unknown'] }])
	})

	it('names the embedding model that actually ran', () => {
		const ingest = method.stages.find((s) => s.key === 'ingest')
		expect(ingest?.body).toContain('text-embedding-3-large')
	})
})
