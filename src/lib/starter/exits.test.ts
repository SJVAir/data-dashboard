/**
 * Every way out of the starter (its first edit, "New from starter", Duplicate, Export) gives a
 * document at the chosen place, with the bar, that passes `DashboardSchema`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChosenPlace } from "$lib/data/schema";
import { DashboardSchema, type Dashboard } from "$lib/documents/schema";
import { addFromDraft } from "$lib/get-data/add";
import { setPlatform } from "$lib/platform";
import { createMemoryPlatform } from "$lib/platform/memory";
import { openShare, type ShareOptions } from "$lib/components/dialogs/lazy.svelte";
import { exportDashboard, shareDashboard } from "$lib/sharing/actions";
import { parseLinkFragment } from "$lib/sharing/incoming";
import { m } from "$lib/paraglide/messages.js";
import { toast } from "svelte-sonner";
import type { SyncWorker } from "$lib/sync/worker.svelte";
import { LAST_OPENED_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { DEFAULT_PLACE } from "$lib/widgets/defaults";
import { writeSelection } from "$lib/widgets/calendars/shared/write-selection";
import { getMetadata, placeRegion } from "$lib/data";
import { report } from "$lib/safety/report";
import { STARTER_AREA_KEY, STARTER_PLACE_KEY, saveStarterPlace } from "./place.svelte";
import { STARTER_ID } from "./starter";
import { barChange } from "$lib/places/replace";
import { loadMonitorTypes, loadMonitorTypesResult } from "$lib/widgets/map/start";
import { MAP_TYPE } from "$lib/widgets/map/options";
import { dashboardActions } from "$lib/actions/dashboard";
import { removeWidget, widgetActions } from "$lib/actions/widget";
import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
import { openRename } from "$lib/components/dialogs/RenameDialog.svelte";
import { takeAfterMenuClose } from "$lib/components/menu/menu-state.svelte";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import { pickedData } from "$lib/places/apply";
import { marksChange } from "$lib/widgets/map/marks";
import { changeTileOptions } from "$lib/widgets/shared/tile-options.svelte";

// Sharing's navigation and dialogs aren't used here (and the router needs a page).
vi.mock("../../router", () => ({ navigate: vi.fn() }));
vi.mock("$lib/components/dialogs/lazy.svelte", () => ({
	openShare: vi.fn(),
	openPlacePicker: vi.fn(),
	askWhichPlace: vi.fn()
}));
vi.mock("$lib/components/dialogs/RenameDialog.svelte", () => ({ openRename: vi.fn() }));
vi.mock("svelte-sonner", () => ({
	toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn() })
}));
// Any point is in ZIP 93721.
vi.mock("$lib/data", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/data")>()),
	placeRegion: vi.fn(async () => ({ type: "zipcode", code: "93721" }))
}));

// Reports as usual, counted.
vi.mock("$lib/safety/report", async (importOriginal) => {
	const original = await importOriginal<typeof import("$lib/safety/report")>();
	return { ...original, report: vi.fn(original.report) };
});

// The catalog's monitor types, as loaded (a test controls when they arrive). The app asks
// `loadMonitorTypesResult`, which answers with `loadMonitorTypes`' types (never a failure) unless a
// test says otherwise.
vi.mock("$lib/widgets/map/start", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/widgets/map/start")>()),
	loadMonitorTypes: vi.fn(),
	loadMonitorTypesResult: vi.fn()
}));

const TYPES = ["purpleair", "airnow"];

beforeEach(() => {
	vi.mocked(loadMonitorTypes).mockReset();
	vi.mocked(loadMonitorTypes).mockImplementation(async () => [...TYPES]);
	vi.mocked(loadMonitorTypesResult).mockReset();
	vi.mocked(loadMonitorTypesResult).mockImplementation(async () => ({
		types: await loadMonitorTypes(),
		failed: false
	}));
});

/** Makes the next load answer only when `answer` is called. */
function holdTypes() {
	let answer!: (types: string[]) => void;
	vi.mocked(loadMonitorTypes).mockImplementationOnce(
		() => new Promise<string[]>((resolve) => (answer = resolve))
	);
	return (types: string[] = [...TYPES]) => answer(types);
}

/** The monitor types `doc`'s Map ticks (`undefined`: none). */
function mapTypes(doc: Dashboard): string[] | undefined {
	const map = doc.body.widgets.find((w) => w.type === MAP_TYPE)!;
	return map.data.layers.find((l) => l.monitorTypes)?.monitorTypes;
}

const SCHOOL: ChosenPlace = { kind: "location", source: "schools", code: "123" };
const POINT: ChosenPlace = { kind: "point", lat: 36.7378, lon: -119.7871 };
const ZIP: ChosenPlace = { kind: "region", type: "zipcode", code: "93721" };
const TULARE: ChosenPlace = { kind: "region", type: "county", code: "06107" };

/**
 * The app, with `place` saved as the starter's place first (none: unset), and the starter claimed
 * as Home claims it while mounted (`release` lets go, as Home's teardown does): these tests open the
 * starter and show it after an await, as Home does.
 */
async function setup(place?: ChosenPlace) {
	const platform = createMemoryPlatform();
	setPlatform(platform);
	if (place) await saveStarterPlace(platform, "anonymous", place);
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const release = app.claimStarter();
	return { platform, app, release };
}

async function stored(platform: ReturnType<typeof createMemoryPlatform>, id: string) {
	return (await platform.documents.get("anonymous", id)) as Dashboard;
}

/** The one stored dashboard, once there is one. */
async function newest(platform: ReturnType<typeof createMemoryPlatform>) {
	let id = "";
	await vi.waitFor(async () => {
		const ids = await platform.documents.list("anonymous");
		expect(ids).toHaveLength(1);
		id = typeof ids[0] === "string" ? ids[0] : (ids[0] as { id: string }).id;
	});
	return stored(platform, id);
}

/** The starter, shown. */
async function showStarter(app: Awaited<ReturnType<typeof initApp>>) {
	const starter = (await app.sessions.get(STARTER_ID))!;
	app.current = { session: starter, isStarter: true };
	return starter;
}

/** Runs the open dashboard's menu item `id` as the menu does (after it closes). */
async function run(app: Awaited<ReturnType<typeof initApp>>, id: string) {
	const ctx = { target: {} as Element, payload: {} };
	const item = dashboardActions(app)(ctx).find((i) => i.id === id)!;
	item.run!(ctx);
	takeAfterMenuClose()?.();
}

/**
 * `doc` is the starter at `place`; its Chart (areas only, decision 2) at `area` when `place` is a
 * school or point (Fresno County when no region was looked up).
 */
function expectFromStarter(
	doc: Dashboard,
	place: ChosenPlace,
	area: ChosenPlace = DEFAULT_PLACE,
	types: string[] | null = TYPES
) {
	expect(DashboardSchema.safeParse(doc).success).toBe(true);
	// `null`: none ticked.
	expect(mapTypes(doc)).toEqual(types ?? undefined);
	expect(doc.copiedFrom).toBe(STARTER_ID);
	expect(doc.body.placeBar).toEqual({ place });
	expect(JSON.stringify(doc)).not.toContain("default-place");
	const shown = doc.body.widgets.filter((w) => w.data.place);
	expect(shown.length).toBeGreaterThanOrEqual(5);
	const forAreas = place.kind === "region" ? place : area;
	for (const w of shown) expect(w.data.place).toEqual(w.type === "chart" ? forAreas : place);
}

