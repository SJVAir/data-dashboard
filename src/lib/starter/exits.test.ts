/**
 * Every way out of the starter (its first edit, "New from starter", Duplicate, Export) gives a
 * document at the chosen place, with the bar, that passes `DashboardSchema`.
 */
import { describe, expect, it, vi } from "vitest";
import type { ChosenPlace } from "$lib/data/schema";
import { DashboardSchema, type Dashboard } from "$lib/documents/schema";
import { addFromDraft } from "$lib/get-data/add";
import { setPlatform } from "$lib/platform";
import { createMemoryPlatform } from "$lib/platform/memory";
import { exportDashboard } from "$lib/sharing/actions";
import { initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { DEFAULT_LAYER } from "$lib/widgets/defaults";
import { writeSelection } from "$lib/widgets/calendars/shared/write-selection";
import { STARTER_PLACE_KEY, saveStarterPlace } from "./place.svelte";
import { STARTER_ID } from "./starter";

// Sharing's navigation and dialogs aren't used here (and the router needs a page).
vi.mock("../../router", () => ({ navigate: vi.fn() }));
vi.mock("$lib/components/dialogs/lazy.svelte", () => ({ openShare: vi.fn() }));
vi.mock("svelte-sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const SCHOOL: ChosenPlace = { kind: "location", source: "schools", code: "123" };

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
		const id = await app.index.duplicate(STARTER_ID, app.starterPlace);
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
