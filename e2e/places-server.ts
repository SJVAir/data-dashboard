import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { BrowserContext } from "@playwright/test";

const API_FIXTURES = fileURLToPath(new URL("./fixtures/api/2.0/", import.meta.url));
const SEARCH = /\/api\/2\.0\/regions\/(places|locations)\/search\/$/;
const REGIONS = /\/api\/2\.0\/regions\/$/;
const QUERY = /^[a-z0-9 ]+$/;

type Region = { id: string; type: string; external_id: string | null };

async function json<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(API_FIXTURES + path, "utf8")) as T;
	} catch {
		return null;
	}
}

/**
 * Answers the place endpoints whose answer depends on the query, from the fixture files:
 *
 * - `regions/places/search/?q=` and `regions/locations/search/?q=`: the file named after the
 *   query (`regions/places/search/fre.json`); a query with no file finds nothing.
 * - `regions/?type=&external_id=&within=`: the rows of `regions.json` (or, with `within=<id>`, of
 *   `regions/within/<id>.json`), narrowed to the type and codes asked for.
 *
 * The other place endpoints (`regions/meta/`, `regions/locations/`, the point lookup
 * `regions/places/lookup/`, `monitors/`) are plain fixture files.
 */
export async function routePlaces(context: BrowserContext): Promise<void> {
	await context.route(
		(url) => SEARCH.test(url.pathname),
		async (route) => {
			const url = new URL(route.request().url());
			const [, kind] = SEARCH.exec(url.pathname)!;
			const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
			const empty = kind === "locations" ? { data: [], more: false } : { data: [] };
			const found = QUERY.test(q) ? await json(`regions/${kind}/search/${q}.json`) : null;
			await route.fulfill({ json: found ?? empty });
		}
	);
	await context.route(
		(url) => REGIONS.test(url.pathname),
		async (route) => {
			const url = new URL(route.request().url());
			const within = url.searchParams.get("within");
			const type = url.searchParams.get("type");
			const codes = url.searchParams.get("external_id")?.split(",");
			const file = within ? `regions/within/${within.replace(/\W/g, "")}.json` : "regions.json";
			const rows = (await json<{ data: Region[] }>(file))?.data ?? [];
			const data = rows.filter(
				(r) =>
					(!type || r.type === type) &&
					(!codes || (r.external_id !== null && codes.includes(r.external_id)))
			);
			await route.fulfill({ json: { data } });
		}
	);
}