describe("the starter's place in the app", () => {
	it("unset: Fresno County", async () => {
		const { app } = await setup();
		expect(app.starterPlace).toEqual(DEFAULT_PLACE);
		const starter = (await app.sessions.get(STARTER_ID))!;
		expect(starter.doc.body.placeBar).toEqual({ place: DEFAULT_PLACE });
	});

	it("the starter session shows the saved place", async () => {
		const { app } = await setup(SCHOOL);
		expect(app.starterPlace).toEqual(SCHOOL);
		const starter = (await app.sessions.get(STARTER_ID))!;
		expect(DashboardSchema.safeParse(starter.doc).success).toBe(true);
		expect(starter.doc.body.placeBar).toEqual({ place: SCHOOL });
	});

	it("is read again after Clear my data", async () => {
		const { platform, app } = await setup(SCHOOL);
		await platform.preferences.set("anonymous", STARTER_PLACE_KEY, null);
		await app.resetAfterClear();
		expect(app.starterPlace).toEqual(DEFAULT_PLACE);
		const starter = (await app.sessions.get(STARTER_ID))!;
		expect(starter.doc.body.placeBar).toEqual({ place: DEFAULT_PLACE });
	});
});

describe("every exit from the starter holds the chosen place", () => {
	it("New from starter", async () => {
		const { platform, app } = await setup(SCHOOL);
		const answer = holdTypes();
		await run(app, "new-from-starter");
		// It waits for the catalog's monitor types: asked, and nothing stored meanwhile.
		await vi.waitFor(() => expect(loadMonitorTypes).toHaveBeenCalledOnce());
		await Promise.resolve();
		expect(await platform.documents.list("anonymous")).toHaveLength(0);
		answer();
		expectFromStarter(await newest(platform), SCHOOL);
	});

	it("Duplicate of the starter", async () => {
		const { platform, app } = await setup(SCHOOL);
		await showStarter(app);
		await run(app, "duplicate-dashboard");
		expectFromStarter(await newest(platform), SCHOOL);
	});

	it("Duplicate of the starter for another place", async () => {
		// At an area, so every widget (the Chart too) moves to the new place.
		const { platform, app } = await setup(ZIP);
		await showStarter(app);
		vi.mocked(openPlacePicker).mockClear();
		await run(app, "duplicate-for-another-place");
		await vi.waitFor(() => expect(openPlacePicker).toHaveBeenCalled());
		const { pick } = vi.mocked(openPlacePicker).mock.calls[0][0] as {
			pick: (p: ChosenPlace) => void;
		};
		pick(TULARE);
		expectFromStarter(await newest(platform), TULARE);
	});

	it("the first edit's copy", async () => {
		const { platform, app } = await setup(SCHOOL);
		const starter = (await app.sessions.get(STARTER_ID))!;
		app.current = { session: starter, isStarter: true };
		starter.apply({ op: "setField", target: { path: "name" }, from: null, to: "Mine" });
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		const copy = app.current.session!;
		await copy.flush();
		expectFromStarter(await stored(platform, copy.doc.id), SCHOOL);
	});

	it("Get data's Add to dashboard on the starter", async () => {
		const { platform, app } = await setup(SCHOOL);
		// A one-place tile at the school (a Chart's Where would hold an area).
		const { dashboardId } = await addFromDraft(app, STARTER_ID, {
			type: "current-conditions",
			data: { place: SCHOOL, layers: [{ dataset: "air-quality", entryType: "pm25" }] }
		});
		const copy = (await app.sessions.get(dashboardId))!;
		await copy.flush();
		expectFromStarter(await stored(platform, dashboardId), SCHOOL);
	});

	it("a calendar selection on the starter", async () => {
		const { platform, app } = await setup(SCHOOL);
		const starter = (await app.sessions.get(STARTER_ID))!;
		app.current = { session: starter, isStarter: true };
		const calendar = starter.doc.body.widgets.find((w) => w.type === "calendar-month")!;
		writeSelection(app, calendar, { start: "2026-11-02", end: "2026-11-03" });
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		const copy = app.current.session!;
		await copy.flush();
		const doc = await stored(platform, copy.doc.id);
		expectFromStarter(doc, SCHOOL);
		expect(doc.body.widgets.find((w) => w.id === calendar.id)!.data.timeSubRange).toEqual({
			start: "2026-11-02",
			end: "2026-11-03"
		});
	});

	it("Export", async () => {
		const { platform, app } = await setup(SCHOOL);
		const starter = (await app.sessions.get(STARTER_ID))!;
		app.current = { session: starter, isStarter: true };
		await exportDashboard(app);
		expect(platform.files.saved).toHaveLength(1);
		const file = JSON.parse(platform.files.saved[0].contents) as { documents: Dashboard[] };
		const doc = file.documents[0];
		// The file leaves out this browser's fields (version, times).
		const time = "2026-11-10T00:00:00Z";
		const local = { version: 0, createdAt: time, updatedAt: time };
		expect(DashboardSchema.safeParse({ ...doc, ...local }).success).toBe(true);
		expect(doc.body.placeBar).toEqual({ place: SCHOOL });
		expect(mapTypes(doc)).toEqual(TYPES);
		expect(JSON.stringify(doc)).not.toContain("default-place");
		// No copy is made: the starter stays the starter.
		expect(app.current.session).toBe(starter);
		expect(app.current.isStarter).toBe(true);
		expect(await platform.documents.list("anonymous")).toHaveLength(0);
	});

	it("Export at my location gives the region, in every layer and the bar", async () => {
		const { platform, app } = await setup(POINT);
		const starter = (await app.sessions.get(STARTER_ID))!;
		app.current = { session: starter, isStarter: true };
		await exportDashboard(app);
		const file = JSON.parse(platform.files.saved[0].contents) as { documents: Dashboard[] };
		const doc = file.documents[0];
		expect(doc.body.placeBar).toEqual({ place: ZIP });
		expect(JSON.stringify(doc)).not.toContain('"kind":"point"');
		expect(await platform.documents.list("anonymous")).toHaveLength(0);
	});
});

