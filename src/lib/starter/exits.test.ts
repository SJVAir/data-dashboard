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
import { placeRegion } from "$lib/data";
import { STARTER_AREA_KEY, STARTER_PLACE_KEY, saveStarterPlace } from "./place.svelte";
import { STARTER_ID } from "./starter";
import { loadMonitorTypes } from "$lib/widgets/map/start";
import { MAP_TYPE } from "$lib/widgets/map/options";
import { dashboardActions } from "$lib/actions/dashboard";
import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
import { takeAfterMenuClose } from "$lib/components/menu/menu-state.svelte";

// Sharing's navigation and dialogs aren't used here (and the router needs a page).
vi.mock("../../router", () => ({ navigate: vi.fn() }));
vi.mock("$lib/components/dialogs/lazy.svelte", () => ({
	openShare: vi.fn(),
	openPlacePicker: vi.fn(),
	askWhichPlace: vi.fn()
}));
vi.mock("$lib/components/dialogs/RenameDialog.svelte", () => ({ openRename: vi.fn() }));
vi.mock("svelte-sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
// Any point is in ZIP 93721.
vi.mock("$lib/data", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/data")>()),
	placeRegion: vi.fn(async () => ({ type: "zipcode", code: "93721" }))
}));

// The catalog's monitor types, as loaded (a test controls when they arrive).
vi.mock("$lib/widgets/map/start", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/widgets/map/start")>()),
	loadMonitorTypes: vi.fn()
}));

const TYPES = ["purpleair", "airnow"];

beforeEach(() => {
	vi.mocked(loadMonitorTypes).mockReset();
	vi.mocked(loadMonitorTypes).mockImplementation(async () => [...TYPES]);
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

/** The app, with `place` saved as the starter's place first (none: unset). */
async function setup(place?: ChosenPlace) {
	const platform = createMemoryPlatform();
	setPlatform(platform);
	if (place) await saveStarterPlace(platform, "anonymous", place);
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	return { platform, app };
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
		// It waits for the catalog's monitor types.
		await new Promise((resolve) => setTimeout(resolve, 10));
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
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(app.current.session).toBe(copy);
		expect(app.current.isStarter).toBe(false);
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
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(await platform.documents.list("anonymous")).toHaveLength(2);
		});
	}

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

	it("a failed load resolves with none", async () => {
		vi.mocked(loadMonitorTypes).mockRejectedValueOnce(new Error("no"));
		const { app } = await setup();
		await showStarter(app);
		await expect(app.starterTypesReady()).resolves.toEqual([]);
		expect(app.starterTypes).toEqual([]);
	});

	it("catalog unavailable", async () => {
		vi.mocked(loadMonitorTypes).mockResolvedValueOnce([]);
		const { platform, app } = await setup();
		const starter = await showStarter(app);
		await app.starterTypesReady();
		expect(app.starterTypes).toEqual([]);
		// Nothing to swap in.
		expect(app.current.session).toBe(starter);
		await run(app, "new-from-starter");
		expectFromStarter(await newest(platform), DEFAULT_PLACE, DEFAULT_PLACE, null);
	});
});
