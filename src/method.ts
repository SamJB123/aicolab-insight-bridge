/**
 * The pipeline's account of itself: the sentences every method page, the
 * shared /insight-bridge page and a generated run site use for the stages the
 * pipeline runs the same way for every corpus.
 *
 * ONE RULE GOVERNS EVERY SENTENCE HERE, and it is why the copy is centralised:
 * say what the output guarantees, never how it is produced. A reader, a client
 * or a competitor must be able to verify every sentence from the outputs alone.
 * Properties, guarantees and reading rules are in. Mechanism, order of
 * operations, a named algorithm beside a guarantee, parameter values,
 * thresholds and formulas are out. If a sentence would let an engineer
 * reconstruct a step rather than recognise a result, it does not belong here,
 * and it does not belong in a host's own stage text either. The mechanism is
 * described in one place, by its author, on their own timetable; a page is not
 * that place.
 *
 * Nouns are the host's: a consultation says "submitter", a podcast "episode", a
 * research corpus "source". The copy takes them and reads as one voice
 * everywhere. A host appends its own facts (counts, what its review confirmed,
 * how it derives a dominant topic) after the shared sentence, never inside it.
 *
 * Pure strings, no JSX, so a server module can import this without pulling the
 * components in.
 */

export type MethodNouns = {
	/** One source entity, lower case: "submitter", "episode", "source". */
	entity: string
	/** Its plural. */
	entities: string
	/** One document, lower case: "submission", "transcript", "document". Defaults to "document". */
	document?: string
	/** Its plural. Defaults to "documents". */
	documents?: string
	/**
	 * The run's position scale as a phrase that can follow "recorded against
	 * that proposition": "from Supports to Opposes". Omitted, the copy refers to
	 * the profile's scale without listing it.
	 */
	scale?: string
}

export type MethodCopy = {
	/** How topics are found, and what it takes to be one. */
	clustering: string
	/** Graded membership of passages and entities in every topic. */
	membership: string
	/** Propositions, and the positions read against them. */
	positions: string
	/** The verbatim-evidence guarantee. */
	evidence: string
	/** Advisory junk review, confirmed by a person. */
	review: string
	/** Themes and families above the topics. */
	hierarchy: string
	/** What happens when documents are added to a finished run. */
	growth: string
}

export function methodCopy(nouns: MethodNouns): MethodCopy {
	const { entity, entities } = nouns
	const document = nouns.document ?? 'document'
	const documents = nouns.documents ?? 'documents'
	const scale = nouns.scale ? `, ${nouns.scale}` : ", on the scale this run's profile defines"
	return {
		clustering:
			`Topics are found from the passages themselves, bottom-up, by grouping the passages across the ` +
			`corpus that say the same thing; nothing supplies a list of themes beforehand. A topic has to be ` +
			`raised by more than one ${entity} to form: one ${entity}'s volume cannot make a topic on its ` +
			`own, and the rare topic that only one ${entity} carries is flagged as such.`,
		membership:
			`Each passage, and each ${entity}, is then placed against every topic at a graded strength ` +
			`(exemplar, high-value, member), so a ${entity} that touches a topic in passing is recorded as ` +
			`well as the ${entities} that define it, and a passage can belong to more than one topic.`,
		positions:
			`Each topic is written up as a proposition with key points, and every exemplar and high-value ` +
			`${entity}'s position is recorded against that proposition${scale}. Positions are relative to ` +
			`the topic's own framing, never absolute agreement, and every ${entity} is measured against the ` +
			`same proposition.`,
		evidence:
			`Every quotation is verbatim from the source ${document}: each is verified against the ` +
			`${document}'s text before it is stored, and one that cannot be found there is never presented ` +
			`as verified.`,
		review:
			'A model flags topics that look like page furniture, boilerplate or reference lists; a reviewer ' +
			'confirms or dismisses each flag, and only a confirmed flag excludes a topic. Nothing is deleted.',
		hierarchy:
			'The topics are grouped upward, generation by generation, into themes and then families, until ' +
			'the top is small enough to hold in your head. A topic can sit under more than one theme, with ' +
			'one marked primary, so the result is a tree you can walk down and cross-links you can follow ' +
			'sideways. Nothing above the topics is chosen by hand.',
		growth:
			`When ${documents} are added to a finished run, existing topics keep their identity and their ` +
			`links; the new material is either placed into today's topics or the whole corpus is ` +
			`re-clustered, and the record shows which.`,
	}
}

/**
 * The copy in the pipeline's own generic nouns, for the pages that describe it
 * for every corpus at once (the shared /insight-bridge page).
 */
export const GENERIC_METHOD_COPY: MethodCopy = methodCopy({ entity: 'source', entities: 'sources' })
