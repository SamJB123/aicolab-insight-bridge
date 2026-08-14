/**
 * Deterministic synthetic corpus — the development bench for the galaxy map.
 *
 * The three real corpora live in remote D1 only (local databases are empty),
 * so engine work, unit tests and gate-panel posters all run against this:
 * a seeded, plausible-looking IBGalaxy with the structural quirks the real
 * adapters produce — a multi-parent DAG tail (audit), stance mixes
 * (legal/basin), hot flags, an optional two-tier shape (basin), and a couple
 * of orphan leaves (basin's junk clusters / legal's tree hole).
 */

import { mulberry32 } from '@aicolab/kolo/utils/seeded-random'
import type {
	IBEdge,
	IBGalaxy,
	IBNode,
	IBNodeContent,
	IBTierMeta,
} from './types.ts'

export const FIXTURE_MIX_ORDER = [
	'Supports',
	'Builds on',
	'Unclear',
	'Mixed',
	'Redirects',
	'Opposes',
] as const

export const FIXTURE_MIX_COLORS: Record<string, string> = {
	Supports: '#5a9a62',
	'Builds on': '#8fae6e',
	Unclear: '#8b8f96',
	Mixed: '#c9a34e',
	Redirects: '#c97e3f',
	Opposes: '#b04a3a',
}

export interface FixtureGalaxyOptions {
	seed?: number
	/** 0 → two-tier galaxy (the basin shape). */
	families?: number
	groups?: number
	topics?: number
	/** Source/contributor nodes (tier -1 dust) with topic memberships. */
	sources?: number
	/** Share of topics that get a secondary (non-primary) parent. */
	secondaryShare?: number
	/** Attach stance mixes (legal/basin flavour) vs none (audit flavour). */
	withMix?: boolean
	/** Leaves left without any parent edge, exercising orphan placement. */
	orphans?: number
}

const REALMS = [
	'Water',
	'Procurement',
	'Housing',
	'Transit',
	'Energy',
	'Justice',
	'Health',
	'Schooling',
	'Coastal',
	'Digital',
]
const FORCES = [
	'Oversight',
	'Allocation',
	'Consent',
	'Compliance',
	'Access',
	'Risk',
	'Stewardship',
	'Disclosure',
]
const SUBJECTS = [
	'licensing',
	'metering',
	'audits',
	'appeals',
	'funding',
	'standards',
	'consultation',
	'enforcement',
	'reporting',
	'planning',
]
const QUALIFIERS = [
	'Regional',
	'Interim',
	'Statutory',
	'Community',
	'Cross-border',
	'Emergency',
	'Annual',
	'Independent',
]
const ORG_NOUNS = [
	'Alliance',
	'Institute',
	'Commission',
	'Council',
	'Observatory',
	'Cooperative',
	'Authority',
	'Federation',
	'Chamber',
	'Trust',
]
const FIXTURE_FACETS: Record<string, string[]> = {
	Voice: ['Academia', 'Practitioners', 'Industry', 'Government', 'Civil society'],
	Era: ['Pre-2010', '2010s', 'Early 2020s', 'Mid 2020s'],
}
const MEMBERSHIP_GRADES = ['standard', 'standard', 'standard', 'high_value', 'high_value', 'exemplar'] as const

