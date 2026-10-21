/**
 * The small grammar every report's generated sentences need, because their
 * nouns are the run's own ("issuing body", "episode", "submission"), not
 * words the sentence was written around.
 */

/** A word with its first letter capitalised, for the start of a sentence. */
export const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

/** A noun with its indefinite article: "a submission", "an issuing body", "an episode". */
export const withArticle = (noun: string): string =>
	`${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`
