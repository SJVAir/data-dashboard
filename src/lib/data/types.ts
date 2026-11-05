import type { ResolvedRegion } from "./adapters/registry";
import type { DateRangeSpec, Layer, Resolution, TimeSubRange } from "./schema";

/** `t` is the period start in epoch ms. A raw point has `mean = min = max = value`, `count = 1`. */
export type SeriesPoint = {
	t: number;
	mean: number;
	min: number;
	max: number;
	count: number;
	partial: boolean;
	/** A daily point's highest hourly mean and that hour's start (epoch ms); see `worstHours`. */
	worstHour?: { t: number; value: number };
};

/**
 * `place` is `"monitor:<id>"` or `"region:<type>:<code>"`. Selections listing the same ids in
 * another order share one cache entry (its key sorts the ids), so series come in the order of
 * whichever request filled that entry, not necessarily the order a layer lists them: match a
 * series to its place by `place`, never by index.
 */
export type Series = { place: string; points: SeriesPoint[] };

/** Orders by `order`'s index; places it doesn't list come last, keeping their order. */
export function byPlaceOrder(order: Map<string, number>) {
	return (a: { place: string }, b: { place: string }): number => {
		const x = order.get(a.place);
		const y = order.get(b.place);
		if (x === undefined || y === undefined) {
			return x === undefined ? (y === undefined ? 0 : 1) : -1;
		}
		return x - y;
	};
}

/**
 * How a point or a school reached the region it shows: `name` is the school's (and `retired` its
 * retirement); a point carries nothing, so its coordinates never travel with the data.
 */
export type Via =
	| { kind: "point" }
	| {
			kind: "location";
			name: string;
			retired?: { since: string; replacedBy: { source: string; code: string } | null };
	  };

/** A requested place's display name and, for a retired region, its retirement. */
export type PlaceInfo = {
	/** Same key as `Series.place`. */
	place: string;
	/** The region's (or monitor's) name; for a point or a school, the region it shows. */
	name: string;
	retired?: ResolvedRegion["retired"];
	/** Set when the place is the region a point or a school fell back to. */
	via?: Via;
};

export type QueryData = {
	series: Series[];
	/** One per requested place in request order; for the whole layer, one per monitor returned. */
	places: PlaceInfo[];
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
	"location-unresolved",
	"point-outside",
	"monitor-unlisted",
	"whole-layer-raw"
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

export type QueryState =
	| { status: "idle"; data?: undefined }
	| { status: "loading"; data?: QueryData }
	| { status: "ready"; data: QueryData }
	| { status: "error"; error: unknown; data?: QueryData }
	| { status: "unavailable"; reason: UnavailableReason };

export type Target =
	| { kind: "monitors"; ids: string[] }
	| { kind: "regions"; keys: string[] }
	/** A point or a school: its region keys tried in order (ZIP, city, county); one series. */
	| { kind: "fallback"; via: Via; keys: string[] }
	| { kind: "all" };

/**
 * `timeSubRange` only filters the data delivered (whole Pacific days for dates, `[start, end]`
 * for date-times); it never changes the cache key, the resolution, or the fetch.
 */
export type QueryInput = {
	layer: Layer;
	dateRange: DateRangeSpec;
	pin?: Resolution;
	/**
	 * Asks for each day's worst hourly average; honored only for one place on a daily view of at
	 * most `WORST_HOUR_MAX_DAYS` days, and ignored otherwise (it doesn't change the cache key then).
	 */
	worstHour?: boolean;
	timeSubRange?: TimeSubRange;
};
