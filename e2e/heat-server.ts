import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { BrowserContext } from "@playwright/test";

const TEMPLATE = fileURLToPath(
	new URL("./fixtures/api/2.0/calheatscore/place.json", import.meta.url)
);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLACE = /\/api\/2\.0\/calheatscore\/place\/$/;

type Day = { date: string } & Record<string, unknown>;
type Answer = { data: { days: Day[] } & Record<string, unknown> };

/**
 * Answers `api/2.0/calheatscore/place/` for any place with the real Fresno County answer in
 * `fixtures/api/2.0/calheatscore/place.json`, its day re-dated to the requested `date` (the
 * starter's "Can we go outside?" asks for today's heat).
 */
export async function routeHeat(context: BrowserContext): Promise<void> {
	const template = JSON.parse(await readFile(TEMPLATE, "utf8")) as Answer;
	await context.route(
		(url) => PLACE.test(url.pathname),
		async (route) => {
			const date = new URL(route.request().url()).searchParams.get("date") ?? "";
			if (!DATE.test(date)) {
				await route.fulfill({ status: 400, json: { detail: "date must be YYYY-MM-DD" } });
				return;
			}
			const days = template.data.days.map((d) => ({ ...d, date }));
			await route.fulfill({ json: { data: { ...template.data, days } } });
		}
	);
}
