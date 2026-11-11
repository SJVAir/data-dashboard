import "../../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { getRegionsMeta } from "@sjvair/sdk";
import { placePicker, whichPlace } from "$lib/components/dialogs/lazy.svelte";
import type { AdapterContext, RegionResolver } from "$lib/data/adapters/registry";
import type { MetadataSource } from "$lib/data/metadata";
import { fixtureMetadata } from "$lib/data/testing/fixtures";
import type { ChosenPlace, Layer } from "$lib/data/schema";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform, type MemoryPlatform } from "$lib/platform/memory";
import { RECENT_KEY } from "$lib/places/recent";
import DialogHarness from "$lib/places/test-harness/DialogHarness.svelte";
import { STARTER_ID } from "$lib/starter/starter";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { animationsSettled } from "../../../test/animations";
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
	whichPlace.open = false;
	toast.dismiss();
});

async function makeApp(platform: MemoryPlatform = createMemoryPlatform()) {
	await platform.preferences.set("anonymous", RECENT_KEY, [CITY, ZIP, COUNTY]);
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

/** A stored dashboard holding `widgets` (a starter copy with its bar at `bar`), current. */
async function showCopy(widgets: WidgetInstance[], bar: ChosenPlace | null = COUNTY) {
	const { app, platform } = await makeApp();
	const id = await app.index.createBlank();
	const stored = (await platform.documents.get(app.space, id)) as Dashboard;
	await platform.documents.commit(app.space, {
		docId: id,
		baseVersion: stored.version,
		doc: bar
			? { ...stored, copiedFrom: STARTER_ID, body: { widgets, placeBar: { place: bar } } }
			: { ...stored, body: { widgets } },
		entries: []
	});
	const session = (await DocumentSession.open(platform, app.space, id, "t2"))!;
	app.current = { session, isStarter: false };
	await render(DialogHarness, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	return { app, platform, session };
}

const more = () => page.getByRole("button", { name: "Dashboard actions" });
const picker = () => page.getByRole("dialog", { name: m.place_picker_dialog_title() });
const which = () => page.getByRole("dialog", { name: m.which_place_replace_title() });
const renameDialog = () => page.getByRole("dialog", { name: m.rename_dashboard_title() });
const placesOf = (doc: Dashboard) =>
	doc.body.widgets.map((w) => w.data.layers.map((l) => l.place ?? null));

async function start() {
	await more().click();
	await page.getByRole("menuitem", { name: m.dashboard_duplicate_for_another_place() }).click();
}

async function pickPlace(name: RegExp) {
	await expect.element(page.getByRole("combobox", { name: m.place_picker_label() })).toBeVisible();
	await animationsSettled(picker().element());
	await page.getByRole("option", { name }).click();
	await expect.element(picker()).not.toBeInTheDocument();
}

/** Closes the copy's rename step (Escape keeps its name). */
async function closeRename() {
	await animationsSettled(renameDialog().element());
	await userEvent.keyboard("{Escape}");
	await expect.element(renameDialog()).not.toBeInTheDocument();
}

/** The dashboards stored besides `except`. */
async function copies(platform: MemoryPlatform, except: string[]): Promise<Dashboard[]> {
	const docs = (await platform.documents.list("anonymous")) as Dashboard[];
	return docs.filter((d) => !except.includes(d.id));
}

test("with a visible bar, the copy has the bar's place replaced and its bar shows the new one; the rename step follows", async () => {
	const mixed = chart("c", [pm25(COUNTY), pm25(CITY)], 8);
	const { platform, session } = await showCopy([
		chart("a", [pm25(COUNTY)], 0),
		chart("b", [pm25(CITY)], 4),
		chart("d", [pm25(CITY)], 12),
		mixed
	]);
	const before = structuredClone(session.doc);
	await start();
	// The bar's place, though City of Fresno shows more often: no question.
	await pickPlace(/ZIP 93721/);
	await expect.element(which()).not.toBeInTheDocument();
	await expect.element(renameDialog()).toBeVisible();
	await closeRename();
	const [copy] = await copies(platform, [session.doc.id]);
	expect(placesOf(copy)).toEqual([[ZIP], [CITY], [CITY], [COUNTY, CITY]]);
	expect(copy.body.placeBar).toEqual({ place: ZIP });
	expect(copy.copiedFrom).toBe(session.doc.id);
	expect(session.doc.body).toEqual(before.body);
});

test("a tie asks which place first, with a labeled radio group; the copy gains no bar", async () => {
	const { platform, session } = await showCopy(
		[chart("a", [pm25(COUNTY)], 0), chart("b", [pm25(CITY)], 4)],
		null
	);
	await start();
	await expect.element(which()).toBeVisible();
	const group = page.getByRole("radiogroup", { name: m.which_place_replace_title() });
	await expect.element(group).toBeVisible();
	await expect.element(group.getByRole("radio", { name: "Fresno County" })).toBeChecked();
	await group.getByRole("radio", { name: "City of Fresno" }).click();
	await page.getByRole("button", { name: m.which_place_continue() }).click();
	await expect.element(which()).not.toBeInTheDocument();
	await pickPlace(/ZIP 93721/);
	await expect.element(renameDialog()).toBeVisible();
	await closeRename();
	const [copy] = await copies(platform, [session.doc.id]);
	expect(placesOf(copy)).toEqual([[COUNTY], [ZIP]]);
	expect(copy.body.placeBar).toBeUndefined();
	expect(placesOf(session.doc)).toEqual([[COUNTY], [CITY]]);
});

test("Escape on the question makes no copy and returns focus to the dashboard's menu button", async () => {
	const { platform, session } = await showCopy(
		[chart("a", [pm25(COUNTY)], 0), chart("b", [pm25(CITY)], 4)],
		null
	);
	await start();
	await expect.element(which()).toBeVisible();
	await animationsSettled(which().element());
	await userEvent.keyboard("{Escape}");
	await expect.element(which()).not.toBeInTheDocument();
	await expect.element(more()).toHaveFocus();
	expect(placePicker.open).toBe(false);
	expect(await copies(platform, [session.doc.id])).toEqual([]);
});

test("closing the picker makes no copy", async () => {
	const { platform, session } = await showCopy([chart("a", [pm25(COUNTY)], 0)], null);
	await start();
	await expect.element(page.getByRole("combobox", { name: m.place_picker_label() })).toBeVisible();
	await animationsSettled(picker().element());
	await userEvent.keyboard("{Escape}");
	await expect.element(picker()).not.toBeInTheDocument();
	await expect.element(more()).toHaveFocus();
	expect(await copies(platform, [session.doc.id])).toEqual([]);
});

test("the starter duplicates with its chosen place replaced; the starter stays", async () => {
	const { app, platform, starter } = await showStarter();
	await start();
	await pickPlace(/City of Fresno/);
	await expect.element(renameDialog()).toBeVisible();
	await closeRename();
	const [copy] = await copies(platform, []);
	expect(copy.copiedFrom).toBe(STARTER_ID);
	expect(copy.body.placeBar).toEqual({ place: CITY });
	expect(placesOf(copy).flat()).not.toContainEqual(COUNTY);
	expect(placesOf(copy).flat()).toContainEqual(CITY);
	expect(app.starterPlace).toEqual(COUNTY);
	expect(starter.doc.body.placeBar).toEqual({ place: COUNTY });
});

test("hidden when nothing shows a single place", async () => {
	await showCopy([chart("c", [pm25(COUNTY), pm25(CITY)], 0)], null);
	await more().click();
	await expect.element(page.getByRole("menuitem", { name: /^Duplicate dashboard/ })).toBeVisible();
	await expect
		.element(page.getByRole("menuitem", { name: m.dashboard_duplicate_for_another_place() }))
		.not.toBeInTheDocument();
});
