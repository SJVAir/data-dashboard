import "../../../app.css";
import axe from "axe-core";
import type { Feature } from "geojson";
import { flushSync, type Snippet } from "svelte";
import {
	getActivePesticideNotices,
	getChemicalDetails,
	getCommodityDetails,
	getHMSFire,
	getHMSSmoke,
	getPesticidesMeta,
	getPesticideSections,
	getPesticideTownships,
	getMonitorSummariesBulkDaily,
	getMonitorSummariesBulkMonthly,
	getMonitorSummariesBulkYearly,
	getMonitors,
	getRegionSummariesBulkDaily,
	getRegionSummariesBulkDailyOpen,
	getRegionSummariesBulkMonthly,
	getRegionSummariesBulkYearly,
	getRegionsMeta
} from "@sjvair/sdk";
import type { FeatureListItem } from "@sjvair/map-sdk";
import { encodeRef, type ScaleRef } from "@sjvair/map-sdk/data";
import { useScaleFor } from "./data/use-scale";
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { getMetadata, getResolvers, placeRegion } from "$lib/data";
import { loadDashboard } from "$lib/documents/load";
import { CURRENT_SCHEMA_VERSION } from "$lib/documents/schema";
import type { DateRangeSpec, Layer, WidgetDataConfig } from "$lib/data/schema";
import type { CatalogEntry, MetadataSource } from "$lib/data/metadata";
import { getNowClient } from "$lib/data/now";
import { createNowClient, type NowClient } from "$lib/data/now/client";
import type { QueryClient } from "$lib/data/query/client";
import type { PlaceInfo, QueryInput, QueryLayer } from "$lib/data/types";
import { FIXTURE_CATALOG, fixtureMetadata } from "$lib/data/testing/fixtures";
import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { resetPesticideMeta } from "$lib/data/pesticide-meta";
import { formatNumber, pacificDay, todayPacific } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { setPlatform } from "$lib/platform";
import { createMemoryPlatform, type MemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import {
	TILE_OPTIONS_KEY,
	ViewerChanges,
	type TileOptionsContext
} from "../shared/tile-options.svelte";
import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
import { generatedTitle } from "../titles.svelte";
import { periodStops } from "./days";
import { mapConfig } from "./host/config";
import { mapMessages } from "./host/messages";
import { NOTICES_SCALE } from "./data/notices";
import { resetUseCaches } from "./data/use";
import { mapOptions } from "./options";
import { regionShapes, regionTypeShapes } from "./regions";
import {
	FAKE_TOOLBAR_HEIGHT,
	FakeGl,
	fakeLenses,
	fakeMaps,
	fakeToolbars,
	type FakeMap
} from "./test-harness/fake-map.svelte";
import Preview from "$lib/get-data/Preview.svelte";
import { registerWidgetType } from "../registry";
import { mapType } from "./index";
import MapWidget from "./MapWidget.svelte";
import { resetUseLegendNote } from "./UseLegendNote.svelte";
import { mapSend } from "./send-registry";
import { showIn } from "./show-in";
import RenderSnippet from "./test-harness/RenderSnippet.svelte";
import SessionMap from "./test-harness/SessionMap.svelte";

vi.mock("@sjvair/map-sdk", async (original) => {
	const sdk = await original<typeof import("@sjvair/map-sdk")>();
	const { createFakeLens, createFakeMap } = await import("./test-harness/fake-map.svelte");
	const { default: MapView } = await import("./test-harness/FakeMapView.svelte");
	const { default: Legend } = await import("./test-harness/FakeLegend.svelte");
	const { default: OptionsToolbar } = await import("./test-harness/FakeOptionsToolbar.svelte");
	const plugin = (kind: string) => (options: { id?: string }) => ({
		id: options.id ?? kind,
		kind,
		options
	});
	/** The box of a polygon's outer ring. */
	const geometryBbox = (g: { coordinates: number[][][] }) => {
		const ring = g.coordinates[0];
		const xs = ring.map((p) => p[0]);
		const ys = ring.map((p) => p[1]);
		return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
	};
	return {
		createMap: createFakeMap,
		MapView,
		Legend,
		OptionsToolbar,
		// The real presets, over the fake map's metadata and basemaps.
		monitorsOptions: sdk.monitorsOptions,
		settingsGroup: sdk.settingsGroup,
		hmsOptions: sdk.hmsOptions,
		focusAreaPlugin: (options: { id?: string }) => {
			const focus = { geometry: null as unknown, label: undefined as string | undefined };
			/** Every geometry set, in order. */
			const history: unknown[] = [];
			return {
				id: options.id ?? "focus-area",
				kind: "focus",
				options,
				focus,
				history,
				set: (next: { geometry: unknown; label?: string }) => {
					history.push(next.geometry);
					Object.assign(focus, next);
				}
			};
		},
		monitorsPlugin: plugin("monitors"),
		regionsPlugin: plugin("regions"),
		hmsSmokePlugin: plugin("hms-smoke"),
		hmsFirePlugin: plugin("hms-fire"),
		pointsPlugin: plugin("points"),
		shapesPlugin: plugin("shapes"),
		shapesLens: createFakeLens,
		cleanFires: (d: unknown[]) => d,
		groupFires: (d: { id: string; coordinates: [number, number]; frp: number }[]) =>
			d.map((f) => ({ id: f.id, coordinates: f.coordinates, avgFrp: f.frp, count: 1 })),
		maptilerMap: (map: { gl: unknown }) => map.gl,
		geometryBbox
	};
});
vi.mock("@sjvair/sdk", async (original) => ({
	...(await original<typeof import("@sjvair/sdk")>()),
	getMonitors: vi.fn(),
	getMonitorSummariesBulkDaily: vi.fn(),
	getMonitorSummariesBulkMonthly: vi.fn(),
	getMonitorSummariesBulkYearly: vi.fn(),
	getHMSSmoke: vi.fn(),
	getHMSFire: vi.fn(),
	getActivePesticideNotices: vi.fn(),
	getChemicalDetails: vi.fn(),
	getCommodityDetails: vi.fn(),
	getPesticidesMeta: vi.fn(),
	getPesticideSections: vi.fn(),
	getPesticideTownships: vi.fn(),
	getRegionsMeta: vi.fn(),
	getRegionSummariesBulkDaily: vi.fn(),
	getRegionSummariesBulkDailyOpen: vi.fn(),
	getRegionSummariesBulkMonthly: vi.fn(),
	getRegionSummariesBulkYearly: vi.fn()
}));
vi.mock("$lib/data/now", () => ({ getNowClient: vi.fn() }));
vi.mock("./show-in", () => ({ showIn: vi.fn() }));
vi.mock("./host/metadata", () => ({ mapMetadata: () => ({}) }));
vi.mock("./host/config", () => ({ mapConfig: vi.fn() }));
vi.mock("$lib/data", () => ({
	getMetadata: vi.fn(),
	getQueryClient: vi.fn(),
	getResolvers: vi.fn(),
	placeRegion: vi.fn()
}));
vi.mock("./regions", async (original) => ({
	...(await original<typeof import("./regions")>()),
	regionShapes: vi.fn(),
	regionTypeShapes: vi.fn()
}));
vi.mock("$lib/components/dialogs/lazy.svelte", async (original) => ({
	...(await original<typeof import("$lib/components/dialogs/lazy.svelte")>()),
	openPlacePicker: vi.fn()
}));

/** A square region from (x, y) to (x + 1, y + 1). */
function square(x: number, y: number): Feature {
	return {
		type: "Feature",
		properties: { name: `Region ${x}` },
		geometry: {
			type: "Polygon",
			coordinates: [
				[
					[x, y],
					[x + 1, y],
					[x + 1, y + 1],
					[x, y]
				]
			]
		}
	};
}

/** Region shapes by code: county "019" is at (0, 0), "029" at (5, 5), zipcode "93721" at (2, 2). */
const SHAPES: Record<string, Feature> = {
	"county:019": square(0, 0),
	"county:029": square(5, 5),
	"zipcode:93721": square(2, 2)
};

/** A query client that names a layer's place, for the title. */
function namingClient(): QueryClient {
	const info = (layer: QueryLayer): PlaceInfo => {
		// A query with ticked types reads every monitor of them, as the real client does: its first
		// place is a monitor, never the Where.
		if (layer.monitorTypes?.length) return { place: "monitor:any", name: "Some monitor" };
		const place = layer.place ?? null;
		const monitor = layer.monitors?.length === 1 ? layer.monitors[0] : undefined;
		if (monitor && !place) return { place: `monitor:${monitor}`, name: `Monitor ${monitor}` };
		if (place?.kind === "region") {
			return { place: `region:${place.type}:${place.code}`, name: "Fresno County" };
		}
		if (place?.kind === "point") {
			return { place: "region:zipcode:93721", name: "ZIP 93721", via: { kind: "point" } };
		}
		return { place: "x", name: "Somewhere" };
	};
	return {
		subscribe(input: QueryInput, listener) {
			const emit = (i: QueryInput) =>
				queueMicrotask(() =>
					listener({
						status: "ready",
						data: {
							series: [],
							places: [info(i.layer)],
							resolution: "hour",
							fromRaw: false,
							processor: null,
							fetchedAt: 0
						}
					})
				);
			emit(input);
			return { update: emit, setPolling() {}, retry() {}, unsubscribe() {}, key: null };
		},
		refetch() {},
		entries: () => [],
		onChange: () => () => {}
	};
}

/** A pesticide use figure, as the catalog lists it. */
function useFigure(id: string, label: string, units: string): CatalogEntry["entryTypes"][number] {
	return {
		id,
		label,
		units,
		kind: "other",
		resolutions: ["month", "year"],
		precision: 0,
		yMin: 0,
		chart: "bar",
		aggregate: "sum"
	};
}

/** The catalog with the smoke and fire datasets, as the server lists them. */
const CATALOG: CatalogEntry[] = [
	...FIXTURE_CATALOG,
	{ id: "hms-smoke", label: "Wildfire Smoke", entryTypes: [], geographies: ["polygon"] },
	{ id: "hms-fire", label: "Fire Detections", entryTypes: [], geographies: ["point"] },
	{ id: "pesticide-notices", label: "Spray Notices", entryTypes: [], geographies: ["point"] },
	{
		id: "pesticide-use",
		label: "Pesticide Use",
		entryTypes: [
			useFigure("pounds-applied", "Pounds Applied", "lbs"),
			useFigure("acres-treated", "Acres Treated", "acres")
		],
		geographies: ["region"]
	}
];

/** A monitor's latest reading, at `[lon, lat]`. */
function reading(id: string, lon = -119.7, lat = 36.7) {
	return {
		id,
		name: `Monitor ${id}`,
		type: "purpleair",
		is_active: true,
		is_sjvair: true,
		location: "outside",
		position: { type: "Point", coordinates: [lon, lat] },
		latest: { value: "12.5", timestamp: "2026-11-12T10:00:00-08:00" }
	};
}

/** The monitor ids a map's monitors plugin draws now. */
function drawn(map: FakeMap): string[] | undefined {
	const plugin = map.plugins.find((p) => p.id === "monitors");
	const source = plugin?.options.source as
		{ features: { features: { properties: { refKey: string } }[] } | null } | undefined;
	return source?.features?.features.map((f) => f.properties.refKey.replace(/^monitor:/, ""));
}

const NOI_SOURCE = "https://cdpr.example/noi";
const SHADES_SOURCE = "https://cdpr.example/shades";
const LAG_SOURCE = "https://cdpr.example/lag";

/**
 * The pesticides meta: the filter params the notice endpoints take (no commodity), the notices'
 * explainer, and their one-level scale.
 */
const PESTICIDES_META = {
	categories: [{ key: "fumigant", label: "Fumigants", description: "", in_use: true }],
	iarc_groups: [],
	methods: [],
	narrows: [],
	placeholder_chemicals: [],
	badges: [],
	notes: {
		noi_meaning: {
			key: "noi_meaning",
			title: "What a notice means",
			summary: "A plan to apply, not proof it happened. Restricted materials only.",
			detail: null,
			source_url: NOI_SOURCE
		},
		shades_valley: {
			key: "shades_valley",
			title: "How the shades work",
			summary: "Each shade is a class of the whole valley's use.",
			detail: null,
			source_url: SHADES_SOURCE
		},
		pur_lag: {
			key: "pur_lag",
			title: "Use is reported late",
			summary: "Use data comes out about two years after the year ends.",
			detail: null,
			source_url: LAG_SOURCE
		}
	},
	years: [2023, 2022],
	links: { spraydays_signup: "" },
	notice_filters: [
		"chemical_id",
		"product_id",
		"category",
		"iarc_group",
		"narrow",
		"aerial_ground"
	],
	scales: {
		"spray-notice": {
			id: "spray-notice",
			label: "Spray Notices",
			kind: "category",
			levels: [{ key: "notice", label: "Spray notice", color: "#e64980", value: "notice" }]
		}
	}
};

/** A spray notice in MTRS section `section`, as the server gives it. */
function sprayNotice(id: string, section: string) {
	return {
		type: "Feature",
		id,
		geometry: { type: "Point", coordinates: [-119.5, 36.5] },
		properties: {
			id,
			scheduled_application: "2026-11-12T08:00:00-08:00",
			scheduled_end: "2026-11-16T08:00:00-08:00",
			county: "Fresno",
			application_method: "Ground",
			aerial_ground: "G",
			treated_amount: 10,
			treated_units: "A",
			section: `Section ${section}`,
			section_id: section,
			products: [],
			chemicals: []
		}
	};
}

const noticeCollection = (features: unknown[]) => ({
	type: "FeatureCollection",
	as_of: "",
	features
});

let frame: HTMLDivElement;
let nowClient: NowClient;
let platform: MemoryPlatform;
let shownApp: Awaited<ReturnType<typeof initApp>>;
/** The app the last `show` rendered into. */
const app = () => shownApp;

beforeEach(async () => {
	await page.viewport(1280, 800);
	fakeMaps.reset();
	fakeToolbars.reset();
	nowClient = createNowClient();
	vi.mocked(getNowClient).mockReturnValue(nowClient);
	vi.mocked(getMonitors).mockResolvedValue([] as never);
	vi.mocked(getHMSSmoke).mockResolvedValue([] as never);
	vi.mocked(getHMSFire).mockResolvedValue([] as never);
	vi.mocked(getMonitorSummariesBulkDaily).mockResolvedValue([] as never);
	vi.mocked(getMonitorSummariesBulkMonthly).mockResolvedValue([] as never);
	vi.mocked(getMonitorSummariesBulkYearly).mockResolvedValue([] as never);
	vi.mocked(getRegionSummariesBulkMonthly).mockResolvedValue([] as never);
	vi.mocked(getRegionSummariesBulkYearly).mockResolvedValue([] as never);
	resetPesticideMeta();
	resetUseCaches();
	resetUseLegendNote();
	vi.mocked(getPesticideTownships).mockResolvedValue(useTownships() as never);
	vi.mocked(getPesticideSections).mockResolvedValue(useSections() as never);
	vi.mocked(getPesticidesMeta).mockResolvedValue(PESTICIDES_META as never);
	vi.mocked(getActivePesticideNotices).mockResolvedValue(noticeCollection([]) as never);
	vi.mocked(mapConfig).mockReturnValue({ maptilerKey: "test", projection: "mercator" });
	const { getMetadata, getQueryClient } = await import("$lib/data");
	vi.mocked(getMetadata).mockReturnValue(fixtureMetadata({ catalog: async () => CATALOG }));
	vi.mocked(getQueryClient).mockReturnValue(namingClient());
	vi.mocked(getResolvers).mockReturnValue({
		locations: {
			resolve: async () => ({ name: "Roosevelt High School", point: { lat: 36.7, lon: -119.8 } })
		},
		// A county's server id is "r" and its code; a ZIP code's "z" and its code.
		regions: {
			resolve: async (type: string, code: string) => ({
				id: `${type === "zipcode" ? "z" : "r"}${code}`,
				name: code
			})
		}
	} as never);
	vi.mocked(placeRegion).mockResolvedValue({ type: "zipcode", code: "93721" });
	vi.mocked(regionShapes).mockImplementation(
		async (refs) =>
			new Map(
				refs.flatMap((r) => {
					const shape = SHAPES[`${r.type}:${r.code}`];
					return shape ? [[`${r.type}:${r.code}`, shape] as const] : [];
				})
			)
	);
	frame = document.createElement("div");
	frame.style.width = "640px";
	frame.style.height = "480px";
	document.body.appendChild(frame);
});

afterEach(() => {
	frame.remove();
	document.documentElement.removeAttribute("data-theme");
	vi.resetAllMocks();
});

/** A layer's fields with the widget's Where beside them (the helpers split them). */
type LayerAt = Partial<Layer> & Pick<WidgetDataConfig, "place" | "selection">;

/** Every monitor type (the local monitors meta's keys): a new Map ticks them all (decision 8). */
const EVERY_TYPE = ["airgradient", "airnow", "aqlite", "aqview", "bam1022", "purpleair", "vozbox"];

/** A Map of PM2.5 with `at`'s Where; every type ticked unless `at` gives its own monitors. */
function mapWidget(at: LayerAt): WidgetInstance {
	const { place, selection, ...layer } = at;
	return {
		id: crypto.randomUUID(),
		type: "map",
		title: null,
		rect: { x: 0, y: 0, w: 6, h: 6 },
		data: {
			...(place ? { place } : {}),
			...(selection ? { selection } : {}),
			layers: [
				{ dataset: "air-quality", entryType: "pm25", monitorTypes: [...EVERY_TYPE], ...layer }
			]
		}
	};
}

async function show(widget: WidgetInstance, viewer?: PlaceViewer) {
	await openSession(widget);
	return render(MapWidget, {
		target: frame,
		props: { widget },
		context: new Map<unknown, unknown>([
			[APP_CONTEXT_KEY, shownApp],
			...(viewer ? [[PLACE_VIEWER_KEY, viewer] as const] : [])
		])
	});
}

/**
 * Shows the Map as the session's document holds it, following its changes (undo, redo); with
 * `tileOptions`, its toolbar's changes go there (the grid's context).
 */
async function showLive(widget: WidgetInstance, tileOptions?: TileOptionsContext) {
	await openSession(widget);
	return render(SessionMap, {
		target: frame,
		props: { widgetId: widget.id },
		context: new Map<unknown, unknown>([
			[APP_CONTEXT_KEY, shownApp],
			...(tileOptions ? [[TILE_OPTIONS_KEY, tileOptions] as const] : [])
		])
	});
}

/** The grid's context on an editable dashboard: changes go to the app's current session. */
const editing = (): TileOptionsContext => ({ mode: "edit", session: () => app().current.session });

/** An app with a dashboard holding `widget`, open in an editable session. */
async function openSession(widget: WidgetInstance) {
	platform = createMemoryPlatform();
	setPlatform(platform);
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const id = await app.index.createBlank();
	const stored = (await platform.documents.get(app.space, id)) as Dashboard;
	await platform.documents.commit(app.space, {
		docId: id,
		baseVersion: stored.version,
		doc: { ...stored, body: { widgets: [widget] } },
		entries: []
	});
	const session = (await DocumentSession.open(platform, app.space, id, "t2"))!;
	app.current = { session, isStarter: false };
	shownApp = app;
	return session;
}

/** The map, once the widget has made it. */
async function madeMap(): Promise<FakeMap> {
	await expect.poll(() => fakeMaps.made.length).toBeGreaterThan(0);
	return fakeMaps.last;
}

const region = (code: string) => ({ place: { kind: "region" as const, type: "county", code } });

test("idle shows Choose a place and opens the picker", async () => {
	// No Where and nothing ticked or searched: nothing to draw.
	const widget = mapWidget({ monitorTypes: [] });
	const screen = await show(widget);
	const button = screen.getByRole("button", { name: m.widget_state_choose_place() });
	await expect.element(button).toBeVisible();
	await button.click();
	expect(openPlacePicker).toHaveBeenCalledWith({ widgetId: widget.id });
});

test("a Map with no layers (None and nothing else) shows its empty state, loading nothing", async () => {
	const widget = mapWidget(region("019"));
	widget.data.layers = [];
	const screen = await show(widget);
	await expect
		.element(screen.getByRole("button", { name: m.widget_state_choose_place() }))
		.toBeVisible();
	expect(fakeMaps.made).toHaveLength(0);
	expect(getMonitors).not.toHaveBeenCalled();
});

test("an idle map creates no map and loads nothing", async () => {
	const screen = await show(mapWidget({ monitorTypes: [] }));
	await expect
		.element(screen.getByRole("button", { name: m.widget_state_choose_place() }))
		.toBeVisible();
	await new Promise((r) => setTimeout(r, 100));
	expect(fakeMaps.made).toHaveLength(0);
	expect(getMonitors).not.toHaveBeenCalled();
	expect(nowClient.entries()).toEqual([]);
});

/** What a map's focus area shows now. */
const focusOf = (map: FakeMap) =>
	(map.plugins.find((p) => p.id === "focus") as unknown as { focus: Record<string, unknown> })
		?.focus;

test("one region is the focus area, and fits", async () => {
	await show(mapWidget(region("019")));
	const map = await madeMap();
	await expect.poll(() => map.plugins.map((p) => p.id)).toEqual(["focus", "monitors"]);
	await expect.poll(() => focusOf(map).geometry).toEqual(SHAPES["county:019"].geometry);
	// No outline, pin or DOM pin label of spec 1's.
	expect(map.plugins.map((p) => p.id)).not.toContain("places");
	expect(map.plugins.map((p) => p.id)).not.toContain("pin");
	expect(document.querySelector("[data-pin-label]")).toBeNull();
	expect(map.cameraCalls).toEqual([]);
	map.ready = true;
	await expect
		.poll(() => map.cameraCalls)
		.toEqual([
			{
				kind: "fitBounds",
				bounds: { west: 0, south: 0, east: 1, north: 1 },
				options: { padding: 32 }
			}
		]);
});

test("a point fits its region and focuses the point, labeled for owner and shared viewer", async () => {
	const point = { place: { kind: "point" as const, lat: 36.7, lon: -119.8 } };
	const owner = await show(mapWidget(point));
	let map = await madeMap();
	await expect
		.poll(() => focusOf(map))
		.toEqual({
			geometry: { type: "Point", coordinates: [-119.8, 36.7] },
			label: m.map_pin_your_location()
		});
	map.ready = true;
	await expect
		.poll(() => map.cameraCalls)
		.toEqual([
			{
				kind: "fitBounds",
				bounds: { west: 2, south: 2, east: 3, north: 3 },
				options: { padding: 32 }
			}
		]);
	await owner.unmount();
	expect(map.destroyed).toBe(true);

	fakeMaps.reset();
	await show(mapWidget(point), "shared");
	map = await madeMap();
	await expect.poll(() => focusOf(map).label).toBe(m.map_pin_shared_location());
});

test("a school's focus point is labeled with its name", async () => {
	await show(mapWidget({ place: { kind: "location", source: "schools", code: "s1" } }));
	const map = await madeMap();
	await expect
		.poll(() => focusOf(map))
		.toEqual({
			geometry: { type: "Point", coordinates: [-119.8, 36.7] },
			label: "Roosevelt High School"
		});
});

test("several regions are one MultiPolygon focus area", async () => {
	await show(mapWidget({ selection: { kind: "regions", ids: ["county:019", "county:029"] } }));
	const map = await madeMap();
	await expect.poll(() => (focusOf(map).geometry as { type: string })?.type).toBe("MultiPolygon");
});

test("monitor places get no focus area", async () => {
	await show(mapWidget({ monitors: ["a"], monitorTypes: [] }));
	const map = await madeMap();
	await expect.poll(() => map.plugins.map((p) => p.id)).toEqual(["focus", "monitors"]);
	expect(focusOf(map).geometry).toBeNull();
});

test("the monitors plugin's selection is the marks, not the places", async () => {
	await show(mapWidget({ monitors: ["a", "b"], monitorTypes: [] }));
	const map = await madeMap();
	await expect.poll(() => map.plugins.find((p) => p.id === "monitors")).toBeTruthy();
	const monitors = map.plugins.find((p) => p.id === "monitors")!;
	expect(monitors.options).toMatchObject({ layerLabel: "PM2.5" });
	expect(monitors.addOptions).toMatchObject({
		selectionMode: "multiple",
		pickWith: "modifier",
		selection: null
	});
	expect(map.getSelection("monitors")).toBeNull();
	expect(map.selectionCalls).toEqual([]);
});

test("fits once the monitors are loaded", async () => {
	let load: (value: unknown) => void = () => {};
	vi.mocked(getMonitors).mockReturnValue(new Promise((r) => (load = r)) as never);
	await show(mapWidget({ monitors: ["a", "b", "gone"], monitorTypes: [] }));
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => vi.mocked(getMonitors).mock.calls.length).toBe(1);
	// Nothing known to fit yet: the map stays on the Valley's view.
	await new Promise((r) => setTimeout(r, 50));
	expect(map.cameraCalls).toEqual([]);
	load([reading("a", -120, 36), reading("b", -119, 37), reading("c", -100, 30)]);
	await expect
		.poll(() => map.cameraCalls)
		.toEqual([
			{
				kind: "fitBounds",
				bounds: { west: -120, south: 36, east: -119, north: 37 },
				options: { padding: 32 }
			}
		]);
});