describe("sharing the starter copies it first", () => {
	beforeEach(() => {
		vi.mocked(openShare).mockClear();
		vi.stubGlobal("location", { origin: "https://example.test" });
	});
	afterEach(() => vi.unstubAllGlobals());

	const shared = () => vi.mocked(openShare).mock.calls.at(-1)![0] as ShareOptions;
	const linked = async (url: string | null) => {
		const incoming = await parseLinkFragment(url!.split("#")[1], new Date());
		if (incoming.kind !== "document") throw new Error("not a document link");
		return incoming.doc;
	};

	it("stores a copy, makes it current, and shares the copy", async () => {
		const { platform, app } = await setup(SCHOOL);
		const starter = (await app.sessions.get(STARTER_ID))!;
		app.current = { session: starter, isStarter: true };
		await shareDashboard(app);
		expect(app.current.isStarter).toBe(false);
		const copy = app.current.session!;
		expect(copy).not.toBe(starter);
		expectFromStarter(await stored(platform, copy.doc.id), SCHOOL);
		expect(await platform.documents.list("anonymous")).toHaveLength(1);
		expect(await app.sessions.get(copy.doc.id)).toBe(copy);
		// The next visit to the starter gets a fresh one.
		expect(await app.sessions.get(STARTER_ID)).not.toBe(starter);
		expect(await platform.preferences.get("anonymous", LAST_OPENED_KEY)).toBe(copy.doc.id);
		expect(openShare).toHaveBeenCalledTimes(1);
		const opts = shared();
		// Signed out: no live link.
		expect(opts.live).toBeNull();
		const doc = await linked("url" in opts ? (opts.url ?? null) : null);
		expect(doc.body.placeBar).toEqual({ place: SCHOOL });
		expect(JSON.stringify(doc)).not.toContain("default-place");
	});

	it("with an account, the copy can be shared live", async () => {
		const { app } = await setup(SCHOOL);
		const starter = (await app.sessions.get(STARTER_ID))!;
		app.current = { session: starter, isStarter: true };
		app.sync = {} as SyncWorker;
		await shareDashboard(app);
		const copy = app.current.session!;
		expect(shared().live).toEqual({ docId: copy.doc.id });
	});

	it("at my location: the copy keeps the point; the link has the region, bar included", async () => {
		const { platform, app } = await setup(POINT);
		const starter = (await app.sessions.get(STARTER_ID))!;
		app.current = { session: starter, isStarter: true };
		await shareDashboard(app);
		const copy = app.current.session!;
		const mine = await stored(platform, copy.doc.id);
		expect(mine.body.placeBar).toEqual({ place: POINT });
		const opts = shared();
		if (!("points" in opts) || !opts.points) throw new Error("expected the points prompt");
		const { swapped, exact } = await opts.points(new AbortController().signal);
		const doc = await linked(swapped.url);
		expect(doc.body.placeBar).toEqual({ place: ZIP });
		expect(JSON.stringify(doc)).not.toContain('"kind":"point"');
		expect((await linked(exact.url)).body.placeBar).toEqual({ place: POINT });
	});

	it("an edit made while the copy is made reaches the copy", async () => {
		const { platform, app } = await setup();
		const starter = (await app.sessions.get(STARTER_ID))!;
		app.current = { session: starter, isStarter: true };
		const sharing = shareDashboard(app);
		starter.apply({ op: "setField", target: { path: "name" }, from: null, to: "Mine" });
		await sharing;
		const copy = app.current.session!;
		expect(copy.doc.name).toBe("Mine");
		await copy.flush();
		expect(await platform.documents.list("anonymous")).toHaveLength(1);
		expect((await stored(platform, copy.doc.id)).name).toBe("Mine");
	});

	it("shares nothing when the copy can't be stored", async () => {
		const { platform, app } = await setup();
		const starter = (await app.sessions.get(STARTER_ID))!;
		app.current = { session: starter, isStarter: true };
		vi.spyOn(platform.documents, "commit").mockResolvedValue({ ok: false } as never);
		await shareDashboard(app);
		expect(app.current.session).toBe(starter);
		expect(openShare).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith(m.share_failed());
	});
});

describe("Change place on the starter", () => {
	const rename = { op: "setField", target: { path: "name" }, from: null, to: "Mine" } as const;

	it("changes every widget at once: no copy, no undo, the place saved", async () => {
		const { platform, app } = await setup();
		const starter = (await app.sessions.get(STARTER_ID))!;
		app.current = { session: starter, isStarter: true };
		await app.changeStarterPlace(SCHOOL);
		expect(app.starterPlace).toEqual(SCHOOL);
		expect(app.current.isStarter).toBe(true);
		const shown = app.current.session!;
		expect(shown).not.toBe(starter);
		expect(shown.doc.body.placeBar).toEqual({ place: SCHOOL });
		// The Chart takes the school's region (looked up as it reads it); the rest the school.
		for (const w of shown.doc.body.widgets.filter((w) => w.data.place)) {
			expect(w.data.place).toEqual(w.type === "chart" ? ZIP : SCHOOL);
		}
		expect(app.starterArea).toEqual(ZIP);
		expect(await platform.preferences.get("anonymous", STARTER_AREA_KEY)).toEqual(ZIP);
		expect(shown.canUndo).toBe(false);
		expect(await app.sessions.get(STARTER_ID)).toBe(shown);
		expect(app.index.items).toHaveLength(0);
		expect(await platform.documents.list("anonymous")).toHaveLength(0);
		expect(await platform.preferences.get("anonymous", STARTER_PLACE_KEY)).toEqual(SCHOOL);
		// The new starter's first edit makes a copy at the new place.
		shown.apply(rename);
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		const copy = app.current.session!;
		await copy.flush();
		expectFromStarter(await stored(platform, copy.doc.id), SCHOOL, ZIP);
	});

	it("a school whose region lookup fails keeps the Chart where it was", async () => {
		const { app } = await setup();
		await app.changeStarterPlace(ZIP);
		vi.mocked(placeRegion).mockRejectedValueOnce(new Error("offline"));
		await app.changeStarterPlace(POINT);
		const shown = app.current.session ?? (await app.sessions.get(STARTER_ID))!;
		expect(shown.doc.body.placeBar).toEqual({ place: POINT });
		for (const w of shown.doc.body.widgets.filter((w) => w.data.place)) {
			expect(w.data.place).toEqual(w.type === "chart" ? ZIP : POINT);
		}
		expect(app.starterArea).toEqual(ZIP);
	});

	it("an older lookup answering last changes nothing: the newer place and area stay", async () => {
		const { platform, app } = await setup();
		const OTHER: ChosenPlace = { kind: "location", source: "schools", code: "456" };
		const CLOVIS = { type: "zipcode", code: "93612" };
		let answerSchool!: (r: { type: string; code: string }) => void;
		vi.mocked(placeRegion)
			.mockImplementationOnce(() => new Promise((resolve) => (answerSchool = resolve)))
			.mockResolvedValueOnce(CLOVIS);
		const first = app.changeStarterPlace(SCHOOL);
		await vi.waitFor(() => expect(answerSchool).toBeDefined());
		await app.changeStarterPlace(OTHER);
		answerSchool({ type: "zipcode", code: "93721" });
		await first;
		expect(app.starterPlace).toEqual(OTHER);
		expect(app.starterArea).toEqual({ kind: "region", ...CLOVIS });
		expect(await platform.preferences.get("anonymous", STARTER_AREA_KEY)).toEqual({
			kind: "region",
			...CLOVIS
		});
		expect(await platform.preferences.get("anonymous", STARTER_PLACE_KEY)).toEqual(OTHER);
	});

	it("a region still saving when a school change starts: the school and its area win", async () => {
		const { platform, app } = await setup();
		const KERN: ChosenPlace = { kind: "region", type: "county", code: "06029" };
		const set = platform.preferences.set.bind(platform.preferences);
		let saved!: () => void;
		// The region's area is written at once, but its save answers only once released.
		vi.spyOn(platform.preferences, "set").mockImplementationOnce(async (...args) => {
			await set(...args);
			await new Promise<void>((resolve) => (saved = resolve));
		});
		const first = app.changeStarterPlace(KERN);
		await vi.waitFor(() => expect(saved).toBeDefined());
		await app.changeStarterPlace(SCHOOL);
		saved();
		await first;
		expect(app.starterPlace).toEqual(SCHOOL);
		expect(app.starterArea).toEqual(ZIP);
		expect(await platform.preferences.get("anonymous", STARTER_AREA_KEY)).toEqual(ZIP);
		expect(await platform.preferences.get("anonymous", STARTER_PLACE_KEY)).toEqual(SCHOOL);
	});

	it("survives a reload", async () => {
		const { platform, app } = await setup();
		await app.changeStarterPlace(SCHOOL);
		const again = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t2" });
		expect(again.starterPlace).toEqual(SCHOOL);
	});

	it("starter bar during hand-off applies to the copy", async () => {
		const { platform, app } = await setup();
		const starter = (await app.sessions.get(STARTER_ID))!;
		app.current = { session: starter, isStarter: true };
		// The first edit is mid-copy when Done lands.
		starter.apply(rename);
		expect(app.current.isStarter).toBe(true);
		await app.changeStarterPlace(SCHOOL);
		expect(app.current.isStarter).toBe(false);
		const copy = app.current.session!;
		expect(copy.doc.name).toBe("Mine");
		expect(copy.doc.body.placeBar).toEqual({ place: SCHOOL });
		// A Chart's Where holds areas only: it keeps its place; every other widget moves.
		for (const w of copy.doc.body.widgets.filter((w) => w.data.place)) {
			expect(w.data.place).toEqual(w.type === "chart" ? DEFAULT_PLACE : SCHOOL);
		}
		// An ordinary edit on the copy: one undo step, the first edit kept.
		copy.undo();
		expect(copy.doc.name).toBe("Mine");
		expect(copy.doc.body.placeBar).toEqual({ place: DEFAULT_PLACE });
		// Not the starter's place: that is unchanged.
		expect(app.starterPlace).toEqual(DEFAULT_PLACE);
		expect(await platform.preferences.get("anonymous", STARTER_PLACE_KEY)).toBeUndefined();
	});

	it("after the hand-off finished, it applies to the copy", async () => {
		const { app } = await setup();
		const starter = (await app.sessions.get(STARTER_ID))!;
		app.current = { session: starter, isStarter: true };
		starter.apply(rename);
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		const copy = app.current.session!;
		await app.changeStarterPlace(SCHOOL);
		expect(app.current.session).toBe(copy);
		expect(copy.doc.body.placeBar).toEqual({ place: SCHOOL });
		expect(app.starterPlace).toEqual(DEFAULT_PLACE);
	});

	it("a starter opened just after Clear my data keeps its first copy", async () => {
		const { app } = await setup(SCHOOL);
		const clearing = app.resetAfterClear();
		// Built before the reset has finished (the index is still refreshing).
		const starter = (await app.sessions.get(STARTER_ID))!;
		expect(starter.doc.body.placeBar).toEqual({ place: DEFAULT_PLACE });
		app.current = { session: starter, isStarter: true };
		starter.apply(rename);
		await clearing;
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		expect(app.current.session?.doc.name).toBe("Mine");
	});
});

