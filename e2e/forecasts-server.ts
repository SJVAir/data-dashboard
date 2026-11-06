import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { TZDate } from "@date-fns/tz";
import type { BrowserContext } from "@playwright/test";

const TEMPLATE = fileURLToPath(new URL("./fixtures/api/2.0/forecasts/place.json", import.meta.url));
const TIME_ZONE = "America/Los_Angeles";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLACE = /\/api\/2\.0\/forecasts\/place\/$/;
const DAY_MS = 86_400_000;

type Forecast = { id: string; forecast_date: string; issued_date: string; published_at: string };
type Answer = { data: { forecasts: Forecast[] } & Record<string, unknown> };

/** `YYYY-MM-DD` for the UTC day `t` starts (dates here are plain calendar days). */
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Today's Pacific date. */
function todayPacific(): string {
	const now = new TZDate(Date.now(), TIME_ZONE);
	return isoDay(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/**
 * Answers `api/2.0/forecasts/place/` for any place with the real Fresno County answer in
 * `fixtures/api/2.0/forecasts/place.json`, its rows re-dated: one forecast per day from
 * `forecast_date__gte` to `forecast_date__lte`, up to tomorrow (Pacific; the district forecasts a
 * day ahead), cycling through the real rows' values. Like the summaries, the answer depends on
 * the query, since widgets ask for days around today.
 */
export async function routeForecasts(context: BrowserContext): Promise<void> {
	const template = JSON.parse(await readFile(TEMPLATE, "utf8")) as Answer;
	const rows = template.data.forecasts;
	await context.route(
		(url) => PLACE.test(url.pathname),
		async (route) => {
			const url = new URL(route.request().url());
			const gte = url.searchParams.get("forecast_date__gte") ?? "";
			const lte = url.searchParams.get("forecast_date__lte") ?? gte;
			if (!DATE.test(gte) || !DATE.test(lte)) {
				await route.fulfill({ status: 400, json: { detail: "dates must be YYYY-MM-DD" } });
				return;
			}
			const tomorrow = Date.parse(todayPacific()) + DAY_MS;
			const end = Math.min(Date.parse(lte), tomorrow);
			const forecasts: Forecast[] = [];
			for (let t = Date.parse(gte), i = 0; t <= end; t += DAY_MS, i++) {
				const day = isoDay(t);
				forecasts.push({
					...rows[i % rows.length],
					id: `${rows[i % rows.length].id}-${day}`,
					forecast_date: day,
					issued_date: isoDay(t - DAY_MS),
					published_at: `${isoDay(t - DAY_MS)}T21:30:00Z`
				});
			}
			await route.fulfill({ json: { data: { ...template.data, forecasts } } });
		}
	);
}
