import type { DateRangeSpec, Layer } from "$lib/data/schema";

/**
 * A new widget's layer: PM2.5 in Fresno County. Shared, so frozen: a type's `addable` copies it
 * (`structuredClone`) into the data it returns.
 */
export const DEFAULT_LAYER: Layer = Object.freeze({
	dataset: "air-quality",
	entryType: "pm25",
	place: Object.freeze({ kind: "region", type: "county", code: "06019" })
}) as Layer;

/** A new widget's range: the last 30 days. Frozen, like `DEFAULT_LAYER`. */
export const DEFAULT_RANGE: DateRangeSpec = Object.freeze({
	kind: "trailing",
	amount: 30,
	unit: "day"
}) as DateRangeSpec;
