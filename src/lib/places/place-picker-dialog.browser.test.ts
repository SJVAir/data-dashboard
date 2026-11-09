import "../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { getRegionsMeta } from "@sjvair/sdk";
import { announce, announcer } from "$lib/a11y/announcer.svelte";
import { placePicker, requested } from "$lib/components/dialogs/lazy.svelte";
import type { AdapterContext, RegionResolver } from "$lib/data/adapters/registry";
import type { MetadataSource } from "$lib/data/metadata";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import { fixtureMetadata } from "$lib/data/testing/fixtures";
import type { Layer } from "$lib/data/schema";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp, type AppContext } from "$lib/store/app.svelte";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { fakeAdapter } from "$lib/widgets/shared/test-harness/fake-data";
import { animationsSettled } from "../../test/animations";
import { readRecent, RECENT_KEY } from "./recent";
import DialogHarness from "./test-harness/DialogHarness.svelte";

vi.mock("@sjvair/sdk");

type Region = { type: string; code: string } | null;

const fake = vi.hoisted(() => ({
	client: undefined as QueryClient | undefined,
	metadata: undefined as MetadataSource | undefined,
	resolvers: undefined as Pick<AdapterContext, "regions" | "locations" | "points"> | undefined,
	placeRegion: undefined as ((input: unknown, signal?: AbortSignal) => Promise<Region>) | undefined
}));
// The Forecast strip tile's now client (its fetches fail here; only its place matters).
vi.mock("$lib/data/now", async () => {
	const { createNowClient } = await import("$lib/data/now/client");
	const { createMemoryPlatform } = await import("$lib/platform/memory");
	const client = createNowClient({ activity: createMemoryPlatform().activity });
	return { getNowClient: () => client };
});
vi.mock("$lib/data", () => ({
	getQueryClient: () => fake.client!,
	getMetadata: () => fake.metadata!,
	getResolvers: () => fake.resolvers!,
	placeRegion: (input: unknown, signal?: AbortSignal) => fake.placeRegion!(input, signal)
}));

const META = {
	types: {
		county: { type: "county", label: "County", count: 8, parents: [], browsable: false },
		city: { type: "city", label: "City", count: 50, parents: [], browsable: false },
		zipcode: { type: "zipcode", label: "ZIP code", count: 300, parents: [], browsable: false }
	},
	location_types: {
		public_school: { type: "public_school", label: "Public school", source: "cde-public" }
	}
};

/** Region names as the server has them now (Fresno renamed since it was picked). */
const NAMES: Record<string, string> = {
	"county:06019": "Fresno County",
	"city:0627000": "City of Fresno",
	"zipcode:93721": "ZIP 93721"
};

let placeRegion: ReturnType<
	typeof vi.fn<(input: unknown, signal?: AbortSignal) => Promise<Region>>
>;

beforeEach(async () => {
	await page.viewport(1280, 800);
	vi.mocked(getRegionsMeta).mockResolvedValue(META as never);
	fake.metadata = fixtureMetadata();
	const regions: RegionResolver = {
		resolve: async (type, code) => {
			const name = NAMES[`${type}:${code}`];
			return name ? { id: `${type}-${code}`, name } : null;
		}
	};
	fake.resolvers = {
		regions,
		locations: { resolve: async () => null },
		points: { keys: async () => ["zipcode:93721", "county:06019"] }
	};
	const base = fakeAdapter([]);
	fake.client = createQueryClient({
		adapters: [
			{
				...base,
				async target(layer, ctx) {
					if (layer.place?.kind === "monitor" && layer.place.id === "gone") {
						return { unavailable: "monitor-unlisted" };
					}
					return base.target(layer, ctx);
				}
			}
		],
		metadata: fake.metadata,
		...fake.resolvers
	});
	placeRegion = vi.fn(async () => ({ type: "zipcode", code: "93721" }));
	fake.placeRegion = (input, signal) => placeRegion(input, signal);
});

afterEach(() => {
	placePicker.open = false;
	toast.dismiss();
});

