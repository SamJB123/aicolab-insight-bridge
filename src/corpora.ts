/**
 * The Insight Bridge family — every corpus explorer built on the pipeline.
 *
 * Consumer apps import this to render the family index on their
 * `/insight-bridge` page, passing their own `slug` so the current app is marked
 * rather than linked. Adding a new corpus explorer means adding one entry here,
 * and every sibling app picks it up on its next deploy.
 */

export type Corpus = {
	/** Stable id; a consumer app passes its own to mark itself current. */
	slug: string
	/** The app's own name, as it brands itself. */
	name: string
	/** What the corpus is, in one line. */
	blurb: string
	/** Canonical origin, no trailing slash. */
	url: string
	/** Scale, for the index. Static figures, not live counts — one app cannot
	 *  query another's D1, so these are read off each corpus's own overview
	 *  (its `/mcp` corpus_overview tool, or its landing page) and pasted here.
	 *  They will drift if a corpus is re-run; re-check them when that happens. */
	scale: string
}

export const CORPORA: Corpus[] = [
	{
		slug: 'second-chair',
		name: 'Second Chair',
		blurb:
			'AI and the legal profession: scholarship, industry evidence, primary legal materials and practitioner interviews, 1953–2026.',
		url: 'https://insightbridge-secondchair.aicolab.org',
		scale: '600 sources · 106 topics',
	},
	{
		slug: 'one-basin',
		name: 'One Basin',
		blurb:
			'Published public submissions to the Murray–Darling Basin Authority’s 2026 Basin Plan Review.',
		url: 'https://insightbridge-basin.aicolab.workers.dev',
		scale: '999 submissions · 86 topics',
	},
	{
		slug: 'audit-corpus',
		// The app's own masthead brand. Its published MCP connector still carries the
		// formal name, so the blurb opens with that for anyone who knows it by it.
		name: 'Watchful State',
		blurb:
			'The Australian Government Audit Corpus: reports of 50 oversight bodies, auditors-general, ombudsmen, anti-corruption and integrity commissions.',
		// Custom domain, attached in the Cloudflare dashboard rather than in this
		// app's wrangler.jsonc — so it survives deploys but is not visible in the
		// repo. Its workers.dev fallback is `aicolab-audit-corpus.aicolab.workers.dev`
		// (the WORKER name); `audit-corpus.aicolab.workers.dev` is the D1/Vectorize
		// resource name and 404s — it was listed here in error until 2026-08-08.
		url: 'https://auditcorpus.aicolab.org',
		scale: '4,183 reports · 276 topics',
	},
]

/** The family minus the app asking — what to show as "elsewhere". */
export const siblings = (slug: string): Corpus[] => CORPORA.filter((c) => c.slug !== slug)
