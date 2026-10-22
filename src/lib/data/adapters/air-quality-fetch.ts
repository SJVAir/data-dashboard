import { TZDate } from "@date-fns/tz";
import {
	getMonitorEntries,
	getMonitorSummariesBulkDaily,
	getMonitorSummariesBulkHourly,
	getMonitorSummariesBulkMonthly,
	getMonitorSummariesBulkQuarterly,
	getMonitorSummariesBulkSeasonal,
	getMonitorSummariesBulkYearly,
	getMonitorSummariesDaily,
	getMonitorSummariesHourly,
	getMonitorSummariesMonthly,
	getMonitorSummariesQuarterly,
	getMonitorSummariesSeasonal,
	getMonitorSummariesYearly,
	getRegionSummariesBulkDaily,
	getRegionSummariesBulkHourly,
	getRegionSummariesBulkMonthly,
	getRegionSummariesBulkQuarterly,
	getRegionSummariesBulkSeasonal,
	getRegionSummariesBulkYearly
} from "@sjvair/sdk";
import { TIME_ZONE, todayPacific } from "$lib/format";
import { nextPeriodStart, periodStart, type Period } from "$lib/format/range";
import { CHUNK_DAYS, splitChunks } from "../chunks";
import type { Segment } from "../periods";
import type { SeriesPoint } from "../types";

/** The rows of one place (a monitor id or a region sqid) from one SDK call. */
export type Fetched = { id: string; points: SeriesPoint[] };
export type FetchTask = () => Promise<Fetched[]>;

/** The summary fields the adapter reads. */
type SummaryRow = {
	timestamp: string;
	mean: number;
	minimum: number;
	maximum: number;
	count: number;
};
type Bulk = { id: string; summaries: SummaryRow[] };
type Options = { signal: AbortSignal };
type PathConfig = { year?: number; month?: number; day?: number };

const SINGLE = {
	hour: getMonitorSummariesHourly,
	day: getMonitorSummariesDaily,
	month: getMonitorSummariesMonthly,
	quarter: getMonitorSummariesQuarterly,
	season: getMonitorSummariesSeasonal,
	year: getMonitorSummariesYearly
} as Record<Period, (config: object, options: Options) => Promise<SummaryRow[]>>;

const BULK_MONITORS = {
	hour: getMonitorSummariesBulkHourly,
	day: getMonitorSummariesBulkDaily,
	month: getMonitorSummariesBulkMonthly,
	quarter: getMonitorSummariesBulkQuarterly,
	season: getMonitorSummariesBulkSeasonal,
	year: getMonitorSummariesBulkYearly
} as Record<Period, (config: object, options: Options) => Promise<Bulk[]>>;

const BULK_REGIONS = {
	hour: getRegionSummariesBulkHourly,
	day: getRegionSummariesBulkDaily,
	month: getRegionSummariesBulkMonthly,
	quarter: getRegionSummariesBulkQuarterly,
	season: getRegionSummariesBulkSeasonal,
	year: getRegionSummariesBulkYearly
} as Record<Period, (config: object, options: Options) => Promise<Bulk[]>>;

/**
 * Summary rows as points, keeping rows whose period starts in `[from, to)` (a row's timestamp
 * is its Pacific period start). A period still open at `now` is `partial`. A missing minimum or
 * maximum falls back to the mean.
 */
function toPoints(rows: SummaryRow[], res: Period, from: Date, to: Date, now: Date) {
	const points: SeriesPoint[] = [];
	for (const row of rows) {
		const t = Date.parse(row.timestamp);
		if (!(t >= from.getTime() && t < to.getTime())) continue;
		if (!Number.isFinite(row.mean) || !Number.isFinite(row.count)) continue;
		const partial = nextPeriodStart(new Date(t), res).getTime() > now.getTime();
		points.push({
			t,
			mean: row.mean,
			min: Number.isFinite(row.minimum) ? row.minimum : row.mean,
			max: Number.isFinite(row.maximum) ? row.maximum : row.mean,
			count: row.count,
			partial
		});
	}
	return points;
}

function pacific(instant: Date): TZDate {
	return new TZDate(instant.getTime(), TIME_ZONE);
}

/**
 * The URL paths a single-monitor summary call takes for `[from, to)`: hourly by month (or one
 * day), daily by year (or one month), monthly, quarterly and seasonal by year, yearly in one call.
 */