test("refits to the current layer after re-attach", async () => {
	const widget = mapWidget(region("019"));
	const screen = await show(widget);
	const map = await madeMap();
	await expect.poll(() => map.view.active).toBe(true);
	map.ready = true;
	await expect.poll(() => map.cameraCalls).toHaveLength(1);
	// Detached (off-screen), the layer changes; nothing moves until the map is back.
	map.attached = false;
	map.ready = false;
	await screen.rerender({ widget: { ...widget, data: mapWidget(region("029")).data } });
	await expect.poll(() => focusOf(map).geometry).toEqual(SHAPES["county:029"].geometry);
	expect(map.cameraCalls).toHaveLength(1);
	map.ready = true;
	await expect.poll(() => map.cameraCalls).toHaveLength(2);
	expect(map.cameraCalls[1]).toEqual({
		kind: "fitBounds",
		bounds: { west: 5, south: 5, east: 6, north: 6 },
		options: { padding: 32 }
	});
	expect(fakeMaps.made).toHaveLength(1);
});

test("a style reload doesn't refit (the person's pan stays)", async () => {
	await show(mapWidget(region("019")));
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => map.cameraCalls).toHaveLength(1);
	// Still attached: a basemap or theme change reloads the style.
	map.ready = false;
	await new Promise((r) => setTimeout(r, 20));
	map.ready = true;
	await new Promise((r) => setTimeout(r, 100));
	expect(map.cameraCalls).toHaveLength(1);
});

test("refits when entering fullscreen", async () => {
	const widget = mapWidget(region("019"));
	const screen = await show(widget);
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => map.cameraCalls).toHaveLength(1);
	const fit = map.cameraCalls[0];
	await screen.rerender({ widget, fullscreen: true });
	await expect.poll(() => map.cameraCalls).toHaveLength(2);
	expect(map.cameraCalls[1]).toEqual(fit);
	// And again on leaving it.
	await screen.rerender({ widget, fullscreen: false });
	await expect.poll(() => map.cameraCalls).toHaveLength(3);
	expect(map.cameraCalls[2]).toEqual(fit);
	expect(fakeMaps.made).toHaveLength(1);
});

test("title for one place and several", async () => {
	const one = mapWidget(region("019"));
	const first = await show(one);
	await expect.poll(() => generatedTitle(one.id)).toBe("PM2.5 · Fresno County");
	const map = await madeMap();
	await expect.poll(() => map.view.label).toBe(m.map_label({ title: "PM2.5 · Fresno County" }));
	await first.unmount();

	const point = mapWidget({ place: { kind: "point", lat: 36.7, lon: -119.8 } });
	const shared = await show(point, "shared");
	await expect.poll(() => generatedTitle(point.id)).toBe("PM2.5 · ZIP 93721 (shared location)");
	await shared.unmount();

	const several = mapWidget({
		selection: { kind: "regions", ids: ["county:019", "county:029", "county:107"] }
	});
	await show(several);
	await expect.poll(() => generatedTitle(several.id)).toBe("PM2.5 · 3 places");
});

test("shows unavailable with no key", async () => {
	vi.mocked(mapConfig).mockReturnValue(null);
	const screen = await show(mapWidget(region("019")));
	await expect.element(screen.getByText(m.map_unavailable_no_key())).toBeVisible();
	expect(fakeMaps.made).toHaveLength(0);
});

test("shows the error state when the map fails to create", async () => {
	fakeMaps.fail = true;
	const screen = await show(mapWidget(region("019")));
	await expect.element(screen.getByText(m.widget_state_error())).toBeVisible();
	expect(fakeMaps.made).toHaveLength(0);
	await screen.getByRole("button", { name: m.widget_state_retry() }).click();
	const map = await madeMap();
	await expect.poll(() => frame.querySelector(`[data-fake-map="${map.uid}"]`)).toBeTruthy();
});

test("shows the error state when the map can't get WebGL", async () => {
	fakeMaps.failView = true;
	const screen = await show(mapWidget(region("019")));
	await expect.element(screen.getByText(m.widget_state_error())).toBeVisible();
	const first = fakeMaps.last;
	await screen.getByRole("button", { name: m.widget_state_retry() }).click();
	await expect.poll(() => fakeMaps.made).toHaveLength(2);
	expect(first.destroyed).toBe(true);
	await expect
		.poll(() => frame.querySelector(`[data-fake-map="${fakeMaps.last.uid}"]`))
		.toBeTruthy();
});

test("a lost WebGL context shows the error state, and Retry makes a new map", async () => {
	const screen = await show(mapWidget(region("019")));
	const map = await madeMap();
	const gl = new FakeGl();
	map.gl = gl;
	await expect.poll(() => gl.listeners.get("webglcontextlost")?.size).toBe(1);
	gl.fire("webglcontextlost");
	await expect.element(screen.getByText(m.widget_state_error())).toBeVisible();
	await screen.getByRole("button", { name: m.widget_state_retry() }).click();
	await expect.poll(() => fakeMaps.made).toHaveLength(2);
	expect(map.destroyed).toBe(true);
});

test("an off-screen map stays detached", async () => {
	frame.style.position = "absolute";
	frame.style.top = "5000px";
	await show(mapWidget(region("019")));
	const map = await madeMap();
	await expect.poll(() => map.view.active).toBe(false);
	await new Promise((r) => setTimeout(r, 100));
	expect(map.view.active).toBe(false);
});

test("an entry type the map doesn't offer is unavailable, with no map", async () => {
	const screen = await show(mapWidget({ entryType: "pm100", ...region("019") }));
	await expect
		.element(screen.getByText(m.widget_state_unavailable_unknown_entry_type()))
		.toBeVisible();
	expect(fakeMaps.made).toHaveLength(0);
});

test("an older Map with several pollutants draws the first; a saved showing is ignored", async () => {
	const widget = mapWidget(region("019"));
	widget.data.layers = [
		{ ...widget.data.layers[0], entryType: "o3" },
		{ dataset: "air-quality", entryType: "pm25" }
	];
	widget.options = { showing: "pm25" };
	const screen = await showLive(widget);
	await madeMap();
	await expect.poll(() => vi.mocked(getMonitors).mock.calls.length).toBeGreaterThan(0);
	expect(vi.mocked(getMonitors).mock.calls.map((c) => c[0])).toEqual(
		expect.arrayContaining(["o3"])
	);
	expect(vi.mocked(getMonitors).mock.calls.map((c) => c[0])).not.toContain("pm25");
	expect(screen.getByText(m.widget_state_unavailable_unknown_entry_type()).query()).toBeNull();
});

test("a failed pollutant list shows Try again, and retrying recovers", async () => {
	const mapPollutants = vi
		.fn<() => Promise<string[] | "unavailable">>()
		.mockResolvedValueOnce("unavailable")
		.mockResolvedValue(["o3", "pm25"]);
	const { getMetadata } = await import("$lib/data");
	vi.mocked(getMetadata).mockReturnValue(fixtureMetadata({ mapPollutants }));
	const screen = await show(mapWidget(region("019")));
	await expect.element(screen.getByText(m.widget_state_error())).toBeVisible();
	expect(fakeMaps.made).toHaveLength(0);
	await screen.getByRole("button", { name: m.widget_state_retry() }).click();
	await madeMap();
	expect(mapPollutants).toHaveBeenCalledTimes(2);
	await expect.poll(() => screen.getByText(m.widget_state_error()).query()).toBeNull();
});

test("a failed monitors load shows the error, and Retry loads them again", async () => {
	vi.mocked(getMonitors)
		.mockRejectedValueOnce(new Error("offline"))
		.mockResolvedValue([reading("a")] as never);
	const screen = await show(mapWidget(region("019")));
	await expect.element(screen.getByText(m.widget_state_error())).toBeVisible();
	await screen.getByRole("button", { name: m.widget_state_retry() }).click();
	await expect.poll(() => screen.getByText(m.widget_state_error()).query()).toBeNull();
	expect(getMonitors).toHaveBeenCalledTimes(2);
	await expect.poll(() => drawn(fakeMaps.last)).toEqual(["a"]);
});

test("a monitor the server doesn't list is no longer available, and the map still draws", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a", -120, 36)] as never);
	const screen = await show(mapWidget({ monitors: ["gone"], monitorTypes: [] }));
	const map = await madeMap();
	await expect.element(screen.getByText(m.widget_state_gone_title())).toBeVisible();
	expect(frame.querySelector(`[data-fake-map="${map.uid}"]`)).toBeTruthy();
	// A compact banner at the top: clicks pass through to the map, but for its buttons.
	const banner = frame.querySelector<HTMLElement>("[data-map-note]")!;
	expect(getComputedStyle(banner.firstElementChild!).pointerEvents).toBe("none");
	expect(banner.getBoundingClientRect().height).toBeLessThan(frame.clientHeight / 2);
	const button = banner.querySelector("button")!;
	expect(getComputedStyle(button).pointerEvents).toBe("auto");
});

test("a failed place lookup shows the error, and a retry looks it up again", async () => {
	vi.mocked(regionShapes).mockRejectedValueOnce(new Error("offline"));
	const screen = await show(mapWidget(region("019")));
	await expect.element(screen.getByText(m.widget_state_error())).toBeVisible();
	await screen.getByRole("button", { name: m.widget_state_retry() }).click();
	const map = await madeMap();
	await expect.poll(() => focusOf(map)?.geometry).toEqual(SHAPES["county:019"].geometry);
	await expect.poll(() => screen.getByText(m.widget_state_error()).query()).toBeNull();
});

test("the legend sits in the widget's card, and collapses on a narrow widget", async () => {
	const screen = await show(mapWidget(region("019")));
	const map = await madeMap();
	map.ready = true;
	await expect
		.poll(() => frame.querySelector("[data-legend]")?.getAttribute("data-framed"))
		.toBe("false");
	frame.style.width = "320px";
	const toggle = screen.getByRole("button", { name: m.map_legend_toggle() });
	await expect.element(toggle).toBeVisible();
	await expect.poll(() => frame.querySelector("[data-legend]")).toBeNull();
	await toggle.click();
	await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
	expect(frame.querySelector("[data-legend]")).toBeTruthy();
});

test("passes axe in light and dark", async () => {
	await show(mapWidget(region("019")));
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => frame.querySelector("[data-legend]")).toBeTruthy();
	for (const theme of ["light", "dark"]) {
		document.documentElement.setAttribute("data-theme", theme);
		const results = await axe.run(frame);
		expect(results.violations).toEqual([]);
	}
});

test("a click pins the card and never selects", async () => {
	const widget = mapWidget({ monitors: ["a"], monitorTypes: [] });
	await show(widget);
	const map = await madeMap();
	await expect.poll(() => map.view.card).toEqual({ actions: expect.any(Function) });
	await expect.poll(() => map.plugins.find((p) => p.id === "monitors")).toBeTruthy();
	// Marks take a modifier: a plain click only pins.
	expect(map.plugins.find((p) => p.id === "monitors")!.addOptions).toMatchObject({
		pickWith: "modifier"
	});
	map.ready = true;
	await new Promise((r) => setTimeout(r, 50));
	const calls = map.selectionCalls.length;
	const before = JSON.parse(JSON.stringify(app().current!.session!.doc.body));
	frame.querySelector<HTMLElement>(`[data-fake-map="${map.uid}"]`)!.click();
	await expect.poll(() => map.pinned?.hit.refKey).toBe("monitor:a");
	await new Promise((r) => setTimeout(r, 100));
	expect(map.selectionCalls).toHaveLength(calls);
	expect(app().current!.session!.doc.body).toEqual(before);
});

/** A spec 2 Map's data: these pollutant layers (at the first's Where), and smoke and fire. */
function layers(at: LayerAt, more: Partial<Layer>[] = [], smokeAndFire = false) {
	const { place, selection, ...first } = at;
	return {
		...(place ? { place } : {}),
		...(selection ? { selection } : {}),
		layers: [
			{ dataset: "air-quality", entryType: "pm25", monitorTypes: [...EVERY_TYPE], ...first },
			...more.map((l) => ({ dataset: "air-quality", ...l })),
			...(smokeAndFire ? [{ dataset: "hms-smoke" }, { dataset: "hms-fire" }] : [])
		]
	} as WidgetInstance["data"];
}

test("draws only the region's monitors", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("in1"), reading("in2")] as never);
	await show(mapWidget(region("6phe")));
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["in1", "in2"]);
	// Scoped by the server: the region's id, for the Map's pollutant.
	expect(getMonitors).toHaveBeenCalledWith(
		"pm25",
		{ timestamp: expect.any(Date), region: ["r6phe"] },
		expect.anything()
	);
	const monitors = map.plugins.find((p) => p.id === "monitors")!;
	expect(monitors.options).toMatchObject({ layerLabel: "PM2.5", selectedStyle: "ring" });
	expect((monitors.options.source as { scale: unknown }).scale).toEqual({
		dataset: "air-quality",
		entryType: "pm25"
	});
});

test("draws exactly the hand-picked monitors", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a"), reading("b"), reading("c")] as never);
	await show(mapWidget({ monitors: ["a", "c"], monitorTypes: [] }));
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["a", "c"]);
	// The current list for the Valley, with no region.
	expect(getMonitors).toHaveBeenCalledWith("pm25", undefined, expect.anything());
});

test("draws a school's region's monitors", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("z1")] as never);
	await show(mapWidget({ place: { kind: "location", source: "schools", code: "s1" } }));
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["z1"]);
	expect(getMonitors).toHaveBeenCalledWith(
		"pm25",
		{ timestamp: expect.any(Date), region: ["z93721"] },
		expect.anything()
	);
});

test("draws a spec 1 ozone tile as ozone", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("o")] as never);
	const widget = mapWidget({ entryType: "o3", ...region("019") });
	await show(widget);
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["o"]);
	expect(vi.mocked(getMonitors).mock.calls.map((c) => c[0])).toEqual(["o3"]);
	const monitors = map.plugins.find((p) => p.id === "monitors")!;
	expect(monitors.options).toMatchObject({ layerLabel: "Ozone" });
	expect((monitors.options.source as { scale: unknown }).scale).toEqual({
		dataset: "air-quality",
		entryType: "o3"
	});
	await expect.poll(() => generatedTitle(widget.id)).toBe("Ozone · Fresno County");
});

test("draws the Map's pollutant, and switches when it changes", async () => {
	vi.mocked(getMonitors).mockImplementation(async (type) => [reading(String(type))] as never);
	const widget: WidgetInstance = {
		...mapWidget({}),
		data: layers({ ...region("019"), entryType: "o3" })
	};
	const screen = await show(widget);
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["o3"]);
	expect(map.plugins.find((p) => p.id === "monitors")!.options).toMatchObject({
		layerLabel: "Ozone"
	});
	await screen.rerender({ widget: { ...widget, data: layers(region("019")) } });
	await expect.poll(() => drawn(map)).toEqual(["pm25"]);
	expect(map.plugins.find((p) => p.id === "monitors")!.options).toMatchObject({
		layerLabel: "PM2.5"
	});
});

test("draws smoke and fire when on, and none when off", async () => {
	vi.mocked(getHMSSmoke).mockResolvedValue([
		{ id: "s1", density: "heavy", geometry: { type: "Polygon", coordinates: [] } }
	] as never);
	vi.mocked(getHMSFire).mockResolvedValue([
		{
			id: "f1",
			frp: 10,
			timestamp: "2026-11-12T10:00:00Z",
			geometry: { type: "Point", coordinates: [-119, 36] }
		}
	] as never);
	const widget: WidgetInstance = { ...mapWidget({}), data: layers(region("019"), [], true) };
	const screen = await show(widget);
	const map = await madeMap();
	await expect
		.poll(() => map.plugins.map((p) => p.id))
		.toEqual(["focus", "hms-smoke", "hms-fire", "monitors"]);
	const smoke = map.plugins.find((p) => p.id === "hms-smoke")!.options;
	const fire = map.plugins.find((p) => p.id === "hms-fire")!.options;
	expect(smoke).toMatchObject({ layerLabel: "Wildfire Smoke" });
	expect(fire).toMatchObject({ layerLabel: "Fire Detections" });
	type Src = { features: { features: unknown[] } | null; scale: unknown };
	await expect.poll(() => (smoke.source as Src).features?.features).toHaveLength(1);
	expect((smoke.source as Src).scale).toEqual({ dataset: "hms-smoke", entryType: "smoke-density" });
	expect((fire.source as Src).features?.features).toHaveLength(1);
	expect((fire.hotspots as Src).features?.features).toHaveLength(1);
	// Never limited by the places: today's, for the whole map.
	expect(getHMSSmoke).toHaveBeenCalledWith(undefined, expect.anything());

	await screen.rerender({ widget: { ...widget, data: layers(region("019")) } });
	await expect.poll(() => map.plugins.map((p) => p.id)).toEqual(["focus", "monitors"]);
	expect(nowClient.entries().find((e) => e.key.startsWith("map-hms"))?.subscribers ?? 0).toBe(0);
});

test("loads no smoke or fire when off", async () => {
	await show(mapWidget(region("019")));
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual([]);
	expect(getHMSSmoke).not.toHaveBeenCalled();
	expect(getHMSFire).not.toHaveBeenCalled();
});

test("on a day stop, the no-monitors note speaks of the day, not now", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([] as never);
	dailyFigures({ "2026-09-09": {} });
	const screen = await show(rangedMap(region("019")));
	await madeMap();
	await expect.element(screen.getByText(m.map_no_monitors_here_day())).toBeVisible();
	expect(screen.getByText(m.map_no_monitors_here()).query()).toBeNull();
});

test("shows a note, not an error, when the places hold no monitors", async () => {
	vi.mocked(getMonitors).mockResolvedValue([] as never);
	const screen = await show(mapWidget(region("019")));
	const map = await madeMap();
	await expect.element(screen.getByText(m.map_no_monitors_here())).toBeVisible();
	expect(screen.getByText(m.widget_state_error()).query()).toBeNull();
	expect(frame.querySelector(`[data-fake-map="${map.uid}"]`)).toBeTruthy();
	expect(frame.querySelector("[data-map-note]")).toBeTruthy();
});

test("keeps the monitors when smoke and fire fail, with a note", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	vi.mocked(getHMSSmoke).mockRejectedValueOnce(new Error("offline"));
	const widget: WidgetInstance = { ...mapWidget({}), data: layers(region("019"), [], true) };
	const screen = await show(widget);
	const map = await madeMap();
	await expect.element(screen.getByText(m.map_smoke_fire_failed())).toBeVisible();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	expect(screen.getByText(m.widget_state_error()).query()).toBeNull();
	// map-sdk sees no error, so its legend offers no second Retry: only the note's.
	const smoke = map.plugins.find((p) => p.id === "hms-smoke")!.options;
	const fire = map.plugins.find((p) => p.id === "hms-fire")!.options;
	expect((smoke.source as { status: unknown }).status).toEqual({ state: "ready" });
	expect((fire.source as { status: unknown }).status).toEqual({ state: "ready" });
	expect((fire.hotspots as { status: unknown }).status).toEqual({ state: "ready" });
	const retries = [...frame.querySelectorAll("button")].filter(
		(b) => b.textContent?.trim() === m.widget_state_retry()
	);
	expect(retries).toHaveLength(1);
	// Its Retry loads smoke and fire again.
	await frame.querySelector<HTMLElement>("[data-map-note] button")!.click();
	await expect.poll(() => screen.getByText(m.map_smoke_fire_failed()).query()).toBeNull();
	expect(getHMSSmoke).toHaveBeenCalledTimes(2);
});

test("a place that can't be scoped shows its reason over the map", async () => {
	vi.mocked(getResolvers).mockReturnValue({
		locations: { resolve: async () => null },
		regions: { resolve: async () => null }
	} as never);
	const screen = await show(mapWidget(region("019")));
	await madeMap();
	await expect.element(screen.getByText(m.widget_state_gone_title())).toBeVisible();
	expect(getMonitors).not.toHaveBeenCalled();
});

test("stops polling while off screen", async () => {
	frame.style.position = "absolute";
	frame.style.top = "5000px";
	await show(mapWidget(region("019")));
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual([]);
	const monitors = () => nowClient.entries().find((e) => e.key.startsWith("map-monitors"));
	expect(monitors()?.resolution).toBe("raw");
	await expect.poll(() => monitors()?.polling).toBe(false);
	frame.style.top = "0px";
	await expect.poll(() => map.view.active).toBe(true);
	await expect.poll(() => monitors()?.polling).toBe(true);
});

/** Region resolves that wait while `held` is set, until `release()`; `calls` counts them. */
function holdableRegions() {
	const gate = { held: false, calls: 0, release: () => {} };
	vi.mocked(getResolvers).mockReturnValue({
		locations: { resolve: async () => null },
		regions: {
			resolve: async (_type: string, code: string) => {
				gate.calls++;
				if (gate.held) await new Promise<void>((r) => (gate.release = r));
				return { id: `r${code}`, name: code };
			}
		}
	} as never);
	return gate;
}

type Watched = { features: { features: unknown[] } | null; status: unknown };
const monitorsSourceOf = (map: FakeMap) =>
	map.plugins.find((p) => p.id === "monitors")?.options.source as Watched | undefined;

test("a pollutant switch draws none of the old readings while the new scope resolves", async () => {
	vi.mocked(getMonitors).mockImplementation(async (type) => [reading(String(type))] as never);
	const gate = holdableRegions();
	const widget: WidgetInstance = { ...mapWidget({}), data: layers(region("019")) };
	const screen = await show(widget);
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["pm25"]);
	gate.held = true;
	const before = gate.calls;
	await screen.rerender({
		widget: { ...widget, data: layers({ ...region("019"), entryType: "o3" }) }
	});
	await expect.poll(() => gate.calls).toBeGreaterThan(before);
	await expect
		.poll(() => map.plugins.find((p) => p.id === "monitors")?.options.layerLabel)
		.toBe("Ozone");
	// Under the new label: no PM2.5 readings drawn, listed or fitted to.
	expect(drawn(map)).toBeUndefined();
	expect(monitorsSourceOf(map)?.status).toEqual({ state: "loading" });
	gate.release();
	await expect.poll(() => drawn(map)).toEqual(["o3"]);
});

test("a place change draws none of the old places' readings while the new scope resolves", async () => {
	vi.mocked(getMonitors).mockImplementation(
		async (_type, options) =>
			(options?.region?.[0] === "r019" ? [] : [reading(String(options?.region?.[0]))]) as never
	);
	const gate = holdableRegions();
	const widget = mapWidget(region("019"));
	const screen = await show(widget);
	const map = await madeMap();
	// The first places hold no monitors: the note says so.
	await expect.element(screen.getByText(m.map_no_monitors_here())).toBeVisible();
	gate.held = true;
	const before = gate.calls;
	await screen.rerender({ widget: { ...widget, data: mapWidget(region("029")).data } });
	await expect.poll(() => gate.calls).toBeGreaterThan(before);
	// The old scope's note and readings don't stand for the new places.
	await expect.poll(() => screen.getByText(m.map_no_monitors_here()).query()).toBeNull();
	expect(drawn(map)).toBeUndefined();
	expect(frame.querySelector("[data-map-note]")).toBeNull();
	gate.release();
	await expect.poll(() => drawn(map)).toEqual(["r029"]);
});

test("a failed refresh keeps the earlier readings, with a note and Retry", async () => {
	vi.mocked(getMonitors)
		.mockResolvedValueOnce([reading("a")] as never)
		.mockRejectedValueOnce(new Error("offline"))
		.mockResolvedValue([reading("b")] as never);
	const screen = await show(mapWidget(region("019")));
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	const key = nowClient.entries().find((e) => e.key.startsWith("map-monitors"))!.key;
	nowClient.refetch(key);
	await expect.element(screen.getByText(m.map_refresh_failed())).toBeVisible();
	expect(drawn(map)).toEqual(["a"]);
	// map-sdk sees the held readings as ready: its legend offers no second Retry.
	expect(monitorsSourceOf(map)?.status).toEqual({ state: "ready" });
	expect(screen.getByText(m.widget_state_error()).query()).toBeNull();
	await frame.querySelector<HTMLElement>("[data-map-refresh-note] button")!.click();
	await expect.poll(() => drawn(map)).toEqual(["b"]);
	expect(screen.getByText(m.map_refresh_failed()).query()).toBeNull();
});

/** The marks the current session's document holds for its first widget. */
const marksOf = () => mapOptions(app().current.session!.doc.body.widgets[0]).marks;
/** Pins `refKey`'s card, as a click or a feature-list row does. */
function pin(map: FakeMap, refKey: string, pluginId = "monitors") {
	map.pinned = { hit: { pluginId, refKey, name: refKey } };
}
const monitor = (id: string) => ({ kind: "monitor" as const, id });
const hiddenNote = () => frame.querySelector("[data-map-marks-hidden]")?.textContent?.trim();

