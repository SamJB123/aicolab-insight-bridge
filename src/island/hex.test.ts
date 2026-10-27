// The report island composed as claims on the hex lattice (@aicolab/atlas
// square-island-hex.ts) is the oracle island: the same plan for a record
// with one task, with four, and with none. What the claims answer of a
// square island is the atlas's own test.

import { planAsData } from '@aicolab/atlas/chessboard/content/plan-as-data.ts'
import { describe, expect, it } from 'vitest'
import { hexReportIslandPlan, reportIslandPlan } from './plan.ts'
import { syntheticRecord } from './synthetic-record.ts'

const records = {
	'one task': syntheticRecord(),
	'four tasks': syntheticRecord({
		tasks: [
			{ id: 'terms', title: 'Terms of reference' },
			{ id: 'scope', title: 'Scope', description: 'What is in and out.' },
			{ id: 'method', title: 'Method' },
			{ id: 'risks', title: 'Risks' },
		],
	}),
}

describe('the hex island is the oracle island', () => {
	for (const [name, record] of Object.entries(records)) {
		it(`lays the same plan for ${name}`, () => {
			const oracle = planAsData(reportIslandPlan(record, 'synthetic'))
			const hex = planAsData(hexReportIslandPlan(record, 'synthetic').plan)
			expect(hex).toEqual(oracle)
		})
	}
	it('lays the same plan with no record', () => {
		expect(planAsData(hexReportIslandPlan(null, 'alone').plan)).toEqual(
			planAsData(reportIslandPlan(null, 'alone')),
		)
	})
})
