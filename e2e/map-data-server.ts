import { readFileSync } from "node:fs";
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
	r6phe: ["4Mb0j33kTnS0qzeE4iDGWw", "Tt5ixZRKSH-rVKJtwVh-bw", "PaSecondFresno0000000AA"],
	dn3sk: ["6qEHS0fITHOQYHLN4c9GKA"],
	njyup: ["4Mb0j33kTnS0qzeE4iDGWw"],
	yd7ru: ["4Mb0j33kTnS0qzeE4iDGWw"]
};

type Monitor = { id: string };

/**
 * The monitor types a bulk summaries request names (`type=`, repeatable, as the server takes
 * them; `@sjvair/sdk` `5.0.0-beta.16`), or `null` for every type.
 */
function typesOf(url: URL): Set<string> | null {
	const types = url.searchParams.getAll("type").flatMap((t) => t.split(","));
	return types.length > 0 ? new Set(types) : null;
}

/** Whether a bulk summaries request is scoped (by region or by type): the Map's are. */
function scoped(url: URL): boolean {
	return url.searchParams.has("region") || url.searchParams.has("type");
}

/**
 * The monitor ids a bulk request's regions hold (`regionMonitors`), or every listed monitor when
 * it names no region (a Map with no Where), kept to the types it names.
 */
function bulkWanted(
	url: URL,
	list: { id: string; type?: string }[],
	regionMonitors: (region: string) => string[]
): Set<string> {
	const regions = url.searchParams.getAll("region").flatMap((r) => r.split(","));
	const types = typesOf(url);
	const inside = regions.length > 0 ? new Set(regions.flatMap(regionMonitors)) : null;
	return new Set(
		list
			.filter((m) => (!inside || inside.has(m.id)) && (!types || types.has(m.type ?? "")))
			.map((m) => m.id)
	);
}

/**
 * The fixture monitors (`monitors.json`) of the types a bulk summaries request names that sit in
 * its regions (`REGION_MONITORS`), or anywhere when it names none: the rows a bulk monitor-set
 * request (`region=` with `type=`) answers, one per monitor.
 */
export async function monitorsOfRequest(
	url: URL
): Promise<{ id: string; name: string; type: string }[]> {
	const list = await json<{ data: { id: string; name: string; type: string }[] }>(
		`${API_FIXTURES}monitors.json`
	);
	const wanted = bulkWanted(url, list?.data ?? [], (r) => REGION_MONITORS[r] ?? []);
	return (list?.data ?? []).filter((m) => wanted.has(m.id));
}

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

