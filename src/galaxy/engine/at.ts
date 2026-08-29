/**
 * Checked indexed read. Under `noUncheckedIndexedAccess` every `arr[i]` is
 * `T | undefined`; the galaxy's layout and rendering maths index typed
 * arrays by construction-guaranteed offsets, so a missing element is a
 * programming error, not a value to default. `at` makes that contract
 * explicit at the read site without a cast.
 */
export function at<T>(arr: ArrayLike<T>, i: number): T {
	const v = arr[i]
	if (v === undefined) throw new RangeError(`index ${i} out of range (length ${arr.length})`)
	return v
}