describe("Change place on the starter to the place it shows", () => {
	it("does nothing", async () => {
		const { platform, app } = await setup();
		const starter = (await app.sessions.get(STARTER_ID))!;
		app.current = { session: starter, isStarter: true };
		await app.changeStarterPlace({ ...DEFAULT_PLACE } as ChosenPlace);
		expect(app.current.session).toBe(starter);
		expect(await platform.preferences.get("anonymous", STARTER_PLACE_KEY)).toBeUndefined();
	});
});

describe("the starter's monitor types", () => {
	const rename = { op: "setField", target: { path: "name" }, from: null, to: "Mine" } as const;
	const ids = (doc: Dashboard) => doc.body.widgets.map((w) => w.id);

	it("the starter shows at once without types, then with them", async () => {
		const answer = holdTypes();
		const { app } = await setup();
		const starter = await showStarter(app);
		expect(mapTypes(starter.doc)).toBeUndefined();
		expect(app.starterTypes).toBeNull();
		answer();
		await vi.waitFor(() => expect(mapTypes(app.current.session!.doc)).toEqual(TYPES));
		expect(app.starterTypes).toEqual(TYPES);
		expect(await app.sessions.get(STARTER_ID)).toBe(app.current.session);
	});

	it("swap keeps widget ids", async () => {
		const answer = holdTypes();
		const { app } = await setup();
		const starter = await showStarter(app);
		const before = ids(starter.doc);
		expect(before).toEqual(Array.from({ length: 7 }, (_, i) => `starter-${i + 1}`));
		answer();
		await vi.waitFor(() => expect(app.current.session).not.toBe(starter));
		expect(ids(app.current.session!.doc)).toEqual(before);
		expect(app.current.isStarter).toBe(true);
	});

	it("first edit before the types arrive", async () => {
		const answer = holdTypes();
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		starter.apply(rename);
		answer();
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		const copy = app.current.session!;
		await copy.flush();
		const doc = await stored(platform, copy.doc.id);
		expectFromStarter(doc, DEFAULT_PLACE);
		expect(doc.name).toBe("Mine");
	});

	it("an edited starter isn't swapped", async () => {
		const answer = holdTypes();
		const { app } = await setup();
		const starter = await showStarter(app);
		starter.apply(rename);
		answer();
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		const copy = app.current.session!;
		// The types' arrival (which would swap a starter) has run, and the copy is stored.
		await app.starterTypesReady();
		await copy.flush();
		expect(app.current.session).toBe(copy);
		expect(app.current.isStarter).toBe(false);
	});

	it("a first edit during the wait shows at once", async () => {
		const answer = holdTypes();
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		starter.apply(rename);
		expect(app.current.session!.doc.name).toBe("Mine");
		expect(app.current.isStarter).toBe(true);
		// Its hand-off started, and waits for the types: nothing stored yet.
		const handoff = starter.handoff!;
		expect(handoff).not.toBeNull();
		await starter.flush();
		expect(await platform.documents.list("anonymous")).toEqual([]);
		answer();
		// The copy, stored after the types arrived, has them.
		const copy = (await handoff)!;
		await copy.flush();
		expect(app.current.session).toBe(copy);
		expectFromStarter(await stored(platform, copy.doc.id), DEFAULT_PLACE);
	});

	it("undo during the wait does nothing; after the copy, it reverts the edit", async () => {
		const answer = holdTypes();
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		starter.apply(rename);
		expect(starter.canUndo).toBe(false);
		expect(starter.canRedo).toBe(false);
		starter.undo();
		expect(starter.doc.name).toBe("Mine");
		answer();
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		const copy = app.current.session!;
		expect(copy.doc.name).toBe("Mine");
		expect(copy.canUndo).toBe(true);
		copy.undo();
		expect(copy.doc.name).toBeNull();
		await copy.flush();
		expect(app.current.session).toBe(copy);
		expect(app.current.isStarter).toBe(false);
		expect((await stored(platform, copy.doc.id)).name).toBeNull();
	});

	it("a failed hand-off keeps the shown edits; the retry stores each once", async () => {
		const answer = holdTypes();
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		const commit = vi.spyOn(platform.documents, "commit");
		commit.mockRejectedValueOnce(new Error("no storage"));
		const first = starter.doc.body.widgets[0].id;
		const titled = (to: string) =>
			({ op: "setField", target: { widgetId: first, path: "title" }, from: null, to }) as const;
		starter.apply(rename);
		starter.apply(titled("A"));
		expect(starter.doc.name).toBe("Mine");
		expect(starter.doc.body.widgets[0].title).toBe("A");
		answer();
		await vi.waitFor(() => expect(starter.status).toBe("error"));
		expect(starter.handingOff).toBe(false);
		expect(app.current.session).toBe(starter);
		expect(starter.doc.name).toBe("Mine");
		expect(starter.doc.body.widgets[0].title).toBe("A");
		starter.apply(titled("B"));
		expect(starter.doc.body.widgets[0].title).toBe("B");
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		const copy = app.current.session!;
		await copy.flush();
		const doc = await stored(platform, copy.doc.id);
		expect(doc.name).toBe("Mine");
		expect(doc.body.widgets[0].title).toBe("B");
		const log = await platform.documents.readLog("anonymous", copy.doc.id, 0);
		expect(log).toHaveLength(3);
	});

	it("Clear my data during the wait drops the shown edits", async () => {
		const answer = holdTypes();
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		starter.apply(rename);
		// As Clear my data does (`clearMyData`): storage first, then the app.
		await platform.reset.clearAll();
		await app.resetAfterClear();
		answer();
		await app.starterTypesReady();
		// The edited starter's hand-off (had it gone ahead) has finished.
		await starter.handoff;
		expect(await platform.documents.list("anonymous")).toEqual([]);
		const shown = await showStarter(app);
		expect(shown).not.toBe(starter);
		expect(shown.doc.name).toBeNull();
	});

	it("place change during the load", async () => {
		const answer = holdTypes();
		const { app } = await setup();
		await showStarter(app);
		await app.changeStarterPlace(TULARE);
		answer();
		await vi.waitFor(() => expect(mapTypes(app.current.session!.doc)).toEqual(TYPES));
		const shown = app.current.session!;
		expect(shown.doc.body.placeBar).toEqual({ place: TULARE });
		expect(app.current.isStarter).toBe(true);
		expect(app.openSessions()).toEqual([shown]);
		expect(await app.sessions.get(STARTER_ID)).toBe(shown);
	});

	it("a starter opened but not yet shown when they arrive stays usable", async () => {
		const answer = holdTypes();
		const { platform, app } = await setup();
		const opened = (await app.sessions.get(STARTER_ID))!;
		answer();
		await app.starterTypesReady();
		// The next open gets one with the types.
		const fresh = (await app.sessions.get(STARTER_ID))!;
		expect(fresh).not.toBe(opened);
		expect(mapTypes(fresh.doc)).toEqual(TYPES);
		// Made current after all, its first edit still makes a copy, with the types.
		app.current = { session: opened, isStarter: true };
		opened.apply(rename);
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		const copy = app.current.session!;
		await copy.flush();
		expectFromStarter(await stored(platform, copy.doc.id), DEFAULT_PLACE);
	});

	it("a starter replaced after Home let go of it is discarded at once", async () => {
		// The page's events (no window in Node): each session listens for pagehide and pageshow.
		const page = new EventTarget();
		vi.stubGlobal("window", page);
		try {
			const answer = holdTypes();
			const { app, release } = await setup();
			// Home's order: opened and made current, then left for /dashboards (nothing current, and
			// Home's teardown lets go) before the catalog answered.
			const replaced = await showStarter(app);
			app.current = { session: null, isStarter: false };
			release();
			const removed = vi.spyOn(page, "removeEventListener");
			answer();
			await app.starterTypesReady();
			const types = removed.mock.calls.map(([type]) => type);
			expect(types.filter((t) => t === "pagehide")).toHaveLength(1);
			expect(types.filter((t) => t === "pageshow")).toHaveLength(1);
			// The fresh starter (the next open) still listens.
			const fresh = (await app.sessions.get(STARTER_ID))!;
			expect(fresh).not.toBe(replaced);
			expect(mapTypes(fresh.doc)).toEqual(TYPES);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("a starter kept for claims goes when the last claim is released", async () => {
		const page = new EventTarget();
		vi.stubGlobal("window", page);
		try {
			const answer = holdTypes();
			const { app, release } = await setup();
			const other = app.claimStarter();
			await app.sessions.get(STARTER_ID);
			answer();
			await app.starterTypesReady();
			const removed = vi.spyOn(page, "removeEventListener");
			release();
			// Released twice: counted once.
			release();
			expect(removed).not.toHaveBeenCalled();
			other();
			expect(removed.mock.calls.filter(([t]) => t === "pagehide")).toHaveLength(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("a kept starter goes once another dashboard is current", async () => {
		const page = new EventTarget();
		vi.stubGlobal("window", page);
		try {
			const answer = holdTypes();
			const { app } = await setup();
			await showStarter(app);
			app.current = { session: null, isStarter: false };
			answer();
			await app.starterTypesReady();
			const removed = vi.spyOn(page, "removeEventListener");
			const id = await app.index.createBlank();
			app.current = { session: (await app.sessions.get(id))!, isStarter: false };
			expect(removed.mock.calls.filter(([t]) => t === "pagehide")).toHaveLength(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("releasing keeps the current starter, the next open and one handing off", async () => {
		const page = new EventTarget();
		vi.stubGlobal("window", page);
		try {
			const answer = holdTypes();
			const { app } = await setup();
			const opened = (await app.sessions.get(STARTER_ID))!;
			answer();
			await app.starterTypesReady();
			const fresh = (await app.sessions.get(STARTER_ID))!;
			// Made current after the types arrived (Home's re-read hasn't run yet).
			app.current = { session: opened, isStarter: true };
			const removed = vi.spyOn(page, "removeEventListener");
			app.releaseStarter();
			expect(removed).not.toHaveBeenCalled();
			// Its first edit hands it off; releasing then leaves it alone too.
			opened.apply(rename);
			app.current = { session: null, isStarter: false };
			app.releaseStarter();
			expect(removed).not.toHaveBeenCalled();
			// Its copy is made (not current: nothing showed the starter when it landed).
			const copy = await opened.handoff;
			expect(copy).not.toBeNull();
			expect(app.current.session).toBeNull();
			await copy!.flush();
			// Once handed off, the fresh starter (never shown) goes, and the next open builds one.
			expect(removed.mock.calls.filter(([t]) => t === "pagehide")).toHaveLength(1);
			expect(await app.sessions.get(STARTER_ID)).not.toBe(fresh);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("Clear my data while they load: only the starter built after it is swapped", async () => {
		const answer = holdTypes();
		const { app } = await setup(SCHOOL);
		const before = await showStarter(app);
		await app.resetAfterClear();
		const after = await showStarter(app);
		expect(after).not.toBe(before);
		answer();
		await vi.waitFor(() => expect(app.current.session).not.toBe(after));
		const shown = app.current.session!;
		expect(shown).not.toBe(before);
		expect(app.current.isStarter).toBe(true);
		expect(mapTypes(shown.doc)).toEqual(TYPES);
		expect(shown.doc.body.placeBar).toEqual({ place: DEFAULT_PLACE });
		expect(app.openSessions()).toEqual([shown]);
		expect(loadMonitorTypes).toHaveBeenCalledOnce();
	});

	for (const item of ["duplicate-dashboard", "duplicate-for-another-place"]) {
		it(`${item}: an edit while the types load is duplicated in the copy, no second copy`, async () => {
			const answer = holdTypes();
			const { platform, app } = await setup(ZIP);
			const starter = await showStarter(app);
			vi.mocked(openPlacePicker).mockClear();
			vi.mocked(openRename).mockClear();
			await run(app, item);
			if (item === "duplicate-for-another-place") {
				await vi.waitFor(() => expect(openPlacePicker).toHaveBeenCalled());
				const { pick } = vi.mocked(openPlacePicker).mock.calls[0][0] as {
					pick: (p: ChosenPlace) => void;
				};
				pick(TULARE);
			}
			starter.apply(rename);
			answer();
			await vi.waitFor(async () =>
				expect(await platform.documents.list("anonymous")).toHaveLength(2)
			);
			const docs = (await platform.documents.list("anonymous")) as Dashboard[];
			const copy = docs.find((d) => d.copiedFrom === STARTER_ID)!;
			const duplicate = docs.find((d) => d !== copy)!;
			expect(copy.name).toBe("Mine");
			expect(duplicate.copiedFrom).toBe(copy.id);
			expect(mapTypes(duplicate)).toEqual(TYPES);
			if (item === "duplicate-for-another-place") {
				expect(duplicate.body.placeBar).toEqual({ place: TULARE });
			}
			// The action's last step (naming the copy it opened): nothing more is stored after it.
			await vi.waitFor(() => expect(openRename).toHaveBeenCalledOnce());
			expect(await platform.documents.list("anonymous")).toHaveLength(2);
		});
	}

	it("Export during the wait exports the edit", async () => {
		const answer = holdTypes();
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		const exporting = exportDashboard(app);
		starter.apply(rename);
		answer();
		await exporting;
		expect(platform.files.saved).toHaveLength(1);
		const file = JSON.parse(platform.files.saved[0].contents) as { documents: Dashboard[] };
		expect(file.documents[0].name).toBe("Mine");
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		expect(file.documents[0].id).toBe(app.current.session!.doc.id);
	});

	describe("Duplicate for another place during the wait", () => {
		/** Asks for the copy (the place picker opens), returns what picks the new place. */
		async function ask() {
			const answer = holdTypes();
			const { platform, app } = await setup();
			const starter = await showStarter(app);
			vi.mocked(openPlacePicker).mockClear();
			vi.mocked(toast.info).mockClear();
			const duplicate = vi.spyOn(app.index, "duplicate");
			await run(app, "duplicate-for-another-place");
			await vi.waitFor(() => expect(openPlacePicker).toHaveBeenCalled());
			const { pick } = vi.mocked(openPlacePicker).mock.calls[0][0] as {
				pick: (p: ChosenPlace) => void;
			};
			return { platform, app, starter, answer, pick, duplicate };
		}

		it("after an edit moved the bar's place, replaces the place it copies", async () => {
			const { platform, starter, answer, pick } = await ask();
			starter.apply(barChange(starter.doc, ZIP, { others: false })!);
			pick(TULARE);
			answer();
			await vi.waitFor(async () =>
				expect(await platform.documents.list("anonymous")).toHaveLength(2)
			);
			const docs = (await platform.documents.list("anonymous")) as Dashboard[];
			const duplicate = docs.find((d) => d.copiedFrom !== STARTER_ID)!;
			expect(duplicate.body.placeBar).toEqual({ place: TULARE });
		});

		it("after an edit left several places without the asked one, makes no copy and says so", async () => {
			const { platform, starter, answer, pick, duplicate } = await ask();
			const { name, body } = starter.doc;
			const [first, second] = body.widgets.filter((w) => w.data.place);
			const at = (w: typeof first, place: ChosenPlace) => ({ ...w, data: { ...w.data, place } });
			starter.apply({
				op: "replaceDocument",
				target: {},
				from: { name, body },
				to: {
					name,
					body: { ...body, widgets: [at(first, ZIP), at(second, TULARE)], placeBar: undefined }
				}
			});
			pick(SCHOOL);
			answer();
			await vi.waitFor(() =>
				expect(toast.info).toHaveBeenCalledWith(m.dashboard_duplicate_no_single_place())
			);
			// Said after the last await of the action, where a copy would have been asked for.
			expect(duplicate).not.toHaveBeenCalled();
			expect(await platform.documents.list("anonymous")).toHaveLength(1);
		});

		it("after an edit removed every place, makes no copy and says so", async () => {
			const { platform, starter, answer, pick, duplicate } = await ask();
			const { name, body } = starter.doc;
			starter.apply({
				op: "replaceDocument",
				target: {},
				from: { name, body },
				to: { name, body: { ...body, widgets: [], placeBar: undefined } }
			});
			pick(TULARE);
			answer();
			await vi.waitFor(() =>
				expect(toast.info).toHaveBeenCalledWith(m.dashboard_duplicate_no_single_place())
			);
			// Said after the last await of the action, where a copy would have been asked for.
			expect(duplicate).not.toHaveBeenCalled();
			expect(await platform.documents.list("anonymous")).toHaveLength(1);
		});
	});

	it("loads once per app, kept through Clear my data", async () => {
		const { app } = await setup();
		await showStarter(app);
		await app.starterTypesReady();
		await app.resetAfterClear();
		expect(app.starterTypes).toEqual(TYPES);
		const starter = (await app.sessions.get(STARTER_ID))!;
		expect(mapTypes(starter.doc)).toEqual(TYPES);
		expect(loadMonitorTypes).toHaveBeenCalledOnce();
	});

	it("a closed app swaps nothing", async () => {
		const answer = holdTypes();
		const { app } = await setup();
		const starter = await showStarter(app);
		await app.close();
		answer();
		await app.starterTypesReady();
		expect(app.current.session).toBeNull();
		expect(app.openSessions()).toEqual([]);
		expect(mapTypes(starter.doc)).toBeUndefined();
	});

	it("a failed load resolves with none, kept as none (starterTypes stays unset)", async () => {
		vi.mocked(loadMonitorTypes).mockRejectedValue(new Error("no"));
		const { app } = await setup();
		await showStarter(app);
		await expect(app.starterTypesReady()).resolves.toEqual([]);
		expect(app.starterTypes).toBeNull();
	});

	// A catalog that throws (reported once) or that the server can't give ("unavailable", as an
	// outage answers; not reported): either is kept as none for the page.
	for (const [outage, reports] of [
		["throws", 1],
		["is unavailable", 0]
	] as const) {
		it(`a failed catalog is asked once per app: it ${outage}`, async () => {
			const actual =
				await vi.importActual<typeof import("$lib/widgets/map/start")>("$lib/widgets/map/start");
			vi.mocked(loadMonitorTypesResult).mockImplementation(actual.loadMonitorTypesResult);
			const catalog = vi
				.spyOn(getMetadata(), "catalog")
				.mockImplementation(async () =>
					outage === "throws" ? Promise.reject(new Error("down")) : "unavailable"
				);
			vi.mocked(report).mockClear();
			try {
				const { platform, app } = await setup(ZIP);
				const starter = await showStarter(app);
				await run(app, "new-from-starter");
				expectFromStarter(await newest(platform), ZIP, DEFAULT_PLACE, null);
				starter.apply(rename);
				await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
				await app.current.session!.flush();
				expect(app.starterTypes).toBeNull();
				expect(await app.starterTypesReady()).toEqual([]);
				expect(loadMonitorTypesResult).toHaveBeenCalledOnce();
				expect(catalog).toHaveBeenCalledOnce();
				expect(
					vi.mocked(report).mock.calls.filter(([e]) => e instanceof Error && e.message === "down")
				).toHaveLength(reports);
			} finally {
				catalog.mockRestore();
			}
		});
	}

	it("a late catalog: the next exit asks again and stores the types", async () => {
		vi.mocked(loadMonitorTypes).mockResolvedValueOnce([]);
		const { platform, app } = await setup();
		await showStarter(app);
		// The first load (started by the starter) gave none.
		await vi.waitFor(() => expect(loadMonitorTypes).toHaveBeenCalledOnce());
		await vi.mocked(loadMonitorTypes).mock.results[0].value;
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(app.starterTypes).toBeNull();
		await run(app, "new-from-starter");
		expectFromStarter(await newest(platform), DEFAULT_PLACE);
		expect(loadMonitorTypes).toHaveBeenCalledTimes(2);
		expect(app.starterTypes).toEqual(TYPES);
		// The shown starter has them too.
		await vi.waitFor(() => expect(mapTypes(app.current.session!.doc)).toEqual(TYPES));
	});

	it("catalog unavailable each time: the exit stores none", async () => {
		vi.mocked(loadMonitorTypes).mockResolvedValue([]);
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		await app.starterTypesReady();
		expect(app.starterTypes).toBeNull();
		// Nothing to swap in.
		expect(app.current.session).toBe(starter);
		await run(app, "new-from-starter");
		expectFromStarter(await newest(platform), DEFAULT_PLACE, DEFAULT_PLACE, null);
		expect(app.current.session).toBe(starter);
	});
});

describe("a Map edit on the starter while the types load", () => {
	const rename = { op: "setField", target: { path: "name" }, from: null, to: "Mine" } as const;
	const mapOf = (session: DocumentSession) =>
		session.doc.body.widgets.find((w) => w.type === MAP_TYPE)!;
	const airOf = (doc: Dashboard) =>
		doc.body.widgets
			.find((w) => w.type === MAP_TYPE)!
			.data.layers.find((l) => l.dataset === "air-quality")!;

	/** Each way the Map's data is rewritten from the shown (type-less) starter. */
	const edits: Array<[string, (starter: DocumentSession) => Promise<void>]> = [
		[
			"a tile option",
			async (starter) => {
				const ctx = { mode: "edit" as const, session: () => starter };
				const map = mapOf(starter);
				changeTileOptions(ctx, map, { ...map.options, basemap: "dark" }, ["basemap"]);
			}
		],
		[
			"a mark",
			async (starter) => {
				starter.apply(marksChange(mapOf(starter), ["m1"])!);
			}
		],
		[
			"its place",
			async (starter) => {
				const map = mapOf(starter);
				const next = await pickedData(map.data, [TULARE], {
					liveLink: false,
					regionOf: async () => null
				});
				starter.apply({
					op: "setWidgetData",
					target: { widgetId: map.id },
					from: map.data,
					to: next!.data
				});
			}
		]
	];

	for (const [name, edit] of edits) {
		for (const first of [true, false]) {
			it(`${name}, as the ${first ? "first edit" : "edit after another"}: the copy's Map keeps the types`, async () => {
				const answer = holdTypes();
				const { platform, app } = await setup();
				const starter = await showStarter(app);
				expect(airOf(starter.doc)).not.toHaveProperty("monitorTypes");
				if (!first) starter.apply(rename);
				await edit(starter);
				answer();
				await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
				const copy = app.current.session!;
				await copy.flush();
				const doc = await stored(platform, copy.doc.id);
				expect(airOf(doc).monitorTypes).toEqual(TYPES);
				expect(DashboardSchema.safeParse(doc).success).toBe(true);
			});
		}
	}

	it("the edit itself reaches the copy", async () => {
		const answer = holdTypes();
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		const map = mapOf(starter);
		starter.apply(marksChange(map, ["m1"])!);
		answer();
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		const copy = app.current.session!;
		await copy.flush();
		const saved = (await stored(platform, copy.doc.id)).body.widgets.find((w) => w.id === map.id)!;
		expect(saved.options).toMatchObject({ marks: ["m1"] });
	});

	const setByPerson: Array<[string, { monitorTypes?: string[]; monitors?: string[] }]> = [
		["ticked types", { monitorTypes: ["airnow"] }],
		["searched monitors", { monitors: ["m1"] }]
	];
	for (const [name, set] of setByPerson) {
		it(`a Map whose ${name} the person set keeps exactly theirs`, async () => {
			const answer = holdTypes();
			const { platform, app } = await setup();
			const starter = await showStarter(app);
			const map = mapOf(starter);
			const to = structuredClone(map.data);
			const layer = to.layers.find((l) => l.dataset === "air-quality")!;
			Object.assign(layer, set);
			starter.apply({ op: "setWidgetData", target: { widgetId: map.id }, from: map.data, to });
			answer();
			await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
			const copy = app.current.session!;
			await copy.flush();
			const air = airOf(await stored(platform, copy.doc.id));
			expect(air.monitorTypes).toEqual(set.monitorTypes);
			expect(air.monitors).toEqual(set.monitors);
		});
	}

	it("no types in the catalog: nothing is ticked", async () => {
		const answer = holdTypes();
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		starter.apply(marksChange(mapOf(starter), ["m1"])!);
		answer([]);
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		const copy = app.current.session!;
		await copy.flush();
		expect(airOf(await stored(platform, copy.doc.id))).not.toHaveProperty("monitorTypes");
	});

	it("Duplicate of its Map: both Maps in the copy keep the types", async () => {
		const answer = holdTypes();
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		const map = mapOf(starter);
		const ctx = { target: {} as Element, payload: {} };
		widgetActions(app, map.id)(ctx).find((i) => i.id === "duplicate-widget")!.run!(ctx);
		expect(starter.doc.body.widgets.filter((w) => w.type === MAP_TYPE)).toHaveLength(2);
		answer();
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		const copy = app.current.session!;
		await copy.flush();
		const maps = (await stored(platform, copy.doc.id)).body.widgets.filter(
			(w) => w.type === MAP_TYPE
		);
		expect(maps).toHaveLength(2);
		for (const m of maps) {
			expect(m.data.layers.find((l) => l.dataset === "air-quality")?.monitorTypes).toEqual(TYPES);
		}
	});

	it("Duplicate of its Map as the edit after another: the duplicate keeps the types", async () => {
		const answer = holdTypes();
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		starter.apply(rename);
		const map = mapOf(starter);
		const ctx = { target: {} as Element, payload: {} };
		widgetActions(app, map.id)(ctx).find((i) => i.id === "duplicate-widget")!.run!(ctx);
		answer();
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		const copy = app.current.session!;
		await copy.flush();
		const maps = (await stored(platform, copy.doc.id)).body.widgets.filter(
			(w) => w.type === MAP_TYPE
		);
		expect(
			maps.map((w) => w.data.layers.find((l) => l.dataset === "air-quality")?.monitorTypes)
		).toEqual([TYPES, TYPES]);
	});

	it("its Map deleted, then put back with the toast's Undo after the copy took over: it keeps the types", async () => {
		const answer = holdTypes();
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		const map = mapOf(starter);
		vi.mocked(toast).mockClear();
		removeWidget(app, map.id);
		answer();
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		const copy = app.current.session!;
		expect(copy.doc.body.widgets.some((w) => w.id === map.id)).toBe(false);
		const options = vi.mocked(toast).mock.calls[0][1] as unknown as {
			action: { onClick: () => void };
		};
		options.action.onClick();
		await copy.flush();
		const back = (await stored(platform, copy.doc.id)).body.widgets.find((w) => w.id === map.id)!;
		expect(back.data.layers.find((l) => l.dataset === "air-quality")?.monitorTypes).toEqual(TYPES);
	});

	it("a replaced document keeps the types on a Map it leaves as it was", async () => {
		const answer = holdTypes();
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		starter.apply(rename);
		const { name, body } = starter.doc;
		starter.apply({
			op: "replaceDocument",
			target: {},
			from: { name, body },
			to: { name: "Other", body: structuredClone(body) }
		});
		answer();
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		const copy = app.current.session!;
		await copy.flush();
		const doc = await stored(platform, copy.doc.id);
		expect(doc.name).toBe("Other");
		expect(airOf(doc).monitorTypes).toEqual(TYPES);
	});

	it("another widget's data is left as it is", async () => {
		const answer = holdTypes();
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		const chart = starter.doc.body.widgets.find((w) => w.type === "chart")!;
		const to = structuredClone(chart.data);
		to.place = TULARE;
		starter.apply({ op: "setWidgetData", target: { widgetId: chart.id }, from: chart.data, to });
		answer();
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));
		const copy = app.current.session!;
		await copy.flush();
		const saved = (await stored(platform, copy.doc.id)).body.widgets.find(
			(w) => w.id === chart.id
		)!;
		expect(saved.data).toEqual(to);
	});
});

describe("the starter's copy, made after the person moved on", () => {
	const rename = { op: "setField", target: { path: "name" }, from: null, to: "Mine" } as const;

	it("another dashboard opened during the types wait stays current; the copy is stored with the edit and the types", async () => {
		const answer = holdTypes();
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		const otherId = await app.index.createBlank();
		starter.apply(rename);
		const other = (await app.sessions.get(otherId))!;
		app.current = { session: other, isStarter: false };
		answer();
		const handed = await starter.handoff;
		expect(handed).not.toBeNull();
		expect(app.current.session).toBe(other);
		expect(app.current.isStarter).toBe(false);
		await handed!.flush();
		const doc = await stored(platform, handed!.doc.id);
		expect(doc.name).toBe("Mine");
		expect(mapTypes(doc)).toEqual(TYPES);
		// The last-opened dashboard is still the one the person went to.
		expect(await platform.preferences.get("anonymous", LAST_OPENED_KEY)).toBe(otherId);
		// Listed, and openable as itself.
		await vi.waitFor(() => expect(app.index.items.map((d) => d.id)).toContain(handed!.doc.id));
		expect(await app.sessions.get(handed!.doc.id, { remember: false })).toBe(handed);
	});

	it("a page with no dashboard (the list, Get data, a shared page) stays without one", async () => {
		const answer = holdTypes();
		const { app } = await setup();
		const starter = await showStarter(app);
		starter.apply(rename);
		app.current = { session: null, isStarter: false };
		answer();
		const handed = await starter.handoff;
		expect(handed).not.toBeNull();
		expect(app.current.session).toBeNull();
	});

	it("a kept starter's copy doesn't take over the fresh starter the person is editing at /", async () => {
		const answer = holdTypes();
		// `setup` holds a claim, as Get data does while mounted: the types swap keeps its starter.
		const { platform, app, release } = await setup();
		// Get data holds the starter it opened (nothing current there); the types then swap it.
		const kept = (await app.sessions.get(STARTER_ID))!;
		answer();
		await app.starterTypesReady();
		const fresh = (await app.sessions.get(STARTER_ID))!;
		expect(fresh).not.toBe(kept);
		// The fresh one's copy is held back after the kept one's, so the moment between them shows.
		const commit = platform.documents.commit.bind(platform.documents);
		let calls = 0;
		let letThrough!: () => void;
		const held = new Promise<void>((resolve) => (letThrough = resolve));
		vi.spyOn(platform.documents, "commit").mockImplementation(async (...args) => {
			if (++calls === 2) await held;
			return commit(...args);
		});
		// Get data's Save hands the kept one off; meanwhile the person edits the fresh one at /.
		kept.apply(rename);
		app.current = { session: fresh, isStarter: true };
		fresh.apply({ ...rename, to: "Theirs" });
		const keptCopy = await kept.handoff;
		expect(keptCopy).not.toBeNull();
		expect(app.current.session).not.toBe(keptCopy);
		// Kept (not discarded by the swap): its copy stores the edit.
		await keptCopy!.flush();
		expect((await stored(platform, keptCopy!.doc.id)).name).toBe("Mine");
		// The fresh one, still handing off, is still the starter.
		expect(fresh.handingOff).toBe(true);
		expect(await app.sessions.get(STARTER_ID, { remember: false })).toBe(fresh);
		letThrough();
		// Its own hand-off still lands where it shows.
		const freshCopy = await fresh.handoff;
		expect(app.current).toEqual({ session: freshCopy, isStarter: false });
		expect(freshCopy!.doc.name).toBe("Theirs");
		release();
	});

	it("the starter still shown: the copy takes its place", async () => {
		const answer = holdTypes();
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		starter.apply(rename);
		answer();
		const handed = await starter.handoff;
		expect(app.current).toEqual({ session: handed, isStarter: false });
		expect(await platform.preferences.get("anonymous", LAST_OPENED_KEY)).toBe(handed!.doc.id);
	});
});