/** The catalog fixture plus ozone and the smoke and fire datasets (`fixtures/map-meta.json`). */
async function mapCatalog(): Promise<Catalog> {
	const { ozone, datasets } = (await json<MapMeta>(FIXTURES + "map-meta.json"))!;
	const catalog = (await json<Catalog>(`${API_FIXTURES}meta/datasets.json`))!;
	for (const dataset of catalog.data.datasets) {
		if (dataset.id === "air-quality") dataset.entry_types.push(ozone.catalog);
	}
	catalog.data.datasets.push(...(datasets as Catalog["data"]["datasets"]));
	return catalog;
}

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
	const { ozone } = (await json<MapMeta>(FIXTURES + "map-meta.json"))!;
	await context.route(
		(url) => CATALOG.test(url.pathname),
		async (route) => route.fulfill({ json: await mapCatalog() })
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
		(url) => MONITOR_DAILY.test(url.pathname) && scoped(url),
		async (route) => {
			const url = new URL(route.request().url());
			const day = url.searchParams.get("start") ?? "";
			// The Map asks for one day at a time: anything else is a wrong request.
			if (url.searchParams.get("end") !== day) {
				await route.fulfill({ status: 400, json: { error: "end must equal start" } });
				return;
			}
			const [, type] = MONITOR_DAILY.exec(url.pathname)!;
			const list = await json<{ data: { id: string; name: string; type: string }[] }>(
				`${API_FIXTURES}monitors/${type}/current.json`
			);
			const wanted = bulkWanted(url, list?.data ?? [], (r) => REGION_MONITORS[r] ?? []);
			const data = (list?.data ?? [])
				.filter((m) => wanted.has(m.id) && days[day]?.figures[m.id] !== undefined)
				.map((m) => ({
					id: m.id,
					name: m.name,
					type: m.type,
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

const MONITOR_PERIOD = /\/api\/2\.0\/monitors\/([a-z0-9]+)\/summaries\/(monthly|yearly)\/$/;

/** One fixture month or year: each monitor's figure (null: too few days), and whether final. */
export type MapPeriod = { figures: Record<string, number | null>; final?: boolean };

/**
 * Answers the Map's month and year stops, by the period's start (`YYYY-MM-01` or `YYYY-01-01`):
 * the bulk monthly and yearly monitor summaries (`monitors/<type>/summaries/{monthly,yearly}/
 * ?start=&end=&region=…`), one row for each fixture monitor of the regions asked for with a figure
 * that period, its average of daily figures as `daily_statistic_mean`. A period not in `periods`
 * has no rows. The Map asks for one whole period at a time: anything else is a wrong request.
 */
export async function routeMapPeriods(
	context: BrowserContext,
	periods: Record<string, MapPeriod>
): Promise<void> {
	await context.route(
		(url) => MONITOR_PERIOD.test(url.pathname) && scoped(url),
		async (route) => {
			const url = new URL(route.request().url());
			const [, type, level] = MONITOR_PERIOD.exec(url.pathname)!;
			const start = url.searchParams.get("start") ?? "";
			const [y, m] = start.split("-").map(Number);
			const last =
				level === "yearly"
					? `${y}-12-31`
					: `${start.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
			if (
				url.searchParams.get("end") !== last ||
				!start.endsWith(level === "yearly" ? "-01-01" : "-01")
			) {
				await route.fulfill({ status: 400, json: { error: "not one whole period" } });
				return;
			}
			const list = await json<{ data: { id: string; name: string; type: string }[] }>(
				`${API_FIXTURES}monitors/${type}/current.json`
			);
			const wanted = bulkWanted(url, list?.data ?? [], (r) => REGION_MONITORS[r] ?? []);
			const period = periods[start];
			const data = (list?.data ?? [])
				.filter((mon) => wanted.has(mon.id) && period?.figures[mon.id] !== undefined)
				.map((mon) => ({
					id: mon.id,
					name: mon.name,
					type: mon.type,
					summaries: [
						{
							// Inside the period's first Pacific day, whatever its offset.
							timestamp: `${start}T00:00:00-08:00`,
							entry_type: type,
							resolution: level === "yearly" ? "year" : "month",
							daily_statistic_mean: period.figures[mon.id],
							daily_statistic_days: 30,
							daily_statistic_expected_days: 30,
							is_final: period.final !== false
						}
					]
				}));
			await route.fulfill({ json: { data, page: 1, pages: 1, has_next_page: false } });
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

/**
 * Each ZIP's figure on a past day (by date) and today so far; a ZIP with none has no row, and
 * `null` is a final row with no figure (too little data: thin).
 */
export type FillFigures = {
	days: Record<string, Record<string, number | null>>;
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

const REGION_PERIOD = /\/api\/2\.0\/regions\/([a-z0-9]+)\/summaries\/(monthly|yearly)\/$/;

/**
 * A ZIP's month or year: its figure, or a thin row (too few days had a figure) with its day
 * counts, `[days, expected]`. A ZIP left out has no row.
 */
export type FillPeriodFigure = number | { thin: [number, number] };

/**
 * Answers a ZIP fill's month and year stops (`regions/<entry>/summaries/monthly|yearly/
 * ?type=zipcode`) by the period's start, with the server's field names; `routeMapFill` first for
 * the ZIPs' shapes.
 */
export async function routeMapFillPeriods(
	context: BrowserContext,
	periods: Record<string, Record<string, FillPeriodFigure>>
): Promise<void> {
	await context.route(
		(url) => REGION_PERIOD.test(url.pathname) && url.searchParams.get("type") === "zipcode",
		(route) => {
			const url = new URL(route.request().url());
			const [, entry, level] = REGION_PERIOD.exec(url.pathname)!;
			const start = url.searchParams.get("start") ?? "";
			const byCode = periods[start] ?? {};
			const data = FILL_ZIPS.filter((z) => byCode[z.code] !== undefined).map((z) => {
				const figure = byCode[z.code];
				const [days, expected] = typeof figure === "number" ? [30, 30] : figure.thin;
				return {
					id: z.id,
					name: z.name,
					slug: z.id,
					type: "zipcode",
					summaries: [
						{
							timestamp: `${start}T00:00:00-08:00`,
							entry_type: entry,
							resolution: level === "yearly" ? "year" : "month",
							daily_statistic_mean: typeof figure === "number" ? figure : null,
							daily_statistic_days: days,
							daily_statistic_expected_days: expected,
							is_final: true
						}
					]
				};
			});
			return route.fulfill({ json: { data, page: 1, pages: 1, has_next_page: false } });
		}
	);
}

const PESTICIDES_META = /\/api\/2\.0\/pesticides\/meta\/$/;
const NOTICES = /\/api\/2\.0\/pesticides\/notices\/active\/$/;
const COMMODITY = /\/api\/2\.0\/pesticides\/commodities\/([a-z0-9]+)\/$/;

/** The fake commodity a notices layer's filters can name (the notice endpoints don't take one). */
export const NOTICE_COMMODITY = { id: "kgrp1", display_name: "Grapes" };

/**
 * The notices' explainer and the SprayDays link (fake wording, the server's shape). The catalog
 * names the layer "Pesticide Spray Notices" and the scale "Spray Notices", as the server does, so
 * a legend title on the wrong one can't pass.
 */
export const NOTICES_META = {
	catalogLabel: "Pesticide Spray Notices",
	scaleLabel: "Spray Notices",
	explainerTitle: "What a notice means",
	explainerSummary: "A plan to apply, not proof that spraying happened.",
	explainerSource: "https://spraydays.example/about",
	signup: "https://spraydays.example/"
};

/** One fixture spray notice: fake, at a point in the valley. */
export type NoticeFixture = {
	id: string;
	/** The MTRS section's id; notices in one section share one marker. */
	sectionId: string;
	section: string;
	county: string;
	/** `[lon, lat]`, the section's centre. */
	at: [number, number];
	/** When it's scheduled (ISO 8601, with its offset); its window ends four days later. */
	scheduled: string;
	/** On a dated request: whether the window had ended by that day (default false). */
	past?: boolean;
};

function noticeFeature(notice: NoticeFixture, dated: boolean) {
	const end = new Date(Date.parse(notice.scheduled) + 4 * 24 * 3_600_000).toISOString();
	return {
		type: "Feature",
		id: notice.id,
		geometry: { type: "Point", coordinates: notice.at },
		properties: {
			id: notice.id,
			scheduled_application: notice.scheduled,
			scheduled_end: end,
			county: notice.county,
			application_method: "Fumigation",
			aerial_ground: "F",
			treated_amount: 12.5,
			treated_units: "Acres",
			section: notice.section,
			section_id: notice.sectionId,
			products: [{ id: "prd01", name: "EXAMPLE SOIL FUMIGANT" }],
			chemicals: [
				{ id: "chm01", name: "EXAMPLE-CHEM", display_name: "Example-chem", is_of_concern: true }
			],
			...(dated && { past: notice.past ?? false })
		}
	};
}

/** The notices requests the page made, in order (their query strings, as sent). */
export type NoticesRequests = URLSearchParams[];

/**
 * Spray notices on the Map, as the server has them (shapes from a local response, fake values):
 * `routeMapMeta`'s dataset catalog plus `pesticide-notices` (route `routeMapMeta` first, for the
 * monitors meta; this catalog wins); the pesticides meta (`pesticides/meta.json`) plus the spray-notice scale, the
 * explainer, the SprayDays link and the `notice_filters` (all but the commodity); the fake
 * commodity's details; and `pesticides/notices/active/`, answered from `byDate` by the request's
 * `date` (`"now"` for a request with none), with `past` only on a dated one. A day not in
 * `byDate` has none. Returns the notices requests made.
 */
export async function routeMapNotices(
	context: BrowserContext,
	byDate: Record<string, NoticeFixture[]>
): Promise<NoticesRequests> {
	await context.route(
		(url) => CATALOG.test(url.pathname),
		async (route) => {
			const catalog = await mapCatalog();
			catalog.data.datasets.push({
				id: "pesticide-notices",
				label: NOTICES_META.catalogLabel,
				description: "Advance notices of planned restricted-use pesticide applications.",
				source: "SprayDays (California DPR)",
				license: "",
				geographies: ["point"],
				meta_url: "/api/2.0/pesticides/meta/",
				places_url: "",
				monitor_types: null,
				entry_types: [
					{
						id: "spray-notice",
						label: NOTICES_META.scaleLabel,
						kind: "other",
						units: "",
						resolutions: ["day"],
						aggregate: "sum",
						display: { precision: 0, chart: "bar", y_min: 0 },
						retired: null
					}
				],
				retired: null
			} as unknown as Catalog["data"]["datasets"][number]);
			await route.fulfill({ json: catalog });
		}
	);
	await context.route(
		(url) => PESTICIDES_META.test(url.pathname),
		async (route) => {
			const meta = (await json<{ data: Record<string, unknown> }>(
				`${API_FIXTURES}pesticides/meta.json`
			))!;
			Object.assign(meta.data, {
				notes: {
					noi_meaning: {
						key: "noi_meaning",
						title: NOTICES_META.explainerTitle,
						summary: NOTICES_META.explainerSummary,
						detail: null,
						source_url: NOTICES_META.explainerSource
					}
				},
				badges: [],
				links: { spraydays_signup: NOTICES_META.signup },
				notice_filters: [
					"chemical_id",
					"product_id",
					"category",
					"iarc_group",
					"narrow",
					"aerial_ground"
				],
				years: [2023],
				ramp: { colors: ["#deebf7", "#08306b"], no_data: "#f0f0f0" },
				scales: {
					"spray-notice": {
						id: "spray-notice",
						label: NOTICES_META.scaleLabel,
						units: "",
						kind: "category",
						source: { name: "SprayDays", url: NOTICES_META.signup },
						averaging_hours: null,
						daily_statistic: null,
						daily_statistic_label: null,
						period_statistic: null,
						period_statistic_label: null,
						levels: [
							{
								key: "notice",
								label: "Spray notice",
								color: "#e64980",
								tier: null,
								description: "",
								guidance: "",
								min: null,
								max: null,
								value: "notice",
								opacity: null
							}
						]
					}
				}
			});
			await route.fulfill({ json: meta });
		}
	);
	await context.route(
		(url) => COMMODITY.exec(url.pathname)?.[1] === NOTICE_COMMODITY.id,
		(route) =>
			route.fulfill({
				json: { data: { ...NOTICE_COMMODITY, name: "GRAPES", code: 29141 } }
			})
	);
	const requests: NoticesRequests = [];
	await context.route(
		(url) => NOTICES.test(url.pathname),
		(route) => {
			const params = new URL(route.request().url()).searchParams;
			requests.push(params);
			const date = params.get("date");
			const features = (byDate[date ?? "now"] ?? []).map((n) => noticeFeature(n, date !== null));
			return route.fulfill({
				json: { type: "FeatureCollection", as_of: "2026-11-15T20:00:00+00:00", features }
			});
		}
	);
	return requests;
}

const TOWNSHIPS = /\/api\/2\.0\/pesticides\/townships\/$/;
const SECTIONS = /\/api\/2\.0\/pesticides\/sections\/$/;
const SECTION_DETAIL = /\/api\/2\.0\/pesticides\/sections\/([a-z0-9]+)\/$/;

/** A township's or section's square: `[west, south, east, north]`. */
type Box = [number, number, number, number];
type UseTotals = { lbs_chemical: number; acres_treated: number; applications: number };
type UseClasses = Record<
	keyof UseTotals,
	{ breaks: number[]; min: number | null; colors: string[] }
>;

/** One fixture township: a synthetic square with its totals. */
export type UseTownshipFixture = { id: string; box: Box } & UseTotals;
/** One fixture section: a sixth of its township's square each way. */
export type UseSectionFixture = { id: string; mtrs: string; county: string; box: Box } & UseTotals;

/** The pesticide use the Map is routed: the grid, the classes, the section details and the meta. */
export type UseFixtures = {
	townships: UseTownshipFixture[];
	townshipClasses: UseClasses;
	sections: UseSectionFixture[];
	sectionClasses: UseClasses;
	/** A section's details (`sections/<id>/`) for a year. */
	details: (section: UseSectionFixture, year: number) => Record<string, unknown>;
	/** What `routeMapUse` adds to the pesticides meta. */
	meta: Record<string, unknown>;
};

type UseFile = {
	townshipClasses: UseClasses;
	sectionClasses: UseClasses;
	townshipPounds: number[];
	sectionPounds: number[];
	notes: Record<string, { key: string; title: string; summary: string; source_url: string }>;
	badges: unknown[];
	topChemicals: unknown[];
	peakMonth: number;
};

/** The use fixture's notes, badges and chemicals (`fixtures/map-use.json`). */
export const USE_FILE = JSON.parse(readFileSync(FIXTURES + "map-use.json", "utf8")) as UseFile;

/**
 * Every monitor type, as the local catalog's air-quality `monitor_types` lists them (the fixture
 * `meta/datasets.json`): a Map ticks them all to draw every monitor in its Where (decision 8).
 */
export const EVERY_MONITOR_TYPE: string[] = (
	JSON.parse(readFileSync(API_FIXTURES + "meta/datasets.json", "utf8")) as {
		data: { datasets: { id: string; monitor_types: string[] | null }[] };
	}
).data.datasets.find((d) => d.id === "air-quality")!.monitor_types!;

/** A township's size in degrees (about six miles each way in the valley). */
const TOWNSHIP_DEG = { lng: 0.108, lat: 0.087 };
/** The use grid's townships each way: 5 × 5, so a pan at the section zoom still finds sections. */
const GRID = 5;

const totals = (lbs: number): UseTotals => ({
	lbs_chemical: lbs,
	acres_treated: lbs / 2,
	applications: Math.ceil(lbs / 10)
});

/**
 * The use fixtures: a 5 × 5 grid of synthetic square townships centred on `center` (`[lon, lat]`),
 * named on the made-up meridian `TST` (`TST-T03S-R03E` is the middle one; T01S is the north row,
 * R01E the west column), each holding 36 square sections numbered row by row from the north-west
 * (`TST-T03S-R03E-01` … `-36`). The middle township and the corners use the most; one township
 * per row uses none (no data).
 */
export function useFixtures(center: [number, number]): UseFixtures {
	const townships: UseTownshipFixture[] = [];
	const sections: UseSectionFixture[] = [];
	const west = center[0] - (GRID / 2) * TOWNSHIP_DEG.lng;
	const north = center[1] + (GRID / 2) * TOWNSHIP_DEG.lat;
	const pad = (n: number) => String(n).padStart(2, "0");
	for (let row = 0; row < GRID; row++) {
		for (let col = 0; col < GRID; col++) {
			const id = `TST-T${pad(row + 1)}S-R${pad(col + 1)}E`;
			const w = west + col * TOWNSHIP_DEG.lng;
			const n = north - row * TOWNSHIP_DEG.lat;
			const box: Box = [w, n - TOWNSHIP_DEG.lat, w + TOWNSHIP_DEG.lng, n];
			const pounds = USE_FILE.townshipPounds[(row + col) % USE_FILE.townshipPounds.length];
			townships.push({ id, box, ...totals(pounds) });
			const step = { lng: TOWNSHIP_DEG.lng / 6, lat: TOWNSHIP_DEG.lat / 6 };
			for (let i = 0; i < 36; i++) {
				const r = Math.floor(i / 6);
				const c = i % 6;
				const sw = w + c * step.lng;
				const sn = n - r * step.lat;
				const lbs = USE_FILE.sectionPounds[(r + c) % USE_FILE.sectionPounds.length];
				sections.push({
					id: `ts${row + 1}${col + 1}s${pad(i + 1)}`,
					mtrs: `${id}-${pad(i + 1)}`,
					county: "Example County",
					box: [sw, sn - step.lat, sw + step.lng, sn],
					...totals(lbs)
				});
			}
		}
	}
	return {
		townships,
		townshipClasses: USE_FILE.townshipClasses,
		sections,
		sectionClasses: USE_FILE.sectionClasses,
		details: (section, year) => ({
			id: section.id,
			mtrs: section.mtrs,
			county: section.county,
			year,
			geometry: square(section.box),
			years: [
				{
					year,
					lbs_chemical: section.lbs_chemical,
					lbs_product: section.lbs_chemical * 2,
					acres_treated: section.acres_treated,
					applications: section.applications
				}
			],
			months: Array.from({ length: 12 }, (_, i) => {
				const peak = i + 1 === USE_FILE.peakMonth;
				return {
					month: i + 1,
					lbs_chemical: peak ? 40 : 1,
					acres_treated: peak ? 20 : 1,
					applications: peak ? 4 : 1
				};
			}),
			top_chemicals: USE_FILE.topChemicals,
			top_products: [],
			top_commodities: []
		}),
		meta: {
			notes: USE_FILE.notes,
			badges: USE_FILE.badges,
			years: [2023, 2022],
			ramp: {
				colors: ["#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#08519c"],
				no_data: "#f0f0f0"
			},
			links: { spraydays_signup: "https://spraydays.example/" },
			notice_filters: ["chemical_id", "product_id", "category", "iarc_group", "narrow"],
			scales: {}
		}
	};
}

function square([w, s, e, n]: Box) {
	return {
		type: "Polygon",
		coordinates: [
			[
				[w, s],
				[e, s],
				[e, n],
				[w, n],
				[w, s]
			]
		]
	};
}

const touches = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** The use requests the page made, in order (their query strings, as sent). */
export type UseRequests = {
	townships: URLSearchParams[];
	sections: URLSearchParams[];
	/** `sections/<id>/`: the section id and the query. */
	details: { id: string; params: URLSearchParams }[];
};

/** The catalog's pesticide use, as the server lists it (`meta/datasets/`). */
export const USE_CATALOG = {
	label: "Pesticide Use",
	figures: [
		{ id: "pounds-applied", label: "Pounds Applied", units: "lbs" },
		{ id: "acres-treated", label: "Acres Treated", units: "acres" },
		{ id: "applications", label: "Applications", units: "applications" }
	]
};

/**
 * Pesticide use on the Map, as the server has it (its shapes, fake values from `fixtures`):
 * `routeMapMeta`'s dataset catalog plus `pesticide-use` (route `routeMapMeta` first, for the
 * monitors meta; this catalog wins); the pesticides meta (`pesticides/meta.json`) plus the
 * fixtures' notes, badges, years and links; `pesticides/townships/` (every township, with its
 * outline unless `geometry=0`, and the classes with `classes=1`); `pesticides/sections/?bbox=`
 * (the sections touching the box, and the classes with `classes=1`); and
 * `pesticides/sections/<id>/`. Returns the use requests made.
 */
export async function routeMapUse(
	context: BrowserContext,
	{ townships, townshipClasses, sections, sectionClasses, details, meta }: UseFixtures
): Promise<UseRequests> {
	await context.route(
		(url) => CATALOG.test(url.pathname),
		async (route) => {
			const catalog = await mapCatalog();
			catalog.data.datasets.push({
				id: "pesticide-use",
				label: USE_CATALOG.label,
				description: "Reported agricultural pesticide applications, summed by region.",
				source: "California DPR Pesticide Use Reporting (PUR)",
				license: "",
				geographies: ["region"],
				meta_url: "/api/2.0/pesticides/meta/",
				places_url: "",
				monitor_types: null,
				entry_types: USE_CATALOG.figures.map((figure) => ({
					...figure,
					kind: "other",
					resolutions: ["month", "year"],
					aggregate: "sum",
					display: { precision: 0, chart: "bar", y_min: 0 },
					retired: null
				})),
				retired: null
			} as unknown as Catalog["data"]["datasets"][number]);
			await route.fulfill({ json: catalog });
		}
	);
	await context.route(
		(url) => PESTICIDES_META.test(url.pathname),
		async (route) => {
			const file = (await json<{ data: Record<string, unknown> }>(
				`${API_FIXTURES}pesticides/meta.json`
			))!;
			Object.assign(file.data, meta);
			await route.fulfill({ json: file });
		}
	);
	const requests: UseRequests = { townships: [], sections: [], details: [] };
	const year = (params: URLSearchParams) => Number(params.get("year") ?? 2023);
	await context.route(
		(url) => TOWNSHIPS.test(url.pathname),
		(route) => {
			const params = new URL(route.request().url()).searchParams;
			requests.townships.push(params);
			const outlines = params.get("geometry") !== "0";
			return route.fulfill({
				json: {
					type: "FeatureCollection",
					year: year(params),
					...(params.get("classes") === "1" && { classes: townshipClasses }),
					features: townships.map(({ id, box, ...values }) => ({
						type: "Feature",
						id,
						geometry: outlines ? square(box) : null,
						properties: { id, name: id, sections: 36, lbs_product: 0, ...values }
					}))
				}
			});
		}
	);
	await context.route(
		(url) => SECTIONS.test(url.pathname),
		(route) => {
			const params = new URL(route.request().url()).searchParams;
			requests.sections.push(params);
			const bbox = (params.get("bbox") ?? "").split(",").map(Number) as Box;
			const found = bbox.length === 4 ? sections.filter((s) => touches(s.box, bbox)) : [];
			return route.fulfill({
				json: {
					type: "FeatureCollection",
					year: year(params),
					...(params.get("classes") === "1" && { classes: sectionClasses }),
					features: found.map(({ id, mtrs, county, box, ...values }) => ({
						type: "Feature",
						id,
						geometry: square(box),
						properties: { id, mtrs, county, lbs_product: 0, ...values }
					}))
				}
			});
		}
	);
	await context.route(
		(url) => SECTION_DETAIL.test(url.pathname),
		(route) => {
			const url = new URL(route.request().url());
			const [, id] = SECTION_DETAIL.exec(url.pathname)!;
			requests.details.push({ id, params: url.searchParams });
			const section = sections.find((s) => s.id === id);
			if (!section) return route.fulfill({ status: 404, json: { error: "Not found" } });
			return route.fulfill({ json: details(section, year(url.searchParams)) });
		}
	);
	return requests;
}

const MONITORS_LIST = /\/api\/2\.0\/monitors\/$/;
const CURRENT = /\/api\/2\.0\/monitors\/([a-z0-9]+)\/current\/$/;

/** A made-up monitor `routeMoreMonitors` adds to Fresno County. */
export type ExtraMonitor = { id: string; name: string };

/** Fresno County's server id (`regions.json`), whose monitors the extra ones join. */
const FRESNO_COUNTY_ID = "r6phe";
/** The Science Building monitor: inactive, so it has no past days. */
const SCIENCE_BUILDING = "Tt5ixZRKSH-rVKJtwVh-bw";

/**
 * Adds `extras` to Fresno County: copies of the Drummond Street monitor (an active outdoor AirNow
 * monitor, Good), each a little east of it, in the monitor list (`monitors/`), the whole Valley's
 * readings (`monitors/<type>/current/`), the region-scoped readings (`monitors/<type>/at/`) and the
 * past days' bulk daily summaries (`monitors/<type>/summaries/daily/?region=`, every Fresno County
 * monitor at `figure` on any day), with Drummond Street's raw readings
 * (`monitors/<id>/entries/pm25/`) as their own. Routed after the fixtures, so it wins; PM2.5 only.
 */
export async function routeMoreMonitors(
	context: BrowserContext,
	extras: ExtraMonitor[],
	figure = 5
): Promise<void> {
	type Row = {
		id: string;
		name: string;
		type: string;
		position: { type: string; coordinates: number[] };
	};
	const current = (await json<{ data: Row[] }>(`${API_FIXTURES}monitors/pm25/current.json`))!;
	const listed = (await json<{ data: Row[] }>(`${API_FIXTURES}monitors.json`))!;
	const drummond = current.data.find((m) => m.id === REGION_MONITORS[FRESNO_COUNTY_ID][0])!;
	const copies = extras.map(({ id, name }, i) => {
		const [lng, lat] = drummond.position.coordinates;
		return {
			...structuredClone(drummond),
			id,
			name,
			position: { type: "Point", coordinates: [lng + 0.02 * (i + 1), lat + 0.01 * (i % 2)] }
		};
	});
	const inCounty = new Set([...REGION_MONITORS[FRESNO_COUNTY_ID], ...extras.map((m) => m.id)]);
	const regionsOf = (url: URL) => url.searchParams.getAll("region").flatMap((r) => r.split(","));
	const wantedIn = (url: URL) =>
		new Set(
			regionsOf(url).flatMap((r) =>
				r === FRESNO_COUNTY_ID ? [...inCounty] : (REGION_MONITORS[r] ?? [])
			)
		);
	const all = [...current.data, ...copies];

	await context.route(
		(url) => MONITORS_LIST.test(url.pathname),
		(route) => {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the list has no reading
			const rows = copies.map(({ latest, ...rest }: Row & { latest?: unknown }) => rest);
			return route.fulfill({ json: { data: [...listed.data, ...rows] } });
		}
	);
	// A Chart of an extra monitor reads Drummond Street's readings.
	const entries = await readFile(
		`${API_FIXTURES}monitors/${drummond.id}/entries/pm25.json`,
		"utf8"
	);
	await context.route(
		(url) => extras.some((m) => url.pathname.endsWith(`/api/2.0/monitors/${m.id}/entries/pm25/`)),
		(route) => route.fulfill({ contentType: "application/json", body: entries })
	);
	await context.route(
		(url) => CURRENT.exec(url.pathname)?.[1] === "pm25",
		(route) => route.fulfill({ json: { data: all } })
	);
	await context.route(
		(url) => AT.exec(url.pathname)?.[1] === "pm25",
		(route) => {
			const wanted = wantedIn(new URL(route.request().url()));
			return route.fulfill({ json: { data: all.filter((m) => wanted.has(m.id)) } });
		}
	);
	await context.route(
		(url) => MONITOR_DAILY.exec(url.pathname)?.[1] === "pm25" && scoped(url),
		(route) => {
			const url = new URL(route.request().url());
			const day = url.searchParams.get("start") ?? "";
			if (url.searchParams.get("end") !== day) {
				return route.fulfill({ status: 400, json: { error: "end must equal start" } });
			}
			const wanted = bulkWanted(url, all, (r) =>
				r === FRESNO_COUNTY_ID ? [...inCounty] : (REGION_MONITORS[r] ?? [])
			);
			const data = all
				.filter((m) => wanted.has(m.id) && m.id !== SCIENCE_BUILDING)
				.map((m) => ({
					id: m.id,
					name: m.name,
					type: m.type,
					summaries: [
						{
							timestamp: `${day}T00:00:00-08:00`,
							entry_type: "pm25",
							resolution: "day",
							count: 24,
							expected_count: 24,
							mean_24h: figure,
							is_final: true
						}
					]
				}));
			return route.fulfill({ json: { data, page: 1, pages: 1, has_next_page: false } });
		}
	);
}

const REGIONS_LIST = /\/api\/2\.0\/regions\/$/;

/**
 * Answers the region list for the use fixtures' sections (`regions/?type=mtrs&external_id=…`):
 * each section a region named by its MTRS code, as the server has them. Other types go on to
 * `routePlaces`.
 */
export async function routeSectionRegions(
	context: BrowserContext,
	{ sections }: UseFixtures
): Promise<void> {
	await context.route(
		(url) => REGIONS_LIST.test(url.pathname) && url.searchParams.get("type") === "mtrs",
		(route) => {
			const url = new URL(route.request().url());
			const codes = url.searchParams.get("external_id")?.split(",") ?? [];
			const data = sections
				.filter((s) => codes.includes(s.mtrs))
				.map((s) => ({
					id: s.id,
					name: s.mtrs,
					slug: s.mtrs.toLowerCase(),
					type: "mtrs",
					external_id: s.mtrs,
					retired: null,
					boundary: { id: `b${s.id}`, version: "2023", bbox: s.box }
				}));
			return route.fulfill({ json: { data } });
		}
	);
}

const LOCATIONS = /\/api\/2\.0\/pesticides\/locations\/$/;

/** A `pesticides/locations/` feature, as the server sends it (a local response, 2026-11-22). */
export type LocationFeature = {
	type: "Feature";
	id: string;
	geometry: { type: "Point"; coordinates: [number, number] };
	properties: {
		id: string;
		source: string;
		external_id: string;
		name: string;
		type: string;
		type_label: string;
		address: string;
		city: string;
		school_district: string | null;
		school_district_id: string | null;
		school_district_url: string | null;
		grade_span: string | null;
		enrollment: number | null;
		capacity: number | null;
	};
};

type LocationRow = {
	id: string;
	source: string;
	external_id: string;
	type: string;
	name: string;
	address: string;
	city_name: string;
	zip: string;
	point: { lat: number; lng: number };
	regions: Record<string, { type: string; external_id: string; name: string }>;
};

/** Roosevelt High (`regions/locations.json`), whose regions (server ids) list it. */
const ROOSEVELT_HIGH = "qfpem";
const ROOSEVELT_REGIONS = ["r6phe", "njyup", "c85na"];

/** Roosevelt High's place in a Where: the school a Map can focus on. */
export const ROOSEVELT_PLACE = {
	kind: "location",
	source: "cde-public",
	code: "10621661035831"
} as const;

/**
 * Roosevelt High as a `pesticides/locations/` feature, built from the place fixture
 * (`regions/locations.json`), so its point is the place's own. Its type's label is the regions
 * meta's.
 */
async function rooseveltFeature(): Promise<LocationFeature> {
	const rows = (await json<{ data: LocationRow[] }>(`${API_FIXTURES}regions/locations.json`))!;
	const row = rows.data.find((r) => r.id === ROOSEVELT_HIGH)!;
	const meta = (await json<{ data: { location_types: Record<string, { label: string }> } }>(
		`${API_FIXTURES}regions/meta.json`
	))!;
	return {
		type: "Feature",
		id: row.id,
		geometry: { type: "Point", coordinates: [row.point.lng, row.point.lat] },
		properties: {
			id: row.id,
			source: row.source,
			external_id: row.external_id,
			name: row.name,
			type: row.type,
			type_label: meta.data.location_types[row.type].label,
			address: row.address,
			city: row.city_name,
			school_district: row.regions.school_district?.name ?? null,
			school_district_id: null,
			school_district_url: null,
			grade_span: "9-12",
			enrollment: null,
			capacity: null
		}
	};
}

/** The made-up sites, by the region (server id) each lies in (`fixtures/map-locations.json`). */
export const LOCATION_SITES = (
	JSON.parse(readFileSync(FIXTURES + "map-locations.json", "utf8")) as {
		regions: Record<string, LocationFeature[]>;
	}
).regions;

/**
 * Answers the Map's schools and child care, `pesticides/locations/?region=<server id>` (repeatable
 * or comma-separated), as the server does: every type, each site in any of the regions asked for
 * once; every site with no region. The sites are the made-up ones (`LOCATION_SITES`) and Roosevelt
 * High in its regions. Returns the requests made (their query strings, as sent).
 */
export async function routeMapLocations(context: BrowserContext): Promise<URLSearchParams[]> {
	const roosevelt = await rooseveltFeature();
	const byRegion: Record<string, LocationFeature[]> = structuredClone(LOCATION_SITES);
	for (const region of ROOSEVELT_REGIONS) (byRegion[region] ??= []).push(roosevelt);
	const requests: URLSearchParams[] = [];
	await context.route(
		(url) => LOCATIONS.test(url.pathname),
		(route) => {
			const params = new URL(route.request().url()).searchParams;
			requests.push(params);
			const regions = params.getAll("region").flatMap((r) => r.split(","));
			const lists =
				regions.length > 0 ? regions.map((r) => byRegion[r] ?? []) : Object.values(byRegion);
			const features = [...new Map(lists.flat().map((f) => [f.id, f])).values()];
			return route.fulfill({ json: { type: "FeatureCollection", features } });
		}
	);
	return requests;
}
