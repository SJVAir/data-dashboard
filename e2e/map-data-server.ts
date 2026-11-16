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
			// The scale's label differs from the pollutant's, so a legend title still on the
			// scale's label (before the pollutant's has loaded) can't pass for the final one.
			const pm25 = meta.data.entries.pm25 as { scale: { label: string } };
			pm25.scale.label = "Fine particles";
			meta.data.entries[ozone.catalog.id] = ozone.entry;
			for (const [type, entry] of Object.entries(ozone.monitors)) {
				meta.data.monitors[type].entries[ozone.catalog.id] = entry;
			}
			await route.fulfill({ json: meta });
		}
	);
}

const MONITOR_DAILY = /\/api\/2\.0\/monitors\/([a-z0-9]+)\/summaries\/daily\/$/;
const HMS_DAY = /\/api\/2\.0\/hms\/(smoke|fire)\/$/;

/** One fixture day: each monitor's 24-hour figure, and whether the day has the fixture smoke. */
export type MapDay = { figures: Record<string, number>; smoke?: boolean };

/**
 * Answers the Map's past days, by `YYYY-MM-DD` (Pacific): the bulk daily monitor summaries
 * (`monitors/<type>/summaries/daily/?start=&end=&region=…`, one final row for each fixture
 * monitor of the regions asked for that has a figure that day) and the dated smoke and fire
 * (`hms/smoke/?date=`: the fixture plume on a day with `smoke`, else none; no fire). A day not in
 * `days` has no monitor rows and no smoke. Requests with no `date` (today's smoke and fire) go on
 * to the fixture files.
 */
export async function routeMapDays(
	context: BrowserContext,
	days: Record<string, MapDay>
): Promise<void> {
	await context.route(
		(url) => MONITOR_DAILY.test(url.pathname) && url.searchParams.has("region"),
		async (route) => {
			const url = new URL(route.request().url());
			const day = url.searchParams.get("start") ?? "";
			// The Map asks for one day at a time: anything else is a wrong request.
			if (url.searchParams.get("end") !== day) {
				await route.fulfill({ status: 400, json: { error: "end must equal start" } });
				return;
			}
			const regions = url.searchParams.getAll("region").flatMap((r) => r.split(","));
			const wanted = new Set(regions.flatMap((r) => REGION_MONITORS[r] ?? []));
			const [, type] = MONITOR_DAILY.exec(url.pathname)!;
			const list = await json<{ data: { id: string; name: string }[] }>(
				`${API_FIXTURES}monitors/${type}/current.json`
			);
			const data = (list?.data ?? [])
				.filter((m) => wanted.has(m.id) && days[day]?.figures[m.id] !== undefined)
				.map((m) => ({
					id: m.id,
					name: m.name,
					summaries: [
						{
							timestamp: `${day}T00:00:00-08:00`,
							entry_type: type,
							resolution: "day",
							count: 24,
							expected_count: 24,
							mean_24h: days[day].figures[m.id],
							is_final: true
						}
					]
				}));
			await route.fulfill({ json: { data, page: 1, pages: 1, has_next_page: false } });
		}
	);
	await context.route(
		(url) => HMS_DAY.test(url.pathname) && url.searchParams.has("date"),
		async (route) => {
			const url = new URL(route.request().url());
			const [, kind] = HMS_DAY.exec(url.pathname)!;
			const file = await json<{ data: unknown[] }>(`${API_FIXTURES}hms/${kind}.json`);
			const smoky = kind === "smoke" && days[url.searchParams.get("date") ?? ""]?.smoke;
			const data = smoky ? file!.data : [];
			await route.fulfill({
				json: { data, page: 1, count: data.length, pages: 1, has_next_page: false }
			});
		}
	);
}

const REGION_BULK = /\/api\/2\.0\/regions\/([a-z0-9]+)\/summaries\/daily\/(open\/)?$/;

/**
 * A ZIP code fill's fixture ZIPs (fake, made-up squares inside Fresno County's fixture outline):
 * the whole-type region GeoJSON lists all three, the bulk summaries only the first two, so
 * `93999` is a region with no figure.
 */
export const FILL_ZIPS = [
	{ id: "zfil1", code: "93721", name: "93721", lon: -119.9 },
	{ id: "zfil2", code: "93722", name: "93722", lon: -119.7 },
	{ id: "zfil3", code: "93999", name: "93999", lon: -119.5 }
];

/** Each ZIP's figure on a past day (by date) and today so far; a ZIP with none has no row. */
export type FillFigures = {
	days: Record<string, Record<string, number>>;
	/** The Pacific date today so far is for (the test clock's). */
	todayDate: string;
	today: Record<string, number>;
};

/**
 * Answers the whole-type region requests of a ZIP fill: `regions/geojson/?type=zipcode` (no
 * `external_id`) with the three `FILL_ZIPS` as squares; the bulk daily summaries
 * (`regions/<entry>/summaries/daily/?type=zipcode&start=&end=`) and the open-day rows
 * (`…/daily/open/?type=zipcode`) with `figures`, leaving out any ZIP with none. Any other
 * region request goes on to the handlers routed before.
 */
export async function routeMapFill(context: BrowserContext, figures: FillFigures): Promise<void> {
	await context.route(
		(url) =>
			GEOJSON.test(url.pathname) &&
			url.searchParams.get("type") === "zipcode" &&
			!url.searchParams.has("external_id"),
		(route) =>
			route.fulfill({
				json: {
					type: "FeatureCollection",
					features: FILL_ZIPS.map(({ id, code, name, lon }) => ({
						type: "Feature",
						id,
						geometry: {
							type: "Polygon",
							coordinates: [
								[
									[lon, 36.7],
									[lon + 0.15, 36.7],
									[lon + 0.15, 36.85],
									[lon, 36.85],
									[lon, 36.7]
								]
							]
						},
						properties: { id, name, slug: id, type: "zipcode", external_id: code, retired: null }
					}))
				}
			})
	);
	await context.route(
		(url) => REGION_BULK.test(url.pathname) && url.searchParams.get("type") === "zipcode",
		(route) => {
			const url = new URL(route.request().url());
			const [, entry, open] = REGION_BULK.exec(url.pathname)!;
			const day = open ? figures.todayDate : (url.searchParams.get("start") ?? "");
			// A day's fill asks for that one day: anything else is a wrong request.
			if (!open && url.searchParams.get("end") !== day) {
				return route.fulfill({ status: 400, json: { error: "end must equal start" } });
			}
			const byCode = open ? figures.today : (figures.days[day] ?? {});
			const data = FILL_ZIPS.filter((z) => byCode[z.code] !== undefined).map((z) => ({
				id: z.id,
				name: z.name,
				slug: z.id,
				type: "zipcode",
				summaries: [
					{
						timestamp: `${day}T00:00:00-08:00`,
						entry_type: entry,
						resolution: "day",
						count: 24,
						expected_count: 24,
						mean_24h: byCode[z.code],
						is_final: !open
					}
				]
			}));
			return route.fulfill({ json: { data, page: 1, pages: 1, has_next_page: false } });
		}
	);
}
