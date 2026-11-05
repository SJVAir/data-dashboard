import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import type { Platform } from "$lib/platform/types";
import { STARTER_ID } from "$lib/starter/starter";
import { initApp, type AppContext } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { createFakeRemote } from "$lib/sync/remote-fake";
import { ACCOUNT, SPACE, makeDoc, storeDoc, user } from "$lib/sync/test-support";
import { SyncWorker } from "$lib/sync/worker.svelte";
import { chartType } from "$lib/widgets/chart";
import { getWidgetType, registerWidgetType } from "$lib/widgets/registry";
import { landedIn } from "./add";
import type { Draft } from "./draft.svelte";
import { editDraft, saveEdit } from "./edit";

// The live-link rule's region lookup: any point is in ZIP 93721.
vi.mock("$lib/data", () => ({
	placeRegion: async () => ({ type: "zipcode", code: "93721" }),
	getResolvers: () => ({
		regions: { resolve: async () => ({ id: "z1", name: "ZIP 93721" }) }
	})
}));

const POINT = { kind: "point", lat: 36.7378, lon: -119.7871 } as const;
const ZIP = { kind: "region", type: "zipcode", code: "93721" } as const;
const FRESNO = { kind: "region", type: "county", code: "06019" } as const;

// A type with a bigger minimum size than the Chart, for the size clamp.
registerWidgetType({ ...chartType, type: "tall", minSize: { w: 4, h: 8 } });

/** A widget saved before this spec: one layer, no date range, no options. */
const preSpec: WidgetInstance = {
	id: "w1",
	type: "chart",
	title: "My chart",
	rect: { x: 10, y: 2, w: 2, h: 4 },
	data: { layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO }] }
};

const workers: SyncWorker[] = [];
afterEach(() => {
	for (const worker of workers.splice(0)) worker.stop();
});

async function withWidget(widget: WidgetInstance = preSpec) {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const doc: Dashboard = { ...makeDoc("d1"), body: { widgets: [widget] } };
	await platform.documents.commit("anonymous", {
		docId: doc.id,
		baseVersion: null,
		doc,
		entries: []
	});
	const session = (await app.sessions.get("d1"))!;
	return { platform, app, session };
}

const shown = (session: { doc: Dashboard }) => session.doc.body.widgets[0];

describe("editDraft", () => {
	it("is the widget's type, data and options", () => {
		const options = { overlayFor: FRESNO };
		expect(editDraft({ ...preSpec, options })).toEqual({
			type: "chart",
			data: preSpec.data,
			options
		});
		expect(editDraft(preSpec)).toEqual({ type: "chart", data: preSpec.data });
		expect("options" in editDraft(preSpec)).toBe(false);
	});
});