function widget(layer: Partial<Layer>, type = "chart"): WidgetInstance {
	return {
		id: "w1",
		type,
		title: "Readings",
		rect: { x: 0, y: 0, w: 6, h: 8 },
		data: {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			layers: [{ dataset: "air-quality", entryType: "pm25", ...layer }]
		}
	};
}

const COUNTY = { kind: "region", type: "county", code: "06019" } as const;

async function show(w: WidgetInstance, recent: unknown[] = []) {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	await platform.preferences.set(app.space, RECENT_KEY, recent);
	const id = await app.index.createBlank();
	const stored = (await platform.documents.get(app.space, id)) as Dashboard;
	await platform.documents.commit(app.space, {
		docId: id,
		baseVersion: stored.version,
		doc: { ...stored, body: { widgets: [w] } },
		entries: []
	});
	const session = (await DocumentSession.open(platform, app.space, id, "t2"))!;
	app.current = { session, isStarter: false };
	await render(DialogHarness, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	return { app, platform, session };
}

const dialog = () => page.getByRole("dialog", { name: /Choose (a place|places)/ });
const trigger = () => page.getByRole("button", { name: "Actions for Readings" });
const layerOf = (session: DocumentSession) => session.doc.body.widgets[0].data.layers[0];

async function openFromMenu() {
	await trigger().click();
	await page.getByRole("menuitem", { name: m.widget_change_place() }).click();
	await expect.element(page.getByRole("combobox", { name: m.place_picker_label() })).toBeVisible();
	await animationsSettled(dialog().element());
}

/** As if this dashboard had a live share link. */
function shareByLink(app: AppContext, session: DocumentSession) {
	app.sync = { states: { [session.doc.id]: { shareToken: "tok" } } } as never;
}

test("Change place loads the picker lazily; Done applies one undoable edit; the pick is a recent place", async () => {
	const { app, session } = await show(widget({ place: COUNTY }), [
		{ kind: "region", type: "city", code: "0627000" }
	]);
	expect(requested.placePicker).toBe(false);
	expect(document.querySelector("[data-place-picker-dialog]")).toBeNull();
	await openFromMenu();
	expect(requested.placePicker).toBe(true);
	// The current place is named on its chip.
	await page.getByRole("button", { name: "Remove Fresno County" }).click();
	await page.getByRole("option", { name: /City of Fresno/ }).click();
	await page.getByRole("button", { name: m.place_picker_done() }).click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(layerOf(session).place).toEqual({ kind: "region", type: "city", code: "0627000" });
	session.undo();
	expect(layerOf(session).place).toEqual(COUNTY);
	expect(session.canUndo).toBe(false);
	expect(await readRecent(app.platform, app.space)).toEqual([
		{ kind: "region", type: "city", code: "0627000" }
	]);
	await expect.element(trigger()).toHaveFocus();
});

test("Cancel and Escape change nothing and return focus to the menu's trigger", async () => {
	const { session } = await show(widget({ place: COUNTY }));
	await openFromMenu();
	await page.getByRole("button", { name: m.place_picker_cancel() }).click();
	await expect.element(dialog()).not.toBeInTheDocument();
	await expect.element(trigger()).toHaveFocus();
	await openFromMenu();
	await expect.element(page.getByRole("combobox")).toHaveFocus();
	await userEvent.keyboard("{Escape}");
	await expect.element(dialog()).not.toBeInTheDocument();
	await expect.element(trigger()).toHaveFocus();
	expect(session.canUndo).toBe(false);
	expect(layerOf(session).place).toEqual(COUNTY);
	// Opens again normally (the Escape closed it once).
	await openFromMenu();
	await expect.element(dialog()).toBeVisible();
});

test("the idle state's Choose a place opens the picker", async () => {
	const { session } = await show(widget({}), [{ kind: "region", type: "city", code: "0627000" }]);
	await page.getByRole("button", { name: m.widget_state_choose_place() }).click();
	await expect.element(dialog()).toBeVisible();
	await page.getByRole("option", { name: /City of Fresno/ }).click();
	await page.getByRole("button", { name: m.place_picker_done() }).click();
	expect(layerOf(session).place).toEqual({ kind: "region", type: "city", code: "0627000" });
});

test("the no-longer-available card's Choose another opens the picker without the gone place", async () => {
	const { session } = await show(widget({ place: { kind: "monitor", id: "gone" } }), [
		{ kind: "region", type: "city", code: "0627000" }
	]);
	await page.getByRole("button", { name: m.widget_state_choose_another() }).click();
	await expect.element(dialog()).toBeVisible();
	await expect.element(page.getByRole("combobox", { name: m.place_picker_label() })).toBeVisible();
	// The gone monitor isn't a chip, so it neither blocks regions nor stays beside the new pick.
	await expect
		.element(page.getByRole("list", { name: m.place_picker_chosen() }))
		.not.toBeInTheDocument();
	await page.getByRole("option", { name: /City of Fresno/ }).click();
	await page.getByRole("button", { name: m.place_picker_done() }).click();
	expect(layerOf(session).place).toEqual({ kind: "region", type: "city", code: "0627000" });
});

test("a place whose lookup fails stays picked (it may still exist)", async () => {
	const { session } = await show(widget({ place: COUNTY }));
	fake.resolvers!.regions.resolve = async () => {
		throw new Error("offline");
	};
	await openFromMenu();
	await expect
		.element(
			page.getByRole("button", { name: m.place_picker_remove({ name: m.place_picker_unnamed() }) })
		)
		.toBeVisible();
	await page.getByRole("button", { name: m.place_picker_cancel() }).click();
	expect(layerOf(session).place).toEqual(COUNTY);
});

test("a point stays picked when the picker opens", async () => {
	await show(widget({ place: { kind: "point", lat: 36.75, lon: -119.79 } }));
	await openFromMenu();
	await expect
		.element(
			page.getByRole("button", {
				name: m.place_picker_remove({ name: m.place_picker_your_location() })
			})
		)
		.toBeVisible();
});

// These start empty (with one place picked, "your location" would replace it).
test("Use my location without a live link saves the point, not as a recent place", async () => {
	const { app, platform, session } = await show(widget({}));
	platform.geolocation.script({ ok: true, lat: 36.75, lon: -119.79 });
	await openFromMenu();
	await page.getByRole("button", { name: m.place_picker_use_location() }).click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(layerOf(session).place).toEqual({ kind: "point", lat: 36.75, lon: -119.79 });
	expect(placeRegion).not.toHaveBeenCalled();
	expect(await readRecent(app.platform, app.space)).toEqual([]);
});

test("on a live-shared dashboard, Use my location saves the region and says so (checked at Done)", async () => {
	const { app, platform, session } = await show(widget({}));
	platform.geolocation.script({ ok: true, lat: 36.75, lon: -119.79 });
	await openFromMenu();
	// The link is turned on after the dialog opened: Done still sees it.
	shareByLink(app, session);
	await page.getByRole("button", { name: m.place_picker_use_location() }).click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(layerOf(session).place).toEqual({ kind: "region", type: "zipcode", code: "93721" });
	const text = "This dashboard is shared by link, so your location is saved as ZIP 93721.";
	expect(m.place_picker_saved_as_region({ region: "ZIP 93721" })).toBe(text);
	await expect.element(page.getByText(text).first()).toBeVisible();
	await expect.poll(() => announcer.text).toBe(text);
	expect(placeRegion.mock.calls[0][0]).toMatchObject({
		layer: { place: { kind: "point", lat: 36.75, lon: -119.79 } }
	});
	expect(placeRegion.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
	session.undo();
	expect(layerOf(session).place).toBeUndefined();
});

test("on a live-shared dashboard, a now tile's location is looked up as the tile reads it", async () => {
	const { app, platform, session } = await show(widget({}, "current-conditions"));
	platform.geolocation.script({ ok: true, lat: 36.75, lon: -119.79 });
	await openFromMenu();
	shareByLink(app, session);
	await page.getByRole("button", { name: m.place_picker_use_location() }).click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(placeRegion.mock.calls[0][0]).toEqual({
		layer: expect.objectContaining({ place: { kind: "point", lat: 36.75, lon: -119.79 } }),
		dateRange: { kind: "trailing", amount: 6, unit: "hour" },
		pin: "hour"
	});
});

/** A Forecast strip: one forecasts layer, with no entry type. */
function strip(place?: Layer["place"]): WidgetInstance {
	return {
		id: "w1",
		type: "forecast-strip",
		title: "Readings",
		rect: { x: 0, y: 0, w: 3, h: 4 },
		data: { layers: [{ dataset: "forecasts", ...(place ? { place } : {}) }] }
	};
}

test("a Forecast strip (a layer with no entry type) changes place from the tile", async () => {
	const { session } = await show(strip(COUNTY), [
		{ kind: "region", type: "city", code: "0627000" }
	]);
	await openFromMenu();
	await expect.element(dialog()).toBeVisible();
	// Single mode: the pick applies at once.
	await page.getByRole("option", { name: /City of Fresno/ }).click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(layerOf(session)).toEqual({
		dataset: "forecasts",
		place: { kind: "region", type: "city", code: "0627000" }
	});
	session.undo();
	expect(layerOf(session)).toEqual({ dataset: "forecasts", place: COUNTY });
});

test("on a live-shared dashboard, a Forecast strip's location is saved as its region", async () => {
	const { app, platform, session } = await show(strip());
	platform.geolocation.script({ ok: true, lat: 36.75, lon: -119.79 });
	await openFromMenu();
	shareByLink(app, session);
	await page.getByRole("button", { name: m.place_picker_use_location() }).click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(layerOf(session)).toEqual({
		dataset: "forecasts",
		place: { kind: "region", type: "zipcode", code: "93721" }
	});
	expect(placeRegion.mock.calls[0][0]).toMatchObject({
		layer: { place: { kind: "point", lat: 36.75, lon: -119.79 } }
	});
});

test("no saved-as notice when an edit meanwhile already set that region", async () => {
	announce("Start");
	await expect.poll(() => announcer.text).toBe("Start");
	const { app, platform, session } = await show(widget({}));
	platform.geolocation.script({ ok: true, lat: 36.75, lon: -119.79 });
	shareByLink(app, session);
	let finish: (region: Region) => void = () => {};
	placeRegion.mockImplementationOnce(() => new Promise<Region>((resolve) => (finish = resolve)));
	await openFromMenu();
	await page.getByRole("button", { name: m.place_picker_use_location() }).click();
	await expect.element(page.getByText(m.place_picker_dialog_looking_up())).toBeVisible();
	// Another device (or tab) picks that ZIP code meanwhile.
	const data = session.doc.body.widgets[0].data;
	const zip = { kind: "region", type: "zipcode", code: "93721" } as const;
	session.apply({
		op: "setWidgetData",
		target: { widgetId: "w1" },
		from: data,
		to: { ...data, layers: [{ ...data.layers[0], place: zip }] }
	});
	finish(zip);
	await expect.element(dialog()).not.toBeInTheDocument();
	await new Promise((r) => setTimeout(r, 300));
	expect(layerOf(session).place).toEqual(zip);
	const toasts = [...document.querySelectorAll("[data-sonner-toast]")];
	expect(toasts.filter((t) => t.textContent?.includes("so your location is saved as"))).toEqual([]);
	expect(announcer.text).toBe("Start");
});

test("a load failure is announced in the status there while loading, and Retry loads", async () => {
	const metadata = fake.metadata!;
	let fail = true;
	let release: () => void = () => {};
	fake.metadata = {
		...metadata,
		catalog: async (signal) => {
			if (fail) {
				await new Promise<void>((resolve) => (release = resolve));
				throw new Error("down");
			}
			return metadata.catalog(signal);
		}
	};
	await show(widget({ place: COUNTY }));
	await trigger().click();
	await page.getByRole("menuitem", { name: m.widget_change_place() }).click();
	const status = () =>
		document.querySelector("[data-place-picker-load-status]") as HTMLElement | null;
	await expect.poll(() => status()?.textContent?.trim()).toBe(m.place_picker_dialog_loading());
	const before = status();
	expect(before!.getAttribute("role")).toBe("status");
	release();
	await expect.poll(() => status()?.textContent?.trim()).toBe(m.place_picker_dialog_failed());
	// The same node, so the change is announced.
	expect(status()).toBe(before);
	fail = false;
	await dialog().getByRole("button", { name: m.place_picker_retry() }).click();
	await expect.element(page.getByRole("combobox", { name: m.place_picker_label() })).toBeVisible();
	expect(status()?.textContent?.trim()).toBe("");
});

test("on a live-shared dashboard, a failed lookup applies nothing and offers Retry", async () => {
	const { app, platform, session } = await show(widget({}));
	platform.geolocation.script({ ok: true, lat: 36.75, lon: -119.79 });
	shareByLink(app, session);
	placeRegion.mockResolvedValueOnce(null);
	await openFromMenu();
	await page.getByRole("button", { name: m.place_picker_use_location() }).click();
	await expect.element(page.getByText(m.place_picker_dialog_lookup_failed())).toBeVisible();
	expect(layerOf(session).place).toBeUndefined();
	expect(session.canUndo).toBe(false);
	await dialog().getByRole("button", { name: m.place_picker_retry() }).click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(layerOf(session).place).toEqual({ kind: "region", type: "zipcode", code: "93721" });
});

test("closing the dialog during a lookup leaves no edit, toast or announcement afterward", async () => {
	// The announcer outlives each test's render: start from a message of this test's own.
	announce("Start");
	await expect.poll(() => announcer.text).toBe("Start");
	const { app, platform, session } = await show(widget({}));
	platform.geolocation.script({ ok: true, lat: 36.75, lon: -119.79 });
	shareByLink(app, session);
	let finish: (region: Region) => void = () => {};
	let seen: AbortSignal | undefined;
	placeRegion.mockImplementationOnce(
		(_input, signal) =>
			new Promise<Region>((resolve) => {
				seen = signal;
				finish = resolve;
			})
	);
	await openFromMenu();
	await page.getByRole("button", { name: m.place_picker_use_location() }).click();
	await expect.element(page.getByText(m.place_picker_dialog_looking_up())).toBeVisible();
	await page.getByRole("button", { name: m.place_picker_cancel() }).click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(seen?.aborted).toBe(true);
	finish({ type: "zipcode", code: "93721" });
	await new Promise((r) => setTimeout(r, 300));
	expect(session.canUndo).toBe(false);
	const toasts = [...document.querySelectorAll("[data-sonner-toast]")];
	expect(toasts.filter((t) => t.textContent?.includes("so your location is saved as"))).toEqual([]);
	expect(announcer.text).toBe("Start");
});

test("Recent shows current names and leaves out a place that no longer resolves", async () => {
	await show(widget({ place: COUNTY }), [
		{ kind: "region", type: "zipcode", code: "00000" },
		{ kind: "region", type: "city", code: "0627000" },
		{ kind: "monitor", id: "m-pa" }
	]);
	await openFromMenu();
	const recent = page.getByRole("group", { name: m.place_picker_recent() });
	await expect.element(recent.getByRole("option", { name: /City of Fresno/ })).toBeVisible();
	await expect.element(recent.getByRole("option", { name: /Purple Air/ })).toBeVisible();
	expect(recent.getByRole("option").elements()).toHaveLength(2);
});

test("the dialog fills the screen on a phone", async () => {
	await page.viewport(390, 800);
	await show(widget({ place: COUNTY }));
	await trigger().click();
	await page.getByRole("menuitem", { name: m.widget_change_place() }).click();
	await expect.element(page.getByRole("combobox")).toBeVisible();
	await animationsSettled(dialog().element());
	const box = dialog().element().getBoundingClientRect();
	expect(box.left).toBe(0);
	expect(box.top).toBe(0);
	expect(box.width).toBe(390);
	expect(box.height).toBe(800);
});

test("a minimized widget's taskbar menu has Change place too", async () => {
	await show({ ...widget({ place: COUNTY }), minimized: { order: 0 } });
	await page.getByTestId("taskbar-w1").click({ button: "right" });
	await page.getByRole("menuitem", { name: m.widget_change_place() }).click();
	await expect.element(page.getByRole("combobox", { name: m.place_picker_label() })).toBeVisible();
});
