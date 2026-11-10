import "../../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { getRegionsMeta } from "@sjvair/sdk";
import { announcer } from "$lib/a11y/announcer.svelte";
import { placePicker } from "$lib/components/dialogs/lazy.svelte";
import type { AdapterContext, RegionResolver } from "$lib/data/adapters/registry";
import type { MetadataSource } from "$lib/data/metadata";
import { fixtureMetadata } from "$lib/data/testing/fixtures";
import type { ChosenPlace, Layer } from "$lib/data/schema";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform, type MemoryPlatform } from "$lib/platform/memory";
import { RECENT_KEY } from "$lib/places/recent";
import DialogHarness from "$lib/places/test-harness/DialogHarness.svelte";
import { STARTER_PLACE_KEY, saveStarterPlace } from "$lib/starter/place.svelte";
import { STARTER_ID } from "$lib/starter/starter";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { animationsSettled } from "../../../test/animations";
import Harness from "./test-harness/Harness.svelte";
import { stubStarterTypes } from "./test-harness/stub-starter-types";

vi.mock("@sjvair/sdk");

type Region = { type: string; code: string } | null;

const fake = vi.hoisted(() => ({
	metadata: undefined as MetadataSource | undefined,
	resolvers: undefined as Pick<AdapterContext, "regions" | "locations" | "points"> | undefined,
	placeRegion: undefined as ((input: unknown, signal?: AbortSignal) => Promise<Region>) | undefined
}));
vi.mock("$lib/data", () => ({
	getQueryClient: () => {
		throw new Error("The stubbed widgets load no data");
	},
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
	location_types: {}
};

const NAMES: Record<string, string> = {
	"county:06019": "Fresno County",
	"city:0627000": "City of Fresno",
	"zipcode:93721": "ZIP 93721"
};

const COUNTY: ChosenPlace = { kind: "region", type: "county", code: "06019" };
const CITY: ChosenPlace = { kind: "region", type: "city", code: "0627000" };
const ZIP: ChosenPlace = { kind: "region", type: "zipcode", code: "93721" };

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
	placeRegion = vi.fn(async () => ({ type: "zipcode", code: "93721" }));
	fake.placeRegion = (input, signal) => placeRegion(input, signal);
});

afterEach(() => {
	placePicker.open = false;
	toast.dismiss();
});

async function makeApp(platform: MemoryPlatform = createMemoryPlatform()) {
	await platform.preferences.set("anonymous", RECENT_KEY, [CITY, ZIP]);
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	stubStarterTypes();
	return { platform, app };
}

