import { TZDate } from "@date-fns/tz";
import type { BrowserContext } from "@playwright/test";

const TIME_ZONE = "America/Los_Angeles";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SUMMARIES = /\/api\/2\.0\/(regions|monitors)\/([A-Za-z0-9_-]+)\/summaries\/(hourly|daily)\/$/;

/** One monitor's summaries by month (daily) or day (hourly): `monitors/<id>/summaries/<entry>/…`. */
const MONITOR_SUMMARIES =
	/\/api\/2\.0\/monitors\/([A-Za-z0-9_-]+)\/summaries\/([a-z0-9-]+)\/(hourly|daily)\/(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?\/$/;

/** Today's open-day rows: `api/2.0/regions/<entry>/…`, `monitors/<entry>/…`, `monitors/<id>/<entry>/…`. */
const OPEN_DAYS =
	/\/api\/2\.0\/(regions|monitors)\/([A-Za-z0-9_-]+)\/summaries\/(?:([a-z0-9-]+)\/)?daily\/open\/$/;

const DAY = 86_400_000;

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

/** The server's figure fields for a row with `mean`: the daily figure only on a daily row. */
function figures(mean: number, hourly: boolean, final: boolean) {
	return {
		max_1h: hourly ? null : mean + 2,
		max_8h: hourly ? null : mean + 1,
		mean_24h: hourly ? null : mean,
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
		...figures(mean, false, false)
	};
}

/**
 * Answers the bulk summaries endpoints (`api/2.0/{regions,monitors}/<entry>/summaries/{hourly,
 * daily}/`) with a row for every period in the requested dates that has begun, for each region
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
					...figures(mean, hourly, true)
				};
			});
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
			const start = url.searchParams.get("start") ?? "";
			const end = url.searchParams.get("end") ?? start;
			// A malformed date would make the period loop run forever: fail the request instead.
			if (!DATE.test(start) || !DATE.test(end)) {
				await route.fulfill({ status: 400, json: { detail: "start and end must be dates" } });
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
					...figures(mean, hourly, true)
				};
			});
			const data = ids.map((id) => ({ id, name: id, slug: id, type: "county", summaries }));
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
			const data = ids.map((id) => ({ id, name: id, slug: id, type: "county", summaries }));
			await route.fulfill({ json: { data, page: 1, pages: 1, has_next_page: false } });
		}
	);
}
