/**
 * Whether a dataset's adapter draws its values as colored bands (points that carry a `level`)
 * rather than as numbers. A fact about what each adapter emits, kept free of imports so modules
 * in the initial bundle can use it without pulling in the SDK.
 */
export function drawsAsBands(dataset: string): boolean {
	return dataset === "forecasts" || dataset === "hms-smoke";
}