/** The starter, current, as `/` shows it. */
async function showStarter(platform?: MemoryPlatform) {
	const { app, ...rest } = await makeApp(platform);
	const starter = (await app.sessions.get(STARTER_ID))!;
	app.current = { session: starter, isStarter: true };
	await render(DialogHarness, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	return { app, starter, ...rest };
}

function chart(id: string, layers: Layer[], y: number): WidgetInstance {
	return {
		id,
		type: "chart",
		title: `Chart ${id}`,
		rect: { x: 0, y, w: 6, h: 4 },
		data: { dateRange: { kind: "trailing", amount: 30, unit: "day" }, layers }
	};
}
const pm25 = (place: ChosenPlace): Layer => ({ dataset: "air-quality", entryType: "pm25", place });

/** A stored copy of the starter holding `widgets`, with the bar at `bar`, current. */
async function showCopy(widgets: WidgetInstance[], bar: ChosenPlace = COUNTY) {
	const { app, platform } = await makeApp();
	const id = await app.index.createBlank();
	const stored = (await platform.documents.get(app.space, id)) as Dashboard;
	await platform.documents.commit(app.space, {
		docId: id,
		baseVersion: stored.version,
		doc: { ...stored, copiedFrom: STARTER_ID, body: { widgets, placeBar: { place: bar } } },
		entries: []
	});
	const session = (await DocumentSession.open(platform, app.space, id, "t2"))!;
	app.current = { session, isStarter: false };
	await render(DialogHarness, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	return { app, platform, session };
}

const bar = () => page.getByRole("region", { name: m.place_bar_label() });
const barText = () => document.querySelector("[data-place-bar]")?.textContent ?? "";
const changePlace = () => bar().getByRole("button", { name: m.place_bar_change() });
const dialog = () => page.getByRole("dialog", { name: m.place_picker_dialog_title() });
const alsoChange = (count: number) =>
	page.getByRole("checkbox", {
		name: m.place_picker_also_change({ count: String(count), countValue: count })
	});
const placesOf = (doc: Dashboard) =>
	doc.body.widgets.map((w) => w.data.layers.map((l) => l.place ?? null));

async function openBar() {
	await changePlace().click();
	await expect.element(page.getByRole("combobox", { name: m.place_picker_label() })).toBeVisible();
	await animationsSettled(dialog().element());
}

async function pick(name: RegExp) {
	await page.getByRole("option", { name }).click();
	await expect.element(dialog()).not.toBeInTheDocument();
}

test("the starter shows Showing Fresno County · Change place", async () => {
	await showStarter();
	await expect.poll(barText).toContain("Showing Fresno County");
	await expect.element(changePlace()).toBeVisible();
	expect(m.place_bar_showing({ place: "Fresno County" })).toBe("Showing Fresno County");
	expect(m.place_bar_change()).toBe("Change place");
});

test("Done on another place changes every widget: no copy, no undo, saved, announced, kept after a reload", async () => {
	const { app, platform, starter } = await showStarter();
	await expect.poll(barText).toContain("Showing Fresno County");
	await openBar();
	await pick(/City of Fresno/);
	await expect.poll(barText).toContain("Showing City of Fresno");
	const shown = app.current.session!;
	expect(app.current.isStarter).toBe(true);
	expect(shown).not.toBe(starter);
	for (const places of placesOf(shown.doc))
		for (const p of places) expect([null, CITY]).toContainEqual(p);
	expect(shown.doc.body.placeBar).toEqual({ place: CITY });
	expect(shown.canUndo).toBe(false);
	expect(await platform.documents.list(app.space)).toHaveLength(0);
	expect(await platform.preferences.get(app.space, STARTER_PLACE_KEY)).toEqual(CITY);
	// Said politely, through the page's region.
	await expect.poll(() => announcer.text).toBe("Showing City of Fresno");
	await expect.element(changePlace()).toHaveFocus();
	const again = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t3" });
	expect(again.starterPlace).toEqual(CITY);
});

test("picking the same place does nothing", async () => {
	const { app, starter } = await showStarter();
	await openBar();
	await pick(/City of Fresno/);
	const changed = app.current.session;
	await openBar();
	await pick(/City of Fresno/);
	expect(app.current.session).toBe(changed);
	expect(app.current.session).not.toBe(starter);
	expect(app.current.session!.canUndo).toBe(false);
});

test("Use my location is offered, and asks only when chosen", async () => {
	const { app, platform } = await showStarter();
	const locate = vi.spyOn(platform.geolocation, "locate");
	platform.geolocation.script({ ok: true, lat: 36.75, lon: -119.79 });
	await openBar();
	expect(locate).not.toHaveBeenCalled();
	await page.getByRole("button", { name: m.place_picker_use_location() }).click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(locate).toHaveBeenCalledOnce();
	expect(app.starterPlace).toEqual({ kind: "point", lat: 36.75, lon: -119.79 });
	await expect.poll(barText).toContain("Showing your location");
});

test("on a copy, Done is one undo step switching only the bar's widgets; comparisons never switch", async () => {
	const mixed = chart("c", [pm25(COUNTY), pm25(CITY)], 8);
	const { session } = await showCopy([
		chart("a", [pm25(COUNTY)], 0),
		chart("b", [pm25(CITY)], 4),
		mixed
	]);
	await expect.poll(barText).toContain("Showing Fresno County");
	await openBar();
	await expect.element(alsoChange(1)).not.toBeChecked();
	await pick(/ZIP 93721/);
	expect(placesOf(session.doc)).toEqual([[ZIP], [CITY], [COUNTY, CITY]]);
	expect(session.doc.body.placeBar).toEqual({ place: ZIP });
	await expect.poll(barText).toContain("Showing ZIP 93721");
	session.undo();
	expect(placesOf(session.doc)).toEqual([[COUNTY], [CITY], [COUNTY, CITY]]);
	expect(session.doc.body.placeBar).toEqual({ place: COUNTY });
	expect(session.canUndo).toBe(false);
});

test("Also change… switches the widgets showing other places too (comparisons still never)", async () => {
	const { session } = await showCopy([
		chart("a", [pm25(COUNTY)], 0),
		chart("b", [pm25(CITY)], 4),
		chart("d", [pm25(CITY)], 8),
		chart("c", [pm25(COUNTY), pm25(CITY)], 12)
	]);
	await openBar();
	expect(m.place_picker_also_change({ count: "2", countValue: 2 })).toBe(
		"Also change the 2 widgets showing other places"
	);
	expect(m.place_picker_also_change({ count: "1", countValue: 1 })).toBe(
		"Also change the 1 widget showing another place"
	);
	await alsoChange(2).click();
	await pick(/ZIP 93721/);
	expect(placesOf(session.doc)).toEqual([[ZIP], [ZIP], [ZIP], [COUNTY, CITY]]);
	session.undo();
	expect(session.canUndo).toBe(false);
});

test("with no widgets elsewhere, Also change… isn't offered", async () => {
	await showCopy([chart("a", [pm25(COUNTY)], 0)]);
	await openBar();
	await expect.element(page.getByRole("checkbox")).not.toBeInTheDocument();
});

test("the bar hides when no widget shows its place", async () => {
	const { session } = await showCopy([chart("a", [pm25(COUNTY)], 0)]);
	await expect.element(bar()).toBeVisible();
	const w = session.doc.body.widgets[0];
	session.apply({
		op: "setWidgetData",
		target: { widgetId: "a" },
		from: w.data,
		to: { ...w.data, layers: [pm25(CITY)] }
	});
	await expect.element(bar()).not.toBeInTheDocument();
});

test("on a live link, a point is saved as its region in the bar and its widgets", async () => {
	const { app, platform, session } = await showCopy([chart("a", [pm25(COUNTY)], 0)]);
	platform.geolocation.script({ ok: true, lat: 36.75, lon: -119.79 });
	app.sync = { states: { [session.doc.id]: { shareToken: "tok" } } } as never;
	await openBar();
	await page.getByRole("button", { name: m.place_picker_use_location() }).click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(placesOf(session.doc)).toEqual([[ZIP]]);
	expect(session.doc.body.placeBar).toEqual({ place: ZIP });
	expect(placeRegion.mock.calls[0][0]).toMatchObject({
		layer: { place: { kind: "point", lat: 36.75, lon: -119.79 } }
	});
});

test("a live-share viewer sees Showing … without Change place", async () => {
	const { app } = await makeApp();
	const view = {
		...(await app.sessions.get(STARTER_ID))!.doc,
		id: "shared"
	};
	await render(Harness, { props: { view }, context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect.poll(barText).toContain("Showing Fresno County");
	await expect
		.element(page.getByRole("button", { name: m.place_bar_change() }))
		.not.toBeInTheDocument();
});

test("starter bar during hand-off applies to the copy", async () => {
	const { app, starter } = await showStarter();
	await openBar();
	// The first edit starts the copy while the picker is open.
	starter.apply({ op: "setField", target: { path: "name" }, from: null, to: "Mine" });
	await pick(/City of Fresno/);
	await expect.poll(() => app.current.isStarter).toBe(false);
	const copy = app.current.session!;
	await expect.poll(() => copy.doc.body.placeBar).toEqual({ place: CITY });
	expect(copy.doc.name).toBe("Mine");
	expect(app.starterPlace).toEqual(COUNTY);
	copy.undo();
	expect(copy.doc.name).toBe("Mine");
	expect(copy.doc.body.placeBar).toEqual({ place: COUNTY });
});

test("an unknown place is named with the generic fallback, and can still be changed", async () => {
	const platform = createMemoryPlatform();
	await saveStarterPlace(platform, "anonymous", { kind: "region", type: "county", code: "gone" });
	await showStarter(platform);
	await expect.poll(barText).toContain("Showing the chosen place");
	expect(m.place_bar_showing_unnamed()).toBe("Showing the chosen place");
	await expect.element(changePlace()).toBeVisible();
});
