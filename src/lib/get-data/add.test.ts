import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dashboard } from "$lib/documents/schema";
import { placeNewWidget } from "$lib/layout/items";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import type { Platform, SpaceId } from "$lib/platform/types";
import { STARTER_ID } from "$lib/starter/starter";
import { initApp, type AppContext } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { createFakeRemote } from "$lib/sync/remote-fake";
import { ACCOUNT, SPACE, makeDoc, storeDoc, user } from "$lib/sync/test-support";
import { SyncWorker } from "$lib/sync/worker.svelte";
import { chartType } from "$lib/widgets/chart";
import { dataTableType } from "$lib/widgets/table";
import { registerWidgetType } from "$lib/widgets/registry";
import { addFromDraft, addTargets } from "./add";
import type { Draft } from "./draft.svelte";

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

function draft(place: Draft["data"]["layers"][number]["place"] = FRESNO): Draft {
	return {
		type: "chart",
		data: {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			layers: [{ dataset: "air-quality", entryType: "pm25", place }]
		}
	};
}

const workers: SyncWorker[] = [];
afterEach(() => {
	for (const worker of workers.splice(0)) worker.stop();
});

async function anonymous() {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	return { platform, app };
}

/** Stores `doc` in the anonymous space, as a created dashboard. */
async function put(platform: Platform, doc: Dashboard): Promise<void> {
	await platform.documents.commit("anonymous", {
		docId: doc.id,
		baseVersion: null,
		doc,
		entries: []
	});
}

const stored = async (platform: Platform, space: SpaceId, id: string) =>
	(await platform.documents.get(space, id)) as Dashboard;

registerWidgetType(dataTableType);