export function buildFixtureGalaxy(options: FixtureGalaxyOptions = {}): IBGalaxy {
	const {
		seed = 20260814,
		families = 7,
		groups = 34,
		topics = 180,
		sources = 140,
		secondaryShare = 0.15,
		withMix = true,
		orphans = 2,
	} = options
	const rng = mulberry32(seed)
	const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)]

	const nodes: IBNode[] = []
	const edges: IBEdge[] = []

	const familyIds: string[] = []
	for (let k = 0; k < families; k++) {
		familyIds.push(`g2:${k}`)
		nodes.push({
			id: `g2:${k}`,
			tier: 2,
			title: `${REALMS[k % REALMS.length]} ${pick(FORCES).toLowerCase()}`,
			key: k,
			weight: 0, // summed bottom-up below
		})
	}

	// Skewed assignment so some families/groups run big and some small,
	// like the real corpora's uneven tiers.
	const skewedIndex = (count: number): number =>
		Math.min(count - 1, Math.floor(rng() ** 1.4 * count))

	const groupIds: string[] = []
	const groupFamily: number[] = []
	for (let k = 0; k < groups; k++) {
		groupIds.push(`g1:${k}`)
		groupFamily.push(families > 0 ? skewedIndex(families) : -1)
		nodes.push({
			id: `g1:${k}`,
			tier: 1,
			title: `${pick(QUALIFIERS)} ${pick(REALMS).toLowerCase()} ${pick(SUBJECTS)}`,
			key: k,
			weight: 0,
		})
		if (families > 0) {
			edges.push({ child: `g1:${k}`, parent: `g2:${groupFamily[k]}`, isPrimary: true })
		}
	}

	const topicWeights: number[] = []
	const topicGroup: number[] = []
	for (let k = 0; k < topics; k++) {
		const orphan = k >= topics - orphans
		const groupIdx = skewedIndex(groups)
		const weight = 1 + Math.floor(120 * rng() ** 2.8)
		const intensity = Math.min(1, Math.max(0, (rng() + rng()) / 2))
		topicWeights.push(weight)
		topicGroup.push(orphan ? -1 : groupIdx)

		let mix: Record<string, number> | undefined
		if (withMix) {
			const stances = Math.max(3, Math.round(weight * 0.8))
			const raw = FIXTURE_MIX_ORDER.map(() => rng() ** 2)
			const total = raw.reduce((sum, v) => sum + v, 0)
			mix = {}
			FIXTURE_MIX_ORDER.forEach((label, i) => {
				const share = Math.round((raw[i] / total) * stances)
				if (share > 0 && mix) mix[label] = share
			})
		}

		const flags: IBNode['flags'] = []
		if (orphan) flags.push({ label: 'no group', hot: true, tip: 'Outside the group layer' })
		else if (rng() < 0.08) flags.push({ label: '1 voice', hot: true })
		else if (rng() < 0.05) flags.push({ label: 'unscrutinised', hot: true })

		nodes.push({
			id: `t:${k}`,
			tier: 0,
			title: `${pick(QUALIFIERS)} ${pick(REALMS).toLowerCase()} ${pick(SUBJECTS)}`,
			key: k,
			weight,
			volume: Math.round(weight * (1.2 + rng())),
			// Stance-mix corpora carry NO heat axis (settled: contested% was a
			// misreading of how the clustering separates dissent) — heat only
			// exists where a real rubric score does (the severity flavour).
			intensity: withMix ? undefined : intensity,
			intensityLabel: withMix ? undefined : `sev ${(1 + intensity * 4).toFixed(1)}`,
			mix,
			flags: flags.length > 0 ? flags : undefined,
		})
		if (!orphan) {
			edges.push({
				child: `t:${k}`,
				parent: `g1:${groupIdx}`,
				isPrimary: true,
				membershipType: 'exemplar',
			})
			if (rng() < secondaryShare && groups > 1) {
				let other = skewedIndex(groups)
				if (other === groupIdx) other = (other + 1) % groups
				edges.push({
					child: `t:${k}`,
					parent: `g1:${other}`,
					isPrimary: false,
					membershipType: 'high_value',
					similarity: 0.35 + rng() * 0.55,
				})
			}
		}
	}

	// Bottom-up weights + child counts (primary membership only).
	const groupWeight = new Array<number>(groups).fill(0)
	const groupChildren = new Array<number>(groups).fill(0)
	for (let k = 0; k < topics; k++) {
		if (topicGroup[k] >= 0) {
			groupWeight[topicGroup[k]] += topicWeights[k]
			groupChildren[topicGroup[k]] += 1
		}
	}
	const familyWeight = new Array<number>(families).fill(0)
	const familyChildren = new Array<number>(families).fill(0)
	for (const node of nodes) {
		if (node.tier === 1) {
			const k = groupIds.indexOf(node.id)
			node.weight = Math.round(groupWeight[k] * 0.65) + 2
			node.childCount = groupChildren[k]
			if (groupFamily[k] >= 0) {
				familyWeight[groupFamily[k]] += node.weight
				familyChildren[groupFamily[k]] += 1
			}
		}
	}
	for (const node of nodes) {
		if (node.tier === 2) {
			const k = familyIds.indexOf(node.id)
			node.weight = Math.round(familyWeight[k] * 0.8) + 4
			node.childCount = familyChildren[k]
		}
	}

	// Sources: skewed engagement (a few prolific contributors, a long tail of
	// single-topic ones), each membership carrying BOTH layout signals — the
	// 3-step grade and a continuous soft intensity varied around it.
	const facetKeys = Object.keys(FIXTURE_FACETS)
	for (let k = 0; k < sources; k++) {
		const memberships = 1 + Math.floor(rng() ** 1.8 * 6)
		const joined = new Set<number>()
		let bestGrade = -1
		let bestTopic = -1
		const pending: Array<{ topic: number; grade: number }> = []
		for (let m = 0; m < memberships; m++) {
			const topic = skewedIndex(topics - orphans)
			if (joined.has(topic)) continue
			joined.add(topic)
			const gradeName = pick(MEMBERSHIP_GRADES)
			const grade = gradeName === 'exemplar' ? 10 : gradeName === 'high_value' ? 5 : 1
			pending.push({ topic, grade })
			if (grade > bestGrade) {
				bestGrade = grade
				bestTopic = topic
			}
		}
		const facets: Record<string, string> = {}
		for (const key of facetKeys) facets[key] = pick(FIXTURE_FACETS[key])
		// A source's weight counts the TOPICS it engages (breadth — the tier
		// meta names it); membership depth shapes the layout, not the size.
		nodes.push({
			id: `s:${k}`,
			tier: -1,
			title: `${pick(QUALIFIERS)} ${pick(REALMS)} ${pick(ORG_NOUNS)}`,
			key: 100000 + k,
			weight: Math.max(1, joined.size),
			facets,
		})
		for (const { topic, grade } of pending) {
			edges.push({
				child: `s:${k}`,
				parent: `t:${topic}`,
				isPrimary: topic === bestTopic,
				membershipType: grade === 10 ? 'exemplar' : grade === 5 ? 'high_value' : 'standard',
				similarity: grade / 10,
				softIntensity: grade * (0.4 + rng() ** 1.2 * 2),
			})
		}
	}

	const tiers: IBTierMeta[] =
		families > 0
			? [
					{ tier: 2, label: 'Family', labelPlural: 'Families' },
					{ tier: 1, label: 'Theme', labelPlural: 'Themes' },
					{ tier: 0, label: 'Topic', labelPlural: 'Topics' },
					{ tier: -1, label: 'Source', labelPlural: 'Sources', weightLabel: 'topics' },
				]
			: [
					{ tier: 1, label: 'Group', labelPlural: 'Groups' },
					{ tier: 0, label: 'Topic', labelPlural: 'Topics' },
					{ tier: -1, label: 'Source', labelPlural: 'Sources', weightLabel: 'topics' },
				]

	return {
		tiers,
		sourceFacets: facetKeys.map((key) => ({ key, label: key })),
		nodes,
		edges,
		weightLabel: 'sources',
		intensityLabel: withMix ? undefined : 'mean severity',
		mixOrder: withMix ? [...FIXTURE_MIX_ORDER] : undefined,
		mixColors: withMix ? FIXTURE_MIX_COLORS : undefined,
		seed,
	}
}

