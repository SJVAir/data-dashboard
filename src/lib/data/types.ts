import type { DateRangeSpec, Layer, Resolution } from "./schema";

/** `t` is the period start in epoch ms. A raw point has `mean = min = max = value`, `count = 1`. */
export type SeriesPoint = {
	t: number;
	mean: number;
	min: number;
	max: number;
	count: number;
	partial: boolean;
};

/** `place` is `"monitor:<id>"` or `"region:<type>:<code>"`. */
export type Series = { place: string; points: SeriesPoint[] };

export type QueryData = {
	series: Series[];
	resolution: Resolution;
	fromRaw: boolean;
	processor: string | null;
	fetchedAt: number;
};

export type UnavailableReason =
	| "catalog-unavailable"
	| "unknown-dataset"
	| "unknown-entry-type"
	| "no-adapter"
	| "no-resolution"
	| "place-unsupported"
	| "region-unresolved"
	| "whole-layer-raw";

export type QueryState =
	| { status: "loading"; data?: QueryData }
	| { status: "ready"; data: QueryData }
	| { status: "error"; error: unknown; data?: QueryData }
	| { status: "unavailable"; reason: UnavailableReason };

export type Target =
	{ kind: "monitors"; ids: string[] } | { kind: "regions"; keys: string[] } | { kind: "all" };

export type QueryInput = { layer: Layer; dateRange: DateRangeSpec; pin?: Resolution };