test("marks from the card's Select and unmarks with Remove, undoable", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a"), reading("b")] as never);
	const screen = await showLive(mapWidget(region("019")));
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	pin(map, "monitor:a");
	await screen.getByRole("button", { name: m.map_mark_select() }).click();
	await expect.poll(marksOf).toEqual(["a"]);
	const remove = screen.getByRole("button", { name: m.map_mark_remove() });
	await expect.element(remove).toBeVisible();

	// Undo and redo set the map's selection (which fires nothing).
	const session = app().current.session!;
	session.undo();
	expect(marksOf()).toBeUndefined();
	await expect.poll(() => map.selectionCalls.at(-1)).toEqual(["monitors", null]);
	await expect.element(screen.getByRole("button", { name: m.map_mark_select() })).toBeVisible();
	session.redo();
	await expect
		.poll(() => map.selectionCalls.at(-1))
		.toEqual(["monitors", { kind: "monitors", ids: ["a"] }]);
	await screen.getByRole("button", { name: m.map_mark_remove() }).click();
	await expect.poll(marksOf).toBeUndefined();
	session.undo();
	expect(marksOf()).toEqual(["a"]);
});

test("marks with Shift-click and with Shift+Enter in the feature list", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a"), reading("b")] as never);
	await showLive(mapWidget(region("019")));
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	map.shiftClick("monitors", monitor("a"));
	await expect.poll(marksOf).toEqual(["a"]);
	map.listShiftEnter("monitors", monitor("b"));
	await expect.poll(marksOf).toEqual(["a", "b"]);
	// One undo step each.
	app().current.session!.undo();
	expect(marksOf()).toEqual(["a"]);
	await expect.poll(() => map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["a"] });
	map.shiftClick("monitors", monitor("a"));
	await expect.poll(marksOf).toBeUndefined();
});

test("refuses a 26th mark with the limit message, counting hidden marks", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const marks = Array.from({ length: 25 }, (_, i) => `m${i}`);
	await showLive({ ...mapWidget(region("019")), options: { marks } });
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: marks });
	map.shiftClick("monitors", monitor("a"));
	const limit = m.map_marks_limit({ count: "25", countValue: 25 });
	await expect.poll(() => map.notice?.message).toBe(limit);
	expect(marksOf()).toEqual(marks);
});

/** Metadata that lists monitors "a" (PurpleAir, PM2.5 only), "b" (AirNow, reports ozone) and "c" (AirNow). */
async function listedMonitors(): Promise<void> {
	const { getMetadata } = await import("$lib/data");
	const types = (type: string, published: string[]) => ({
		type,
		label: type,
		entryTypes: published,
		group: null,
		published
	});
	vi.mocked(getMetadata).mockReturnValue(
		fixtureMetadata({
			catalog: async () => CATALOG,
			monitors: async () =>
				[
					{ id: "a", type: "purpleair" },
					{ id: "b", type: "airnow" },
					{ id: "c", type: "airnow" }
				].map((x) => ({ ...x, name: x.id, county: "Fresno", active: true, inside: false })),
			monitorTypes: async () => [types("purpleair", ["pm25"]), types("airnow", ["pm25", "o3"])]
		})
	);
}

const hiddenLines = () =>
	[...frame.querySelectorAll("[data-map-marks-hidden] > span")].map((e) => e.textContent?.trim());
const reasonLine = (reason: "pollutant" | "options" | "places" | "unknown", n = 1) =>
	m.map_marks_hidden({ reason, pollutant: "Ozone", count: String(n), countValue: n });

test("keeps marks when the pollutant changes, and counts the hidden ones", async () => {
	await listedMonitors();
	vi.mocked(getMonitors).mockImplementation(
		async (type) => (type === "o3" ? [reading("b")] : [reading("a"), reading("b")]) as never
	);
	const widget: WidgetInstance = {
		...mapWidget({}),
		data: layers(region("019")),
		options: { marks: ["a", "b"] }
	};
	await showLive(widget);
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	expect(hiddenNote()).toBe("");
	const session = app().current.session!;
	const current = () => session.doc.body.widgets[0];
	session.apply({
		op: "setWidgetData",
		target: { widgetId: widget.id },
		from: current().data,
		to: layers({ ...region("019"), entryType: "o3" })
	});
	await expect.poll(() => drawn(map)).toEqual(["b"]);
	await expect.poll(hiddenNote).toBe(reasonLine("pollutant"));
	expect(frame.querySelector("[data-map-marks-hidden]")!.getAttribute("role")).toBe("status");
	await expect
		.poll(() => map.view.label)
		.toBe(
			m.map_label_marks_hidden({ title: "Ozone · Fresno County", notes: reasonLine("pollutant") })
		);
	expect(marksOf()).toEqual(["a", "b"]);
	expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["a", "b"] });
	session.undo();
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	await expect.poll(hiddenNote).toBe("");
});

test("gives each reason its own line, in order, in the list note and the map's name", async () => {
	await listedMonitors();
	vi.mocked(getMonitors).mockImplementation(
		async (type) => (type === "o3" ? [reading("b")] : [reading("a"), reading("b")]) as never
	);
	const widget: WidgetInstance = {
		...mapWidget({}),
		data: layers({ ...region("019"), entryType: "o3" }),
		options: { marks: ["a", "c", "zz"] }
	};
	await showLive(widget);
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["b"]);
	const lines = [reasonLine("pollutant"), reasonLine("places"), reasonLine("unknown")];
	await expect.poll(hiddenLines).toEqual(lines);
	const notes = m.sentence_join({
		first: m.sentence_join({ first: lines[0], second: lines[1] }),
		second: lines[2]
	});
	await expect
		.poll(() => map.view.label)
		.toBe(m.map_label_marks_hidden({ title: "Ozone · Fresno County", notes }));
	expect((map.view.featureList as { note?: string }).note).toBe(notes);
});

/** Metadata whose monitors lookup the test settles itself. */
async function lookupMetadata() {
	const { getMetadata } = await import("$lib/data");
	let resolve!: (list: unknown[]) => void;
	let reject!: (error: Error) => void;
	const pending = new Promise<unknown[]>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	vi.mocked(getMetadata).mockReturnValue(
		fixtureMetadata({
			catalog: async () => CATALOG,
			monitors: () => pending as never,
			monitorTypes: async () => []
		})
	);
	return { resolve, reject };
}

test("holds the hidden-marks note until the monitors lookup settles", async () => {
	const lookup = await lookupMetadata();
	vi.mocked(getMonitors).mockResolvedValue([reading("b")] as never);
	await showLive({ ...mapWidget(region("019")), options: { marks: ["a"] } });
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["b"]);
	expect(hiddenNote()).toBe("");
	lookup.resolve([
		{ id: "a", type: "purpleair", name: "a", county: "Fresno", active: true, inside: false }
	]);
	await expect.poll(hiddenNote).not.toBe("");
});

test("says the marks aren't shown when the monitors lookup fails", async () => {
	const lookup = await lookupMetadata();
	vi.mocked(getMonitors).mockResolvedValue([reading("b")] as never);
	await showLive({ ...mapWidget(region("019")), options: { marks: ["a"] } });
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["b"]);
	expect(hiddenNote()).toBe("");
	lookup.reject(new Error("down"));
	await expect.poll(hiddenNote).toBe(reasonLine("unknown"));
});

test("keeps marks when the places change, and undo shows them again", async () => {
	vi.mocked(getMonitors).mockImplementation(
		async (_type, options) =>
			(options?.region?.[0] === "r019" ? [reading("a"), reading("b")] : [reading("c")]) as never
	);
	await listedMonitors();
	const widget = { ...mapWidget(region("019")), options: { marks: ["a"] } };
	await showLive(widget);
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	const session = app().current.session!;
	session.apply({
		op: "setWidgetData",
		target: { widgetId: widget.id },
		from: session.doc.body.widgets[0].data,
		to: mapWidget(region("029")).data
	});
	await expect.poll(() => drawn(map)).toEqual(["c"]);
	await expect.poll(hiddenNote).toBe(reasonLine("places"));
	expect(marksOf()).toEqual(["a"]);
	expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["a"] });
	session.undo();
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	await expect.poll(hiddenNote).toBe("");
	expect(marksOf()).toEqual(["a"]);
});

test("hides Select/Remove and ignores Shift-click on a view-only dashboard", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a"), reading("b")] as never);
	const widget = { ...mapWidget(region("019")), options: { marks: ["a"] } };
	const session = await openSession(widget);
	session.readOnly = "invalid";
	const screen = await render(MapWidget, {
		target: frame,
		props: { widget },
		context: new Map<unknown, unknown>([[APP_CONTEXT_KEY, app()]])
	});
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	// The saved marks still show.
	expect(map.plugins.find((p) => p.id === "monitors")!.addOptions).toMatchObject({
		selectionMode: "none",
		selection: { kind: "monitors", ids: ["a"] }
	});
	pin(map, "monitor:b");
	await expect.poll(() => frame.querySelector("[data-fake-card]")).toBeTruthy();
	expect(screen.getByRole("button", { name: m.map_mark_select() }).query()).toBeNull();
	pin(map, "monitor:a");
	await expect.poll(() => frame.querySelector('[data-fake-card="monitor:a"]')).toBeTruthy();
	expect(screen.getByRole("button", { name: m.map_mark_remove() }).query()).toBeNull();
	map.shiftClick("monitors", monitor("b"));
	map.listShiftEnter("monitors", monitor("b"));
	await new Promise((r) => setTimeout(r, 50));
	expect(marksOf()).toEqual(["a"]);
});

test("a widget not in the session's document (a shared view) takes no marks", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	await openSession(mapWidget(region("029")));
	const shown = mapWidget(region("019"));
	await render(MapWidget, {
		target: frame,
		props: { widget: shown },
		context: new Map<unknown, unknown>([[APP_CONTEXT_KEY, app()]])
	});
	const map = await madeMap();
	await expect.poll(() => map.plugins.find((p) => p.id === "monitors")).toBeTruthy();
	expect(map.plugins.find((p) => p.id === "monitors")!.addOptions).toMatchObject({
		selectionMode: "none"
	});
});

test("hands a mark on the starter off to its copy", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const widget = mapWidget(region("019"));
	// The stored dashboard stands in for the starter's copy.
	const copy = await openSession(widget);
	const handedOff: unknown[] = [];
	const starter = new DocumentSession({
		platform,
		space: app().space,
		tabId: "t3",
		doc: { ...copy.doc, id: "starter" },
		onBeforeFirstEdit: async (change) => {
			handedOff.push(change);
			copy.apply(change!);
			app().current = { session: copy, isStarter: false };
			return copy;
		}
	});
	app().current = { session: starter, isStarter: true };
	await render(MapWidget, {
		target: frame,
		props: { widget },
		context: new Map<unknown, unknown>([[APP_CONTEXT_KEY, app()]])
	});
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	map.shiftClick("monitors", monitor("a"));
	await expect.poll(() => handedOff.length).toBe(1);
	await expect.poll(() => mapOptions(copy.doc.body.widgets[0]).marks).toEqual(["a"]);
	expect(mapOptions(starter.doc.body.widgets[0]).marks).toBeUndefined();
	expect(app().current.session).toBe(copy);
});

/** Shows `widget` in the grid's editing context (where the Map offers Show in). */
async function showEditing(widget: WidgetInstance) {
	await openSession(widget);
	return render(MapWidget, {
		target: frame,
		props: { widget },
		context: new Map<unknown, unknown>([
			[APP_CONTEXT_KEY, app()],
			[TILE_OPTIONS_KEY, editing()]
		])
	});
}

/** The Map's ⋯ menu item ids for `widget`. */
const menuIds = (widget: WidgetInstance) =>
	mapType
		.menu({ target: document.body, payload: {} }, { app: app(), widget: () => widget })
		.map((i) => i.id);
const SHOW_IN = ["map_show_in_chart", "map_show_in_table"];

describe("Show in a chart / Show in a table", () => {
	test("aren't listed with no marks", async () => {
		vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
		const widget = mapWidget(region("019"));
		await showEditing(widget);
		const map = await madeMap();
		await expect.poll(() => drawn(map)).toEqual(["a"]);
		// The entry is there (a section card's button reads it) but holds no marks.
		await expect.poll(() => mapSend(widget.id)).toMatchObject({ marks: [] });
		expect(menuIds(widget)).toEqual([]);
	});

	test("aren't listed while every mark is hidden for its pollutant or places", async () => {
		await listedMonitors();
		vi.mocked(getMonitors).mockImplementation(
			async (type) => (type === "o3" ? [reading("b")] : [reading("a"), reading("b")]) as never
		);
		// "a" (purpleair) doesn't report Ozone; "c" is outside the places.
		const widget: WidgetInstance = {
			...mapWidget({}),
			data: layers({ ...region("019"), entryType: "o3" }),
			options: { marks: ["a", "c"] }
		};
		await showEditing(widget);
		const map = await madeMap();
		await expect.poll(() => drawn(map)).toEqual(["b"]);
		await expect.poll(hiddenLines).toEqual([reasonLine("pollutant"), reasonLine("places")]);
		expect(menuIds(widget)).toEqual([]);
	});

	test("are listed with one mark drawn, the hidden ones counted as left out", async () => {
		await listedMonitors();
		vi.mocked(getMonitors).mockResolvedValue([reading("a"), reading("b")] as never);
		const widget = { ...mapWidget(region("019")), options: { marks: ["c", "a"] } };
		const screen = await showEditing(widget);
		const map = await madeMap();
		await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
		await expect.poll(() => menuIds(widget)).toEqual(SHOW_IN);
		expect(mapSend(widget.id)).toMatchObject({ marks: ["a"], leftOut: 1 });
		const draft = mapSend(widget.id)!.draft();
		// A plain snapshot: the hand-off clones it.
		expect(structuredClone(draft)).toEqual({
			type: "map",
			data: widget.data,
			options: { marks: ["c", "a"] }
		});
		// Cleared once the Map unmounts.
		screen.unmount();
		expect(mapSend(widget.id)).toBeNull();
		expect(menuIds(widget)).toEqual([]);
	});

	test("wait for the monitors lookup before listing", async () => {
		const lookup = await lookupMetadata();
		vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
		const widget = { ...mapWidget(region("019")), options: { marks: ["a"] } };
		await showEditing(widget);
		const map = await madeMap();
		await expect.poll(() => drawn(map)).toEqual(["a"]);
		// The entry is set, with no marks while the lookup is out.
		await expect.poll(() => mapSend(widget.id)).toMatchObject({ marks: [] });
		expect(menuIds(widget)).toEqual([]);
		lookup.resolve([
			{ id: "a", type: "purpleair", name: "a", county: "Fresno", active: true, inside: false }
		]);
		await expect.poll(() => menuIds(widget)).toEqual(SHOW_IN);
	});

	test("are listed for a viewer, with the Map's own draft", async () => {
		await listedMonitors();
		vi.mocked(getMonitors).mockResolvedValue([reading("b")] as never);
		const widget: WidgetInstance = {
			...mapWidget({}),
			data: layers({ ...region("019"), entryType: "o3" }),
			options: { marks: ["b"] }
		};
		const changes = new ViewerChanges();
		await showViewer(widget, changes);
		const map = await madeMap();
		map.ready = true;
		await expect.poll(() => drawn(map)).toEqual(["b"]);
		await expect.poll(() => menuIds(widget)).toEqual(SHOW_IN);
		expect(structuredClone(mapSend(widget.id)!.draft())).toEqual({
			type: "map",
			data: widget.data,
			options: { marks: ["b"] }
		});
		expect(changes.get(widget.id)).toBeUndefined();
	});

	test("aren't offered by Get data's preview", async () => {
		await listedMonitors();
		vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
		registerWidgetType(mapType);
		const widget = { ...mapWidget(region("019")), options: { marks: ["a"] } };
		await openSession(widget);
		await render(Preview, {
			target: frame,
			props: { widget, title: "Map", size: "large", gridWidth: 1200, phone: false, onsize() {} },
			context: new Map<unknown, unknown>([[APP_CONTEXT_KEY, app()]])
		});
		const map = await madeMap();
		map.ready = true;
		// Drawn: the effect that would set the entry has run (it returns at once with no tile
		// options).
		await expect.poll(() => drawn(map)).toEqual(["a"]);
		expect(mapSend(widget.id)).toBeNull();
		expect(menuIds(widget)).toEqual([]);
	});
});

test("shows no buttons on smoke, fire or the focus pin", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const screen = await showLive({ ...mapWidget({}), data: layers(region("019"), [], true) });
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	const buttons = () =>
		[
			screen.getByRole("button", { name: m.map_mark_select() }),
			screen.getByRole("button", { name: m.map_mark_remove() })
		].map((b) => b.query());
	for (const [pluginId, refKey] of [
		["hms-smoke", "feature:s1"],
		["hms-fire", "feature:f1"],
		["focus", "feature:focus"]
	]) {
		pin(map, refKey, pluginId);
		await expect.poll(() => frame.querySelector(`[data-fake-card="${refKey}"]`)).toBeTruthy();
		expect(buttons()).toEqual([null, null]);
	}
	// A monitor's card does show Select.
	pin(map, "monitor:a");
	await expect.element(screen.getByRole("button", { name: m.map_mark_select() })).toBeVisible();
});

/** The options the current session's document holds for its first widget. */
const optionsOf = () => app().current.session!.doc.body.widgets[0].options;
const pluginIds = (map: FakeMap) => map.plugins.map((p) => p.id);
/** Two monitors: "a" a PurpleAir, "b" an AirNow. */
const twoTypes = () => [reading("a"), { ...reading("b"), type: "airnow" }];

test("the toolbar offers no pollutant choice: a Map holds one", async () => {
	vi.mocked(getMonitors).mockImplementation(async (type) => [reading(String(type))] as never);
	// An older Map with two pollutants draws the first, with no Pollutant group either.
	const widget = { ...mapWidget({}), data: layers(region("019"), [{ entryType: "o3" }]) };
	const screen = await showLive(widget, editing());
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => drawn(map)).toEqual(["pm25"]);
	await expect.poll(() => fakeToolbars.last?.groups.map((g) => g.id)).toBeDefined();
	expect(fakeToolbars.last?.groups.map((g) => g.id)).not.toContain("pollutant");
	expect(screen.getByRole("radio", { name: "Ozone" }).query()).toBeNull();
	expect(optionsOf()).toBeUndefined();
});

test("Fire & Smoke off removes the smoke and fire layers, and on adds them again", async () => {
	const widget = { ...mapWidget({}), data: layers(region("019"), [], true) };
	const screen = await showLive(widget, editing());
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "hms-smoke", "hms-fire", "monitors"]);
	const box = screen.getByRole("checkbox", { name: mapMessages("mapsdk_options_fire_smoke") });
	await box.click();
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "monitors"]);
	expect(optionsOf()).toEqual({ fireAndSmoke: false });
	// Their data keeps loading (switching back on draws at once).
	const hms = () => nowClient.entries().find((e) => e.key.startsWith("map-hms"));
	expect(hms()?.subscribers ?? 0).toBeGreaterThan(0);
	await box.click();
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "hms-smoke", "hms-fire", "monitors"]);
	expect(optionsOf()).toBeUndefined();
});

test("switching a type off hides its monitors; with only that type, they draw", async () => {
	vi.mocked(getMonitors).mockResolvedValue(twoTypes() as never);
	const screen = await showLive(mapWidget(region("019")), editing());
	let map = await madeMap();
	map.ready = true;
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	await screen.getByRole("checkbox", { name: "purpleair" }).click();
	await expect.poll(() => drawn(map)).toEqual(["b"]);
	expect(optionsOf()).toEqual({ hiddenTypes: ["purpleair"] });
	await screen.unmount();

	// Only PurpleAirs here: no Monitors group, so the saved switch filters nothing.
	fakeMaps.reset();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	await showLive(
		{ ...mapWidget(region("029")), options: { hiddenTypes: ["purpleair"] } },
		editing()
	);
	map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	expect(fakeToolbars.last?.groups.map((g) => g.id)).not.toContain("monitors");
});

test("the toolbar's clusters and basemap drive the map, and Reset removes every toolbar key", async () => {
	vi.mocked(getMonitors).mockResolvedValue(twoTypes() as never);
	const widget: WidgetInstance = {
		...mapWidget({}),
		data: layers(region("019"), [], true),
		options: {
			marks: ["a"],
			basemap: "satellite",
			clustered: false,
			fireAndSmoke: false,
			hiddenTypes: ["airnow"]
		}
	};
	const screen = await showLive(widget, editing());
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	expect(map.basemap.selected.at(-1)).toBe("satellite");
	expect(map.plugins.find((p) => p.id === "monitors")!.options).toMatchObject({ clustered: false });
	expect(fakeToolbars.last?.basemapKey).toBe("basemap");
	expect(fakeToolbars.last?.readonly).toBe(false);
	await screen.getByRole("button", { name: mapMessages("mapsdk_options_reset") }).click();
	await expect.poll(optionsOf).toEqual({ marks: ["a"] });
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	expect(map.basemap.selected.at(-1)).toBe("streets-v4");
	expect(map.plugins.find((p) => p.id === "monitors")!.options).toMatchObject({ clustered: true });
	expect(pluginIds(map)).toEqual(["focus", "hms-smoke", "hms-fire", "monitors"]);
	// Undo is one step back to all of them.
	app().current.session!.undo();
	await expect.poll(() => optionsOf()?.basemap).toBe("satellite");
	await expect.poll(() => map.basemap.selected.at(-1)).toBe("satellite");
});

test("a viewer's change is held for the visit, kept through fullscreen, and Reset drops it", async () => {
	vi.mocked(getMonitors).mockResolvedValue(twoTypes() as never);
	const widget = { ...mapWidget(region("019")), options: { hiddenTypes: ["airnow"] } };
	await openSession(widget);
	const changes = new ViewerChanges();
	const screen = await render(MapWidget, {
		target: frame,
		props: { widget },
		context: new Map<unknown, unknown>([
			[APP_CONTEXT_KEY, app()],
			[TILE_OPTIONS_KEY, { mode: "view", changes } satisfies TileOptionsContext]
		])
	});
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	await screen.getByRole("checkbox", { name: "airnow" }).click();
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	// Held as missing (the drawn default); the document is untouched.
	expect(changes.get(widget.id)).toEqual({ hiddenTypes: undefined });
	expect(optionsOf()).toEqual({ hiddenTypes: ["airnow"] });

	await screen.rerender({ widget, fullscreen: true });
	await new Promise((r) => setTimeout(r, 50));
	expect(drawn(map)).toEqual(["a", "b"]);
	await screen.rerender({ widget, fullscreen: false });
	await new Promise((r) => setTimeout(r, 50));
	expect(drawn(map)).toEqual(["a", "b"]);
	await expect.element(screen.getByRole("checkbox", { name: "airnow" })).toBeChecked();

	// Reset puts the owner's view back, forgetting the held key.
	await screen.getByRole("button", { name: mapMessages("mapsdk_options_reset") }).click();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	expect(changes.get(widget.id)).toBeUndefined();
	expect(optionsOf()).toEqual({ hiddenTypes: ["airnow"] });
});

/** Shows `widget` to a viewer of a read-only view, holding their changes in `changes`. */
async function showViewer(widget: WidgetInstance, changes: ViewerChanges) {
	await openSession(widget);
	return render(MapWidget, {
		target: frame,
		props: { widget },
		context: new Map<unknown, unknown>([
			[APP_CONTEXT_KEY, app()],
			[TILE_OPTIONS_KEY, { mode: "view", changes } satisfies TileOptionsContext]
		])
	});
}

test("a viewer back at a default the owner changed sees it, and Reset puts the owner's back", async () => {
	vi.mocked(getMonitors).mockResolvedValue([
		...twoTypes(),
		{ ...reading("c"), is_active: false }
	] as never);
	const widget = { ...mapWidget(region("019")), options: { clustered: false, inactive: true } };
	const changes = new ViewerChanges();
	const screen = await showViewer(widget, changes);
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => drawn(map)).toEqual(["a", "b", "c"]);
	const monitorsOf = () => map.plugins.find((p) => p.id === "monitors")!.options;
	expect(monitorsOf()).toMatchObject({ clustered: false });
	const clusters = screen.getByRole("checkbox", {
		name: mapMessages("mapsdk_options_marker_clusters")
	});
	const inactive = screen.getByRole("checkbox", { name: mapMessages("mapsdk_options_inactive") });

	// Marker Clusters back on (the preset's default): checked, and the map clusters.
	await clusters.click();
	await expect.element(clusters).toBeChecked();
	await expect.poll(() => fakeToolbars.last?.values.clustered).toBe(true);
	await expect.poll(monitorsOf).toMatchObject({ clustered: true });
	// Inactive back off (the preset's default): unchecked, and the inactive monitor hidden.
	await inactive.click();
	await expect.element(inactive).not.toBeChecked();
	await expect.poll(() => fakeToolbars.last?.values.inactive).toBe(false);
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	expect(changes.get(widget.id)).toEqual({ clustered: undefined, inactive: undefined });

	// Reset puts the owner's values back and forgets the held keys.
	await screen.getByRole("button", { name: mapMessages("mapsdk_options_reset") }).click();
	await expect.element(clusters).not.toBeChecked();
	await expect.element(inactive).toBeChecked();
	await expect.poll(() => drawn(map)).toEqual(["a", "b", "c"]);
	await expect.poll(monitorsOf).toMatchObject({ clustered: false });
	expect(changes.get(widget.id)).toBeUndefined();
	expect(optionsOf()).toEqual({ clustered: false, inactive: true });
});

