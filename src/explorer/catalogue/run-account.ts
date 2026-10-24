/**
 * The run's account of itself, as the Method page states it: the facts its page reads
 * (core's methodData), the record's documents by the host's document facet where it
 * names one, and the account built from the run's profile and config around what the
 * host authored (core's buildMethod). One body for the catalogue's `method` read and
 * the Method page's read; the host's method hook is given it.
 */
import type { MethodData, RunMethod } from '@aicolab/insight-bridge-contracts/explorer'
import { DEFAULT_RUN_CONFIG } from '@aicolab/insight-bridge-contracts/run-config'
import * as s from '@aicolab/insight-bridge-contracts/schema'
import { eq } from 'drizzle-orm'
import { buildMethod } from '../../method.ts'
import * as pages from '../pages.ts'
import type { ReportCtx } from './context.ts'

export type RunAccount = {
	data: MethodData
	method: RunMethod
	/** The record's documents by the host's document facet, in the run's order; empty where the host names none. */
	documentsBy: { value: string; documents: number }[]
}

export async function runAccount(ctx: ReportCtx): Promise<RunAccount> {
	const facet = ctx.host.documentFacet
	const [[meta], data, documentsBy] = await Promise.all([
		ctx.db
			.select({ profile: s.runMeta.profile, runConfig: s.runMeta.runConfig })
			.from(s.runMeta)
			.where(eq(s.runMeta.singleton, 1))
			.limit(1),
		pages.methodData(ctx.db, ctx.run.words, ctx.scope),
		facet ? pages.documentsBy(ctx.db, ctx.run.words, facet, ctx.scope) : Promise.resolve([]),
	])
	if (!meta?.profile)
		throw new Error('[catalogue] run_meta.profile is missing: the run cannot account for itself')
	// a run that stored no config ran under the default one (settled 2026-10-25)
	const config = meta.runConfig ?? DEFAULT_RUN_CONFIG
	return {
		data,
		method: buildMethod(meta.profile, config, data, ctx.host.method ?? {}),
		documentsBy,
	}
}
