import { TZDate } from "@date-fns/tz";
import {
	getMonitorEntries,
	getMonitorSummariesBulkDaily,
	getMonitorSummariesBulkDailyOpen,
	getMonitorSummariesBulkHourly,
	getMonitorSummariesBulkMonthly,
	getMonitorSummariesBulkQuarterly,
	getMonitorSummariesBulkSeasonal,
	getMonitorSummariesBulkYearly,
	getMonitorSummariesDaily,
	getMonitorSummariesDailyOpen,
	getMonitorSummariesHourly,
	getMonitorSummariesMonthly,
	getMonitorSummariesQuarterly,
	getMonitorSummariesSeasonal,
	getMonitorSummariesYearly,
	getRegionSummariesBulkDaily,
	getRegionSummariesBulkDailyOpen,
	getRegionSummariesBulkHourly,
	getRegionSummariesBulkMonthly,
	getRegionSummariesBulkQuarterly,
	getRegionSummariesBulkSeasonal,
	getRegionSummariesBulkYearly,
	mergeBulkOpenDays,
	mergeOpenDays,
	type DailyStatistic
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
} & Partial<Record<DailyStatistic, number | null>>;
/** How a summary row is read: `total` reads `sum`, `completeness` marks incomplete rows partial. */
export type SummaryOptions = {
	total?: boolean;
	completeness?: boolean;
	/** A summary field read by name into `figure` (with `is_final` into `final`). */
	figure?: string;
};
type Bulk = { id: string; summaries: SummaryRow[] };
/** Open-day rows, fetched at most once per query and shared by the units that reach them. */
export type OpenDays<T> = () => Promise<T>;
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
				figure: figureOf(row[figure as DailyStatistic]),
				final: row.is_final
			})
		});
	}
	return points;
}

function pacific(instant: Date): TZDate {
	return new TZDate(instant.getTime(), TIME_ZONE);
}

/**
 * Whether a daily unit `[start, end)` reaches yesterday or today, the only days the open-days
 * endpoints can have (today so far; yesterday until its nightly row exists).
 */
function reachesOpenDays(unit: { start: Date; end: Date }, now: Date): boolean {
	const today = periodStart(now, "day");
	const yesterday = periodStart(new Date(today.getTime() - 1), "day");
	return unit.end > yesterday && unit.start < nextPeriodStart(today, "day");
}

/**
 * One monitor's open days, for the same series its daily calls ask for (`processor`; none is
 * the raw series, as in the daily list).
 */
export function monitorOpenDays(
	monitorId: string,
	entryType: string,
	processor: string | null,
	signal: AbortSignal
): Promise<SummaryRow[]> {
	return getMonitorSummariesDailyOpen(
		{
			monitorId,
			entryType: entryType as Parameters<typeof getMonitorSummariesDailyOpen>[0]["entryType"],
			...(processor ? { processor } : {})
		},
		{ signal }
	);
}

/** Open days for many places: regions by sqid, otherwise every published monitor. */
export function bulkOpenDays(
	entryType: string,
	regionIds: string[] | undefined,
	signal: AbortSignal
): Promise<Bulk[]> {
	return regionIds
		? getRegionSummariesBulkDailyOpen({ entryType, region: regionIds }, { signal })
		: getMonitorSummariesBulkDailyOpen(
				{
					entryType: entryType as Parameters<
						typeof getMonitorSummariesBulkDailyOpen
					>[0]["entryType"]
				},
				{ signal }
			);
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

/**
 * One monitor's summaries for a segment, through the single-monitor endpoints. With `open`, a
 * daily unit reaching yesterday or today merges in the open-day rows (the stored row wins on a
 * shared day), trimmed to the unit like the rest.
 */
export function monitorSummaryTasks(
	monitorId: string,
	entryType: string,
	processor: string | null,
	seg: Segment,
	now: Date,
	signal: AbortSignal,
	opts?: SummaryOptions,
	open?: OpenDays<SummaryRow[]>
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
		const withOpen = open && res === "day" && reachesOpenDays(unit, now);
		const [stored, openRows] = await Promise.all([
			SINGLE[res](config, { signal }),
			withOpen ? open() : []
		]);
		const rows = withOpen ? mergeOpenDays(stored, openRows) : stored;
		return [{ id: monitorId, points: toPoints(rows, res, unit.start, unit.end, now, opts) }];
	});
}

/**
 * Summaries for many places through a bulk endpoint, one request per whole calendar unit.
 * Monitors come back with each type's published series; `regionIds` (sqids) picks the region
 * endpoint, otherwise every published monitor is returned. `open` merges open days as for one
 * monitor (an owner only in the open rows is added).
 */
export function bulkSummaryTasks(
	entryType: string,
	regionIds: string[] | undefined,
	seg: Segment,
	now: Date,
	signal: AbortSignal,
	opts?: SummaryOptions,
	open?: OpenDays<Bulk[]>
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
		const withOpen = open && res === "day" && reachesOpenDays(unit, now);
		const [stored, openPlaces] = await Promise.all([
			regionIds
				? BULK_REGIONS[res]({ ...dates, region: regionIds }, { signal })
				: BULK_MONITORS[res](dates, { signal }),
			withOpen ? open() : []
		]);
		const places = withOpen ? mergeBulkOpenDays(stored, openPlaces) : stored;
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
