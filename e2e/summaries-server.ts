import { TZDate } from "@date-fns/tz";
import type { BrowserContext } from "@playwright/test";

const TIME_ZONE = "America/Los_Angeles";
const SUMMARIES = /\/api\/2\.0\/(regions|monitors)\/([A-Za-z0-9_-]+)\/summaries\/(hourly|daily)\/$/;

/** A made-up but steady reading for the period starting at `t`, so reloads show the same data. */
function reading(t: number): number {
	return 6 + ((t / 3_600_000) % 29);
}

/** The period starts (Pacific) from `start` to `end` (inclusive dates) that have begun by now. */
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
		if (t >= stop || t > now) break;
		out.push(new TZDate(t, TIME_ZONE));
	}
	return out;
}

/**
 * Answers the bulk summaries endpoints (`api/2.0/{regions,monitors}/<entry>/summaries/{hourly,
 * daily}/`) with a row for every period in the requested dates that has begun, for each region
 * or monitor asked for: the Chart's data in E2E tests. Unlike the fixture files, the answer
 * depends on the query (the dates and places).
 */
export async function routeSummaries(context: BrowserContext): Promise<void> {
	await context.route(
		(url) => SUMMARIES.test(url.pathname),
		async (route) => {
			const url = new URL(route.request().url());
			const [, kind, entryType, resolution] = SUMMARIES.exec(url.pathname)!;
			const param = kind === "regions" ? "region" : "monitor";
			const ids = url.searchParams.getAll(param).flatMap((v) => v.split(","));
			const start = url.searchParams.get("start") ?? "";
			const end = url.searchParams.get("end") ?? start;
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
					station_count: 1
				};
			});
			const data = ids.map((id) => ({ id, name: id, slug: id, type: "county", summaries }));
			await route.fulfill({ json: { data, page: 1, pages: 1, has_next_page: false } });
		}
	);
}
