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
import { DEFAULT_LAYER } from "$lib/widgets/defaults";
import { writeSelection } from "$lib/widgets/calendars/shared/write-selection";
import { STARTER_PLACE_KEY, saveStarterPlace } from "./place.svelte";
import { STARTER_ID } from "./starter";

// Sharing's navigation and dialogs aren't used here (and the router needs a page).
vi.mock("../../router", () => ({ navigate: vi.fn() }));
vi.mock("$lib/components/dialogs/lazy.svelte", () => ({ openShare: vi.fn() }));
vi.mock("svelte-sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
// Any point is in ZIP 93721.
vi.mock("$lib/data", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/data")>()),
	placeRegion: vi.fn(async () => ({ type: "zipcode", code: "93721" }))
}));

const SCHOOL: ChosenPlace = { kind: "location", source: "schools", code: "123" };
const POINT: ChosenPlace = { kind: "point", lat: 36.7378, lon: -119.7871 };
const ZIP: ChosenPlace = { kind: "region", type: "zipcode", code: "93721" };

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

function expectFromStarter(doc: Dashboard, place: ChosenPlace) {
	expect(DashboardSchema.safeParse(doc).success).toBe(true);
	expect(doc.copiedFrom).toBe(STARTER_ID);
	expect(doc.body.placeBar).toEqual({ place });
	expect(JSON.stringify(doc)).not.toContain("default-place");
	const shown = doc.body.widgets.flatMap((w) => w.data.layers.flatMap((l) => l.place ?? []));
	expect(shown.length).toBeGreaterThanOrEqual(5);
	for (const p of shown) expect(p).toEqual(place);
}

describe("the starter's place in the app", () => {
	it("unset: Fresno County", async () => {
		const { app } = await setup();
		expect(app.starterPlace).toEqual(DEFAULT_LAYER.place);
		const starter = (await app.sessions.get(STARTER_ID))!;
		expect(starter.doc.body.placeBar).toEqual({ place: DEFAULT_LAYER.place });
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
		expect(app.starterPlace).toEqual(DEFAULT_LAYER.place);
		const starter = (await app.sessions.get(STARTER_ID))!;
		expect(starter.doc.body.placeBar).toEqual({ place: DEFAULT_LAYER.place });
	});
});

describe("every exit from the starter holds the chosen place", () => {
	it("New from starter", async () => {
		const { platform, app } = await setup(SCHOOL);
		const id = await app.index.createFromStarter(app.starterPlace);
		expectFromStarter(await stored(platform, id), SCHOOL);
	});

	it("Duplicate of the starter", async () => {
		const { platform, app } = await setup(SCHOOL);
		const id = await app.index.duplicate(STARTER_ID, {
			from: app.starterPlace,
			to: app.starterPlace
		});
		expectFromStarter(await stored(platform, id), SCHOOL);
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
		const { dashboardId } = await addFromDraft(app, STARTER_ID, {
			type: "chart",
			data: {
				dateRange: { kind: "trailing", amount: 30, unit: "day" },
				layers: [{ dataset: "air-quality", entryType: "pm25", place: SCHOOL }]
			}
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
	const places = (doc: Dashboard) =>
		doc.body.widgets.flatMap((w) => w.data.layers.flatMap((l) => l.place ?? []));

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
		for (const p of places(shown.doc)) expect(p).toEqual(SCHOOL);
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
		expectFromStarter(await stored(platform, copy.doc.id), SCHOOL);
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
		for (const p of places(copy.doc)) expect(p).toEqual(SCHOOL);
		// An ordinary edit on the copy: one undo step, the first edit kept.
		copy.undo();
		expect(copy.doc.name).toBe("Mine");
		expect(copy.doc.body.placeBar).toEqual({ place: DEFAULT_LAYER.place });
		// Not the starter's place: that is unchanged.
		expect(app.starterPlace).toEqual(DEFAULT_LAYER.place);
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
		expect(app.starterPlace).toEqual(DEFAULT_LAYER.place);
	});

	it("a starter opened just after Clear my data keeps its first copy", async () => {
		const { app } = await setup(SCHOOL);
		const clearing = app.resetAfterClear();
		// Built before the reset has finished (the index is still refreshing).
		const starter = (await app.sessions.get(STARTER_ID))!;
		expect(starter.doc.body.placeBar).toEqual({ place: DEFAULT_LAYER.place });
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
		await app.changeStarterPlace({ ...DEFAULT_LAYER.place } as ChosenPlace);
		expect(app.current.session).toBe(starter);
		expect(await platform.preferences.get("anonymous", STARTER_PLACE_KEY)).toBeUndefined();
	});
});