test("Get data's preview shows the toolbar read-only: its rows are disabled and change nothing", async () => {
	vi.mocked(getMonitors).mockResolvedValue(twoTypes() as never);
	registerWidgetType(mapType);
	const widget = mapWidget(region("019"));
	await openSession(widget);
	const screen = await render(Preview, {
		target: frame,
		props: { widget, title: "Map", size: "large", gridWidth: 1200, phone: false, onsize() {} },
		context: new Map<unknown, unknown>([[APP_CONTEXT_KEY, app()]])
	});
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	expect(fakeToolbars.last?.readonly).toBe(true);
	const airnow = screen.getByRole("checkbox", { name: "airnow" });
	const clusters = screen.getByRole("checkbox", {
		name: mapMessages("mapsdk_options_marker_clusters")
	});
	await expect.element(airnow).toHaveAttribute("aria-disabled", "true");
	await expect.element(clusters).toHaveAttribute("aria-disabled", "true");
	// A pointer's click (Playwright won't click a disabled-looking control).
	(airnow.element() as HTMLElement).click();
	(clusters.element() as HTMLElement).click();
	await new Promise((r) => setTimeout(r, 50));
	await expect.element(airnow).toBeChecked();
	await expect.element(clusters).toBeChecked();
	expect(drawn(map)).toEqual(["a", "b"]);
	expect(map.plugins.find((p) => p.id === "monitors")!.options).toMatchObject({ clustered: true });
	expect(optionsOf()).toBeUndefined();
});

test("the toolbar's filters never hide the tile's own monitors, and offer no rows for them", async () => {
	// A monitor place whose monitor is indoors: drawn with the defaults, and no Monitors group
	// (its rows couldn't filter it).
	vi.mocked(getMonitors).mockResolvedValue([{ ...reading("a"), location: "inside" }] as never);
	const first = await show(mapWidget({ monitors: ["a"], monitorTypes: [] }));
	let map = await madeMap();
	map.ready = true;
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	await expect.poll(() => fakeToolbars.last?.groups.map((g) => g.id)).toEqual(["settings"]);
	await first.unmount();

	// Hand-picked monitors, one inactive and one of a hidden type: both drawn.
	fakeMaps.reset();
	vi.mocked(getMonitors).mockResolvedValue([
		{ ...reading("a"), is_active: false },
		{ ...reading("b"), type: "airnow" }
	] as never);
	await show({
		...mapWidget({ monitors: ["a", "b"], monitorTypes: [] }),
		options: { hiddenTypes: ["airnow"], marks: ["b"] }
	});
	map = await madeMap();
	map.ready = true;
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	await expect.poll(() => fakeToolbars.last?.groups.map((g) => g.id)).toEqual(["settings"]);
	// The marked one is drawn, so no "hidden by the options" line.
	await new Promise((r) => setTimeout(r, 50));
	expect(frame.querySelector("[data-map-marks-hidden]")?.textContent?.trim()).toBe("");
});

test("the note banner sits below the toolbar", async () => {
	vi.mocked(getMonitors).mockResolvedValue([] as never);
	const screen = await show(mapWidget(region("019")));
	await madeMap();
	await expect.element(screen.getByText(m.map_no_monitors_here())).toBeVisible();
	const note = frame.querySelector<HTMLElement>("[data-map-note]")!;
	expect(getComputedStyle(note).top).toBe(`${FAKE_TOOLBAR_HEIGHT}px`);
});

test("a place change clears the focus area until the new frame arrives", async () => {
	const widget = mapWidget(region("019"));
	const screen = await show(widget);
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => focusOf(map).geometry).toEqual(SHAPES["county:019"].geometry);
	await expect.poll(() => map.cameraCalls).toHaveLength(1);
	let release = () => {};
	vi.mocked(regionShapes).mockImplementationOnce(
		() =>
			new Promise((r) => {
				release = () => r(new Map([["county:029", SHAPES["county:029"]]]));
			})
	);
	await screen.rerender({ widget: { ...widget, data: mapWidget(region("029")).data } });
	await expect.poll(() => focusOf(map).geometry).toBeNull();
	// The camera stays where it was meanwhile.
	expect(map.cameraCalls).toHaveLength(1);
	release();
	await expect.poll(() => focusOf(map).geometry).toEqual(SHAPES["county:029"].geometry);
	await expect.poll(() => map.cameraCalls).toHaveLength(2);
});

test("switching a type off leaves the camera where it is", async () => {
	vi.mocked(getMonitors).mockResolvedValue([
		reading("a", -120, 36),
		{ ...reading("b", -119, 37), type: "airnow" }
	] as never);
	// A region's monitors. That the camera uses the unfiltered monitors is guaranteed by
	// construction under ruling 3: the monitors it fits to (a tile's own) are never filtered.
	const screen = await showLive(mapWidget(region("019")), editing());
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => map.cameraCalls).toHaveLength(1);
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	await screen.getByRole("checkbox", { name: "airnow" }).click();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	await new Promise((r) => setTimeout(r, 100));
	expect(map.cameraCalls).toHaveLength(1);
});

/** Every geometry the map's focus area was set to, in order. */
const focusHistory = (map: FakeMap) =>
	(map.plugins.find((p) => p.id === "focus") as unknown as { history: unknown[] }).history;

test("an options-only change (the same places) never clears the focus area", async () => {
	const screen = await showLive(mapWidget(region("019")), editing());
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => focusOf(map).geometry).toEqual(SHAPES["county:019"].geometry);
	const before = focusHistory(map).length;
	// The same places looked up again resolve slowly: the outline must stay meanwhile.
	vi.mocked(regionShapes).mockImplementation(() => new Promise(() => {}));
	await screen
		.getByRole("checkbox", { name: mapMessages("mapsdk_options_marker_clusters") })
		.click();
	await expect.poll(optionsOf).toEqual({ clustered: false });
	// Another tab's (or a live link's) copy: the same places, in a new data object.
	const session = app().current.session!;
	const current = session.doc.body.widgets[0];
	session.apply({
		op: "setWidgetData",
		target: { widgetId: current.id },
		from: current.data,
		to: JSON.parse(JSON.stringify(current.data)),
		options: { from: current.options, to: { clustered: true } }
	});
	await expect.poll(optionsOf).toEqual({ clustered: true });
	await new Promise((r) => setTimeout(r, 100));
	expect(focusHistory(map).slice(before)).not.toContain(null);
	expect(focusOf(map).geometry).toEqual(SHAPES["county:019"].geometry);
	expect(map.cameraCalls).toHaveLength(1);
});

test("another tab's change sets the toolbar's values and applies nothing", async () => {
	vi.mocked(getMonitors).mockResolvedValue(twoTypes() as never);
	const widget = mapWidget(region("019"));
	const screen = await showLive(widget, editing());
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	const session = app().current.session!;
	const current = session.doc.body.widgets[0];
	// As another tab's change arrives: straight into the session, not through the toolbar.
	session.apply({
		op: "setWidgetData",
		target: { widgetId: widget.id },
		from: current.data,
		to: current.data,
		options: { from: current.options, to: { hiddenTypes: ["airnow"], clustered: false } }
	});
	const apply = vi.spyOn(session, "apply");
	await expect.poll(() => fakeToolbars.last?.values["type:airnow"]).toBe(false);
	expect(fakeToolbars.last?.values.clustered).toBe(false);
	await expect.element(screen.getByRole("checkbox", { name: "airnow" })).not.toBeChecked();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	await new Promise((r) => setTimeout(r, 50));
	expect(apply).not.toHaveBeenCalled();
	expect(optionsOf()).toEqual({ hiddenTypes: ["airnow"], clustered: false });
});

test("a note shows over the loading skeleton", async () => {
	vi.mocked(getMonitors).mockResolvedValue([] as never);
	const screen = await show(mapWidget(region("019")));
	const map = await madeMap();
	// Not ready: the skeleton covers the map.
	expect(map.ready).toBe(false);
	await expect.element(screen.getByText(m.map_no_monitors_here())).toBeVisible();
	const note = screen.getByText(m.map_no_monitors_here()).element();
	// The banner lets the pointer through; let it be hit, to see what paints on top.
	note.closest<HTMLElement>("[data-map-note]")!.style.pointerEvents = "auto";
	const box = note.getBoundingClientRect();
	const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
	expect(note.contains(top)).toBe(true);
	expect(getComputedStyle(frame.querySelector<HTMLElement>("[data-map-note]")!).top).toBe(
		`${FAKE_TOOLBAR_HEIGHT}px`
	);
});

test("no smoke and fire failure note while Fire & Smoke is off", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	vi.mocked(getHMSSmoke).mockRejectedValue(new Error("offline"));
	const widget: WidgetInstance = {
		...mapWidget({}),
		data: layers(region("019"), [], true),
		options: { fireAndSmoke: false }
	};
	await show(widget);
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	await expect.poll(() => getHMSSmoke).toHaveBeenCalled();
	await new Promise((r) => setTimeout(r, 50));
	expect(frame.querySelector("[data-map-hms-note]")).toBeNull();
});

// --- The Map on a day ---

const RANGE = { kind: "custom", start: "2026-09-07", end: "2026-09-09" } as const;
const PM25_FIGURE = { field: "mean_24h", label: "24-hour average" };
/** The period figure at Monthly and Yearly: the average of the daily figures. */
const PERIOD_FIGURE = { field: "daily_statistic_mean", label: "Average of 24-hour averages" };

/** The Map's daily figures rated: PM2.5 and ozone have a daily figure. */
function rated(over: Partial<MetadataSource> = {}) {
	vi.mocked(getMetadata).mockReturnValue(
		fixtureMetadata({
			catalog: async () => CATALOG,
			figure: async (entryType, resolution) =>
				entryType !== "pm25" && entryType !== "o3"
					? null
					: resolution === "day"
						? PM25_FIGURE
						: resolution === "month" || resolution === "year"
							? PERIOD_FIGURE
							: null,
			...over
		})
	);
}

/** One monitor's daily row for `day`. */
const dayRow = (day: string, value: number | null, isFinal = true) => ({
	timestamp: pacificDay(day).toISOString(),
	is_final: isFinal,
	mean_24h: value
});

type DayFigures = Record<string, Record<string, number | null>>;

/** The bulk daily summaries: each day's figure per monitor (a monitor left out has no row). */
function dailyFigures(byDay: DayFigures, isFinal = true) {
	vi.mocked(getMonitorSummariesBulkDaily).mockImplementation((async (config: { start: string }) =>
		Object.entries(byDay[config.start] ?? {}).map(([id, value]) => ({
			id,
			summaries: [dayRow(config.start, value, isFinal)]
		}))) as never);
}

/** One monitor's or region's monthly or yearly row for the period starting `start`. */
const periodRow = (
	start: string,
	value: number | null,
	isFinal = true,
	counts: [number, number] | null = null
) => ({
	timestamp: pacificDay(start).toISOString(),
	is_final: isFinal,
	mean: 99,
	daily_statistic_mean: value,
	daily_statistic_days: counts?.[0] ?? null,
	daily_statistic_expected_days: counts?.[1] ?? null
});

/**
 * The bulk monthly and yearly summaries: each period's figure per monitor, by the period's start
 * (a monitor left out has no row). `notFinal` lists the starts whose rows aren't final yet;
 * `counts` gives a start's rows their days with a figure and expected days.
 */
function periodFigures(
	byStart: DayFigures,
	notFinal: string[] = [],
	counts: Record<string, [number, number]> = {}
) {
	const answer = (async (config: { start: string }) =>
		Object.entries(byStart[config.start] ?? {}).map(([id, value]) => ({
			id,
			summaries: [
				periodRow(
					config.start,
					value,
					!notFinal.includes(config.start),
					counts[config.start] ?? null
				)
			]
		}))) as never;
	vi.mocked(getMonitorSummariesBulkMonthly).mockImplementation(answer);
	vi.mocked(getMonitorSummariesBulkYearly).mockImplementation(answer);
}

/** The periods the bulk monthly summaries were asked for, as `start..end`. */
const monthsAsked = () =>
	vi
		.mocked(getMonitorSummariesBulkMonthly)
		.mock.calls.map((c) => c[0] as { start: string; end: string })
		.map((q) => `${q.start}..${q.end}`);

/** The days the bulk daily summaries were asked for, in order. */
const daysAsked = () =>
	vi.mocked(getMonitorSummariesBulkDaily).mock.calls.map((c) => (c[0] as { start: string }).start);

/** A Map of `layer` over `range`. */
function rangedMap(
	layer: LayerAt,
	options?: Record<string, unknown>,
	range: DateRangeSpec = RANGE
): WidgetInstance {
	const widget = mapWidget(layer);
	return {
		...widget,
		data: { ...widget.data, dateRange: range },
		...(options && { options })
	};
}

/** Each drawn monitor's value. */
function drawnValues(map: FakeMap): Record<string, unknown> | undefined {
	const source = map.plugins.find((p) => p.id === "monitors")?.options.source as
		| {
				features: {
					features: { properties: { refKey: string; value: unknown; isActive: boolean } }[];
				} | null;
		  }
		| undefined;
	const features = source?.features?.features;
	if (!features) return undefined;
	return Object.fromEntries(
		features.map((f) => [f.properties.refKey.replace(/^monitor:/, ""), f.properties.value])
	);
}

const dayLabel = () => frame.querySelector("[data-day-label]")?.textContent;
const nextDay = () => page.getByRole("button", { name: m.map_day_next() });
const previousDay = () => page.getByRole("button", { name: m.map_day_previous() });

test("on a past day, the monitors draw the day's figures: no row isn't drawn, thin has no value", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([
		{ ...reading("a"), is_active: false },
		reading("b"),
		reading("c")
	] as never);
	dailyFigures({ "2026-09-09": { a: 20, b: null, z: 3 } });
	const screen = await show(rangedMap(region("019")));
	const map = await madeMap();
	// The last stop: the range's last day.
	await expect.poll(dayLabel).toBe("Wednesday, September 9, 2026");
	await expect.poll(() => drawnValues(map)).toEqual({ a: 20, b: null });
	const source = map.plugins.find((p) => p.id === "monitors")!.options.source as {
		features: { features: { properties: Record<string, unknown> }[] };
	};
	// Active that day (it reported), with no reading time.
	expect(source.features.features[0].properties).toMatchObject({ isActive: true, timestamp: null });
	expect(vi.mocked(getMonitorSummariesBulkDaily).mock.calls[0][0]).toEqual({
		entryType: "pm25",
		start: "2026-09-09",
		end: "2026-09-09",
		region: ["r019"],
		type: EVERY_TYPE
	});
	await expect.element(screen.getByText(m.map_day_not_final())).not.toBeInTheDocument();
});

test("a pollutant whose days can't be rated draws no levels, and the note says so once", async () => {
	// Its scale names no daily figure (the fixture's PM2.5 has one, as the server's does).
	vi.mocked(getMetadata).mockReturnValue(
		fixtureMetadata({ catalog: async () => CATALOG, figure: async () => null })
	);
	vi.mocked(getMonitors).mockResolvedValue([reading("a"), reading("b")] as never);
	dailyFigures({ "2026-09-09": { a: 20, b: 30 } });
	await show(rangedMap(region("019")));
	const map = await madeMap();
	await expect.poll(() => drawnValues(map)).toEqual({ a: null, b: null });
	const line = m.map_day_unrated({ pollutant: "PM2.5" });
	await expect.poll(() => frame.querySelector("[data-map-marks-hidden]")?.textContent).toBe(line);
	expect(map.view.label).toContain(line);
});

test("a pollutant whose months or years can't be rated says so for the month or year", async () => {
	vi.mocked(getMetadata).mockReturnValue(
		fixtureMetadata({ catalog: async () => CATALOG, figure: async () => null })
	);
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const range = { kind: "custom", start: "2026-07-01", end: "2026-09-30" } as const;
	const screen = await show(periodMap("month", range));
	const map = await madeMap();
	const month = m.map_month_unrated({ pollutant: "PM2.5" });
	await expect.poll(() => map.view.label).toContain(month);
	await screen.rerender({ widget: periodMap("year", range) });
	const year = m.map_year_unrated({ pollutant: "PM2.5" });
	await expect.poll(() => map.view.label).toContain(year);
	expect(map.view.label).not.toContain(month);
});

test("the neighbouring days load ahead: a step draws at once, with no new request for it", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	dailyFigures({
		"2026-09-07": { a: 7 },
		"2026-09-08": { a: 8 },
		"2026-09-09": { a: 9 },
		"2026-09-10": { a: 10 }
	});
	const range = { kind: "custom", start: "2026-09-07", end: "2026-09-11" } as const;
	await show(rangedMap(region("019"), { at: "2026-09-08" }, range));
	const map = await madeMap();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 8 });
	await expect
		.poll(() => [...daysAsked()].sort())
		.toEqual(["2026-09-07", "2026-09-08", "2026-09-09"]);
	await nextDay().click();
	// Drawn from the day fetched ahead; only the new neighbour is asked for.
	await expect.poll(() => drawnValues(map)).toEqual({ a: 9 });
	await expect.poll(() => daysAsked().length).toBe(4);
	expect(daysAsked().filter((d) => d === "2026-09-09")).toHaveLength(1);
	expect(daysAsked()[3]).toBe("2026-09-10");
	expect(getMonitors).toHaveBeenCalledTimes(1);
});

test("stepping fast: a late answer for a day stepped past is never drawn", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const held = new Map<string, () => void>();
	vi.mocked(getMonitorSummariesBulkDaily).mockImplementation((async (config: { start: string }) => {
		await new Promise<void>((r) => held.set(config.start, r));
		return [{ id: "a", summaries: [dayRow(config.start, Number(config.start.slice(-2)))] }];
	}) as never);
	const range = { kind: "custom", start: "2026-09-01", end: "2026-09-09" } as const;
	await show(rangedMap(region("019"), undefined, range));
	const map = await madeMap();
	await expect.poll(() => held.has("2026-09-09")).toBe(true);
	await previousDay().click();
	await previousDay().click();
	await expect.poll(dayLabel).toBe("Monday, September 7, 2026");
	await expect.poll(() => held.has("2026-09-07")).toBe(true);
	// The days stepped past answer late: none is drawn.
	held.get("2026-09-09")!();
	held.get("2026-09-08")!();
	await new Promise((r) => setTimeout(r, 50));
	expect(drawnValues(map)).toBeUndefined();
	held.get("2026-09-07")!();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 7 });
});

test("a pollutant change on a day keeps the day, and draws nothing stale while it loads", async () => {
	rated();
	vi.mocked(getMonitors).mockImplementation(async () => [reading("a")] as never);
	vi.mocked(getMonitorSummariesBulkDaily).mockImplementation((async (config: {
		entryType: string;
		start: string;
	}) => [
		{ id: "a", summaries: [dayRow(config.start, config.entryType === "o3" ? 61 : 12)] }
	]) as never);
	const gate = holdableRegions();
	const widget: WidgetInstance = {
		...rangedMap(region("019"), { at: "2026-09-08" }),
		data: { ...layers(region("019")), dateRange: RANGE }
	};
	const screen = await show(widget);
	const map = await madeMap();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 12 });
	gate.held = true;
	await screen.rerender({
		widget: {
			...widget,
			data: { ...layers({ ...region("019"), entryType: "o3" }), dateRange: RANGE }
		}
	});
	await expect
		.poll(() => map.plugins.find((p) => p.id === "monitors")?.options.layerLabel)
		.toBe("Ozone");
	expect(drawnValues(map)).toBeUndefined();
	expect(dayLabel()).toBe("Tuesday, September 8, 2026");
	gate.release();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 61 });
	expect(vi.mocked(getMonitorSummariesBulkDaily).mock.calls.map((c) => c[0])).toContainEqual({
		entryType: "o3",
		start: "2026-09-08",
		end: "2026-09-08",
		region: ["r019"],
		type: EVERY_TYPE
	});
	expect(dayLabel()).toBe("Tuesday, September 8, 2026");
});

test("a place change on a day keeps the day, and draws nothing stale while it resolves", async () => {
	rated();
	vi.mocked(getMonitors).mockImplementation(
		async (_type, options) => [reading(options?.region?.[0] === "r029" ? "b" : "a")] as never
	);
	vi.mocked(getMonitorSummariesBulkDaily).mockImplementation((async (config: {
		start: string;
		region?: string[];
	}) =>
		config.region?.[0] === "r029"
			? [{ id: "b", summaries: [dayRow(config.start, 29)] }]
			: [{ id: "a", summaries: [dayRow(config.start, 19)] }]) as never);
	const gate = holdableRegions();
	const widget = rangedMap(region("019"), { at: "2026-09-08" });
	const screen = await show(widget);
	const map = await madeMap();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 19 });
	gate.held = true;
	const before = gate.calls;
	await screen.rerender({
		widget: { ...widget, data: { ...rangedMap(region("029")).data } }
	});
	await expect.poll(() => gate.calls).toBeGreaterThan(before);
	expect(drawnValues(map)).toBeUndefined();
	expect(dayLabel()).toBe("Tuesday, September 8, 2026");
	gate.release();
	await expect.poll(() => drawnValues(map)).toEqual({ b: 29 });
	expect(vi.mocked(getMonitorSummariesBulkDaily).mock.calls.map((c) => c[0])).toContainEqual({
		entryType: "pm25",
		start: "2026-09-08",
		end: "2026-09-08",
		region: ["r029"],
		type: EVERY_TYPE
	});
	expect(dayLabel()).toBe("Tuesday, September 8, 2026");
});

test("stepping back to a day still fetched ahead never asks for it twice", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const held = new Map<string, () => void>();
	vi.mocked(getMonitorSummariesBulkDaily).mockImplementation((async (config: { start: string }) => {
		await new Promise<void>((r) => held.set(config.start, r));
		return [{ id: "a", summaries: [dayRow(config.start, Number(config.start.slice(-2)))] }];
	}) as never);
	await show(rangedMap(region("019")));
	const map = await madeMap();
	// The last stop (still in flight) and the day before, ahead.
	await expect.poll(() => [...daysAsked()].sort()).toEqual(["2026-09-08", "2026-09-09"]);
	await previousDay().click();
	await expect.poll(dayLabel).toBe("Tuesday, September 8, 2026");
	await nextDay().click();
	await expect.poll(dayLabel).toBe("Wednesday, September 9, 2026");
	await new Promise((r) => setTimeout(r, 50));
	// Each day asked for once: the one in flight was kept, never aborted and asked again.
	expect(daysAsked().filter((d) => d === "2026-09-09")).toHaveLength(1);
	expect(daysAsked().filter((d) => d === "2026-09-08")).toHaveLength(1);
	for (const answer of held.values()) answer();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 9 });
});

test("smoke and fire follow the day, and the Fire & Smoke row still hides them", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	dailyFigures({ "2026-09-09": { a: 9 } });
	const widget: WidgetInstance = {
		...rangedMap(region("019")),
		data: { ...layers(region("019"), [], true), dateRange: RANGE }
	};
	const screen = await show(widget);
	const map = await madeMap();
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "hms-smoke", "hms-fire", "monitors"]);
	expect(vi.mocked(getHMSSmoke).mock.calls[0][0]).toEqual({ date: "2026-09-09" });
	expect(vi.mocked(getHMSFire).mock.calls[0][0]).toEqual({ date: "2026-09-09" });
	expect(nowClient.entries().some((e) => e.key === "map-hms:2026-09-09")).toBe(true);
	await screen.rerender({ widget: { ...widget, options: { fireAndSmoke: false } } });
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "monitors"]);
});

test("on a day stop the Inactive row isn't offered and filters nothing; on Now it's back", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([
		...twoTypes(),
		{ ...reading("c"), is_active: false }
	] as never);
	const today = todayPacific();
	const range = { kind: "trailing", amount: 3, unit: "day" } as const;
	const stops = periodStops(range, "day", today);
	const yesterday = (stops.at(-2) as { at: string }).at;
	dailyFigures({ [yesterday]: { a: 1, b: 2, c: 3 } });
	const screen = await showLive(rangedMap(region("019"), { at: yesterday }, range), editing());
	const map = await madeMap();
	map.ready = true;
	// The inactive monitor reported that day: drawn, though the defaults hide inactive monitors.
	await expect.poll(() => drawn(map)).toEqual(["a", "b", "c"]);
	await expect.poll(() => fakeToolbars.last?.groups.map((g) => g.id)).toContain("monitors");
	const inactive = screen.getByRole("checkbox", { name: mapMessages("mapsdk_options_inactive") });
	expect(inactive.query()).toBeNull();
	await nextDay().click();
	await expect.poll(dayLabel).toBe(m.map_day_now());
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	await expect.element(inactive).toBeVisible();
});

