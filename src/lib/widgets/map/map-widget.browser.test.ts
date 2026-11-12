import "../../../app.css";
import axe from "axe-core";
import type { Feature } from "geojson";
import { getHMSFire, getHMSSmoke, getMonitors } from "@sjvair/sdk";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { getResolvers, placeRegion } from "$lib/data";
import type { Layer } from "$lib/data/schema";
import type { CatalogEntry } from "$lib/data/metadata";
import { getNowClient } from "$lib/data/now";
import { createNowClient, type NowClient } from "$lib/data/now/client";
import type { QueryClient } from "$lib/data/query/client";
import type { PlaceInfo, QueryInput } from "$lib/data/types";
import { FIXTURE_CATALOG, fixtureMetadata } from "$lib/data/testing/fixtures";
import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { setPlatform } from "$lib/platform";
import { createMemoryPlatform, type MemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
import { generatedTitle } from "../titles.svelte";
import { mapConfig } from "./host/config";
import { regionShapes } from "./regions";
import { FakeGl, fakeMaps, type FakeMap } from "./test-harness/fake-map.svelte";
import MapWidget from "./MapWidget.svelte";

vi.mock("@sjvair/map-sdk", async () => {
	const { createFakeMap } = await import("./test-harness/fake-map.svelte");
	const { default: MapView } = await import("./test-harness/FakeMapView.svelte");
	const { default: Legend } = await import("./test-harness/FakeLegend.svelte");
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
		focusAreaPlugin: (options: { id?: string }) => {
			const focus = { geometry: null as unknown, label: undefined as string | undefined };
			return {
				id: options.id ?? "focus-area",
				kind: "focus",
				options,
				focus,
				set: (next: { geometry: unknown; label?: string }) => Object.assign(focus, next)
			};
		},
		monitorsPlugin: plugin("monitors"),
		hmsSmokePlugin: plugin("hms-smoke"),
		hmsFirePlugin: plugin("hms-fire"),
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
	getHMSSmoke: vi.fn(),
	getHMSFire: vi.fn()
}));
vi.mock("$lib/data/now", () => ({ getNowClient: vi.fn() }));
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
	regionShapes: vi.fn()
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
	const info = (layer: Layer): PlaceInfo => {
		const place = layer.place ?? null;
		if (place?.kind === "monitor")
			return { place: `monitor:${place.id}`, name: `Monitor ${place.id}` };
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

/** The catalog with the smoke and fire datasets, as the server lists them. */
const CATALOG: CatalogEntry[] = [
	...FIXTURE_CATALOG,
	{ id: "hms-smoke", label: "Wildfire Smoke", entryTypes: [], geographies: ["polygon"] },
	{ id: "hms-fire", label: "Fire Detections", entryTypes: [], geographies: ["point"] }
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

let frame: HTMLDivElement;
let nowClient: NowClient;
let platform: MemoryPlatform;
let shownApp: Awaited<ReturnType<typeof initApp>>;
/** The app the last `show` rendered into. */
const app = () => shownApp;

beforeEach(async () => {
	await page.viewport(1280, 800);
	fakeMaps.reset();
	nowClient = createNowClient();
	vi.mocked(getNowClient).mockReturnValue(nowClient);
	vi.mocked(getMonitors).mockResolvedValue([] as never);
	vi.mocked(getHMSSmoke).mockResolvedValue([] as never);
	vi.mocked(getHMSFire).mockResolvedValue([] as never);
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

function mapWidget(layer: Partial<Layer>): WidgetInstance {
	return {
		id: crypto.randomUUID(),
		type: "map",
		title: null,
		rect: { x: 0, y: 0, w: 6, h: 6 },
		data: { layers: [{ dataset: "air-quality", entryType: "pm25", ...layer }] }
	};
}

async function show(widget: WidgetInstance, viewer?: PlaceViewer) {
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
	return render(MapWidget, {
		target: frame,
		props: { widget },
		context: new Map<unknown, unknown>([
			[APP_CONTEXT_KEY, app],
			...(viewer ? [[PLACE_VIEWER_KEY, viewer] as const] : [])
		])
	});
}

/** The map, once the widget has made it. */
async function madeMap(): Promise<FakeMap> {
	await expect.poll(() => fakeMaps.made.length).toBeGreaterThan(0);
	return fakeMaps.last;
}

const region = (code: string) => ({ place: { kind: "region" as const, type: "county", code } });

test("idle shows Choose a place and opens the picker", async () => {
	const widget = mapWidget({});
	const screen = await show(widget);
	const button = screen.getByRole("button", { name: m.widget_state_choose_place() });
	await expect.element(button).toBeVisible();
	await button.click();
	expect(openPlacePicker).toHaveBeenCalledWith({ widgetId: widget.id });
});

test("an idle map creates no map and loads nothing", async () => {
	const screen = await show(mapWidget({}));
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
	expect(map.camera).toEqual([]);
	map.ready = true;
	await expect
		.poll(() => map.camera)
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
		.poll(() => map.camera)
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
	await show(mapWidget({ place: { kind: "monitor", id: "a" } }));
	const map = await madeMap();
	await expect.poll(() => map.plugins.map((p) => p.id)).toEqual(["focus", "monitors"]);
	expect(focusOf(map).geometry).toBeNull();
});

test("the monitors plugin takes no selection, and nothing is highlighted", async () => {
	await show(mapWidget({ selection: { kind: "monitors", ids: ["a", "b"] } }));
	const map = await madeMap();
	await expect.poll(() => map.plugins.find((p) => p.id === "monitors")).toBeTruthy();
	const monitors = map.plugins.find((p) => p.id === "monitors")!;
	expect(monitors.options).toMatchObject({ layerLabel: "PM2.5" });
	expect(monitors.addOptions).toEqual({ selectionMode: "none" });
	expect(map.selectionCalls).toEqual([]);
});

test("fits once the monitors are loaded", async () => {
	let load: (value: unknown) => void = () => {};
	vi.mocked(getMonitors).mockReturnValue(new Promise((r) => (load = r)) as never);
	await show(mapWidget({ selection: { kind: "monitors", ids: ["a", "b", "gone"] } }));
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => vi.mocked(getMonitors).mock.calls.length).toBe(1);
	// Nothing known to fit yet: the map stays on the Valley's view.
	await new Promise((r) => setTimeout(r, 50));
	expect(map.camera).toEqual([]);
	load([reading("a", -120, 36), reading("b", -119, 37), reading("c", -100, 30)]);
	await expect
		.poll(() => map.camera)
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
	await expect.poll(() => map.camera).toHaveLength(1);
	// Detached (off-screen), the layer changes; nothing moves until the map is back.
	map.attached = false;
	map.ready = false;
	await screen.rerender({ widget: { ...widget, data: mapWidget(region("029")).data } });
	await expect.poll(() => focusOf(map).geometry).toEqual(SHAPES["county:029"].geometry);
	expect(map.camera).toHaveLength(1);
	map.ready = true;
	await expect.poll(() => map.camera).toHaveLength(2);
	expect(map.camera[1]).toEqual({
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
	await expect.poll(() => map.camera).toHaveLength(1);
	// Still attached: a basemap or theme change reloads the style.
	map.ready = false;
	await new Promise((r) => setTimeout(r, 20));
	map.ready = true;
	await new Promise((r) => setTimeout(r, 100));
	expect(map.camera).toHaveLength(1);
});

test("refits when entering fullscreen", async () => {
	const widget = mapWidget(region("019"));
	const screen = await show(widget);
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => map.camera).toHaveLength(1);
	const fit = map.camera[0];
	await screen.rerender({ widget, fullscreen: true });
	await expect.poll(() => map.camera).toHaveLength(2);
	expect(map.camera[1]).toEqual(fit);
	// And again on leaving it.
	await screen.rerender({ widget, fullscreen: false });
	await expect.poll(() => map.camera).toHaveLength(3);
	expect(map.camera[2]).toEqual(fit);
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

	const several = mapWidget({ selection: { kind: "monitors", ids: ["a", "b", "c"] } });
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
	const screen = await show(mapWidget({ place: { kind: "monitor", id: "gone" } }));
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
	const widget = mapWidget({ place: { kind: "monitor", id: "a" } });
	await show(widget);
	const map = await madeMap();
	await expect.poll(() => map.view.card).toBe(true);
	await expect.poll(() => map.plugins.find((p) => p.id === "monitors")).toBeTruthy();
	// The monitors take no selection from the map: a click only pins.
	expect(map.plugins.find((p) => p.id === "monitors")!.addOptions).toMatchObject({
		selectionMode: "none"
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

/** A spec 2 Map's data: these pollutant layers (the first holds the places), and smoke and fire. */
function layers(first: Partial<Layer>, more: Partial<Layer>[] = [], smokeAndFire = false) {
	return {
		layers: [
			{ dataset: "air-quality", entryType: "pm25", ...first },
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
	// Scoped by the server: the region's id, for the pollutant showing.
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
	await show(mapWidget({ selection: { kind: "monitors", ids: ["a", "c"] } }));
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

test("draws the pollutant showing, and switches when it changes", async () => {
	vi.mocked(getMonitors).mockImplementation(async (type) => [reading(String(type))] as never);
	const widget: WidgetInstance = {
		...mapWidget({}),
		data: layers(region("019"), [{ entryType: "o3" }]),
		options: { showing: "o3" }
	};
	const screen = await show(widget);
	const map = await madeMap();
	await expect.poll(() => drawn(map)).toEqual(["o3"]);
	expect(map.plugins.find((p) => p.id === "monitors")!.options).toMatchObject({
		layerLabel: "Ozone"
	});
	await screen.rerender({ widget: { ...widget, options: { showing: "pm25" } } });
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
