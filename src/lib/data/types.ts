import type { DateRangeSpec, Layer, Resolution, TimeSubRange } from "./schema";

/** `t` is the period start in epoch ms. A raw point has `mean = min = max = value`, `count = 1`. */
export type SeriesPoint = {
	t: number;
	mean: number;
	min: number;
	max: number;
	count: number;
	partial: boolean;
};

/**
 * `place` is `"monitor:<id>"` or `"region:<type>:<code>"`. Selections listing the same ids in
 * another order share one cache entry (its key sorts the ids), so series come in the order of
 * whichever request filled that entry, not necessarily the order a layer lists them: match a
 * series to its place by `place`, never by index.
 */
export type Series = { place: string; points: SeriesPoint[] };

export type QueryData = {
	series: Series[];
	resolution: Resolution;
	fromRaw: boolean;
	processor: string | null;
	fetchedAt: number;
};

export const UNAVAILABLE_REASONS = [
	"catalog-unavailable",
	"unknown-dataset",
	"unknown-entry-type",
	"no-adapter",
	"no-resolution",
	"place-unsupported",
	"region-unresolved",
	"whole-layer-raw"
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

export type QueryState =
	| { status: "loading"; data?: QueryData }
	| { status: "ready"; data: QueryData }
	| { status: "error"; error: unknown; data?: QueryData }
	| { status: "unavailable"; reason: UnavailableReason };

export type Target =
	{ kind: "monitors"; ids: string[] } | { kind: "regions"; keys: string[] } | { kind: "all" };

/**
 * `timeSubRange` only filters the data delivered (whole Pacific days for dates, `[start, end]`
 * for date-times); it never changes the cache key, the resolution, or the fetch.
 */
export type QueryInput = {
	layer: Layer;
	dateRange: DateRangeSpec;
	pin?: Resolution;
	timeSubRange?: TimeSubRange;
};