test("a saved Inactive choice filters nothing on a day stop, and filters again on Now", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([
		...twoTypes(),
		{ ...reading("c"), is_active: false }
	] as never);
	const range = { kind: "trailing", amount: 3, unit: "day" } as const;
	const yesterday = (periodStops(range, "day", todayPacific()).at(-2) as { at: string }).at;
	dailyFigures({ [yesterday]: { a: 1, b: 2, c: 3 } });
	await showLive(rangedMap(region("019"), { at: yesterday, inactive: false }, range), editing());
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => drawn(map)).toEqual(["a", "b", "c"]);
	await nextDay().click();
	await expect.poll(dayLabel).toBe(m.map_day_now());
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	expect(optionsOf()).toEqual({ inactive: false });
});

test("a day with no figures for the places' monitors says so, once it has loaded", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a"), reading("b")] as never);
	let answer: () => void = () => {};
	vi.mocked(getMonitorSummariesBulkDaily).mockImplementation((async (config: { start: string }) => {
		if (config.start === "2026-09-09") await new Promise<void>((r) => (answer = r));
		return [];
	}) as never);
	await show(rangedMap(region("019")));
	const map = await madeMap();
	const notes = () => frame.querySelector("[data-map-marks-hidden]")?.textContent;
	await expect.poll(() => vi.mocked(getMonitorSummariesBulkDaily).mock.calls.length).toBe(2);
	// Never while the day loads.
	await new Promise((r) => setTimeout(r, 50));
	expect(notes()).toBe("");
	answer();
	await expect.poll(notes).toBe(m.map_day_no_figures());
	expect(drawnValues(map)).toEqual({});
	expect(map.view.label).toContain(m.map_day_no_figures());
	expect(frame.textContent).not.toContain(m.map_no_monitors_here());
});

test("a hidden mark with no figure that day gives its reason line", async () => {
	await listedMonitors();
	const listed = vi.mocked(getMetadata)();
	rated({ monitors: listed.monitors, monitorTypes: listed.monitorTypes });
	vi.mocked(getMonitors).mockResolvedValue([reading("a"), reading("c")] as never);
	dailyFigures({ "2026-09-09": { a: 9 } });
	await show(rangedMap(region("019"), { marks: ["c"] }));
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	const line = m.map_marks_hidden_period({ count: "1", countValue: 1 });
	await expect.poll(() => frame.querySelector("[data-map-marks-hidden]")?.textContent).toBe(line);
});

test("a mark hidden only for having no figure that day is still sent", async () => {
	await listedMonitors();
	const listed = vi.mocked(getMetadata)();
	rated({ monitors: listed.monitors, monitorTypes: listed.monitorTypes });
	vi.mocked(getMonitors).mockResolvedValue([reading("a"), reading("c")] as never);
	dailyFigures({ "2026-09-09": { a: 9 } });
	const widget = rangedMap(region("019"), { marks: ["c"] });
	await showEditing(widget);
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	await expect.poll(() => mapSend(widget.id)?.marks).toEqual(["c"]);
	expect(mapSend(widget.id)?.leftOut).toBe(0);
	expect(menuIds(widget)).toEqual(SHOW_IN);
});

test("a Monthly Map steps by month and draws each month's figure from the monthly summaries", async () => {
	await listedMonitors();
	const listed = vi.mocked(getMetadata)();
	rated({ monitors: listed.monitors, monitorTypes: listed.monitorTypes });
	vi.mocked(getMonitors).mockResolvedValue([reading("a"), reading("b"), reading("c")] as never);
	dailyFigures({ "2026-09-01": { a: 9 } });
	// September's rows carry their day counts; August's don't.
	periodFigures({ "2026-09-01": { a: 14, b: null }, "2026-08-01": { a: 30, b: null } }, [], {
		"2026-09-01": [20, 30]
	});
	const range = { kind: "custom", start: "2026-07-10", end: "2026-09-20" } as const;
	const widget = rangedMap(region("019"), { marks: ["c"] }, range);
	widget.data.resolution = "month";
	await show(widget);
	const map = await madeMap();
	// The last stop is September (a past range): no "so far", and final.
	await expect.poll(dayLabel).toBe("September 2026");
	await expect.element(page.getByRole("button", { name: "Previous month" })).toBeEnabled();
	// The month's figure (the average of the daily figures), named by period_statistic_label; a
	// null one (too few days had a figure) draws as no data, saying how many did.
	await expect.poll(() => drawnValues(map)).toEqual({ a: 14, b: null });
	expect(monthsAsked()).toEqual(["2026-09-01..2026-09-30"]);
	expect(vi.mocked(getMonitorSummariesBulkMonthly).mock.calls[0][0]).toMatchObject({
		entryType: "pm25",
		region: expect.any(Array)
	});
	expect(daysAsked()).toEqual([]);
	await expect.poll(() => monitorsOptionsOf(map)?.figureLabel).toBe(PERIOD_FIGURE.label);
	expect(listNoteOf(map)).toContain(PERIOD_FIGURE.label);
	// The legend's line under the section's title: the units and the figure (E2E checks the text
	// in map-sdk's Legend).
	expect(monitorsOptionsOf(map)?.legendUnits).toBe(
		m.label_join({ first: "µg/m³", second: PERIOD_FIGURE.label })
	);
	const props = (id: string) =>
		(
			map.plugins.find((p) => p.id === "monitors")!.options.source as {
				features: { features: { properties: Record<string, unknown> }[] };
			}
		).features.features.find((f) => f.properties.refKey === `monitor:${id}`)!.properties;
	expect(monitorsOptionsOf(map)!.detail!(props("b"))).toBe(
		m.map_period_days_with_figure({ days: "20", expected: "30", expectedValue: 30 })
	);
	expect(m.map_period_days_with_figure({ days: "20", expected: "30", expectedValue: 30 })).toBe(
		"Only 20 of 30 days had a figure"
	);
	expect(monitorsOptionsOf(map)!.detail!(props("a"))).toBeUndefined();
	// The marked monitor has no row this month: hidden, with the period's reason.
	const line = m.map_marks_hidden_period({ count: "1", countValue: 1 });
	await expect.poll(() => map.view.label).toContain(line);
	expect(frame.textContent).not.toContain(m.map_day_not_final());

	await page.getByRole("button", { name: "Previous month" }).click();
	await expect.poll(dayLabel).toBe("August 2026");
	await expect.poll(() => drawnValues(map)).toEqual({ a: 30, b: null });
	// No day counts on the row: the reason without them.
	expect(monitorsOptionsOf(map)!.detail!(props("b"))).toBe(m.map_period_too_few_days());
	expect(m.map_period_too_few_days()).toBe("Too few days had a figure");
	expect(monthsAsked()).toEqual(["2026-09-01..2026-09-30", "2026-08-01..2026-08-31"]);

	// July has no rows: no data, the usual way.
	await page.getByRole("button", { name: "Previous month" }).click();
	await expect.poll(dayLabel).toBe("July 2026");
	await expect.poll(() => map.view.label).toContain(m.map_month_no_figures());
	expect(drawnValues(map)).toEqual({});
});

test("a Yearly Map draws each year's figure from the yearly summaries", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	periodFigures({ "2025-01-01": { a: 11 } });
	const range = { kind: "custom", start: "2024-01-01", end: "2025-12-31" } as const;
	const widget = rangedMap(region("019"), undefined, range);
	widget.data.resolution = "year";
	await show(widget);
	const map = await madeMap();
	await expect.poll(dayLabel).toBe("2025");
	await expect.poll(() => drawnValues(map)).toEqual({ a: 11 });
	expect(vi.mocked(getMonitorSummariesBulkYearly).mock.calls[0][0]).toMatchObject({
		start: "2025-01-01",
		end: "2025-12-31"
	});
	expect(getMonitorSummariesBulkMonthly).not.toHaveBeenCalled();
	await expect.poll(() => monitorsOptionsOf(map)?.figureLabel).toBe(PERIOD_FIGURE.label);
});

test("the current month is drawn so far, not final, and polls hourly until its row is final", async () => {
	rated();
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
	try {
		nowClient = createNowClient({ activity: { visible: () => true, onChange: () => () => {} } });
		vi.mocked(getNowClient).mockReturnValue(nowClient);
		vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
		const month = `${todayPacific().slice(0, 7)}-01`;
		periodFigures({ [month]: { a: 6 } }, [month]);
		const range = { kind: "to-date", unit: "year" } as const;
		const widget = rangedMap(region("019"), undefined, range);
		widget.data.resolution = "month";
		const screen = await show(widget);
		const map = await madeMap();
		await expect.poll(() => drawnValues(map)).toEqual({ a: 6 });
		await expect.element(screen.getByText(m.map_day_not_final())).toBeVisible();
		const asked = () => monthsAsked().filter((q) => q.startsWith(month)).length;
		expect(asked()).toBe(1);
		await vi.advanceTimersByTimeAsync(61 * 60_000);
		await expect.poll(asked).toBe(2);
	} finally {
		vi.useRealTimers();
	}
});

test("the current month before its first nightly row draws no data, the usual way, and keeps polling", async () => {
	rated();
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
	try {
		nowClient = createNowClient({ activity: { visible: () => true, onChange: () => () => {} } });
		vi.mocked(getNowClient).mockReturnValue(nowClient);
		vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
		periodFigures({});
		const range = { kind: "to-date", unit: "month" } as const;
		const widget = rangedMap(region("019"), undefined, range);
		widget.data.resolution = "month";
		const screen = await show(widget);
		const map = await madeMap();
		await expect.poll(() => map.view.label).toContain(m.map_month_no_figures());
		expect(drawnValues(map)).toEqual({});
		await expect.element(screen.getByText(m.map_day_not_final())).toBeVisible();
		expect(monthsAsked()).toHaveLength(1);
		// The nightly row may land within the hour: asked again.
		await vi.advanceTimersByTimeAsync(61 * 60_000);
		await expect.poll(() => monthsAsked().length).toBe(2);
	} finally {
		vi.useRealTimers();
	}
});

/** A Map of `region` at `resolution` over `range`, with `options`. */
function periodMap(
	resolution: "month" | "year",
	range: DateRangeSpec,
	options?: Record<string, unknown>,
	more: Partial<Layer>[] = []
): WidgetInstance {
	const widget = rangedMap(region("019"), options, range);
	return {
		...widget,
		data: { ...layers(region("019"), more), dateRange: range, resolution }
	};
}

test("a stored level outside the Map's levels (hour, from a link) can't be drawn, with no map", async () => {
	const range = { kind: "custom", start: "2026-07-01", end: "2026-09-30" } as const;
	const widget = periodMap("month", range);
	widget.data.resolution = "hour";
	const screen = await show(widget);
	await expect.element(screen.getByText(m.widget_state_unavailable_no_resolution())).toBeVisible();
	expect(fakeMaps.made).toHaveLength(0);
});

test("on a month stop, the no-monitors note speaks of the month; on a year stop, of the year", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([] as never);
	const range = { kind: "custom", start: "2026-07-01", end: "2026-09-30" } as const;
	const screen = await show(periodMap("month", range));
	await madeMap();
	await expect.element(screen.getByText(m.map_no_monitors_here_month())).toBeVisible();
	expect(screen.getByText(m.map_no_monitors_here_day()).query()).toBeNull();
	expect(screen.getByText(m.map_no_monitors_here()).query()).toBeNull();
	await screen.rerender({ widget: periodMap("year", range) });
	await expect.element(screen.getByText(m.map_no_monitors_here_year())).toBeVisible();
});

test("a fill on the current month says this month so far; a past month just names the regions", async () => {
	rated();
	zipFill();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const thisYear = { kind: "to-date", unit: "year" } as const;
	const screen = await show(periodMap("month", thisYear, { fill: "zipcode" }));
	const map = await madeMap();
	await expect.poll(() => fillOf(map)?.options.layerLabel).toBe("ZIP Codes, this month so far");
	expect(fillOf(map)!.options.layerLabel).toBe(
		m.map_fill_month_so_far({ regionType: "ZIP Codes" })
	);
	// A month stop reads the month's rows: never today's open-day rows.
	expect(getRegionSummariesBulkDailyOpen).not.toHaveBeenCalled();
	await expect.poll(() => vi.mocked(getRegionSummariesBulkMonthly).mock.calls.length).toBe(1);
	expect(vi.mocked(getRegionSummariesBulkMonthly).mock.calls[0][0]).toMatchObject({
		type: "zipcode",
		start: `${todayPacific().slice(0, 7)}-01`
	});
	await screen.rerender({ widget: periodMap("year", thisYear, { fill: "zipcode" }) });
	await expect.poll(() => fillOf(map)?.options.layerLabel).toBe("ZIP Codes, this year so far");
	const past = { kind: "custom", start: "2025-01-01", end: "2025-03-31" } as const;
	await screen.rerender({ widget: periodMap("month", past, { fill: "zipcode" }) });
	await expect.poll(() => fillOf(map)?.options.layerLabel).toBe("ZIP Codes");
});

test("a fill on a month stop draws each region's monthly figure; a null one is no data", async () => {
	rated();
	zipFill();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	vi.mocked(getRegionSummariesBulkMonthly).mockImplementation((async (config: {
		start: string;
	}) => [
		{ id: "z93721", summaries: [periodRow(config.start, 13)] },
		{ id: "z93722", summaries: [periodRow(config.start, null)] }
	]) as never);
	const past = { kind: "custom", start: "2025-01-01", end: "2025-03-31" } as const;
	await show(periodMap("month", past, { fill: "zipcode" }));
	const map = await madeMap();
	await expect
		.poll(() => fillValues(map))
		.toEqual({
			"region:zipcode:93721": 13,
			"region:zipcode:93722": null,
			"region:zipcode:93723": null
		});
	expect(vi.mocked(getRegionSummariesBulkMonthly).mock.calls[0][0]).toMatchObject({
		type: "zipcode",
		start: "2025-03-01",
		end: "2025-03-31"
	});
	expect(getRegionSummariesBulkDaily).not.toHaveBeenCalled();
});

test("smoke, fire and spray notices draw only at Daily: a Monthly Map (untrusted) hides their rows and says why", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const range = { kind: "custom", start: "2026-07-01", end: "2026-09-30" } as const;
	const widget = periodMap("month", range, undefined, [{ dataset: "pesticide-notices" }]);
	widget.data.layers.splice(1, 0, { dataset: "hms-smoke" }, { dataset: "hms-fire" });
	const screen = await showLive(widget, editing());
	const map = await madeMap();
	map.ready = true;
	await expect.poll(dayLabel).toBe("September 2026");
	for (const dataset of ["Wildfire Smoke", "Fire Detections", "Spray Notices"]) {
		await expect.element(screen.getByText(notLinedUp(dataset))).toBeVisible();
	}
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "monitors"]);
	expect(getActivePesticideNotices).not.toHaveBeenCalled();
	expect(getHMSSmoke).not.toHaveBeenCalled();
	// No Layers rows for them (the group goes with its last row).
	expect(frame.querySelector('[data-option="fireAndSmoke"]')).toBeNull();
	expect(frame.querySelector('[data-option="notices"]')).toBeNull();
});

test("at Daily, smoke, fire and spray notices draw with their rows and no note", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const widget = rangedMap(region("019"));
	widget.data.layers.push({ dataset: "hms-smoke" }, { dataset: "hms-fire" });
	widget.data.layers.push({ dataset: "pesticide-notices" });
	const screen = await showLive(widget, editing());
	const map = await madeMap();
	map.ready = true;
	await expect
		.poll(() => pluginIds(map))
		.toEqual(["focus", "hms-smoke", "hms-fire", "notices", "monitors"]);
	expect(frame.querySelector('[data-option="fireAndSmoke"]')).toBeTruthy();
	expect(frame.querySelector('[data-option="notices"]')).toBeTruthy();
	expect(screen.getByText(notLinedUp("Wildfire Smoke")).query()).toBeNull();
});

test("refresh: a final past day isn't asked for again; one not final is, hourly", async () => {
	rated();
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
	try {
		nowClient = createNowClient({ activity: { visible: () => true, onChange: () => () => {} } });
		vi.mocked(getNowClient).mockReturnValue(nowClient);
		vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
		dailyFigures({ "2026-09-09": { a: 9 } });
		const final = await show(rangedMap(region("019")));
		let map = await madeMap();
		await expect.poll(() => drawnValues(map)).toEqual({ a: 9 });
		await vi.advanceTimersByTimeAsync(61 * 60_000);
		expect(daysAsked()).toEqual(["2026-09-09", "2026-09-08"]);
		expect(getMonitors).toHaveBeenCalledTimes(1);
		await final.unmount();

		fakeMaps.reset();
		nowClient = createNowClient({ activity: { visible: () => true, onChange: () => () => {} } });
		vi.mocked(getNowClient).mockReturnValue(nowClient);
		vi.mocked(getMonitorSummariesBulkDaily).mockClear();
		dailyFigures({ "2026-09-09": { a: 9 } }, false);
		const screen = await show(rangedMap(region("019")));
		map = await madeMap();
		await expect.poll(() => drawnValues(map)).toEqual({ a: 9 });
		await expect.element(screen.getByText(m.map_day_not_final())).toBeVisible();
		const asked = () => daysAsked().filter((d) => d === "2026-09-09").length;
		expect(asked()).toBe(1);
		await vi.advanceTimersByTimeAsync(61 * 60_000);
		await expect.poll(asked).toBe(2);
	} finally {
		vi.useRealTimers();
	}
});

test("refresh: the Now stop keeps the live monitors' 3-minute poll, and fetches the day before ahead", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const range = { kind: "trailing", amount: 3, unit: "day" } as const;
	const stops = periodStops(range, "day", todayPacific());
	const before = (stops.at(-2) as { at: string }).at;
	dailyFigures({ [before]: { a: 4 } });
	await show(rangedMap(region("019"), undefined, range));
	const map = await madeMap();
	await expect.poll(dayLabel).toBe(m.map_day_now());
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	const monitors = () => nowClient.entries().find((e) => e.key.startsWith("map-monitors"));
	await expect.poll(monitors).toMatchObject({ resolution: "raw", polling: true });
	// Only the day before the Now stop, fetched ahead and never polled.
	await expect.poll(daysAsked).toEqual([before]);
	const ahead = nowClient.entries().find((e) => e.key.startsWith("snapshot:monitors"));
	expect(ahead).toMatchObject({ polling: false });
	// Stepping to it draws at once, with no new request for it.
	await previousDay().click();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 4 });
	expect(daysAsked().filter((d) => d === before)).toHaveLength(1);
});

test("a saved day outside the range opens on the last stop, writing nothing", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	dailyFigures({ "2026-09-09": { a: 9 } });
	await showLive(rangedMap(region("019"), { at: "2026-01-01" }), editing());
	const session = app().current.session!;
	const apply = vi.spyOn(session, "apply");
	const amend = vi.spyOn(session, "amend");
	const map = await madeMap();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 9 });
	expect(dayLabel()).toBe("Wednesday, September 9, 2026");
	await new Promise((r) => setTimeout(r, 50));
	expect(apply).not.toHaveBeenCalled();
	expect(amend).not.toHaveBeenCalled();
	expect(optionsOf()).toEqual({ at: "2026-01-01" });
});

test("a range with no days yet says so and asks for nothing", async () => {
	rated();
	const screen = await show(
		rangedMap(region("019"), undefined, { kind: "custom", start: "2099-01-01", end: "2099-01-03" })
	);
	const map = await madeMap();
	await expect.element(screen.getByText(m.map_day_none_yet())).toBeVisible();
	await new Promise((r) => setTimeout(r, 50));
	expect(pluginIds(map)).toEqual(["focus"]);
	expect(getMonitors).not.toHaveBeenCalled();
	expect(getMonitorSummariesBulkDaily).not.toHaveBeenCalled();
});

test("editing: a step saves the day, the last stop removes it, and a run is one undo step", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	dailyFigures({ "2026-09-07": { a: 7 }, "2026-09-08": { a: 8 }, "2026-09-09": { a: 9 } });
	await showLive(rangedMap(region("019"), { at: "2026-09-07" }), editing());
	const map = await madeMap();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 7 });
	await nextDay().click();
	await expect.poll(() => optionsOf()).toEqual({ at: "2026-09-08" });
	await expect.poll(() => drawnValues(map)).toEqual({ a: 8 });
	await nextDay().click();
	// The last stop is stored as missing.
	await expect.poll(() => optionsOf()).toBeUndefined();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 9 });
	// One undo step back to the day before the run.
	app().current.session!.undo();
	await expect.poll(() => optionsOf()).toEqual({ at: "2026-09-07" });
	await expect.poll(dayLabel).toBe("Monday, September 7, 2026");
	await expect.poll(() => drawnValues(map)).toEqual({ a: 7 });
	// Redo gives the run's last day (the last stop, stored as missing).
	app().current.session!.redo();
	await expect.poll(() => optionsOf()).toBeUndefined();
	await expect.poll(dayLabel).toBe("Wednesday, September 9, 2026");
	await expect.poll(() => drawnValues(map)).toEqual({ a: 9 });
});

test("editing: a step at once after an undo is its own undo step, and clears redo", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	dailyFigures({ "2026-09-07": { a: 7 }, "2026-09-08": { a: 8 }, "2026-09-09": { a: 9 } });
	await showLive(rangedMap(region("019"), { at: "2026-09-07" }), editing());
	const session = app().current.session!;
	const map = await madeMap();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 7 });
	await nextDay().click();
	await expect.poll(() => optionsOf()).toEqual({ at: "2026-09-08" });
	session.undo();
	await expect.poll(() => optionsOf()).toEqual({ at: "2026-09-07" });
	expect(session.canRedo).toBe(true);
	// Within the run's window: still a new undo step, since there is something to redo.
	const amend = vi.spyOn(session, "amend");
	await nextDay().click();
	await expect.poll(() => optionsOf()).toEqual({ at: "2026-09-08" });
	expect(amend).not.toHaveBeenCalled();
	expect(session.canUndo).toBe(true);
	expect(session.canRedo).toBe(false);
	session.undo();
	await expect.poll(() => optionsOf()).toEqual({ at: "2026-09-07" });
});

test("a step that goes nowhere (End on the last stop) writes nothing and starts no run", async () => {
	rated();
	frame.style.width = "900px";
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	dailyFigures({ "2026-09-08": { a: 8 }, "2026-09-09": { a: 9 } });
	await showLive(rangedMap(region("019")), editing());
	const session = app().current.session!;
	const apply = vi.spyOn(session, "apply");
	const amend = vi.spyOn(session, "amend");
	const map = await madeMap();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 9 });
	const slider = page.getByRole("slider");
	(slider.element() as HTMLElement).focus();
	await userEvent.keyboard("{End}");
	await new Promise((r) => setTimeout(r, 50));
	expect(apply).not.toHaveBeenCalled();
	expect(amend).not.toHaveBeenCalled();
	// The next step, at once, is a run's first: its own undo step.
	await previousDay().click();
	await expect.poll(() => optionsOf()).toEqual({ at: "2026-09-08" });
	expect(apply).toHaveBeenCalledTimes(1);
	expect(amend).not.toHaveBeenCalled();
});

test("a viewer of a read-only view steps for themselves, writing nothing; Make a copy keeps the day", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	dailyFigures({ "2026-09-08": { a: 8 }, "2026-09-09": { a: 9 } });
	const widget = rangedMap(region("019"));
	const changes = new ViewerChanges();
	await showViewer(widget, changes);
	const session = app().current.session!;
	session.readOnly = "unkept";
	const apply = vi.spyOn(session, "apply");
	const amend = vi.spyOn(session, "amend");
	const commit = vi.spyOn(platform.documents, "commit");
	const map = await madeMap();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 9 });
	await previousDay().click();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 8 });
	expect(changes.get(widget.id)).toEqual({ at: "2026-09-08" });
	await new Promise((r) => setTimeout(r, 50));
	expect(apply).not.toHaveBeenCalled();
	expect(amend).not.toHaveBeenCalled();
	expect(commit).not.toHaveBeenCalled();
	expect(optionsOf()).toBeUndefined();
	// A copy holds the viewer's day.
	expect(changes.applyTo(session.doc).body.widgets[0].options).toEqual({ at: "2026-09-08" });
	// Back at the owner's day (the last stop): nothing held.
	await nextDay().click();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 9 });
	expect(changes.get(widget.id)).toBeUndefined();
});

test("a step doesn't move the camera, even when a monitor place has no figure that day", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([
		reading("a", -120, 36),
		reading("b", -119, 37)
	] as never);
	dailyFigures({ "2026-09-08": { a: 8, b: 8 }, "2026-09-09": { a: 9 } });
	await show(rangedMap({ monitors: ["a", "b"], monitorTypes: [] }));
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => drawnValues(map)).toEqual({ a: 9 });
	await expect.poll(() => map.cameraCalls).toHaveLength(1);
	expect(map.cameraCalls[0]).toMatchObject({
		kind: "fitBounds",
		bounds: { west: -120, south: 36, east: -119, north: 37 }
	});
	await previousDay().click();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 8, b: 8 });
	await new Promise((r) => setTimeout(r, 100));
	expect(map.cameraCalls).toHaveLength(1);
});

