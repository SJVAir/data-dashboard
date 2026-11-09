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
import { CHUNK_DAYS, calendarUnits, splitChunks, type Unit } from "../chunks";
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
	sum?: number;
	is_complete?: boolean;
	is_final?: boolean;
};
/** How a summary row is read: `total` reads `sum`, `completeness` marks incomplete rows partial. */
export type SummaryOptions = {
	total?: boolean;
	completeness?: boolean;
	/** A summary field read by name into `figure` (with `is_final` into `final`). */
	figure?: string;
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

/** A figure field's value: a finite number, else `null`. */
function figureOf(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Summary rows as points, keeping rows whose period starts in `[from, to)` (a row's timestamp
 * is its Pacific period start). A period still open at `now` is `partial`. A missing minimum or
 * maximum falls back to the mean.
 */
function toPoints(
	rows: SummaryRow[],
	res: Period,
	from: Date,
	to: Date,
	now: Date,
	opts?: SummaryOptions
) {
	const points: SeriesPoint[] = [];
	for (const row of rows) {
		const t = Date.parse(row.timestamp);
		if (!(t >= from.getTime() && t < to.getTime())) continue;
		const value = opts?.total ? (row.sum as number) : row.mean;
		if (!Number.isFinite(value) || !Number.isFinite(row.count)) continue;
		const partial =
			nextPeriodStart(new Date(t), res).getTime() > now.getTime() ||
			(!!opts?.completeness && row.is_complete === false);
		const figure = opts?.figure;
		points.push({
			t,
			mean: value,
			min: opts?.total ? value : Number.isFinite(row.minimum) ? row.minimum : value,
			max: opts?.total ? value : Number.isFinite(row.maximum) ? row.maximum : value,
			count: row.count,
			partial,
			...(figure && {
				figure: figureOf((row as Record<string, unknown>)[figure]),
				final: row.is_final
			})
		});
	}
	return points;
}

function pacific(instant: Date): TZDate {
	return new TZDate(instant.getTime(), TIME_ZONE);
}

/** Whether `[from, to)` sits inside one Pacific day. */
function withinOneDay(from: Date, to: Date): boolean {
	const first = pacific(from);
	const last = pacific(new Date(to.getTime() - 1));
	return (
		first.getFullYear() === last.getFullYear() &&
		first.getMonth() === last.getMonth() &&
		first.getDate() === last.getDate()
	);
}

/**
 * The URL path a single-monitor summary call takes for one unit: hourly and daily by month,
 * monthly, quarterly and seasonal by year, yearly in one call. A segment inside one Pacific day
 * (the open hour fill) uses the day path for hourly.
 */
function pathConfig(res: Period, unit: Unit): PathConfig {
	if (res === "year") return {};
	const first = pacific(unit.start);
	const year = first.getFullYear();
	if (res === "hour" && withinOneDay(unit.start, unit.end)) {
		return { year, month: first.getMonth() + 1, day: first.getDate() };
	}
	if (res === "hour" || res === "day") return { year, month: first.getMonth() + 1 };
	return { year };
}

/** One monitor's summaries for a segment, through the single-monitor endpoints. */
export function monitorSummaryTasks(
	monitorId: string,
	entryType: string,
	processor: string | null,
	seg: Segment,
	now: Date,
	signal: AbortSignal,
	opts?: SummaryOptions
): FetchTask[] {
	const res = seg.resolution as Period;
	const from = periodStart(seg.start, res);
	if (from >= seg.end) return [];
	return calendarUnits({ ...seg, start: from }).map((unit) => async () => {
		const config = {
			monitorId,
			entryType,
			...pathConfig(res, unit),
			...(processor ? { processor } : {})
		};
		const rows = await SINGLE[res](config, { signal });
		return [{ id: monitorId, points: toPoints(rows, res, unit.start, unit.end, now, opts) }];
	});
}

/**
 * Summaries for many places through a bulk endpoint, one request per whole calendar unit.
 * Monitors come back with each type's published series; `regionIds` (sqids) picks the region
 * endpoint, otherwise every published monitor is returned.
 */
export function bulkSummaryTasks(
	entryType: string,
	regionIds: string[] | undefined,
	seg: Segment,
	now: Date,
	signal: AbortSignal,
	opts?: SummaryOptions
): FetchTask[] {
	const res = seg.resolution as Period;
	const from = periodStart(seg.start, res);
	if (from >= seg.end) return [];
	const whole = { ...seg, start: from };
	// A segment inside one day (the open hour fill) asks for just that day, not its month.
	const units =
		res === "hour" && withinOneDay(from, seg.end)
			? [{ fetchStart: from, fetchEnd: seg.end, start: from, end: seg.end }]
			: calendarUnits(whole);
	return units.map((unit) => async () => {
		// `start` and `end` are inclusive Pacific dates of the whole unit.
		const dates = {
			entryType,
			start: todayPacific(unit.fetchStart),
			end: todayPacific(new Date(unit.fetchEnd.getTime() - 1))
		};
		const places = regionIds
			? await BULK_REGIONS[res]({ ...dates, region: regionIds }, { signal })
			: await BULK_MONITORS[res](dates, { signal });
		return places.map((p) => ({
			id: p.id,
			points: toPoints(p.summaries, res, unit.start, unit.end, now, opts)
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
 * One monitor's raw entries in `[start, end)` as count-1 points, by chunk, for the published
 * series (`processor`, when the monitor's type names one). Bounds go to the SDK as `Date`s, so
 * they are unambiguous instants even inside the repeated fall-back hour. Its upper bound is
 * inclusive, so the exclusive end is sent less 1 ms. Entries are still filtered by their own
 * (offset-carrying) timestamps.
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
				timestampLte: new Date(to - 1)
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
