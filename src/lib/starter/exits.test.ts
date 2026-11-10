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