test("the day stepper sits under the map, with its slider only from 48rem wide", async () => {
	rated();
	frame.style.width = "900px";
	await show(rangedMap(region("019")));
	await madeMap();
	await expect.element(page.getByRole("slider")).toBeVisible();
	const strip = frame.querySelector("[data-map-days]")!;
	const mapView = frame.querySelector("[data-fake-map]")!;
	expect(mapView.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	expect(mapView.contains(strip)).toBe(false);
	frame.style.width = "640px";
	await expect.poll(() => page.getByRole("slider").query()).toBeNull();
	await expect.element(nextDay()).toBeVisible();
	expect(dayLabel()).toBe("Wednesday, September 9, 2026");
});

test("a map with no range shows no day stepper", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	await show(mapWidget(region("019")));
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	expect(frame.querySelector("[data-map-days]")).toBeNull();
	expect(getMonitorSummariesBulkDaily).not.toHaveBeenCalled();
});

// The monitors on a day stop: "Not enough data", and what the figure is.

type MonitorsOptions = {
	detail?: (props: Record<string, unknown>) => string | undefined;
	figureLabel?: string;
	legendUnits?: string;
};
const monitorsOptionsOf = (map: FakeMap) =>
	map.plugins.find((p) => p.id === "monitors")?.options as MonitorsOptions | undefined;
const listNoteOf = (map: FakeMap) => (map.view.featureList as { note?: string } | undefined)?.note;

test("on a day, a thin monitor reads Not enough data and the figure is named; on Now neither", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a"), reading("b")] as never);
	dailyFigures({ "2026-09-09": { a: 20, b: null } });
	const range = { kind: "trailing", amount: 3, unit: "day" } as const;
	const stops = periodStops(range, "day", todayPacific());
	const before = (stops.at(-2) as { at: string }).at;
	dailyFigures({ [before]: { a: 20, b: null } });
	await show(rangedMap(region("019"), undefined, range));
	const map = await madeMap();
	// Now: the live readings keep map-sdk's own look.
	await expect.poll(dayLabel).toBe(m.map_day_now());
	await expect.poll(() => drawn(map)).toEqual(["a", "b"]);
	expect(monitorsOptionsOf(map)?.detail).toBeUndefined();
	expect(monitorsOptionsOf(map)?.figureLabel).toBeUndefined();
	expect(listNoteOf(map)).toBeUndefined();

	const added = vi.spyOn(map, "addPlugin");
	await previousDay().click();
	await expect.poll(() => drawnValues(map)).toEqual({ a: 20, b: null });
	await expect.poll(() => monitorsOptionsOf(map)?.figureLabel).toBe(PM25_FIGURE.label);
	await new Promise((r) => setTimeout(r, 50));
	// One new monitors plugin for the step, with its detail and figure name together.
	expect(added.mock.calls.filter(([p]) => p.id === "monitors")).toHaveLength(1);
	added.mockRestore();
	const source = map.plugins.find((p) => p.id === "monitors")!.options.source as {
		features: { features: { properties: Record<string, unknown> }[] };
	};
	const [a, b] = source.features.features.map((f) => f.properties);
	const detail = monitorsOptionsOf(map)!.detail!;
	expect(detail(b)).toBe(m.calendar_not_enough_data());
	expect(detail(a)).toBeUndefined();
	// A day's legend is as before: "(units)" after the title, no line under it.
	expect(monitorsOptionsOf(map)).not.toHaveProperty("legendUnits");
	// The list names the figure once, above its rows.
	expect(listNoteOf(map)).toBe(PM25_FIGURE.label);

	await nextDay().click();
	await expect.poll(() => monitorsOptionsOf(map)?.figureLabel).toBeUndefined();
	expect(monitorsOptionsOf(map)?.detail).toBeUndefined();
	expect(listNoteOf(map)).toBeUndefined();
});

// Region fills.

const ZIP_META = {
	types: {
		county: {
			type: "county",
			label: "County",
			label_plural: "Counties",
			name_template: "{name} County",
			count: 8,
			parents: [],
			browsable: true
		},
		zipcode: {
			type: "zipcode",
			label: "ZIP code",
			label_plural: "ZIP Codes",
			name_template: "ZIP {name}",
			count: 3,
			parents: ["county"],
			browsable: true
		},
		mtrs: {
			type: "mtrs",
			label: "Section",
			label_plural: "Sections",
			name_template: null,
			count: 9000,
			parents: [],
			browsable: false
		}
	},
	location_types: {},
	buffers: []
};

/** A ZIP code's shape: server id `z<code>`. */
function zipShape(code: string, x: number) {
	const s = square(x, 0);
	return {
		...s,
		id: `z${code}`,
		properties: {
			id: `z${code}`,
			name: code,
			slug: code,
			type: "zipcode",
			external_id: code,
			retired: null
		}
	};
}

/** Three ZIP codes; the summaries hold rows for the first two only. */
function zipFill(today = 5, day: Record<string, number> = {}) {
	vi.mocked(getRegionsMeta).mockResolvedValue(ZIP_META as never);
	vi.mocked(regionTypeShapes).mockResolvedValue([
		zipShape("93721", 10),
		zipShape("93722", 11),
		zipShape("93723", 12)
	] as never);
	vi.mocked(getRegionSummariesBulkDailyOpen).mockResolvedValue([
		{ id: "z93721", summaries: [dayRow(todayPacific(), today, false)] },
		{ id: "z93722", summaries: [dayRow(todayPacific(), null, false)] }
	] as never);
	vi.mocked(getRegionSummariesBulkDaily).mockImplementation((async (config: { start: string }) =>
		Object.entries(day).map(([code, value]) => ({
			id: `z${code}`,
			summaries: [dayRow(config.start, value)]
		}))) as never);
}

type FillPlugin = {
	kind: string;
	options: {
		id: string;
		layerLabel: string;
		selectable: boolean;
		noFigure: string;
		source: {
			features: { features: { properties: Record<string, unknown> }[] } | null;
			scale: unknown;
			status: unknown;
		};
	};
	addOptions?: Record<string, unknown>;
};
const fillOf = (map: FakeMap) =>
	map.plugins.find((p) => p.id === "fill") as unknown as FillPlugin | undefined;
/** The fill's value per region ref. */
function fillValues(map: FakeMap): Record<string, unknown> | undefined {
	const features = fillOf(map)?.options.source.features?.features;
	if (!features) return undefined;
	return Object.fromEntries(features.map((f) => [f.properties.refKey, f.properties.value]));
}

test("a fill draws under the focus area, every region of its type, today so far on Now", async () => {
	rated();
	zipFill();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	await show({ ...mapWidget(region("019")), options: { fill: "zipcode" } });
	const map = await madeMap();
	await expect.poll(() => pluginIds(map)).toEqual(["fill", "focus", "monitors"]);
	const fill = fillOf(map)!;
	expect(fill.kind).toBe("regions");
	expect(fill.addOptions).toEqual({ before: "focus" });
	expect(fill.options).toMatchObject({
		id: "fill",
		layerLabel: m.map_fill_today_so_far({ regionType: "ZIP Codes" }),
		selectable: false,
		noFigure: "outline"
	});
	expect(fill.options.layerLabel).toBe("ZIP Codes, today so far");
	await expect
		.poll(() => fillValues(map))
		.toEqual({
			"region:zipcode:93721": 5,
			// A row without enough data, and a region missing from the summaries: no figure (no data).
			"region:zipcode:93722": null,
			"region:zipcode:93723": null
		});
	expect(fill.options.source.features!.features[0].properties.name).toBe("ZIP 93721");
	expect(fill.options.source.status).toEqual({ state: "ready" });
	// The monitors' ScaleRef exactly: the legend shares one section.
	const monitors = map.plugins.find((p) => p.id === "monitors")!.options.source as {
		scale: unknown;
	};
	expect(fill.options.source.scale).toEqual({ dataset: "air-quality", entryType: "pm25" });
	expect(fill.options.source.scale).toEqual(monitors.scale);
	// map-sdk matches a resolved scale to its source by identity: each read gives the same object.
	expect(fill.options.source.scale).toBe(fill.options.source.scale);
	// Today's open-day rows for the whole type, over the whole map (not the places).
	expect(getRegionSummariesBulkDailyOpen).toHaveBeenCalledWith(
		{ entryType: "pm25", type: "zipcode" },
		expect.anything()
	);
	expect(regionTypeShapes).toHaveBeenCalledWith("zipcode", expect.anything());
	const entry = () => nowClient.entries().find((e) => e.key.startsWith("map-fill"));
	await expect
		.poll(entry)
		.toMatchObject({ key: `map-fill:pm25:zipcode:today:${todayPacific()}`, polling: true });
});

test("the Now fill is a new source at Pacific midnight, not yesterday's held for an hour", async () => {
	rated();
	vi.useFakeTimers({
		toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
		shouldAdvanceTime: true
	});
	try {
		// 23:59:30 Pacific on November 14 (already November 15 in New York or UTC).
		vi.setSystemTime(new Date("2026-11-15T07:59:30Z"));
		nowClient = createNowClient({ activity: { visible: () => true, onChange: () => () => {} } });
		vi.mocked(getNowClient).mockReturnValue(nowClient);
		zipFill();
		vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
		await show({ ...mapWidget(region("019")), options: { fill: "zipcode" } });
		await madeMap();
		const keys = () =>
			nowClient
				.entries()
				.map((e) => e.key)
				.filter((k) => k.startsWith("map-fill"));
		await expect.poll(keys).toEqual(["map-fill:pm25:zipcode:today:2026-11-14"]);
		const asked = vi.mocked(getRegionSummariesBulkDailyOpen).mock.calls.length;
		// The clock's next minute tick is past midnight: today's fill is asked for at once.
		await vi.advanceTimersByTimeAsync(61_000);
		await expect.poll(keys).toContain("map-fill:pm25:zipcode:today:2026-11-15");
		expect(vi.mocked(getRegionSummariesBulkDailyOpen).mock.calls.length).toBeGreaterThan(asked);
	} finally {
		vi.useRealTimers();
	}
});

test("on a day, the fill draws the day's figures, labelled by its type", async () => {
	rated();
	zipFill(5, { "93721": 40 });
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	dailyFigures({ "2026-09-09": { a: 20 } });
	await show(rangedMap(region("019"), { fill: "zipcode" }));
	const map = await madeMap();
	await expect.poll(dayLabel).toBe("Wednesday, September 9, 2026");
	await expect
		.poll(() => fillValues(map))
		.toEqual({
			"region:zipcode:93721": 40,
			"region:zipcode:93722": null,
			"region:zipcode:93723": null
		});
	expect(fillOf(map)!.options.layerLabel).toBe("ZIP Codes");
	expect(getRegionSummariesBulkDaily).toHaveBeenCalledWith(
		{ entryType: "pm25", start: "2026-09-09", end: "2026-09-09", type: "zipcode" },
		expect.anything()
	);
	expect(getRegionSummariesBulkDailyOpen).not.toHaveBeenCalled();
	// A final day isn't polled.
	const entry = nowClient.entries().find((e) => e.key === "map-fill:pm25:zipcode:2026-09-09");
	expect(entry).toMatchObject({ polling: false });
});

test("on a day, a thin region says Not enough data; a region with no row says nothing more", async () => {
	rated();
	zipFill();
	// 93721 has a final row with no figure (thin); 93722 has a figure; 93723 has no row at all.
	vi.mocked(getRegionSummariesBulkDaily).mockImplementation((async (config: { start: string }) => [
		{ id: "z93721", summaries: [dayRow(config.start, null)] },
		{ id: "z93722", summaries: [dayRow(config.start, 40)] }
	]) as never);
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	dailyFigures({ "2026-09-09": { a: 20 } });
	await show(rangedMap(region("019"), { fill: "zipcode" }));
	const map = await madeMap();
	await expect.poll(dayLabel).toBe("Wednesday, September 9, 2026");
	await expect
		.poll(() => fillValues(map))
		.toEqual({
			"region:zipcode:93721": null,
			"region:zipcode:93722": 40,
			"region:zipcode:93723": null
		});
	// map-sdk puts the detail in the list row's accessible name and the hover card (E2E checks both).
	const detail = (fillOf(map)!.options as { detail?: (p: unknown) => string | undefined }).detail;
	const props = (code: string) =>
		fillOf(map)!.options.source.features!.features.find(
			(f) => f.properties.refKey === `region:zipcode:${code}`
		)!.properties;
	expect(detail?.(props("93721"))).toBe(m.calendar_not_enough_data());
	expect(detail?.(props("93722"))).toBeUndefined();
	expect(detail?.(props("93723"))).toBeUndefined();
});

test("the Layers group shows with a fill alone; its row hides the fill without a new request", async () => {
	rated();
	zipFill();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const widget = { ...mapWidget(region("019")), options: { fill: "zipcode" } };
	const screen = await showLive(widget, editing());
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => pluginIds(map)).toEqual(["fill", "focus", "monitors"]);
	await expect.poll(() => fillValues(map)).toBeTruthy();
	const box = screen.getByRole("checkbox", { name: "ZIP Codes" });
	await expect.element(box).toBeChecked();
	expect(
		screen.getByRole("checkbox", { name: mapMessages("mapsdk_options_fire_smoke") }).query()
	).toBeNull();
	const asked = vi.mocked(getRegionSummariesBulkDailyOpen).mock.calls.length;
	await box.click();
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "monitors"]);
	expect(optionsOf()).toEqual({ fill: "zipcode", fillShown: false });
	// Its data keeps loading: showing it again draws at once.
	const fill = () => nowClient.entries().find((e) => e.key.startsWith("map-fill"));
	expect(fill()?.subscribers ?? 0).toBeGreaterThan(0);
	await screen.getByRole("button", { name: mapMessages("mapsdk_options_reset") }).click();
	await expect.poll(optionsOf).toEqual({ fill: "zipcode" });
	await expect.poll(() => pluginIds(map)).toEqual(["fill", "focus", "monitors"]);
	expect(fillValues(map)).toBeTruthy();
	expect(getRegionSummariesBulkDailyOpen).toHaveBeenCalledTimes(asked);
	await box.click();
	await expect.poll(() => optionsOf()?.fillShown).toBe(false);
	await box.click();
	await expect.poll(optionsOf).toEqual({ fill: "zipcode" });
});

test("a saved fill the regions meta doesn't list draws no fill, offers no row, writes nothing", async () => {
	rated();
	zipFill();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	for (const type of ["mtrs", "nowhere"]) {
		fakeMaps.reset();
		const widget = { ...mapWidget(region("019")), options: { fill: type, fillShown: false } };
		const screen = await showLive(widget, editing());
		const map = await madeMap();
		map.ready = true;
		await expect.poll(() => drawn(map)).toEqual(["a"]);
		await expect.poll(() => vi.mocked(getRegionsMeta).mock.calls.length).toBeGreaterThan(0);
		await new Promise((r) => setTimeout(r, 50));
		expect(pluginIds(map)).toEqual(["focus", "monitors"]);
		expect(screen.getByRole("checkbox", { name: "Sections" }).query()).toBeNull();
		expect(
			screen.getByRole("button", { name: mapMessages("mapsdk_options_layers") }).query()
		).toBeNull();
		expect(getRegionSummariesBulkDailyOpen).not.toHaveBeenCalled();
		expect(regionTypeShapes).not.toHaveBeenCalled();
		expect(optionsOf()).toEqual({ fill: type, fillShown: false });
		await screen.unmount();
	}
});

test("a viewer hides the fill for themselves, writing nothing", async () => {
	rated();
	zipFill();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const widget = { ...mapWidget(region("019")), options: { fill: "zipcode" } };
	const changes = new ViewerChanges();
	const screen = await showViewer(widget, changes);
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => pluginIds(map)).toEqual(["fill", "focus", "monitors"]);
	await screen.getByRole("checkbox", { name: "ZIP Codes" }).click();
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "monitors"]);
	expect(changes.get(widget.id)).toEqual({ fillShown: false });
	expect(optionsOf()).toEqual({ fill: "zipcode" });
	await screen.getByRole("checkbox", { name: "ZIP Codes" }).click();
	await expect.poll(() => pluginIds(map)).toEqual(["fill", "focus", "monitors"]);
	expect(changes.get(widget.id)).toBeUndefined();
});

test("a hidden fill (fillShown false) loads but isn't drawn", async () => {
	rated();
	zipFill();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	await show({ ...mapWidget(region("019")), options: { fill: "zipcode", fillShown: false } });
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	await expect.poll(() => getRegionSummariesBulkDailyOpen).toHaveBeenCalled();
	expect(pluginIds(map)).toEqual(["focus", "monitors"]);
});

test("clicking a region shows its card with no Select button", async () => {
	rated();
	zipFill();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const screen = await showLive({ ...mapWidget(region("019")), options: { fill: "zipcode" } });
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => fillValues(map)).toBeTruthy();
	pin(map, "region:zipcode:93721", "fill");
	await expect
		.poll(() => frame.querySelector(`[data-fake-card="region:zipcode:93721"]`))
		.toBeTruthy();
	expect(screen.getByRole("button", { name: m.map_mark_select() }).query()).toBeNull();
});

test("a failed region types lookup says the fill couldn't load, and Retry looks again", async () => {
	rated();
	zipFill();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	vi.mocked(getRegionsMeta).mockRejectedValueOnce(new Error("offline"));
	const screen = await show({ ...mapWidget(region("019")), options: { fill: "zipcode" } });
	const map = await madeMap();
	await expect.element(screen.getByText(m.map_fill_failed())).toBeVisible();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	expect(pluginIds(map)).toEqual(["focus", "monitors"]);
	await frame.querySelector<HTMLElement>("[data-map-fill-note] button")!.click();
	await expect.poll(() => screen.getByText(m.map_fill_failed()).query()).toBeNull();
	await expect.poll(() => pluginIds(map)).toEqual(["fill", "focus", "monitors"]);
	await expect.poll(() => fillValues(map)?.["region:zipcode:93721"]).toBe(5);
	expect(getRegionsMeta).toHaveBeenCalledTimes(2);
});

test("a fill that fails to load keeps the map, with a note and Retry", async () => {
	rated();
	zipFill();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	vi.mocked(getRegionSummariesBulkDailyOpen).mockRejectedValueOnce(new Error("offline"));
	const screen = await show({ ...mapWidget(region("019")), options: { fill: "zipcode" } });
	const map = await madeMap();
	await expect.element(screen.getByText(m.map_fill_failed())).toBeVisible();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	expect(fillOf(map)!.options.source.status).toEqual({ state: "ready" });
	await frame.querySelector<HTMLElement>("[data-map-fill-note] button")!.click();
	await expect.poll(() => screen.getByText(m.map_fill_failed()).query()).toBeNull();
	await expect.poll(() => fillValues(map)?.["region:zipcode:93721"]).toBe(5);
});

// Spray notices.

type NoticesPlugin = {
	kind: string;
	options: {
		id: string;
		layerLabel: string;
		legendUnits?: string;
		legendNote?: Snippet;
		count?: { property: string };
		cluster?: { radius: number; maxZoom: number; properties?: unknown };
		tooltip?: (item: unknown, props: Record<string, unknown>, env: unknown) => Snippet | undefined;
		tooltipShowsName?: boolean;
		source: {
			features: { features: { properties: Record<string, unknown> }[] } | null;
			scale: unknown;
			status: unknown;
		};
	};
	addOptions?: Record<string, unknown>;
};
const noticesOf = (map: FakeMap) =>
	map.plugins.find((p) => p.id === "notices") as unknown as NoticesPlugin | undefined;

/** A Map of county 019 with the spray notices layer (with `filters`, if given). */
function noticesMap(filters?: Record<string, unknown>): WidgetInstance {
	return {
		...mapWidget({}),
		data: layers(region("019"), [{ dataset: "pesticide-notices", ...(filters && { filters }) }])
	};
}

/** The notices plugin's legend note, rendered as map-sdk's legend does, once it's added. */
async function noticesNote(map: FakeMap) {
	await expect.poll(() => noticesOf(map)?.options.legendNote).toBeDefined();
	return render(RenderSnippet, { snippet: noticesOf(map)!.options.legendNote! });
}

function notFound(): Error {
	return new Error("Not found", { cause: { result: { status: 404 } } });
}

test("adds the notices plugin under the monitors when the tile has notices", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	vi.mocked(getActivePesticideNotices).mockResolvedValue(
		noticeCollection([sprayNotice("n1", "s1"), sprayNotice("n2", "s1")]) as never
	);
	await show(noticesMap());
	const map = await madeMap();
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "notices", "monitors"]);
	const notices = noticesOf(map)!;
	expect(notices.kind).toBe("points");
	expect(notices.addOptions).toEqual({ before: "monitors" });
	expect(notices.options).toMatchObject({
		id: "notices",
		layerLabel: "Spray Notices",
		count: { property: "count" }
	});
	// Clustered (the toolbar's default), summed by map-sdk itself: no clusterProperties of ours.
	expect(notices.options.cluster).toBeDefined();
	expect(notices.options.cluster?.properties).toBeUndefined();
	await expect.poll(() => notices.options.source.features?.features).toHaveLength(1);
	expect(notices.options.source.features!.features[0].properties).toMatchObject({
		count: 2,
		value: "notice"
	});
	// Over the whole map: never limited by the places.
	expect(getActivePesticideNotices).toHaveBeenCalledWith(
		expect.not.objectContaining({ bbox: expect.anything() })
	);
});

test("a notices marker's card is the notice card, from the source's notices array", async () => {
	vi.mocked(getActivePesticideNotices).mockResolvedValue(
		noticeCollection([sprayNotice("n1", "s1"), sprayNotice("n2", "s1")]) as never
	);
	await show(noticesMap());
	const map = await madeMap();
	await expect.poll(() => noticesOf(map)?.options.source.features?.features).toHaveLength(1);
	const notices = noticesOf(map)!;
	// The card shows its own heading, so map-sdk draws no name above it.
	expect(notices.options.tooltipShowsName).toBe(true);
	const props = notices.options.source.features!.features[0].properties;
	// map-sdk hands the tooltip the source's properties: the notices are objects, not JSON.
	expect(Array.isArray(props.notices)).toBe(true);
	const item = { refKey: props.refKey };
	// On hover (nothing pinned): the static form, with nothing focusable.
	const hover = notices.options.tooltip!(item, props, {});
	expect(hover).toBeDefined();
	const tip = await render(RenderSnippet, { snippet: hover! });
	await expect
		.element(tip.getByText(m.map_notice_list_heading({ count: "2", countValue: 2 })))
		.toBeVisible();
	await expect
		.element(tip.getByText(m.map_notice_where({ section: "Section s1", county: "Fresno" })))
		.toBeVisible();
	expect(tip.container.querySelectorAll("button, a, [tabindex]")).toHaveLength(0);
	tip.unmount();
	// Pinned: the interactive card, one button per notice.
	map.pinned = { hit: { pluginId: "notices", refKey: props.refKey as string, name: "" } };
	const card = await render(RenderSnippet, {
		snippet: notices.options.tooltip!(item, props, {})!
	});
	await expect.poll(() => card.container.querySelectorAll("button").length).toBe(2);
	card.unmount();
});

test("a notice card keeps focus when map-sdk asks for its content again", async () => {
	// map-sdk re-reads the tooltip whenever the card's feature is found again, e.g. when Tab moves
	// focus from the feature list into the card and the list clears its focused key while the
	// card stays pinned. The same card must come back, or the focused button is detached.
	vi.mocked(getActivePesticideNotices).mockResolvedValue(
		noticeCollection([sprayNotice("n1", "s1"), sprayNotice("n2", "s1")]) as never
	);
	await show(noticesMap());
	const map = await madeMap();
	await expect.poll(() => noticesOf(map)?.options.source.features?.features).toHaveLength(1);
	const notices = noticesOf(map)!;
	const props = notices.options.source.features!.features[0].properties;
	const item = { refKey: props.refKey };
	map.pinned = { hit: { pluginId: "notices", refKey: props.refKey as string, name: "" } };
	const first = notices.options.tooltip!(item, props, {})!;
	const card = await render(RenderSnippet, { snippet: first });
	await expect.poll(() => card.container.querySelectorAll("li button").length).toBe(2);
	const row = card.container.querySelector<HTMLButtonElement>("li button")!;
	row.focus();
	expect(document.activeElement).toBe(row);
	// Asked again with nothing changed: the same snippet, so nothing mounts again.
	const again = notices.options.tooltip!(item, props, {})!;
	expect(again).toBe(first);
	await card.rerender({ snippet: again });
	expect(row.isConnected).toBe(true);
	expect(document.activeElement).toBe(row);
	card.unmount();
});

