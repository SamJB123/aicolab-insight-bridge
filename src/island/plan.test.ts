// The report island plan as the ORACLE: the plan a record produces is
// snapshotted whole (positions, doors, paths, regions, chart markup), so
// any other way of composing an island (the hex claims, the declaration)
// is held to the same numbers, and a change to the plan's own arithmetic
// is seen.

import { planAsData } from '@aicolab/atlas/chessboard/content/plan-as-data.ts'
import { describe, expect, it } from 'vitest'
import { reportIslandPlan } from './plan.ts'
import { syntheticRecord } from './synthetic-record.ts'

describe('the report island plan', () => {
	it('is what it was, for a record with one task', () => {
		expect(planAsData(reportIslandPlan(syntheticRecord(), 'synthetic'))).toMatchSnapshot()
	})

	it('is what it was, for a record with four tasks (four chambers)', () => {
		const record = syntheticRecord({
			tasks: [
				{ id: 'terms', title: 'Terms of reference' },
				{ id: 'scope', title: 'Scope', description: 'What is in and out.' },
				{ id: 'method', title: 'Method' },
				{ id: 'risks', title: 'Risks' },
			],
		})
		expect(planAsData(reportIslandPlan(record, 'synthetic-four'))).toMatchSnapshot()
	})

	it('stands the island alone without a record', () => {
		expect(planAsData(reportIslandPlan(null, 'alone'))).toMatchSnapshot()
	})
})