describe("addFromDraft", () => {
	it("keeps a Chart's threshold line, but never puts one on a Data table", async () => {
		const { platform, app } = await anonymous();
		await put(platform, makeDoc("d1"));
		await app.index.refresh();
		const session = (await app.sessions.get("d1"))!;
		const thresholds = [{ level: "unhealthy_sensitive" }];
		await addFromDraft(app, "d1", { ...draft(), thresholds });
		expect(session.doc.body.widgets.at(-1)!.thresholds).toEqual(thresholds);
		await addFromDraft(app, "d1", { ...draft(), type: "data-table", thresholds });
		expect(session.doc.body.widgets.at(-1)!.type).toBe("data-table");
		expect("thresholds" in session.doc.body.widgets.at(-1)!).toBe(false);
	});

	it("adds at placeNewWidget's rect, one undo removes it", async () => {
		const { platform, app } = await anonymous();
		await put(platform, makeDoc("d1"));
		await app.index.refresh();
		const session = (await app.sessions.get("d1"))!;
		const before = session.doc.body.widgets;

		const { dashboardId, widgetId, copied } = await addFromDraft(app, "d1", draft());

		expect(dashboardId).toBe("d1");
		expect(copied).toBe(false);
		const added = session.doc.body.widgets.at(-1)!;
		expect(added).toEqual({
			id: widgetId,
			type: "chart",
			title: null,
			rect: placeNewWidget(before, chartType.defaultSize),
			data: draft().data
		});
		expect(session.doc.body.widgets).toHaveLength(before.length + 1);
		// The dashboard page opens the same session, so its undo stack holds the add.
		expect(await app.sessions.get("d1")).toBe(session);
		session.undo();
		expect(session.doc.body.widgets).toEqual(before);
	});

	it("keeps the draft's options", async () => {
		const { platform, app } = await anonymous();
		await put(platform, makeDoc("d1"));
		const options = { overlayFor: { kind: "region", type: "county", code: "06019" } };
		await addFromDraft(app, "d1", { ...draft(), options } as Draft);
		const session = (await app.sessions.get("d1"))!;
		expect(session.doc.body.widgets.at(-1)!.options).toEqual(options);
	});

	it("keeps the draft's alert level", async () => {
		const { platform, app } = await anonymous();
		await put(platform, makeDoc("d1"));
		const now: Draft = {
			type: "current-conditions",
			data: { layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO }] },
			thresholds: [{ level: "unhealthy_sensitive" }]
		};
		await addFromDraft(app, "d1", now);
		const session = (await app.sessions.get("d1"))!;
		expect(session.doc.body.widgets.at(-1)!.thresholds).toEqual([{ level: "unhealthy_sensitive" }]);
		// Off stores none.
		await addFromDraft(app, "d1", { ...now, thresholds: undefined });
		expect("thresholds" in session.doc.body.widgets.at(-1)!).toBe(false);
	});

	it("adding to the starter makes the copy and returns its id", async () => {
		const { platform, app } = await anonymous();

		const { dashboardId, widgetId, copied } = await addFromDraft(app, STARTER_ID, draft());

		expect(copied).toBe(true);
		expect(dashboardId).not.toBe(STARTER_ID);
		const copy = (await app.sessions.get(dashboardId))!;
		expect(copy.doc.copiedFrom).toBe(STARTER_ID);
		expect(copy.doc.body.widgets.map((w) => w.id)).toContain(widgetId);
		expect(app.current.session?.doc.id).toBe(dashboardId);
		await copy.flush();
		expect((await stored(platform, "anonymous", dashboardId)).body.widgets.at(-1)!.id).toBe(
			widgetId
		);
		// Undo takes the widget off, and keeps the copy.
		copy.undo();
		expect(copy.doc.body.widgets.map((w) => w.id)).not.toContain(widgetId);
	});

	it("New dashboard creates one and adds there", async () => {
		const { platform, app } = await anonymous();
		await put(platform, makeDoc("d1"));
		await app.index.refresh();

		const { dashboardId, widgetId } = await addFromDraft(app, "new", draft());

		expect(dashboardId).not.toBe("d1");
		expect(app.index.items.map((d) => d.id)).toContain(dashboardId);
		const session = (await app.sessions.get(dashboardId))!;
		expect(session.doc.body.widgets.map((w) => w.id)).toEqual([widgetId]);
		expect(session.doc.body.widgets[0].rect).toEqual({ x: 0, y: 0, ...chartType.defaultSize });
	});

	it("a read-only dashboard throws and is left as it was", async () => {
		const { platform, app } = await anonymous();
		await put(platform, { ...makeDoc("d1"), schemaVersion: 99 } as unknown as Dashboard);
		await expect(addFromDraft(app, "d1", draft())).rejects.toThrow();
		await expect(addFromDraft(app, "missing", draft())).rejects.toThrow();
		expect((await stored(platform, "anonymous", "d1")).body.widgets).toHaveLength(2);
	});

	it("a live-shared dashboard saves a point place as its region", async () => {
		const identity = createMemoryIdentity({ state: "signed-in", user: user(ACCOUNT) });
		identity.start();
		identity.currentSpace = async () => SPACE;
		const platform = createMemoryPlatform({ identity });
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
		await storeDoc(platform, makeDoc("d1"));
		expect(await worker.syncAll()).toBe(0);
		expect(await worker.share("d1")).toMatchObject({ kind: "shared" });

		const { widgetId } = await addFromDraft(app, "d1", draft(POINT));

		const placeIn = (doc: Dashboard) =>
			doc.body.widgets.find((w) => w.id === widgetId)!.data.layers[0].place;
		const session = (await app.sessions.get("d1"))!;
		await expect.poll(() => placeIn(session.doc)).toEqual(ZIP);
		await expect.poll(async () => placeIn(await stored(platform, SPACE, "d1"))).toEqual(ZIP);
		expect(await worker.syncAll()).toBe(0);
		expect(JSON.stringify((await fake.get("d1")).body)).not.toContain("36.7378");
		// Undo goes past the swap: the add is one step.
		session.undo();
		expect(session.doc.body.widgets.map((w) => w.id)).not.toContain(widgetId);
	});
});

describe("addTargets", () => {
	async function withDashboards() {
		const { platform, app } = await anonymous();
		await put(platform, { ...makeDoc("d1"), name: "Home" });
		await put(platform, { ...makeDoc("d2"), name: "School" });
		await app.index.refresh();
		return { platform, app };
	}

	it("defaults to the dashboard you came from, listing the others", async () => {
		const { app } = await withDashboards();
		const targets = addTargets(app, "d2", "d1");
		expect(targets.selected).toEqual({ id: "d2", name: "School" });
		expect(targets.others).toEqual([{ id: "d1", name: "Home" }]);
	});

	it("else the last-opened one, else the starter", async () => {
		const { app } = await withDashboards();
		expect(addTargets(app, undefined, "d1").selected).toEqual({ id: "d1", name: "Home" });
		// A last-opened dashboard that's gone, and an unknown route id, fall through.
		expect(addTargets(app, "gone", "gone").selected).toEqual({
			id: STARTER_ID,
			name: "Starter dashboard"
		});
		expect(
			addTargets(app, undefined, undefined)
				.others.map((t) => t.id)
				.sort()
		).toEqual(["d1", "d2"]);
	});

	it("with no dashboards, the starter, as it reads in the nav", async () => {
		const { app } = await anonymous();
		expect(addTargets(app, STARTER_ID, undefined)).toEqual({
			selected: { id: STARTER_ID, name: "Starter dashboard" },
			others: []
		});
	});
});