describe("a notice card across a notices refetch", () => {
	/** A notice with another amount, as a later fetch might give it. */
	const treated = (notice: ReturnType<typeof sprayNotice>, amount: number) => ({
		...notice,
		properties: { ...notice.properties, treated_amount: amount }
	});

	/** The pinned card of the one marker, with the detail of its second notice open. */
	async function openSecond() {
		const map = await madeMap();
		await expect.poll(() => noticesOf(map)?.options.source.features?.features).toHaveLength(1);
		const notices = noticesOf(map)!;
		const propsNow = () => notices.options.source.features!.features[0].properties;
		const props = propsNow();
		const item = { refKey: props.refKey };
		map.pinned = { hit: { pluginId: "notices", refKey: props.refKey as string, name: "" } };
		const first = notices.options.tooltip!(item, props, {})!;
		const card = await render(RenderSnippet, { snippet: first });
		await expect.poll(() => card.container.querySelectorAll("li button").length).toBe(2);
		card.container.querySelectorAll<HTMLButtonElement>("li button")[1].click();
		const backLabel = m.map_notice_back({ count: "2", countValue: 2 });
		await expect.poll(() => document.activeElement?.textContent?.trim()).toBe(backLabel);
		const back = document.activeElement as HTMLButtonElement;
		/** Refetches the notices, then asks for the card again as map-sdk does on new props. */
		async function refetch() {
			const before = propsNow();
			nowClient.refetch(nowClient.entries().find((e) => e.key.startsWith("map-notices"))!.key);
			await expect.poll(() => propsNow()).not.toBe(before);
			const again = notices.options.tooltip!(item, propsNow(), {})!;
			await card.rerender({ snippet: again });
			return again;
		}
		return { card, first, back, refetch };
	}

	test("keeps the open detail and the focus on Back", async () => {
		vi.mocked(getActivePesticideNotices).mockResolvedValue(
			noticeCollection([sprayNotice("n1", "s1"), sprayNotice("n2", "s1")]) as never
		);
		await show(noticesMap());
		const { card, first, back, refetch } = await openSecond();
		expect(await refetch()).toBe(first);
		expect(back.isConnected).toBe(true);
		expect(document.activeElement).toBe(back);
		card.unmount();
	});

	test("shows the new data in the open card", async () => {
		vi.mocked(getActivePesticideNotices)
			.mockResolvedValueOnce(
				noticeCollection([sprayNotice("n1", "s1"), sprayNotice("n2", "s1")]) as never
			)
			.mockResolvedValue(
				noticeCollection([sprayNotice("n1", "s1"), treated(sprayNotice("n2", "s1"), 25)]) as never
			);
		await show(noticesMap());
		const { card, back, refetch } = await openSecond();
		const amount = (value: number) =>
			m.map_notice_amount({ amount: formatNumber(value), units: "A" });
		await expect.element(card.getByText(amount(10))).toBeVisible();
		await refetch();
		await expect.element(card.getByText(amount(25))).toBeVisible();
		expect(document.activeElement).toBe(back);
		card.unmount();
	});

	test("when the open notice is gone, falls back to the list with focus kept in the card", async () => {
		vi.mocked(getActivePesticideNotices)
			.mockResolvedValueOnce(
				noticeCollection([sprayNotice("n1", "s1"), sprayNotice("n2", "s1")]) as never
			)
			.mockResolvedValueOnce(
				noticeCollection([
					sprayNotice("n1", "s1"),
					sprayNotice("n3", "s1"),
					sprayNotice("n4", "s1")
				]) as never
			)
			.mockResolvedValue(noticeCollection([sprayNotice("n1", "s1")]) as never);
		await show(noticesMap());
		const { card, refetch } = await openSecond();
		await refetch();
		// The list again, focus on its first row.
		await expect.poll(() => card.container.querySelectorAll("li button").length).toBe(3);
		const rows = card.container.querySelectorAll<HTMLButtonElement>("li button");
		await expect.poll(() => document.activeElement).toBe(rows[0]);
		// Open a row, then the marker drops to one notice, not the one open: its detail, focus
		// still in the card.
		rows[2].click();
		const backLabel = m.map_notice_back({ count: "3", countValue: 3 });
		await expect.poll(() => document.activeElement?.textContent?.trim()).toBe(backLabel);
		await refetch();
		await expect.poll(() => card.container.querySelectorAll("button").length).toBe(0);
		await expect
			.poll(() =>
				card.container.querySelector("[data-notice-card]")?.contains(document.activeElement)
			)
			.toBe(true);
		card.unmount();
	});
});

test("no notices plugin and no fetch without the layer", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	await show(mapWidget(region("019")));
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	expect(pluginIds(map)).toEqual(["focus", "monitors"]);
	expect(getActivePesticideNotices).not.toHaveBeenCalled();
});

test("the notices row appears only when the tile has notices", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const without = await showLive(mapWidget(region("019")), editing());
	const first = await madeMap();
	first.ready = true;
	await expect.poll(() => drawn(first)).toEqual(["a"]);
	expect(
		without.getByRole("button", { name: mapMessages("mapsdk_options_layers") }).query()
	).toBeNull();
	expect(without.getByRole("checkbox", { name: "Spray Notices" }).query()).toBeNull();
	await without.unmount();

	fakeMaps.reset();
	const screen = await showLive(noticesMap(), editing());
	const map = await madeMap();
	map.ready = true;
	await expect.element(screen.getByRole("checkbox", { name: "Spray Notices" })).toBeChecked();
	expect(fakeToolbars.last!.groups.find((g) => g.id === "layers")?.rows.map((r) => r.id)).toEqual([
		"notices"
	]);
});

test("the Layers row hides notices without unloading them", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	vi.mocked(getActivePesticideNotices).mockResolvedValue(
		noticeCollection([sprayNotice("n1", "s1")]) as never
	);
	const screen = await showLive(noticesMap(), editing());
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "notices", "monitors"]);
	await expect.poll(() => noticesOf(map)?.options.source.features?.features).toHaveLength(1);
	const asked = vi.mocked(getActivePesticideNotices).mock.calls.length;
	const box = screen.getByRole("checkbox", { name: "Spray Notices" });
	await box.click();
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "monitors"]);
	expect(optionsOf()).toEqual({ noticesShown: false });
	// Their data keeps loading: showing them again draws at once, with no new request.
	const entry = () => nowClient.entries().find((e) => e.key.startsWith("map-notices"));
	expect(entry()?.subscribers ?? 0).toBeGreaterThan(0);
	await box.click();
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "notices", "monitors"]);
	expect(optionsOf()).toBeUndefined();
	expect(noticesOf(map)!.options.source.features?.features).toHaveLength(1);
	expect(getActivePesticideNotices).toHaveBeenCalledTimes(asked);
});

test("a viewer hides the notices for themselves, writing nothing", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const widget = noticesMap();
	const changes = new ViewerChanges();
	const screen = await showViewer(widget, changes);
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "notices", "monitors"]);
	await screen.getByRole("checkbox", { name: "Spray Notices" }).click();
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "monitors"]);
	// The row's key is held as the option it writes (noticesShown), nothing else.
	expect(changes.get(widget.id)).toEqual({ noticesShown: false });
	expect(optionsOf()).toBeUndefined();
	await screen.getByRole("checkbox", { name: "Spray Notices" }).click();
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "notices", "monitors"]);
	expect(changes.get(widget.id)).toBeUndefined();
});

test("notices failure note: Retry fetches again while the monitors stay drawn", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	vi.mocked(getActivePesticideNotices)
		.mockRejectedValueOnce(new Error("offline"))
		.mockResolvedValue(noticeCollection([sprayNotice("n1", "s1")]) as never);
	const screen = await show(noticesMap());
	const map = await madeMap();
	await expect.element(screen.getByText(m.map_notices_failed())).toBeVisible();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	expect(screen.getByText(m.widget_state_error()).query()).toBeNull();
	// map-sdk sees no error, so its legend offers no second Retry: only the note's.
	expect(noticesOf(map)!.options.source.status).toEqual({ state: "ready" });
	const note = frame.querySelector<HTMLElement>("[data-map-notices-note]")!;
	expect(note.querySelectorAll("button")).toHaveLength(1);
	await note.querySelector("button")!.click();
	await expect.poll(() => screen.getByText(m.map_notices_failed()).query()).toBeNull();
	await expect.poll(() => noticesOf(map)?.options.source.features?.features).toHaveLength(1);
	expect(getActivePesticideNotices).toHaveBeenCalledTimes(2);
	expect(drawn(map)).toEqual(["a"]);
});

test("the notices source's scale is one stable ScaleRef", async () => {
	vi.mocked(getActivePesticideNotices).mockResolvedValue(
		noticeCollection([sprayNotice("n1", "s1")]) as never
	);
	await show(noticesMap());
	const map = await madeMap();
	await expect.poll(() => noticesOf(map)?.options.source.features?.features).toHaveLength(1);
	const source = noticesOf(map)!.options.source;
	// map-sdk matches the resolved scale to its source's by identity: the same object every read.
	expect(source.scale).toBe(NOTICES_SCALE);
	expect(source.scale).toBe(source.scale);
	expect(NOTICES_SCALE).toEqual({ dataset: "pesticide-notices", entryType: "spray-notice" });
	// The legend row's units line: what a marker's number means.
	expect(noticesOf(map)!.options.legendUnits).toBe(m.map_notices_legend_units());
});

test("a day with no notices says so, with the explainer", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	dailyFigures({ "2026-09-09": { a: 9 } });
	const widget: WidgetInstance = {
		...rangedMap(region("019")),
		data: { ...layers(region("019"), [{ dataset: "pesticide-notices" }]), dateRange: RANGE }
	};
	await show(widget);
	const map = await madeMap();
	await expect
		.poll(() => vi.mocked(getActivePesticideNotices).mock.calls.length)
		.toBeGreaterThan(0);
	const note = await noticesNote(map);
	await expect.element(note.getByText(m.map_notices_none_day())).toBeVisible();
	expect(note.container.textContent).not.toContain(m.map_notices_none_now());
	// The explainer still reminds that no notice doesn't mean no spraying; its title links out.
	await expect.element(note.getByText(PESTICIDES_META.notes.noi_meaning.summary)).toBeVisible();
	const link = note.getByRole("link", {
		name: new RegExp(PESTICIDES_META.notes.noi_meaning.title)
	});
	await expect.element(link).toHaveAttribute("href", NOI_SOURCE);
	await expect.element(link).toHaveAttribute("rel", "noopener noreferrer");
	note.unmount();
});

test("on now, no notices says none right now, not a day without them; the explainer shows", async () => {
	await show(noticesMap());
	const map = await madeMap();
	const note = await noticesNote(map);
	await expect.element(note.getByText(m.map_notices_none_now())).toBeVisible();
	await expect.element(note.getByText(PESTICIDES_META.notes.noi_meaning.summary)).toBeVisible();
	expect(note.container.textContent).not.toContain(m.map_notices_none_day());
	note.unmount();
});

test("on now, the none line waits for the notices to load", async () => {
	vi.mocked(getActivePesticideNotices).mockReturnValue(new Promise(() => {}) as never);
	await show(noticesMap());
	const map = await madeMap();
	const note = await noticesNote(map);
	await expect.element(note.getByText(PESTICIDES_META.notes.noi_meaning.summary)).toBeVisible();
	expect(note.container.textContent).not.toContain(m.map_notices_none_now());
	note.unmount();
});

test("the No spray notices line doesn't flicker across a poll, and goes when notices come", async () => {
	let release!: (value: unknown) => void;
	vi.mocked(getActivePesticideNotices)
		.mockResolvedValueOnce(noticeCollection([]) as never)
		.mockReturnValueOnce(new Promise((resolve) => (release = resolve)) as never);
	await show(noticesMap());
	const map = await madeMap();
	const note = await noticesNote(map);
	await expect.element(note.getByText(m.map_notices_none_now())).toBeVisible();
	// The poll: the notices are loading again, and the line stays.
	const key = nowClient.entries().find((e) => e.key.startsWith("map-notices"))!.key;
	nowClient.refetch(key);
	await expect
		.poll(() => vi.mocked(getActivePesticideNotices).mock.calls.length)
		.toBeGreaterThan(1);
	// The client hands the widget its loading state as the fetch starts; flush it to the page.
	expect(nowClient.entries().find((e) => e.key === key)?.inFlight).toBe(true);
	flushSync();
	expect(note.container.textContent).toContain(m.map_notices_none_now());
	// A real change still shows: the poll brings a notice, and the line goes.
	release(noticeCollection([sprayNotice("n1", "s1")]));
	await expect.poll(() => noticesOf(map)?.options.source.features?.features).toHaveLength(1);
	await expect.poll(() => note.container.textContent).not.toContain(m.map_notices_none_now());
	note.unmount();
});

test("on now, a failed fetch isn't called none", async () => {
	vi.mocked(getActivePesticideNotices).mockRejectedValue(new Error("offline"));
	const screen = await show(noticesMap());
	const map = await madeMap();
	await expect.element(screen.getByText(m.map_notices_failed())).toBeVisible();
	const note = await noticesNote(map);
	await expect.element(note.getByText(PESTICIDES_META.notes.noi_meaning.summary)).toBeVisible();
	expect(note.container.textContent).not.toContain(m.map_notices_none_now());
	note.unmount();
});

test("on now, a gone filter isn't called none", async () => {
	vi.mocked(getChemicalDetails).mockRejectedValue(notFound());
	const screen = await show(noticesMap({ chemical: "gone" }));
	const map = await madeMap();
	await expect.element(screen.getByText(m.map_notices_filter_gone())).toBeVisible();
	const note = await noticesNote(map);
	await expect.element(note.getByText(PESTICIDES_META.notes.noi_meaning.summary)).toBeVisible();
	expect(note.container.textContent).not.toContain(m.map_notices_none_now());
	note.unmount();
});

test("a day with notices doesn't say there are none", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	dailyFigures({ "2026-09-09": { a: 9 } });
	vi.mocked(getActivePesticideNotices).mockResolvedValue(
		noticeCollection([sprayNotice("n1", "s1")]) as never
	);
	const widget: WidgetInstance = {
		...rangedMap(region("019")),
		data: { ...layers(region("019"), [{ dataset: "pesticide-notices" }]), dateRange: RANGE }
	};
	await show(widget);
	const map = await madeMap();
	await expect.poll(() => noticesOf(map)?.options.source.features?.features).toHaveLength(1);
	const note = await noticesNote(map);
	await expect.element(note.getByText(PESTICIDES_META.notes.noi_meaning.summary)).toBeVisible();
	expect(note.container.textContent).not.toContain(m.map_notices_none_day());
	note.unmount();
});

test("the legend names the active filters", async () => {
	vi.mocked(getChemicalDetails).mockResolvedValue({ display_name: "1,3-Dichloropropene" } as never);
	await show(noticesMap({ chemical: "c1", category: ["fumigant"] }));
	const map = await madeMap();
	const note = await noticesNote(map);
	// As charts' legends name them: the filters' names, joined as labels are.
	const named = m.label_join({ first: "1,3-Dichloropropene", second: "Fumigants" });
	await expect
		.element(note.getByText(m.map_notices_legend_filters({ filters: named })))
		.toBeVisible();
	note.unmount();
});

test("the legend says which filters don't apply to spray notices", async () => {
	vi.mocked(getCommodityDetails).mockResolvedValue({ display_name: "Grapes" } as never);
	await show(noticesMap({ commodity: "k1", category: ["fumigant"] }));
	const map = await madeMap();
	const note = await noticesNote(map);
	await expect
		.element(
			note.getByText(m.getdata_map_notices_filter_skipped({ filter: m.get_data_filter_crop() }))
		)
		.toBeVisible();
	// The category applies: it isn't named as skipped, and it alone is named as filtering.
	expect(note.container.textContent).not.toContain(
		m.getdata_map_notices_filter_skipped({ filter: m.get_data_filter_category() })
	);
	await expect
		.element(note.getByText(m.map_notices_legend_filters({ filters: "Fumigants" })))
		.toBeVisible();
	expect(note.container.textContent).not.toContain("Grapes");
	note.unmount();
});

test("with only filters that don't apply, the legend names none as filtering", async () => {
	vi.mocked(getCommodityDetails).mockResolvedValue({ display_name: "Grapes" } as never);
	await show(noticesMap({ commodity: "k1" }));
	const map = await madeMap();
	const note = await noticesNote(map);
	await expect
		.element(
			note.getByText(m.getdata_map_notices_filter_skipped({ filter: m.get_data_filter_crop() }))
		)
		.toBeVisible();
	await expect.element(note.getByText(PESTICIDES_META.notes.noi_meaning.summary)).toBeVisible();
	await new Promise((r) => setTimeout(r, 50));
	expect(note.container.textContent).not.toContain("Grapes");
	expect(note.container.textContent).not.toContain(
		m.map_notices_legend_filters({ filters: "" }).trim()
	);
	note.unmount();
});

test("a gone filter is said, not an empty layer", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	vi.mocked(getChemicalDetails).mockRejectedValue(notFound());
	const screen = await show(noticesMap({ chemical: "gone" }));
	const map = await madeMap();
	// map-sdk's legend shows the layer as unavailable (a status row), with no features drawn.
	await expect
		.poll(() => noticesOf(map)?.options.source.status)
		.toEqual({
			state: "unavailable",
			reason: "filter-gone",
			message: m.map_notices_filter_gone()
		});
	expect(noticesOf(map)!.options.source.features).toBeNull();
	// And the map says why, with Edit data to change the filter; the monitors stay drawn.
	await expect.element(screen.getByText(m.map_notices_filter_gone())).toBeVisible();
	expect(frame.querySelector("[data-map-notices-gone]")).toBeTruthy();
	await expect.element(screen.getByRole("button", { name: m.widget_edit_data() })).toBeVisible();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	expect(getActivePesticideNotices).not.toHaveBeenCalled();
});

// Pesticide use: townships, the lens and sections, the toolbar's group and row, the legend note.

const USE_CLASS = { breaks: [10, 100], min: 1, colors: ["#111111", "#222222"] };
const ACRES_CLASS = { breaks: [5, 50], min: 1, colors: ["#333333", "#444444"] };
const USE_CLASSES = {
	lbs_chemical: USE_CLASS,
	acres_treated: ACRES_CLASS,
	applications: USE_CLASS
};

/** A square from (x, y), `size` on a side. */
const useSquare = (x: number, y: number, size: number) => ({
	type: "Polygon" as const,
	coordinates: [
		[
			[x, y],
			[x + size, y],
			[x + size, y + size],
			[x, y + size],
			[x, y]
		]
	]
});

const useTotals = (n: number) => ({
	lbs_chemical: n,
	lbs_product: n,
	acres_treated: n * 2,
	applications: n * 10
});

/** Two townships side by side, as the server gives them (with outlines). */
function useTownships() {
	return {
		type: "FeatureCollection",
		year: 2023,
		classes: USE_CLASSES,
		features: ["T-0", "T-1"].map((id, i) => ({
			type: "Feature",
			id,
			geometry: useSquare(-119.8 + i * 0.1, 36.6, 0.1),
			properties: { id, name: id, sections: 36, ...useTotals(i + 1) }
		}))
	};
}

/** One section in township T-0. */
function useSections() {
	return {
		type: "FeatureCollection",
		year: 2023,
		classes: USE_CLASSES,
		features: [
			{
				type: "Feature",
				id: "s1",
				geometry: useSquare(-119.79, 36.61, 0.01),
				properties: { id: "s1", mtrs: "T-0-01", county: "Fresno", ...useTotals(5) }
			}
		]
	};
}

/**
 * A Yearly Map of county 019 over `first`–`last` (one stop, 2023, by default) with the pesticide
 * use layer (with `filters`, if given): use follows the stop showing.
 */
function useMap(
	options: Record<string, unknown> = {},
	filters?: Record<string, unknown>,
	first = 2023,
	last = first
) {
	return {
		...mapWidget({}),
		data: {
			...layers(region("019"), [{ dataset: "pesticide-use", ...(filters && { filters }) }]),
			dateRange: { kind: "custom", start: `${first}-01-01`, end: `${last}-12-31` },
			resolution: "year"
		},
		options
	} as WidgetInstance;
}

/** The years and months the townships were asked for, in order. */
const useAsked = () =>
	vi
		.mocked(getPesticideTownships)
		.mock.calls.map((c) => c[0] as { year: number; month?: number })
		.map((q) => (q.month === undefined ? String(q.year) : `${q.year}-${q.month}`));

type UsePlugin = {
	kind: string;
	options: {
		id: string;
		layerLabel: string;
		mode?: string;
		noFigure?: string;
		legendDisplay?: string;
		selectable?: boolean;
		zoomRange?: { min?: number; max?: number };
		legendUnits?: string;
		legendNote?: Snippet;
		parents?: { id: string };
		source: {
			features: { features: { properties: Record<string, unknown> }[] } | null;
			scale: { dataset: string; entryType: string } | null;
			status: unknown;
		};
	};
	addOptions?: Record<string, unknown>;
};
type UseTooltipOption = (item: FeatureListItem, props: never, env: unknown) => Snippet | undefined;
const useOf = (map: FakeMap, id: string) =>
	map.plugins.find((p) => p.id === id) as unknown as UsePlugin | undefined;
const townshipFeatures = (map: FakeMap) =>
	useOf(map, "townships")?.options.source.features?.features;

/** The townships plugin's legend note, rendered as map-sdk's legend does, once it's added. */
async function useNote(map: FakeMap) {
	await expect.poll(() => useOf(map, "townships")?.options.legendNote).toBeDefined();
	return render(RenderSnippet, { snippet: useOf(map, "townships")!.options.legendNote! });
}

const useBox = () => frame.querySelector<HTMLInputElement>('[data-option="use"]');
const useSelect = (id: string) => frame.querySelector<HTMLSelectElement>(`[data-option="${id}"]`)!;

/** The draw order with a fill and use, bottom first: use above the fill, under the focus area. */
const FILL_UNDER_USE = ["fill", "townships", "lens", "sections", "focus", "monitors"];

test("adds townships, lens and sections, in that order, above the fill when both mount together", async () => {
	rated();
	zipFill();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	await show(useMap({ fill: "zipcode" }));
	const map = await madeMap();
	await expect.poll(() => pluginIds(map)).toEqual(FILL_UNDER_USE);
	expect(useOf(map, "townships")).toMatchObject({
		kind: "shapes",
		options: {
			mode: "choropleth",
			noFigure: "outline",
			legendDisplay: "blocks",
			layerLabel: "Pounds Applied, 2023",
			legendUnits: "lbs per township"
		}
	});
	const lens = useOf(map, "lens")!;
	expect(lens.kind).toBe("lens");
	expect(lens.options).toMatchObject({
		noFigure: "outline",
		legendDisplay: "blocks",
		layerLabel: "Pounds Applied, 2023",
		legendUnits: "lbs per section"
	});
	expect(lens.options.parents?.id).toBe("townships");
	expect(useOf(map, "sections")).toMatchObject({
		kind: "shapes",
		options: {
			mode: "choropleth",
			noFigure: "outline",
			legendDisplay: "blocks",
			selectable: false,
			legendUnits: "lbs per section"
		}
	});
	await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
	// The sections and the lens share one scale; the townships have their own.
	const sectionsScale = useOf(map, "sections")!.options.source.scale;
	expect(useOf(map, "lens")!.options.source.scale).toBe(sectionsScale);
	expect(useOf(map, "townships")!.options.source.scale).not.toBe(sectionsScale);
});

test("use draws above the fill when the fill is on first", async () => {
	rated();
	zipFill();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const screen = await showLive(useMap({ fill: "zipcode", useShown: false }), editing());
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => pluginIds(map)).toEqual(["fill", "focus", "monitors"]);
	await screen.getByRole("checkbox", { name: "Pesticide Use" }).click();
	await expect.poll(() => pluginIds(map)).toEqual(FILL_UNDER_USE);
	expect(useOf(map, "townships")!.addOptions).toEqual({ before: "focus" });
});

test("use draws above the fill when use is on first, and after the fill is re-made", async () => {
	rated();
	zipFill();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const screen = await showLive(useMap({ fill: "zipcode", fillShown: false }), editing());
	const map = await madeMap();
	map.ready = true;
	await expect
		.poll(() => pluginIds(map))
		.toEqual(["townships", "lens", "sections", "focus", "monitors"]);
	const box = screen.getByRole("checkbox", { name: "ZIP Codes" });
	await box.click();
	await expect.poll(() => pluginIds(map)).toEqual(FILL_UNDER_USE);
	expect(useOf(map, "fill")!.addOptions).toEqual({ before: "townships" });
	// Hidden and shown again: the fill is made again, still under use.
	await box.click();
	await expect
		.poll(() => pluginIds(map))
		.toEqual(["townships", "lens", "sections", "focus", "monitors"]);
	await box.click();
	await expect.poll(() => pluginIds(map)).toEqual(FILL_UNDER_USE);
});

test("without a fill, use goes under the focus area", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	await show(useMap());
	const map = await madeMap();
	await expect
		.poll(() => pluginIds(map))
		.toEqual(["townships", "lens", "sections", "focus", "monitors"]);
	for (const id of ["townships", "lens", "sections"]) {
		expect(useOf(map, id)!.addOptions).toEqual({ before: "focus" });
	}
});

test("the zoom ranges meet at the section zoom", async () => {
	await show(useMap());
	const map = await madeMap();
	await expect.poll(() => useOf(map, "sections")).toBeDefined();
	const z = useOf(map, "townships")!.options.zoomRange!.max!;
	expect(Number.isInteger(z)).toBe(true);
	expect(z).toBeGreaterThanOrEqual(11);
	expect(useOf(map, "townships")!.options.zoomRange).toEqual({ max: z });
	expect(useOf(map, "sections")!.options.zoomRange).toEqual({ min: z });
	// From the section zoom, the view's sections are asked for.
	await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
	map.bounds = { west: -119.8, south: 36.6, east: -119.7, north: 36.7 };
	map.camera.zoom = z;
	await expect.poll(() => vi.mocked(getPesticideSections).mock.calls.length).toBe(1);
	await expect
		.poll(() => useOf(map, "sections")?.options.source.features?.features)
		.toHaveLength(1);
});