const POINT_SHAPES = [
	'Oversight bodies repeatedly flag %s as under-documented',
	'Compliance timelines for %s slipped across successive reviews',
	'%s carries the strongest single-agency concentration in this cluster',
	'Recommendations on %s were accepted but not implemented',
	'Practitioners describe %s as the binding constraint on delivery',
]
const QUOTE_SHAPES = [
	'“The framework for %s remains, in practice, aspirational.”',
	'“We found no evidence that %s had been revisited since the last audit.”',
	'“On %s, the agencies simply do not agree about who holds the pen.”',
]
const FACET_LABELS = ['Practitioners', 'Regulators', 'Academics', 'Industry', 'Community']
const ENTITY_LABELS = [
	'Auditor-General NSW',
	'Commonwealth Ombudsman',
	'Integrity Commission VIC',
	'Productivity Review Office',
	'Coastal Authority QLD',
]

/**
 * Deterministic synthetic node content — the reader's dev bench (real
 * corpora are remote-only locally). Seeded per node, so screenshots and
 * probes are stable.
 */
export function buildFixtureContent(node: IBNode): IBNodeContent {
	const rng = mulberry32((typeof node.key === 'number' ? node.key : node.key.length) ^ 0x7e57ed)
	const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)]
	const subject = node.title.toLowerCase()
	const pointCount = 2 + Math.floor(rng() * 3)
	return {
		lede: `What the corpus actually says about ${subject}, distilled from ${node.weight} sources — fixture prose standing in for the live drawer content.`,
		stats: [
			{ label: 'sources', value: String(node.weight) },
			...(node.volume !== undefined ? [{ label: 'documents', value: String(node.volume) }] : []),
			...(node.intensityLabel !== undefined ? [{ label: 'score', value: node.intensityLabel }] : []),
		],
		sections: [
			{
				kind: 'points',
				title: 'Key points',
				points: Array.from({ length: pointCount }, () => ({
					text: pick(POINT_SHAPES).replace('%s', subject),
					detail: `The elaboration behind this point about ${subject} — fixture prose standing in for the extracted detail, long enough to prove the accordion body wraps properly.`,
					quotes:
						rng() < 0.8
							? [
									{
										text: pick(QUOTE_SHAPES).replace('%s', subject),
										source: `${pick(ENTITY_LABELS)}, ${2016 + Math.floor(rng() * 10)}`,
									},
								]
							: undefined,
				})),
			},
			{
				kind: 'facets',
				title: 'Perspectives',
				rows: FACET_LABELS.slice(0, 3 + Math.floor(rng() * 3)).map((label) => ({
					label,
					badge: FIXTURE_MIX_ORDER[Math.floor(rng() * FIXTURE_MIX_ORDER.length)],
					badgeColor:
						FIXTURE_MIX_COLORS[FIXTURE_MIX_ORDER[Math.floor(rng() * FIXTURE_MIX_ORDER.length)]],
					share: 0.2 + rng() * 0.8,
					analysis: `How this cohort frames ${subject}, in one fixture sentence.`,
				})),
			},
			{
				kind: 'entities',
				title: 'Most engaged bodies',
				rows: ENTITY_LABELS.slice(0, 4).map((label) => ({
					label,
					count: 1 + Math.floor(rng() * node.weight),
					max: node.weight,
				})),
			},
		],
	}
}
