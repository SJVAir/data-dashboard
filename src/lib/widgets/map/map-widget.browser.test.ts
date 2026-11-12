import "../../../app.css";
import axe from "axe-core";
import type { Feature } from "geojson";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { getResolvers, placeRegion } from "$lib/data";
import type { Layer } from "$lib/data/schema";
import type { QueryClient } from "$lib/data/query/client";
import type { PlaceInfo, QueryInput } from "$lib/data/types";
import { fixtureMetadata } from "$lib/data/testing/fixtures";
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
import {
	FakeGl,
	fakeMaps,
	fakeMarkers,
	fakeStores,
	type FakeMap
} from "./test-harness/fake-map.svelte";
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
		shapesPlugin: plugin("shapes"),
		pointsPlugin: plugin("points"),
		monitorsPlugin: plugin("monitors"),
		maptilerMap: (map: { gl: unknown }) => map.gl,
		geometryBbox
	};
});
vi.mock("@maptiler/sdk", async () => {
	const { FakeMarker } = await import("./test-harness/fake-map.svelte");
	return { Marker: FakeMarker };
});
vi.mock("./host/stores", async () => {
	const { fakeStores } = await import("./test-harness/fake-map.svelte");
	return {
		acquireMonitors: (entryType: string) => fakeStores.acquire(entryType),
		sharedMetadata: () => ({})
	};
});
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

let frame: HTMLDivElement;
let platform: MemoryPlatform;
let shownApp: Awaited<ReturnType<typeof initApp>>;
/** The app the last `show` rendered into. */
const app = () => shownApp;