test("the lens's center loads its block's sections", async () => {
	await show(useMap());
	const map = await madeMap();
	await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
	const lens = fakeLenses.at(-1)!;
	lens.center = encodeRef({ kind: "feature", id: "township:T-0" });
	await expect.poll(() => vi.mocked(getPesticideSections).mock.calls.length).toBe(1);
	await expect.poll(() => useOf(map, "lens")?.options.source.features?.features).toHaveLength(1);
});

test("a pinned section's card names its township, a button that pins the township's card", async () => {
	await show(useMap());
	const map = await madeMap();
	await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
	const township = encodeRef({ kind: "feature", id: "township:T-0" });
	fakeLenses.at(-1)!.center = township;
	await expect.poll(() => useOf(map, "lens")?.options.source.features?.features).toHaveLength(1);
	const refKey = encodeRef({ kind: "feature", id: "section:s1" });
	pin(map, refKey, "lens");
	const props = useOf(map, "lens")!.options.source.features!.features[0].properties;
	const tooltip = (useOf(map, "lens")!.options as unknown as { tooltip: UseTooltipOption }).tooltip;
	const card = await render(RenderSnippet, {
		snippet: tooltip({ refKey, name: "T-0-01" } as FeatureListItem, props as never, {})!
	});
	await expect
		.element(
			card.getByText(m.map_use_card_in_township({ township: "T-0", value: "1", units: "lbs" }))
		)
		.toBeVisible();
	await card
		.getByRole("button", { name: m.map_use_card_township_open({ township: "T-0" }) })
		.click();
	expect(map.pinCalls).toEqual([["townships", township]]);
	expect(map.pinned?.hit).toMatchObject({ pluginId: "townships", refKey: township });
	expect(map.cameraCalls).toEqual([]);
});

describe("a section card's Show in a chart", () => {
	const SECTION = encodeRef({ kind: "feature", id: "section:s1" });
	/** The Map with a section loaded in the lens, its card pinned. */
	async function pinnedSection(live = true) {
		vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
		const widget = useMap();
		const screen = live ? await showLive(widget, editing()) : await show(widget);
		const map = await madeMap();
		map.ready = true;
		await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
		fakeLenses.at(-1)!.center = encodeRef({ kind: "feature", id: "township:T-0" });
		await expect.poll(() => useOf(map, "lens")?.options.source.features?.features).toHaveLength(1);
		pin(map, SECTION, "lens");
		return { screen, map, widget };
	}
	const button = (screen: { getByRole: typeof page.getByRole }) =>
		screen.getByRole("button", { name: m.map_show_in_chart() });

	test("is on the pinned card and sends the section's code, not its id", async () => {
		vi.mocked(showIn).mockClear();
		const { screen, map, widget } = await pinnedSection();
		const props = useOf(map, "lens")!.options.source.features!.features[0].properties;
		await button(screen).click();
		await expect
			.poll(() => vi.mocked(showIn).mock.calls)
			.toEqual([[expect.anything(), widget.id, { kind: "section", code: props.name }, "chart"]]);
		expect(props.name).not.toBe(props.id);
	});

	test("is on a section card of the sections plugin too", async () => {
		const { screen, map } = await pinnedSection();
		pin(map, SECTION, "sections");
		await expect.element(button(screen)).toBeVisible();
	});

	test("sends nothing once the section has left its source", async () => {
		const { screen, map } = await pinnedSection();
		vi.mocked(showIn).mockClear();
		// A feature the source doesn't hold: its listed item's name is all that's left.
		const refKey = encodeRef({ kind: "feature", id: "section:gone" });
		const item = { refKey, name: "M99S99E99", level: "Good" } as unknown as FeatureListItem;
		map.pinned = { hit: { pluginId: "sections", refKey, name: refKey, item } };
		await button(screen).click();
		// The source's own section is sent; had the first click sent, it would be first.
		pin(map, SECTION, "lens");
		await button(screen).click();
		await expect.poll(() => vi.mocked(showIn).mock.calls.length).toBe(1);
		const code = useOf(map, "lens")!.options.source.features!.features[0].properties.name;
		expect(vi.mocked(showIn).mock.calls[0][2]).toEqual({ kind: "section", code });
	});

	test("isn't on a township's card", async () => {
		const { screen, map } = await pinnedSection();
		pin(map, encodeRef({ kind: "feature", id: "township:T-0" }), "townships");
		await expect
			.element(screen.getByRole("button", { name: m.map_mark_select() }))
			.not.toBeInTheDocument();
		expect(button(screen).query()).toBeNull();
	});

	test("isn't in a preview", async () => {
		const { screen } = await pinnedSection(false);
		expect(button(screen).query()).toBeNull();
	});

	test("keeps focus across a refetch", async () => {
		const { screen, map } = await pinnedSection();
		const el = button(screen).element() as HTMLButtonElement;
		el.focus();
		// A refetch re-pins the same card (cards stay mounted).
		map.pinned = { hit: { ...map.pinned!.hit } };
		await new Promise((r) => setTimeout(r, 50));
		expect(document.activeElement).toBe(el);
		expect(button(screen).element()).toBe(el);
	});
});

test("the Layers row hides use without unloading it", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const screen = await showLive(useMap(), editing());
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
	const asked = vi.mocked(getPesticideTownships).mock.calls.length;
	const box = screen.getByRole("checkbox", { name: "Pesticide Use" });
	await expect.element(box).toBeChecked();
	expect(useBox()).toBeTruthy();
	await box.click();
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "monitors"]);
	expect(optionsOf()).toEqual({ useShown: false });
	await box.click();
	await expect
		.poll(() => pluginIds(map))
		.toEqual(["townships", "lens", "sections", "focus", "monitors"]);
	expect(optionsOf() ?? {}).toEqual({});
	await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
	expect(getPesticideTownships).toHaveBeenCalledTimes(asked);
});

test("the figure select redraws with another scale and writes useFigure, but never the default", async () => {
	const screen = await showLive(useMap(), editing());
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
	const first = useOf(map, "townships")!;
	// The source is one object across plugins: its scale is read now, before the change.
	const firstScale = first.options.source.scale;
	expect(firstScale?.entryType).toMatch(/^pounds-applied\|/);
	const asked = vi.mocked(getPesticideTownships).mock.calls.length;
	const figure = screen.getByRole("combobox", { name: m.map_use_figure() });
	await expect.element(figure).toHaveValue("pounds-applied");
	await figure.selectOptions("acres-treated");
	await expect.poll(optionsOf).toEqual({ useFigure: "acres-treated" });
	await expect.poll(() => useOf(map, "townships")?.options.layerLabel).toBe("Acres Treated, 2023");
	const next = useOf(map, "townships")!;
	expect(next).not.toBe(first);
	expect(next.options.legendUnits).toBe("acres per township");
	await expect.poll(() => next.options.source.scale?.entryType).toMatch(/^acres-treated\|/);
	expect(next.options.source.scale).not.toBe(firstScale);
	// One response carries every figure: nothing new is asked for.
	expect(getPesticideTownships).toHaveBeenCalledTimes(asked);
	await figure.selectOptions("pounds-applied");
	await expect.poll(() => optionsOf() ?? {}).toEqual({});
});

test("a Yearly Map's use asks for the stop's year, and a step asks for the year before", async () => {
	await showLive(useMap({}, undefined, 2022, 2023), editing());
	const map = await madeMap();
	map.ready = true;
	await expect.poll(dayLabel).toBe("2023");
	await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
	expect(useAsked()).toEqual(["2023"]);
	expect(useOf(map, "townships")!.options.layerLabel).toBe("Pounds Applied, 2023");
	// No period selects: the stepper is the period.
	expect(useSelect("useYear")).toBeNull();
	await page.getByRole("button", { name: m.map_year_previous() }).click();
	await expect.poll(() => useOf(map, "townships")?.options.layerLabel).toBe("Pounds Applied, 2022");
	await expect.poll(useAsked).toEqual(["2023", "2022"]);
	expect(optionsOf()).toEqual({ at: "2022-01-01" });
});

test("a Monthly Map's use asks for the stop's month, and a step asks for the month before", async () => {
	const widget = useMap();
	widget.data.dateRange = { kind: "custom", start: "2023-06-01", end: "2023-07-31" };
	widget.data.resolution = "month";
	await showLive(widget, editing());
	const map = await madeMap();
	map.ready = true;
	await expect.poll(dayLabel).toBe("July 2023");
	await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
	expect(useAsked()).toEqual(["2023-7"]);
	expect(useOf(map, "townships")!.options.layerLabel).toBe(
		m.map_use_layer({ figure: "Pounds Applied", period: "July 2023" })
	);
	await page.getByRole("button", { name: m.map_month_previous() }).click();
	await expect
		.poll(() => useOf(map, "townships")?.options.layerLabel)
		.toBe(m.map_use_layer({ figure: "Pounds Applied", period: "June 2023" }));
	await expect.poll(useAsked).toEqual(["2023-7", "2023-6"]);
});

/** The Map's note that `dataset` isn't drawn at the resolution (or on Now). */
const notLinedUp = (dataset: string) => m.map_layer_not_lined_up({ dataset });

test("a Daily Map with use (from a share link: Get data never builds one) draws no use and says so", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const widget = useMap();
	widget.data.dateRange = { kind: "custom", start: "2023-06-01", end: "2023-06-30" };
	widget.data.resolution = "day";
	const screen = await showLive(widget, editing());
	const map = await madeMap();
	map.ready = true;
	await expect.element(screen.getByText(notLinedUp("Pesticide Use"))).toBeVisible();
	expect(m.map_layer_not_lined_up({ dataset: "Pesticide Use" })).toBe(
		"Pesticide Use isn't shown at this data resolution. Change it in the Data Portal."
	);
	await expect.element(screen.getByRole("button", { name: m.widget_edit_data() })).toBeVisible();
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "monitors"]);
	// No use row and no use group in the toolbar, and nothing asked for.
	expect(useBox()).toBeNull();
	expect(useSelect("useFigure")).toBeNull();
	expect(getPesticideTownships).not.toHaveBeenCalled();
});

test("a mixed Map from a share link opens without errors, draws the pollutant, and says use isn't shown", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const raw = {
		kind: "dashboard",
		schemaVersion: CURRENT_SCHEMA_VERSION,
		id: "shared",
		name: null,
		version: 0,
		createdAt: "2026-10-20T00:00:00Z",
		updatedAt: "2026-10-20T00:00:00Z",
		body: {
			widgets: [
				{
					...useMap(),
					data: {
						...layers(region("019"), [{ dataset: "pesticide-use", entryType: "pounds-applied" }]),
						dateRange: { kind: "custom", start: "2023-06-01", end: "2023-06-30" },
						resolution: "day"
					}
				}
			]
		}
	};
	const stored = JSON.stringify(raw);
	const loaded = loadDashboard(JSON.parse(stored));
	if (loaded.status !== "ok") throw new Error("the mixed document should open");
	const widget = loaded.doc.body.widgets[0];
	const errors = vi.spyOn(console, "error");
	onTestFinished(() => errors.mockRestore());
	const screen = await showLive(widget, editing());
	const map = await madeMap();
	map.ready = true;
	await expect.element(screen.getByText(notLinedUp("Pesticide Use"))).toBeVisible();
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "monitors"]);
	expect(getPesticideTownships).not.toHaveBeenCalled();
	expect(errors).not.toHaveBeenCalled();
	// Opening never rewrites what was shared (key order aside: the schema's order is what saves).
	expect(loaded.doc).toStrictEqual(JSON.parse(stored));
	expect(app().current.session!.doc.body.widgets[0].data).toStrictEqual(raw.body.widgets[0].data);
});

test("a Map on Now with use draws no use and says so", async () => {
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	const widget = useMap();
	delete widget.data.dateRange;
	delete widget.data.resolution;
	const screen = await showLive(widget, editing());
	const map = await madeMap();
	map.ready = true;
	await expect.element(screen.getByText(notLinedUp("Pesticide Use"))).toBeVisible();
	await expect.poll(() => pluginIds(map)).toEqual(["focus", "monitors"]);
	expect(useBox()).toBeNull();
	expect(getPesticideTownships).not.toHaveBeenCalled();
});

test("viewer changes to the use rows are held", async () => {
	const widget = useMap();
	const changes = new ViewerChanges();
	const screen = await showViewer(widget, changes);
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
	const apply = vi.spyOn(app().current.session!, "apply");
	await screen.getByRole("combobox", { name: m.map_use_figure() }).selectOptions("acres-treated");
	await expect.poll(() => changes.get(widget.id)).toEqual({ useFigure: "acres-treated" });
	await expect.poll(() => useOf(map, "townships")?.options.layerLabel).toBe("Acres Treated, 2023");
	await screen.getByRole("checkbox", { name: "Pesticide Use" }).click();
	await expect.poll(() => changes.get(widget.id)?.useShown).toBe(false);
	expect(apply).not.toHaveBeenCalled();
	expect(optionsOf() ?? {}).toEqual({});
	// Reset puts the toolbar's keys back: nothing is held.
	await screen.getByRole("button", { name: mapMessages("mapsdk_options_reset") }).click();
	await expect.poll(() => changes.get(widget.id)).toBeUndefined();
	expect(apply).not.toHaveBeenCalled();
});

test("a period the server doesn't list says no use is reported for it yet, in the legend", async () => {
	await showLive(useMap({}, undefined, 2017), editing());
	const map = await madeMap();
	map.ready = true;
	const none = m.map_use_none_yet({ period: "2017" });
	expect(none).toBe("No pesticide use reported for 2017 yet.");
	// A status row map-sdk's legend draws, with the note (filters, server notes) under it; the note
	// doesn't say it again. (E2E checks the real legend.)
	await expect
		.poll(() => useOf(map, "townships")?.options.source.status)
		.toEqual({ state: "unavailable", reason: "no-data", message: none });
	// From the section zoom (the townships hidden) the sections plugin carries the row; the lens
	// adds none.
	expect(useOf(map, "sections")!.options.source.status).toEqual({
		state: "unavailable",
		reason: "no-data",
		message: none
	});
	expect(useOf(map, "lens")!.options.source.status).toEqual({ state: "ready" });
	const note = await useNote(map);
	await expect.element(note.getByText(PESTICIDES_META.notes.shades_valley.summary)).toBeVisible();
	expect(note.container.textContent).not.toContain(none);
	expect(useOf(map, "townships")!.options.layerLabel).toBe("Pounds Applied, 2017");
	await expect.poll(() => townshipFeatures(map)).toEqual([]);
	expect(getPesticideTownships).not.toHaveBeenCalled();
	expect(optionsOf() ?? {}).toEqual({});
	note.unmount();
});

test("an unknown useFigure draws the first, writing nothing", async () => {
	await showLive(useMap({ useFigure: "gone-figure" }), editing());
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => useOf(map, "townships")?.options.layerLabel).toBe("Pounds Applied, 2023");
	expect(useSelect("useFigure").value).toBe("pounds-applied");
	expect(optionsOf()).toEqual({ useFigure: "gone-figure" });
});

test("the legend names the period, the units, the filters, and the server's two notes", async () => {
	await show(useMap({}, { category: ["fumigant"] }));
	const map = await madeMap();
	await expect.poll(() => useOf(map, "townships")?.options.layerLabel).toBe("Pounds Applied, 2023");
	expect(useOf(map, "townships")!.options.legendUnits).toBe("lbs per township");
	const note = await useNote(map);
	await expect
		.element(note.getByText(m.map_use_legend_filters({ filters: "Fumigants" })))
		.toBeVisible();
	for (const [key, href] of [
		["shades_valley", SHADES_SOURCE],
		["pur_lag", LAG_SOURCE]
	] as const) {
		const text = PESTICIDES_META.notes[key];
		await expect.element(note.getByText(text.summary)).toBeVisible();
		const link = note.getByRole("link", { name: new RegExp(text.title) });
		await expect.element(link).toHaveAttribute("href", href);
		await expect.element(link).toHaveAttribute("target", "_blank");
		await expect.element(link).toHaveAttribute("rel", "noopener noreferrer");
	}
	// The lines are ready at once when the note is drawn again (a new plugin): no flicker.
	note.unmount();
	const again = await render(RenderSnippet, {
		snippet: useOf(map, "townships")!.options.legendNote!
	});
	expect(again.container.textContent).toContain(m.map_use_legend_filters({ filters: "Fumigants" }));
	expect(again.container.textContent).toContain(PESTICIDES_META.notes.shades_valley.summary);
	again.unmount();
});

test("a township's card names the use layer's filters, as the legend does", async () => {
	await show(useMap({}, { category: ["fumigant"] }));
	const map = await madeMap();
	await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
	const feature = useOf(map, "townships")!.options.source.features!.features[0];
	const refKey = feature.properties.refKey as string;
	pin(map, refKey, "townships");
	const tooltip = (useOf(map, "townships")!.options as unknown as { tooltip: UseTooltipOption })
		.tooltip;
	const card = await render(RenderSnippet, {
		snippet: tooltip({ refKey, name: "T-0" } as FeatureListItem, feature.properties as never, {})!
	});
	await expect
		.element(card.getByText(m.map_use_legend_filters({ filters: "Fumigants" })))
		.toBeVisible();
	card.unmount();
});

test("use failure note with one Retry, with the monitors still drawn", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	periodFigures({ "2023-01-01": { a: 9 } });
	vi.mocked(getPesticideTownships)
		.mockRejectedValueOnce(new Error("offline"))
		.mockResolvedValue(useTownships() as never);
	const screen = await show(useMap());
	const map = await madeMap();
	await expect.element(screen.getByText(m.map_use_failed())).toBeVisible();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	expect(screen.getByText(m.widget_state_error()).query()).toBeNull();
	// map-sdk sees no error, so its legend offers no second Retry: only the note's.
	expect(useOf(map, "townships")!.options.source.status).toEqual({ state: "ready" });
	const note = frame.querySelector<HTMLElement>("[data-map-use-failed]")!;
	expect(note.querySelectorAll("button")).toHaveLength(1);
	await note.querySelector("button")!.click();
	await expect.poll(() => screen.getByText(m.map_use_failed()).query()).toBeNull();
	await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
	expect(getPesticideTownships).toHaveBeenCalledTimes(2);
	expect(drawn(map)).toEqual(["a"]);
});

describe("use with no fit target yet (the region shapes still loading)", () => {
	beforeEach(() => {
		vi.mocked(regionShapes).mockImplementation(() => new Promise(() => {}));
	});

	test("an unlisted period still says no use is reported for 2017", async () => {
		await showLive(useMap({}, undefined, 2017), editing());
		const map = await madeMap();
		map.ready = true;
		await expect
			.poll(() => useOf(map, "townships")?.options.source.status)
			.toMatchObject({ state: "unavailable", reason: "no-data" });
	});

	test("a gone filter still shows the legend's filter-gone row", async () => {
		vi.mocked(getChemicalDetails).mockRejectedValue(notFound());
		await show(useMap({}, { chemical: "gone" }));
		const map = await madeMap();
		await expect
			.poll(() => useOf(map, "townships")?.options.source.status)
			.toMatchObject({ state: "unavailable", reason: "filter-gone" });
	});

	test("a new period that fails keeps the use layers on the map", async () => {
		const screen = await showLive(useMap({}, undefined, 2022, 2023), editing());
		const map = await madeMap();
		map.ready = true;
		await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
		vi.mocked(getPesticideTownships).mockRejectedValueOnce(new Error("offline"));
		await page.getByRole("button", { name: m.map_year_previous() }).click();
		await expect.element(screen.getByText(m.map_use_failed())).toBeVisible();
		await expect
			.poll(() => useOf(map, "townships")?.options.layerLabel)
			.toBe("Pounds Applied, 2022");
	});
});

test("stepping from an unlisted period to a listed one clears the none-yet row and brings the classes back", async () => {
	// 2023 then 2024 (the server lists up to 2023), opened on 2024.
	await showLive(useMap({}, undefined, 2023, 2024), editing());
	const map = await madeMap();
	map.ready = true;
	await expect
		.poll(() => useOf(map, "townships")?.options.source.status)
		.toMatchObject({ state: "unavailable", reason: "no-data" });
	await page.getByRole("button", { name: m.map_year_previous() }).click();
	await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
	const source = useOf(map, "townships")!.options.source;
	expect(source.status).toEqual({ state: "ready" });
	expect(useScaleFor(source.scale as ScaleRef)?.levels.length).toBeGreaterThan(0);
});

test("a gone use filter is said, with Edit data", async () => {
	rated();
	vi.mocked(getMonitors).mockResolvedValue([reading("a")] as never);
	periodFigures({ "2023-01-01": { a: 9 } });
	vi.mocked(getChemicalDetails).mockRejectedValue(notFound());
	const screen = await show(useMap({}, { chemical: "gone" }));
	const map = await madeMap();
	await expect.element(screen.getByText(m.map_use_filter_gone())).toBeVisible();
	expect(frame.querySelector("[data-map-use-gone]")).toBeTruthy();
	await expect.element(screen.getByRole("button", { name: m.widget_edit_data() })).toBeVisible();
	await expect.poll(() => drawn(map)).toEqual(["a"]);
	expect(getPesticideTownships).not.toHaveBeenCalled();
});

test("a failed sections load says so, and Retry asks again", async () => {
	vi.mocked(getPesticideSections)
		.mockRejectedValueOnce(new Error("offline"))
		.mockResolvedValue(useSections() as never);
	const screen = await show(useMap());
	const map = await madeMap();
	await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
	fakeLenses.at(-1)!.center = encodeRef({ kind: "feature", id: "township:T-0" });
	await expect.element(screen.getByText(m.map_use_sections_failed())).toBeVisible();
	const note = frame.querySelector<HTMLElement>("[data-map-use-sections-failed]")!;
	await note.querySelector("button")!.click();
	await expect.poll(() => useOf(map, "lens")?.options.source.features?.features).toHaveLength(1);
	expect(screen.getByText(m.map_use_sections_failed()).query()).toBeNull();
});

test("a pan doesn't re-make the use plugins", async () => {
	// A big map, whose section zoom (12 here) depends on the latitude it's computed at.
	await page.viewport(2000, 1400);
	frame.style.width = "1900px";
	frame.style.height = "1300px";
	await show(useMap());
	const map = await madeMap();
	await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
	const made = useOf(map, "townships");
	expect(made!.options.zoomRange).toEqual({ max: 12 });
	// A pan far north (where the section zoom at the camera's latitude would differ).
	map.camera.center = [-119.7, 70];
	map.bounds = { west: -120, south: 69.9, east: -119.4, north: 70.1 };
	await new Promise((r) => setTimeout(r, 100));
	expect(useOf(map, "townships")).toBe(made);
});

test("a failed pesticide meta is asked again by the use note's Retry", async () => {
	vi.mocked(getPesticidesMeta).mockRejectedValue(new Error("offline"));
	const screen = await showLive(useMap(), editing());
	const map = await madeMap();
	map.ready = true;
	await expect.element(screen.getByText(m.map_use_failed())).toBeVisible();
	vi.mocked(getPesticidesMeta).mockResolvedValue(PESTICIDES_META as never);
	await frame.querySelector<HTMLElement>("[data-map-use-failed] button")!.click();
	await expect.poll(() => townshipFeatures(map)).toHaveLength(2);
	expect(screen.getByText(m.map_use_failed()).query()).toBeNull();
});

test("at about 300 px tall the legend fits under the toolbar and scrolls", async () => {
	frame.style.height = "300px";
	const screen = await show(mapWidget(region("019")));
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => frame.querySelector("[data-legend]")).toBeTruthy();
	const card = frame.querySelector("[data-legend]")!.parentElement!;
	// A legend taller than the map, as with several layers.
	const tall = document.createElement("div");
	tall.style.height = "1000px";
	card.appendChild(tall);
	const view = frame.querySelector<HTMLElement>("[data-fake-map]")!.getBoundingClientRect();
	const box = card.getBoundingClientRect();
	expect(box.top).toBeGreaterThanOrEqual(view.top + FAKE_TOOLBAR_HEIGHT);
	expect(box.bottom).toBeLessThanOrEqual(view.bottom);
	expect(card.scrollHeight).toBeGreaterThan(card.clientHeight);
	expect(getComputedStyle(card).overflowY).toBe("auto");
	// Scrollable, so it can be reached and scrolled by keyboard.
	await expect.poll(() => card.getAttribute("tabindex")).toBe("0");
	// A named group, not a second "Legend" landmark: map-sdk's legend inside is the one region.
	expect(card.getAttribute("role")).toBe("group");
	expect(card.getAttribute("aria-label")).toBe(m.map_legend_scroll());
	expect(screen.getByRole("region", { name: "Legend" }).elements()).toHaveLength(0);
	const results = await axe.run(frame);
	expect(results.violations).toEqual([]);
	// Not overflowing: no Tab stop.
	tall.remove();
	frame.style.height = "800px";
	await expect.poll(() => card.getAttribute("tabindex")).toBe("-1");
});