function pathConfigs(res: Period, from: Date, to: Date): PathConfig[] {
	if (res === "year") return [{}];
	const first = pacific(from);
	const last = pacific(new Date(to.getTime() - 1));
	const [y1, m1, d1] = [first.getFullYear(), first.getMonth() + 1, first.getDate()];
	const [y2, m2, d2] = [last.getFullYear(), last.getMonth() + 1, last.getDate()];
	const sameMonth = y1 === y2 && m1 === m2;
	if (res === "hour" && sameMonth && d1 === d2) return [{ year: y1, month: m1, day: d1 }];
	if (res === "day" && sameMonth) return [{ year: y1, month: m1 }];
	const configs: PathConfig[] = [];
	if (res === "hour") {
		for (let y = y1, m = m1; y < y2 || (y === y2 && m <= m2); m === 12 ? (y++, (m = 1)) : m++) {
			configs.push({ year: y, month: m });
		}
	} else {
		for (let y = y1; y <= y2; y++) configs.push({ year: y });
	}
	return configs;
}

/** One monitor's summaries for a segment, through the single-monitor endpoints. */
export function monitorSummaryTasks(
	monitorId: string,
	entryType: string,
	processor: string | null,
	seg: Segment,
	now: Date,
	signal: AbortSignal
): FetchTask[] {
	const res = seg.resolution as Period;
	const from = periodStart(seg.start, res);
	if (from >= seg.end) return [];
	return pathConfigs(res, from, seg.end).map((path) => async () => {
		const config = { monitorId, entryType, ...path, ...(processor ? { processor } : {}) };
		const rows = await SINGLE[res](config, { signal });
		return [{ id: monitorId, points: toPoints(rows, res, from, seg.end, now) }];
	});
}

/**
 * Summaries for many places through a bulk endpoint, split into spans the server accepts.
 * Monitors come back with each type's published series; `regionIds` (sqids) picks the region
 * endpoint, otherwise every published monitor is returned.
 */
export function bulkSummaryTasks(
	entryType: string,
	regionIds: string[] | undefined,
	seg: Segment,
	now: Date,
	signal: AbortSignal
): FetchTask[] {
	const res = seg.resolution as Period;
	const from = periodStart(seg.start, res);
	if (from >= seg.end) return [];
	return splitChunks({ ...seg, start: from }, CHUNK_DAYS[res]).map((chunk) => async () => {
		// `start` and `end` are inclusive Pacific dates.
		const dates = {
			entryType,
			start: todayPacific(chunk.start),
			end: todayPacific(new Date(chunk.end.getTime() - 1))
		};
		const places = regionIds
			? await BULK_REGIONS[res]({ ...dates, region: regionIds }, { signal })
			: await BULK_MONITORS[res](dates, { signal });
		return places.map((p) => ({
			id: p.id,
			points: toPoints(p.summaries, res, chunk.start, chunk.end, now)
		}));
	});
}

/** A raw entry's value, or `NaN` when it isn't a number. */
function entryValue(value: unknown): number {
	if (typeof value === "number") return value;
	if (typeof value === "string" && value.trim() !== "") return Number(value);
	return NaN;
}

/**
 * The SDK widens a window of five minutes or less to whole Pacific days; a window this long (a
 * millisecond over five minutes) is sent as given.
 */
const MIN_RAW_WINDOW_MS = 5 * 60 * 1000 + 1;

/**
 * One monitor's raw entries in `[start, end)` as count-1 points, by chunk, for the published
 * series (`processor`, when the monitor's type names one). Bounds go to the SDK as `Date`s, so
 * they are unambiguous instants even inside the repeated fall-back hour. Its upper bound is
 * inclusive, so the exclusive end is sent less 1 ms; a shorter window is padded past its end
 * (later than now is allowed) rather than widened to whole days. Entries are still filtered by
 * their own (offset-carrying) timestamps.
 */
export function rawTasks(
	monitorId: string,
	entryType: string,
	processor: string | null,
	start: Date,
	end: Date,
	signal: AbortSignal
): FetchTask[] {
	if (start >= end) return [];
	const whole: Segment = { resolution: "raw", start, end };
	return splitChunks(whole, CHUNK_DAYS.raw).map((chunk) => async () => {
		const from = chunk.start.getTime();
		const to = chunk.end.getTime();
		const entries = await getMonitorEntries(
			{
				monitorId,
				entryType: entryType as Parameters<typeof getMonitorEntries>[0]["entryType"],
				...(processor ? { processor } : {}),
				timestampGte: new Date(from),
				timestampLte: new Date(Math.max(to - 1, from + MIN_RAW_WINDOW_MS))
			},
			{ signal }
		);
		const points: SeriesPoint[] = [];
		for (const entry of entries as Array<{ timestamp: string; value: unknown }>) {
			const t = Date.parse(entry.timestamp);
			const value = entryValue(entry.value);
			if (!(t >= from && t < to)) continue;
			if (!Number.isFinite(value)) continue;
			points.push({ t, mean: value, min: value, max: value, count: 1, partial: false });
		}
		return [{ id: monitorId, points }];
	});
}