beforeEach(async () => {
	await page.viewport(1280, 800);
	fakeMaps.reset();
	fakeStores.reset();
	fakeMarkers.reset();
	vi.mocked(mapConfig).mockReturnValue({ maptilerKey: "test", projection: "mercator" });
	const { getMetadata, getQueryClient } = await import("$lib/data");
	vi.mocked(getMetadata).mockReturnValue(fixtureMetadata());
	vi.mocked(getQueryClient).mockReturnValue(namingClient());
	vi.mocked(getResolvers).mockReturnValue({
		locations: {
			resolve: async () => ({ name: "Roosevelt High School", point: { lat: 36.7, lon: -119.8 } })
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
	vi.clearAllMocks();
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

test("an idle map creates no map and acquires no store", async () => {
	const screen = await show(mapWidget({}));
	await expect
		.element(screen.getByRole("button", { name: m.widget_state_choose_place() }))
		.toBeVisible();
	await new Promise((r) => setTimeout(r, 100));
	expect(fakeMaps.made).toHaveLength(0);
	expect(fakeStores.held.size).toBe(0);
});

test("one region outlines and fits it", async () => {
	await show(mapWidget(region("019")));
	const map = await madeMap();
	await expect.poll(() => map.plugins.map((p) => p.id)).toEqual(["places", "monitors", "pin"]);
	expect(map.plugins[0].options).toMatchObject({
		mode: "plain",
		listed: false,
		selectable: false,
		hoverable: false
	});
	await expect
		.poll(() => map.selections.get("places"))
		.toEqual({ kind: "regions", ids: ["county:019"] });
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
	const source = map.plugins[0].options.source as { features: { features: unknown[] } };
	expect(source.features.features).toHaveLength(1);
});

test("a point fits its region and pins the point, labeled for owner and shared viewer", async () => {
	const point = { place: { kind: "point" as const, lat: 36.7, lon: -119.8 } };
	const pinName = (map: FakeMap) => {
		const pin = map.plugins.find((p) => p.id === "pin")!;
		const fc = (pin.options.source as { features: { features: Feature[] } }).features;
		return fc.features.map((f) => f.properties?.name);
	};
	const owner = await show(mapWidget(point));
	let map = await madeMap();
	await expect.poll(() => pinName(map)).toEqual([m.map_pin_your_location()]);
	expect(map.plugins.find((p) => p.id === "pin")!.options.selectable).toBe(false);
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
	await expect.poll(() => pinName(map)).toEqual([m.map_pin_shared_location()]);
});

test("the pin shows a visible label for the owner and a shared viewer", async () => {
	const point = { place: { kind: "point" as const, lat: 36.7, lon: -119.8 } };
	const owner = await show(mapWidget(point));
	let map = await madeMap();
	map.gl = new FakeGl();
	await expect.poll(() => fakeMarkers.on(map.gl).length).toBe(1);
	let [label] = fakeMarkers.on(map.gl);
	expect(label.element.textContent).toBe(m.map_pin_your_location());
	expect(label.element.getAttribute("aria-hidden")).toBe("true");
	expect(label.lngLat).toEqual([-119.8, 36.7]);
	await owner.unmount();

	fakeMaps.reset();
	fakeMarkers.reset();
	await show(mapWidget(point), "shared");
	map = await madeMap();
	map.gl = new FakeGl();
	await expect.poll(() => fakeMarkers.on(map.gl).length).toBe(1);
	[label] = fakeMarkers.on(map.gl);
	expect(label.element.textContent).toBe(m.map_pin_shared_location());
});

test("a school's pin is labeled with its name", async () => {
	await show(mapWidget({ place: { kind: "location", source: "schools", code: "s1" } }));
	const map = await madeMap();
	map.gl = new FakeGl();
	await expect.poll(() => fakeMarkers.on(map.gl).length).toBe(1);
	expect(fakeMarkers.on(map.gl)[0].element.textContent).toBe("Roosevelt High School");
});

test("the pin label is removed on detach and on unmount", async () => {
	const screen = await show(mapWidget({ place: { kind: "point", lat: 36.7, lon: -119.8 } }));
	const map = await madeMap();
	const first = new FakeGl();
	map.gl = first;
	await expect.poll(() => fakeMarkers.on(first).length).toBe(1);
	// Detached: the label goes with the GL map.
	map.gl = null;
	await expect.poll(() => fakeMarkers.shown.length).toBe(0);
	// Re-attached to a new GL map: one label, on the new one.
	const second = new FakeGl();
	map.gl = second;
	await expect.poll(() => fakeMarkers.on(second).length).toBe(1);
	expect(fakeMarkers.shown).toHaveLength(1);
	await screen.unmount();
	expect(fakeMarkers.shown).toHaveLength(0);
});

test("a region has no pin label", async () => {
	await show(mapWidget(region("019")));
	const map = await madeMap();
	map.gl = new FakeGl();
	await expect.poll(() => map.selections.get("places")).toBeTruthy();
	expect(fakeMarkers.made).toHaveLength(0);
});

test("a monitor selection highlights them with the ring style", async () => {
	await show(mapWidget({ selection: { kind: "monitors", ids: ["a", "b"] } }));
	const map = await madeMap();
	await expect
		.poll(() => map.selections.get("monitors"))
		.toEqual({ kind: "monitors", ids: ["a", "b"] });
	await expect.poll(() => map.plugins.find((p) => p.id === "monitors")).toBeTruthy();
	const monitors = map.plugins.find((p) => p.id === "monitors")!;
	expect(monitors.options).toMatchObject({ selectedStyle: "ring", layerLabel: "PM2.5" });
	expect(monitors.addOptions).toMatchObject({ selectionMode: "none", before: "pin" });
});

test("fits once the store has the monitors", async () => {
	await show(mapWidget({ selection: { kind: "monitors", ids: ["a", "b", "gone"] } }));
	const map = await madeMap();
	map.ready = true;
	await expect.poll(() => fakeStores.held.get("pm25")?.initCalls).toEqual(["pm25"]);
	// Nothing known to fit yet: the map stays on the Valley's view.
	await new Promise((r) => setTimeout(r, 50));
	expect(map.camera).toEqual([]);
	fakeStores.held.get("pm25")!.load([
		["a", -120, 36],
		["b", -119, 37]
	]);
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
	await expect
		.poll(() => map.selections.get("places"))
		.toEqual({ kind: "regions", ids: ["county:029"] });
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

test("a failed store load shows the error, and a retry re-syncs pausing", async () => {
	const screen = await show(mapWidget(region("019")));
	await madeMap();
	await expect.poll(() => fakeStores.held.get("pm25")?.initCalls).toHaveLength(1);
	const store = fakeStores.held.get("pm25")!;
	store.fail(new Error("offline"));
	await expect.element(screen.getByText(m.widget_state_error())).toBeVisible();
	await screen.getByRole("button", { name: m.widget_state_retry() }).click();
	await expect.poll(() => store.initCalls).toHaveLength(2);
	platform.activity.setVisible(false);
	store.load([]);
	await expect.poll(() => store.pauses).toBe(1);
	await expect.poll(() => screen.getByText(m.widget_state_error()).query()).toBeNull();
});

test("a monitor the store doesn't list is no longer available, and the map still draws", async () => {
	const screen = await show(mapWidget({ place: { kind: "monitor", id: "gone" } }));
	const map = await madeMap();
	await expect.poll(() => fakeStores.held.get("pm25")?.initCalls).toHaveLength(1);
	fakeStores.held.get("pm25")!.load([["a", -120, 36]]);
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
	await expect
		.poll(() => map.selections.get("places"))
		.toEqual({ kind: "regions", ids: ["county:019"] });
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
	// The monitor place's own highlight, which the click must leave as it is.
	const selected = map.selections.get("monitors");
	expect(selected).toEqual({ kind: "monitors", ids: ["a"] });
	const before = JSON.parse(JSON.stringify(app().current!.session!.doc.body));
	frame.querySelector<HTMLElement>(`[data-fake-map="${map.uid}"]`)!.click();
	await expect.poll(() => map.pinned?.hit.refKey).toBe("monitor:a");
	await new Promise((r) => setTimeout(r, 100));
	expect(map.selectionCalls).toHaveLength(calls);
	expect(map.selections.get("monitors")).toEqual(selected);
	expect(app().current!.session!.doc.body).toEqual(before);
});
