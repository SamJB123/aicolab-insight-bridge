// A small synthetic record for tests: three topics in two levels of
// grouping, four sources, one facet, and the tasks asked for — the island
// a report's world is built from — and its rooms' texts, the writing a door
// would give each room (core's `worldText`). Everything the world, the island
// plan and a room's walls read is here; nothing is real.

import {
	type WorldRecord,
	type WorldText,
	type WorldTextRef,
	worldRecordSchema,
	worldTextSchema,
} from '../world/index.ts'

export interface SyntheticTask {
	id: string
	title: string
	description?: string
}

const SOURCES = ['alpha', 'beta', 'gamma', 'delta']
/** Three sources with one document, one with two. */
const documentsOf = (id: string, i: number) => [
	{ id: `doc-${id}`, title: `Submission ${id}`, points: ['One', 'Two', 'Three'] },
	...(i === 3 ? [{ id: `doc-${id}-2`, title: `Annex ${id}`, points: ['Four'] }] : []),
]

export function syntheticRecord(
	options: { tasks?: readonly SyntheticTask[]; slug?: string; title?: string } = {},
): WorldRecord {
	const tasks = options.tasks ?? [{ id: 'terms', title: 'Terms of reference', description: '' }]
	return worldRecordSchema.parse({
		site: {
			slug: options.slug ?? 'synthetic',
			title: options.title ?? 'A Synthetic Report',
			eyebrow: null,
			standfirst: 'Three topics, four sources, one facet.',
			source: null,
			nouns: {
				entity: 'submitter',
				entities: 'submitters',
				document: 'document',
				documents: 'documents',
			},
			scale: {
				order: ['Supports', 'Opposes', 'Unclear'],
				supportive: ['Supports'],
				contesting: ['Opposes'],
				unclear: 'Unclear',
			},
		},
		facets: [
			{
				key: 'sector',
				heading: 'Sector',
				values: [
					{ value: 'Academia', label: 'Academia', sources: 2 },
					{ value: 'Company', label: 'Company', sources: 2 },
				],
			},
		],
		// Two levels of hierarchy: a family, a group within it; one topic in
		// the group, one in the family itself, one in no group at all.
		generations: [
			{ generation: 2, label: 'family', labelPlural: 'families' },
			{ generation: 1, label: 'group', labelPlural: 'groups' },
		],
		groups: [
			{
				id: 10,
				generation: 2,
				title: 'Family A',
				description: null,
				parentId: null,
				topics: 2,
				sources: 4,
				positions: {},
			},
			{
				id: 11,
				generation: 1,
				title: 'Group A1',
				description: null,
				parentId: 10,
				topics: 1,
				sources: 2,
				positions: {},
			},
		],
		topics: [1, 2, 3].map((id) => ({
			id,
			title: `Topic ${id}: a claim`,
			description: 'What it says.',
			parents:
				id === 3
					? []
					: [
							{
								groupId: id === 1 ? 11 : 10,
								isPrimary: true,
								membershipType: 'exemplar',
								similarity: 0.9,
							},
						],
			sources: 2,
			documents: 2,
			positions: { Supports: 2 },
			keyPoints: 1,
			lenses: [{ facet: 'sector', value: 'Academia', position: 'Supports', quotes: 0 }],
			star: { x: 0.5, y: 0.5, r: 0.5 },
		})),
		sources: SOURCES.map((id, i) => ({
			id,
			name: `Source ${id}`,
			facets: { sector: [i % 2 === 0 ? 'Academia' : 'Company'] },
			documents: documentsOf(id, i).map((d) => ({
				id: d.id,
				title: d.title,
				points: d.points.length,
			})),
			memberOnly: 0,
		})),
		memberships: [
			{ topicId: 1, sourceId: 'alpha', grade: 'exemplar' },
			{ topicId: 1, sourceId: 'beta', grade: 'high_value' },
			{ topicId: 2, sourceId: 'alpha', grade: 'exemplar' },
			{ topicId: 3, sourceId: 'gamma', grade: 'exemplar' },
		],
		perspectives: [
			{ topicId: 1, sourceId: 'alpha', position: 'Supports', keyPoints: 2, quotes: 1 },
		],
		tasks: tasks.map((task) => ({
			kind: 'question_response',
			id: task.id,
			title: task.title,
			description: task.description ?? '',
			prompts: [
				{
					key: `${task.id}-a`,
					clause: '(a)',
					text: '(a) the first term',
					group: null,
					ordinal: 1,
					answers: [{ sourceId: 'alpha', documentId: 'doc-alpha', keyPoints: 1 }],
				},
			],
		})),
	})
}

/** The synthetic record's room texts: what its door would give each room. */
export function syntheticText(ref: WorldTextRef): WorldText {
	const perspective = {
		topicId: 1,
		sourceId: 'alpha',
		title: 'Alpha on 1',
		description: '',
		analysis: 'Alpha supports topic 1.',
	}
	const lens = (topicId: number) => ({
		topicId,
		facet: 'sector',
		value: 'Academia',
		analysis: 'Academia supports.',
		quotes: [],
	})
	const answer = (taskId: string) => ({
		taskId,
		promptKey: `${taskId}-a`,
		sourceId: 'alpha',
		documentId: 'doc-alpha',
		position: 'Supports',
		lead: 'Alpha answers (a).',
	})
	const empty = { points: [], documents: [], perspectives: [], lenses: [], answers: [] }
	switch (ref.kind) {
		case 'topic':
			return worldTextSchema.parse({
				ref,
				...empty,
				points: ['A point'],
				perspectives: ref.topicId === 1 ? [perspective] : [],
				lenses: [lens(ref.topicId)],
			})
		case 'source': {
			const i = SOURCES.indexOf(ref.sourceId)
			return worldTextSchema.parse({
				ref,
				...empty,
				documents:
					i < 0 ? [] : documentsOf(ref.sourceId, i).map((d) => ({ id: d.id, points: d.points })),
				perspectives: ref.sourceId === 'alpha' ? [perspective] : [],
				answers: ref.sourceId === 'alpha' ? [answer('terms')] : [],
			})
		}
		case 'cohort':
			return worldTextSchema.parse({
				ref,
				...empty,
				lenses: ref.value === 'Academia' ? [1, 2, 3].map(lens) : [],
			})
		case 'task':
			return worldTextSchema.parse({ ref, ...empty, answers: [answer(ref.taskId)] })
	}
}
