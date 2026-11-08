import type { Level } from "../metadata";
import { levelFor } from "../metadata";
import type { DateRangeSpec, Layer } from "../schema";
import type { PlaceInfo, QueryData, QueryInput } from "../types";

const HOUR_MS = 60 * 60 * 1000;

/** Enough trailing hours to hold the latest complete hour and the one before it. */
export const CURRENT_RANGE: DateRangeSpec = { kind: "trailing", amount: 6, unit: "hour" };
/** An hourly value that ended longer ago than this is "No recent data". */
export const STALE_MS = 3 * HOUR_MS;

/** What the current reading asks the query client for: the layer's hourly averages. */
export function currentInput(layer: Layer): QueryInput {
	return { layer, dateRange: CURRENT_RANGE, pin: "hour" };
}

export type Trend = "rising" | "falling" | "steady";

/**
 * Which way the value moved from `previous`. "steady" when both are equal at the entry type's
 * `precision` (0 decimals when `null`); null without a previous value.
 */
export function trend(
	value: number,
	previous: number | null,
	precision: number | null
): Trend | null {
	if (previous === null) return null;
	const digits = precision ?? 0;
	const a = Number(value.toFixed(digits));
	const b = Number(previous.toFixed(digits));
	if (a === b) return "steady";
	return a > b ? "rising" : "falling";
}

export type CurrentReading =
	| {
			status: "ok";
			value: number;
			level: Level | undefined;
			/** Epoch ms: the reading's time (alert) or the hour's end (summary). */
			at: number;
			trend: Trend | null;
			source: "alert" | "alert-latest" | "hourly";
			/** The alert window in minutes, for the "60-minute average" label. */
			windowMinutes?: number;
			place: PlaceInfo;
	  }
	| { status: "pending" | "insufficient" | "no-recent" | "no-data"; place?: PlaceInfo };

/** The latest complete hour in the data, and the complete hour right before it. */
export function hourlyReading(
	data: QueryData,
	levels: Level[],
	now: Date,
	precision: number | null
): CurrentReading {
	const place = data.places[0];
	const complete = (data.series[0]?.points ?? []).filter((p) => !p.partial);
	let latest = complete[0];
	for (const p of complete) if (p.t > latest.t) latest = p;
	if (!latest) return { status: "no-data", place };
	const at = latest.t + HOUR_MS;
	if (now.getTime() - at > STALE_MS) return { status: "no-recent", place };
	if (!place) return { status: "no-data" };
	const before = complete.find((p) => p.t === latest.t - HOUR_MS);
	return {
		status: "ok",
		value: latest.mean,
		level: levelFor(levels, latest.mean),
		at,
		trend: trend(latest.mean, before?.mean ?? null, precision),
		source: "hourly",
		place
	};
}
