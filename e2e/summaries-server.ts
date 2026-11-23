import { TZDate } from "@date-fns/tz";
import type { BrowserContext } from "@playwright/test";
import { monitorsOfRequest } from "./map-data-server";

const TIME_ZONE = "America/Los_Angeles";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SUMMARIES =
	/\/api\/2\.0\/(regions|monitors)\/([A-Za-z0-9_-]+)\/summaries\/(hourly|daily|monthly|yearly)\/$/;

/** One monitor's monthly rows for a year: `monitors/<id>/summaries/<entry>/monthly/<year>/`. */
const MONITOR_MONTHLY =
	/\/api\/2\.0\/monitors\/([A-Za-z0-9_-]+)\/summaries\/([a-z0-9-]+)\/monthly\/(\d{4})\/$/;

/** One monitor's summaries by month (daily) or day (hourly): `monitors/<id>/summaries/<entry>/…`. */
const MONITOR_SUMMARIES =
	/\/api\/2\.0\/monitors\/([A-Za-z0-9_-]+)\/summaries\/([a-z0-9-]+)\/(hourly|daily)\/(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?\/$/;

/** Today's open-day rows: `api/2.0/regions/<entry>/…`, `monitors/<entry>/…`, `monitors/<id>/<entry>/…`. */
const OPEN_DAYS =
	/\/api\/2\.0\/(regions|monitors)\/([A-Za-z0-9_-]+)\/summaries\/(?:([a-z0-9-]+)\/)?daily\/open\/$/;

const DAY = 86_400_000;

/** The weather stations bulk `type=cimis` summaries return (those of `monitors/weather/place.json`). */
const WEATHER_STATIONS = [
	{ id: "I3wADR9bR-2hfub3h3nsJA", name: "CIMIS #80 - Fresno State" },
	{ id: "NXxE9W0QRfWZjOFlocNgJA", name: "CIMIS #15 - Stratford" }
];

/** A made-up but steady reading for the period starting at `t`, so reloads show the same data. */
function reading(t: number): number {
	return 6 + ((t / 3_600_000) % 29);
}

/**
 * The period starts (Pacific) from `start` to `end` (inclusive dates) that have begun by now; a
 * daily row only once its day has ended (today's comes from the open-days endpoints).
 */
function periods(start: string, end: string, hourly: boolean): TZDate[] {
	const [y, m, d] = start.split("-").map(Number);
	const [ey, em, ed] = end.split("-").map(Number);
	const stop = new TZDate(ey, em - 1, ed + 1, TIME_ZONE).getTime();
	const now = Date.now();
	const out: TZDate[] = [];
	for (let i = 0; ; i++) {
		const t = hourly
			? new TZDate(y, m - 1, d, 0, 0, 0, TIME_ZONE).getTime() + i * 3_600_000
			: new TZDate(y, m - 1, d + i, TIME_ZONE).getTime();
		if (t >= stop || t > now || (!hourly && t + DAY > now)) break;
		out.push(new TZDate(t, TIME_ZONE));
	}
	return out;
}

/**
 * The month starts (Pacific) from `start` to `end` (inclusive dates) that have begun by now: an
 * ended month's row, and the open month's nightly row (sjvair.com #342), not final yet.
 */
function monthPeriods(start: string, end: string): TZDate[] {
	const [y, m] = start.split("-").map(Number);
	const [ey, em, ed] = end.split("-").map(Number);
	const stop = new TZDate(ey, em - 1, ed + 1, TIME_ZONE).getTime();
	const now = Date.now();
	const out: TZDate[] = [];
	for (let i = 0; ; i++) {
		const t = new TZDate(y, m - 1 + i, 1, TIME_ZONE).getTime();
		if (t >= stop || t > now) break;
		out.push(new TZDate(t, TIME_ZONE));
	}
	return out;
}

/**
 * The year starts (Pacific) from `start` to `end` (inclusive dates) that have begun by now: an
 * ended year's row, and the open year's nightly row, not final yet.
 */
function yearPeriods(start: string, end: string): TZDate[] {
	const [y] = start.split("-").map(Number);
	const [ey, em, ed] = end.split("-").map(Number);
	const stop = new TZDate(ey, em - 1, ed + 1, TIME_ZONE).getTime();
	const now = Date.now();
	const out: TZDate[] = [];
	for (let i = 0; ; i++) {
		const t = new TZDate(y + i, 0, 1, TIME_ZONE).getTime();
		if (t >= stop || t > now) break;
		out.push(new TZDate(t, TIME_ZONE));
	}
	return out;
}

/** A yearly row for the year starting at `p`, with the figures a yearly row carries. */
function yearRow(p: TZDate, entryType: string) {
	const ended = new TZDate(p.getFullYear() + 1, 0, 1, TIME_ZONE).getTime() <= Date.now();
	return { ...monthRow(p, entryType), resolution: "year", is_final: ended };
}

/** The start (epoch ms) of the month after the one starting at `p`. */
function nextMonth(p: TZDate): number {
	return new TZDate(p.getFullYear(), p.getMonth() + 1, 1, TIME_ZONE).getTime();
}

/** A monthly row for the month starting at `p`, with the figures a monthly row carries. */
function monthRow(p: TZDate, entryType: string) {
	const mean = reading(p.getTime());
	return {
		timestamp: p.toISOString(),
		entry_type: entryType,
		resolution: "month",
		count: 720,
		expected_count: 720,
		is_complete: true,
		minimum: mean - 2,
		maximum: mean + 2,
		mean,
		stddev: 1,
		p25: mean - 1,
		p75: mean + 1,
		sum: mean * 720,
		...figures(mean, "month", nextMonth(p) <= Date.now())
	};
}

/**
 * The server's figure fields for a row with `mean`, as sjvair.com #342 serves them: the daily
 * figures only on a daily row; on a monthly row the average of the daily figures (here the
 * 24-hour average, `mean`) with its day counts, null on hourly and daily rows.
 */
function figures(mean: number, level: "hour" | "day" | "month", final: boolean) {
	const day = level === "day";
	const coarse = level === "month";
	return {
		max_1h: day ? mean + 2 : null,
		max_8h: day ? mean + 1 : null,
		mean_24h: day ? mean : null,
		daily_statistic_mean: coarse ? mean : null,
		daily_statistic_days: coarse ? 30 : null,
		daily_statistic_expected_days: coarse ? 30 : null,
		is_final: final
	};
}

/** Today's open-day row (so far), from midnight Pacific. */
function todayRow(entryType: string) {
	const now = new TZDate(Date.now(), TIME_ZONE);
	const start = new TZDate(now.getFullYear(), now.getMonth(), now.getDate(), TIME_ZONE);
	const mean = reading(start.getTime());
	return {
		timestamp: start.toISOString(),
		entry_type: entryType,
		resolution: "day",
		count: 12,
		minimum: mean - 2,
		maximum: mean + 2,
		mean,
		stddev: 1,
		p25: mean - 1,
		p75: mean + 1,
		sum: mean * 12,
		station_count: 1,
		...figures(mean, "day", false)
	};
}

/**
 * Answers the bulk summaries endpoints (`api/2.0/{regions,monitors}/<entry>/summaries/{hourly,
 * daily,monthly,yearly}/`) with a row for every period in the requested dates that has begun, for each region
 * or monitor asked for: the Chart's data in E2E tests. Unlike the fixture files, the answer
 * depends on the query (the dates and places).
 */
export async function routeSummaries(context: BrowserContext): Promise<void> {
	// A single monitor's summaries (a weather station's), a month or a day at a time.
	await context.route(
		(url) => MONITOR_SUMMARIES.test(url.pathname),
		async (route) => {
			const url = new URL(route.request().url());
			const [, , entryType, resolution, year, month, day] = MONITOR_SUMMARIES.exec(url.pathname)!;
			const hourly = resolution === "hourly";
			const pad = (n: string) => n.padStart(2, "0");
			const first = `${year}-${pad(month)}-${pad(day ?? "1")}`;
			const last = day
				? first
				: `${year}-${pad(month)}-${new Date(Date.UTC(+year, +month, 0)).getUTCDate()}`;
			const data = periods(first, last, hourly).map((p) => {
				const mean = reading(p.getTime());
				return {
					timestamp: p.toISOString(),
					entry_type: entryType,
					resolution: hourly ? "hour" : "day",
					count: hourly ? 1 : 24,
					expected_count: hourly ? 1 : 24,
					is_complete: true,
					minimum: mean - 2,
					maximum: mean + 2,
					mean,
					stddev: 1,
					p25: mean - 1,
					p75: mean + 1,
					sum: mean * (hourly ? 1 : 24),
					...figures(mean, hourly ? "hour" : "day", true)
				};
			});
			await route.fulfill({ json: { data, page: 1, pages: 1, has_next_page: false } });
		}
	);
	await context.route(
		(url) => MONITOR_MONTHLY.test(url.pathname),
		async (route) => {
			const url = new URL(route.request().url());
			const [, , entryType, year] = MONITOR_MONTHLY.exec(url.pathname)!;
			const data = monthPeriods(`${year}-01-01`, `${year}-12-31`).map((p) =>
				monthRow(p, entryType)
			);
			await route.fulfill({ json: { data, page: 1, pages: 1, has_next_page: false } });
		}
	);
	await context.route(
		(url) => SUMMARIES.test(url.pathname),
		async (route) => {
			const url = new URL(route.request().url());
			const [, kind, entryType, resolution] = SUMMARIES.exec(url.pathname)!;
			const param = kind === "regions" ? "region" : "monitor";
			const ids = url.searchParams.getAll(param).flatMap((v) => v.split(","));
			// Every weather station: bulk monitor summaries naming the weather type (`type=cimis`).
			const stations = kind === "monitors" && url.searchParams.getAll("type").includes("cimis");
			// A monitor set (`type=` beside `region=`): the fixture monitors of those types there.
			const monitors =
				kind === "monitors" && !stations && url.searchParams.has("type")
					? await monitorsOfRequest(url)
					: null;
			const start = url.searchParams.get("start") ?? "";
			const end = url.searchParams.get("end") ?? start;
			// A malformed date would make the period loop run forever: fail the request instead.
			if (!DATE.test(start) || !DATE.test(end)) {
				await route.fulfill({ status: 400, json: { detail: "start and end must be dates" } });
				return;
			}
			if (resolution === "monthly" || resolution === "yearly") {
				const rows =
					resolution === "monthly"
						? monthPeriods(start, end).map((p) => ({ ...monthRow(p, entryType), station_count: 1 }))
						: yearPeriods(start, end).map((p) => ({ ...yearRow(p, entryType), station_count: 1 }));
				const data = stations
					? WEATHER_STATIONS.map((st) => ({ ...st, type: "cimis", summaries: rows }))
					: monitors
						? monitors.map((mon) => ({ ...mon, summaries: rows }))
						: ids.map((id) => ({ id, name: id, slug: id, type: "county", summaries: rows }));
				await route.fulfill({ json: { data, page: 1, pages: 1, has_next_page: false } });
				return;
			}
			const hourly = resolution === "hourly";
			const summaries = periods(start, end, hourly).map((p) => {
				const mean = reading(p.getTime());
				return {
					timestamp: p.toISOString(),
					entry_type: entryType,
					resolution: hourly ? "hour" : "day",
					count: hourly ? 1 : 24,
					expected_count: hourly ? 1 : 24,
					minimum: mean - 2,
					maximum: mean + 2,
					mean,
					stddev: 1,
					p25: mean - 1,
					p75: mean + 1,
					station_count: 1,
					...figures(mean, hourly ? "hour" : "day", true)
				};
			});
			if (stations) {
				// A station row is its own summary: it carries `sum` and no `station_count`.
				const rows = summaries.map((row) => {
					const { station_count, ...own } = row;
					void station_count;
					return { ...own, sum: own.mean * own.count };
				});
				const data = WEATHER_STATIONS.map((st) => ({ ...st, type: "cimis", summaries: rows }));
				await route.fulfill({ json: { data, page: 1, pages: 1, has_next_page: false } });
				return;
			}
			const data = monitors
				? monitors.map((mon) => ({ ...mon, summaries }))
				: ids.map((id) => ({ id, name: id, slug: id, type: "county", summaries }));
			await route.fulfill({ json: { data, page: 1, pages: 1, has_next_page: false } });
		}
	);
	// Today so far, for each place asked for (bulk) or the one monitor.
	await context.route(
		(url) => OPEN_DAYS.test(url.pathname),
		async (route) => {
			const url = new URL(route.request().url());
			const [, kind, first, entryType] = OPEN_DAYS.exec(url.pathname)!;
			if (entryType) {
				const data = [todayRow(entryType)];
				await route.fulfill({ json: { data, page: 1, pages: 1, has_next_page: false } });
				return;
			}
			const param = kind === "regions" ? "region" : "monitor";
			const ids = url.searchParams.getAll(param).flatMap((v) => v.split(","));
			const summaries = [todayRow(first)];
			const monitors =
				kind === "monitors" && url.searchParams.has("type") ? await monitorsOfRequest(url) : null;
			const data = (monitors ?? ids.map((id) => ({ id, name: id, slug: id, type: "county" }))).map(
				(row) => ({ ...row, summaries })
			);
			await route.fulfill({ json: { data, page: 1, pages: 1, has_next_page: false } });
		}
	);
}
