import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { BrowserContext } from "@playwright/test";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const API_FIXTURES = FIXTURES + "api/2.0/";
const AT = /\/api\/2\.0\/monitors\/([a-z0-9]+)\/at\/$/;
const MONITORS_META = /\/api\/2\.0\/monitors\/meta\/$/;
const CATALOG = /\/api\/2\.0\/meta\/datasets\/$/;

/**
 * The fixture monitors (`monitors/<type>/current.json`) in each fixture region (`regions.json`'s
 * server ids): Fresno County's two, Tulare County's Porterville, and Drummond Street in the city of
 * Fresno and in ZIP 93721 (where the point lookup puts any point). Bakersfield is in none.
 */
const REGION_MONITORS: Record<string, string[]> = {
	r6phe: ["4Mb0j33kTnS0qzeE4iDGWw", "Tt5ixZRKSH-rVKJtwVh-bw"],
	dn3sk: ["6qEHS0fITHOQYHLN4c9GKA"],
	njyup: ["4Mb0j33kTnS0qzeE4iDGWw"],
	yd7ru: ["4Mb0j33kTnS0qzeE4iDGWw"]
};

type Monitor = { id: string };

async function json<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch {
		return null;
	}
}

/**
 * Answers the Map's region-scoped readings, `monitors/<type>/at/?timestamp=&region=…`: the rows of
 * `monitors/<type>/current.json` in any of the regions asked for (`REGION_MONITORS`). A type with
 * no file finds nothing. The unscoped list (`monitors/<type>/current/`) and today's smoke and fire
 * (`hms/smoke/`, `hms/fire/`) are plain fixture files.
 */
export async function routeMapData(context: BrowserContext): Promise<void> {
	await context.route(
		(url) => AT.test(url.pathname),
		async (route) => {
			const url = new URL(route.request().url());
			const [, type] = AT.exec(url.pathname)!;
			const wanted = new Set(
				url.searchParams.getAll("region").flatMap((r) => REGION_MONITORS[r] ?? [])
			);
			const file = await json<{ data: Monitor[] }>(`${API_FIXTURES}monitors/${type}/current.json`);
			const data = (file?.data ?? []).filter((m) => wanted.has(m.id));
			await route.fulfill({ json: { data } });
		}
	);
}

/**
 * From now on, answers every region-scoped readings request for `type` with the fixture monitors
 * `ids`, whatever regions it asks for: the server's next readings, say, after a monitor reports
 * in. Routed after `routeMapData`, so it wins.
 */
export async function routeMapReadings(
	context: BrowserContext,
	type: string,
	ids: string[]
): Promise<void> {
	const file = await json<{ data: Monitor[] }>(`${API_FIXTURES}monitors/${type}/current.json`);
	const data = (file?.data ?? []).filter((m) => ids.includes(m.id));
	await context.route(
		(url) => AT.exec(url.pathname)?.[1] === type,
		(route) => route.fulfill({ json: { data } })
	);
}

const GEOJSON = /\/api\/2\.0\/regions\/geojson\/$/;

type Outline = { type: string; features: { properties: Record<string, unknown> }[] };

/**
 * Answers every region shape request with the fixture's one outline (Fresno County's,
 * `regions/geojson.json`), once for each region asked for, under that region's type and code. Any
 * region then frames as the county does, so a place change can leave the view still. Without it,
 * only the county has a shape (another region's place says it's unavailable).
 */
export async function routeOneOutline(context: BrowserContext): Promise<void> {
	const file = (await json<Outline>(`${API_FIXTURES}regions/geojson.json`))!;
	await context.route(
		(url) => GEOJSON.test(url.pathname),
		async (route) => {
			const url = new URL(route.request().url());
			const type = url.searchParams.get("type");
			const codes = url.searchParams.getAll("external_id").flatMap((c) => c.split(","));
			const [outline] = file.features;
			const features = codes.map((code) => ({
				...outline,
				properties: { ...outline.properties, type, external_id: code }
			}));
			await route.fulfill({ json: { type: file.type, features } });
		}
	);
}

type MapMeta = {
	ozone: { catalog: { id: string }; entry: unknown; monitors: Record<string, unknown> };
	datasets: unknown[];
};
type Catalog = { data: { datasets: { id: string; entry_types: unknown[] }[] } };
type MonitorsMeta = {
	data: {
		available_pollutants: string[];
		entries: Record<string, unknown>;
		monitors: Record<string, { entries: Record<string, unknown> }>;
	};
};

/**
 * The metadata a Map with more than PM2.5 needs, as the real server has it
 * (`fixtures/map-meta.json`, from `sdk-js`'s own fixtures): the dataset catalog answers as its
 * fixture file plus ozone and the smoke and fire datasets (`hms-smoke`, `hms-fire`, whose labels
 * name the Map's layers), and the monitors meta plus ozone, with `available_pollutants` PM2.5 and
 * ozone. Ozone readings are `monitors/o3/current.json` (the three AirNow monitors). Not for every
 * spec: the other specs' Get data offers only what the fixture files hold.
 */
export async function routeMapMeta(context: BrowserContext): Promise<void> {
	const { ozone, datasets } = (await json<MapMeta>(FIXTURES + "map-meta.json"))!;
	await context.route(
		(url) => CATALOG.test(url.pathname),
		async (route) => {
			const catalog = (await json<Catalog>(`${API_FIXTURES}meta/datasets.json`))!;
			for (const dataset of catalog.data.datasets) {
				if (dataset.id === "air-quality") dataset.entry_types.push(ozone.catalog);
			}
			catalog.data.datasets.push(...(datasets as Catalog["data"]["datasets"]));
			await route.fulfill({ json: catalog });
		}
	);
	await context.route(
		(url) => MONITORS_META.test(url.pathname),
		async (route) => {
			const meta = (await json<MonitorsMeta>(`${API_FIXTURES}monitors/meta.json`))!;
			meta.data.available_pollutants.push(ozone.catalog.id);
			meta.data.entries[ozone.catalog.id] = ozone.entry;
			for (const [type, entry] of Object.entries(ozone.monitors)) {
				meta.data.monitors[type].entries[ozone.catalog.id] = entry;
			}
			await route.fulfill({ json: meta });
		}
	);
}