describe("saveEdit", () => {
	it("unchanged save applies nothing", async () => {
		const { session } = await withWidget({ ...preSpec, options: { overlayFor: FRESNO } });
		const before = session.doc;
		expect(saveEdit(session, "w1", editDraft(shown(session)))).toBe(false);
		expect(session.doc).toBe(before);
		expect(session.canUndo).toBe(false);
	});

	it("a pre-spec widget (one layer, no options) round-trips", async () => {
		const { session } = await withWidget();
		const draft = structuredClone(editDraft(shown(session)));
		expect(saveEdit(session, "w1", draft)).toBe(false);
		expect(shown(session)).toEqual(preSpec);
		expect(session.canUndo).toBe(false);
	});

	it("changing the date range is one undo step", async () => {
		const { session } = await withWidget();
		const draft: Draft = {
			...editDraft(preSpec),
			data: { ...preSpec.data, dateRange: { kind: "trailing", amount: 7, unit: "day" } }
		};
		expect(saveEdit(session, "w1", draft)).toBe(true);
		expect(shown(session)).toEqual({ ...preSpec, data: draft.data });
		session.undo();
		expect(shown(session)).toEqual(preSpec);
		expect(session.canUndo).toBe(false);
	});

	it("switching Chart → Data table keeps id, rect, title", async () => {
		const { session } = await withWidget({ ...preSpec, rect: { x: 0, y: 0, w: 4, h: 6 } });
		expect(saveEdit(session, "w1", { ...editDraft(preSpec), type: "data-table" })).toBe(true);
		expect(shown(session)).toEqual({
			...preSpec,
			type: "data-table",
			rect: { x: 0, y: 0, w: 4, h: 6 }
		});
		session.undo();
		expect(shown(session).type).toBe("chart");
		expect(session.canUndo).toBe(false);
	});

	it("a type with a bigger minimum size clamps the size, in the same undo step", async () => {
		const { session } = await withWidget();
		expect(getWidgetType("tall")?.minSize).toEqual({ w: 4, h: 8 });
		expect(saveEdit(session, "w1", { ...editDraft(preSpec), type: "tall" })).toBe(true);
		// Wider than fits at x 10: it moves left to stay on the grid.
		expect(shown(session)).toMatchObject({ type: "tall", rect: { x: 8, y: 2, w: 4, h: 8 } });
		session.undo();
		expect(shown(session)).toEqual(preSpec);
		expect(session.canUndo).toBe(false);
	});

	it("options set and cleared", async () => {
		const { session } = await withWidget();
		const options = { overlayFor: FRESNO };
		expect(saveEdit(session, "w1", { ...editDraft(preSpec), options })).toBe(true);
		expect(shown(session).options).toEqual(options);
		expect(saveEdit(session, "w1", editDraft(preSpec))).toBe(true);
		expect("options" in shown(session)).toBe(false);
		session.undo();
		expect(shown(session).options).toEqual(options);
	});

	it("a widget that's gone throws", async () => {
		const { session } = await withWidget();
		expect(() => saveEdit(session, "gone", editDraft(preSpec))).toThrow();
	});

	it("on the starter, saving makes the copy with the change", async () => {
		const platform = createMemoryPlatform();
		const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
		const starter = (await app.sessions.get(STARTER_ID))!;
		const widget = starter.doc.body.widgets[0];
		const draft: Draft = { ...editDraft(widget), type: "data-table" };
		expect(saveEdit(starter, widget.id, draft)).toBe(true);
		const copy = await landedIn(starter);
		expect(copy.doc.id).not.toBe(STARTER_ID);
		expect(copy.doc.body.widgets.find((w) => w.id === widget.id)?.type).toBe("data-table");
	});

	it("a live-shared dashboard saves a point place as its region", async () => {
		const identity = createMemoryIdentity({ state: "signed-in", user: user(ACCOUNT) });
		identity.start();
		identity.currentSpace = async () => SPACE;
		const platform: Platform = createMemoryPlatform({ identity });
		const fake = createFakeRemote({ accountId: ACCOUNT });
		const app: AppContext = await initApp(platform, {
			channel: createMemoryTabHub().channel(),
			tabId: "t1",
			loadSync: null
		});
		const worker = new SyncWorker({
			platform,
			space: SPACE,
			accountId: ACCOUNT,
			remote: fake,
			channel: app.channel,
			tabId: app.tabId,
			buildId: "test-build",
			now: () => new Date(),
			onPointsHeld: (docId) => app.pointsHeld(docId)
		});
		workers.push(worker);
		app.sync = worker;
		await storeDoc(platform, { ...makeDoc("d1"), body: { widgets: [preSpec] } });
		expect(await worker.syncAll()).toBe(0);
		expect(await worker.share("d1")).toMatchObject({ kind: "shared" });
		const session = (await app.sessions.get("d1"))!;

		const draft: Draft = {
			...editDraft(preSpec),
			data: { layers: [{ ...preSpec.data.layers[0], place: POINT }] }
		};
		expect(saveEdit(session, "w1", draft)).toBe(true);

		const placeIn = (doc: Dashboard) => doc.body.widgets[0].data.layers[0].place;
		await expect.poll(() => placeIn(session.doc)).toEqual(ZIP);
		const stored = async () => (await platform.documents.get(SPACE, "d1")) as Dashboard;
		await expect.poll(async () => placeIn(await stored())).toEqual(ZIP);
		expect(await worker.syncAll()).toBe(0);
		expect(JSON.stringify((await fake.get("d1")).body)).not.toContain("36.7378");
		// Undo goes past the swap: the save is one step.
		session.undo();
		expect(placeIn(session.doc)).toEqual(FRESNO);
	});
});
