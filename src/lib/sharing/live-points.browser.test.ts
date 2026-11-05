import "../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import type { Change } from "$lib/changes/types";
import type { Layer } from "$lib/data/schema";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import ShareDialog from "$lib/components/dialogs/ShareDialog.svelte";
import { share } from "$lib/components/dialogs/lazy.svelte";
import { Toaster } from "$lib/components/ui/sonner";
import { setPlatform } from "$lib/platform";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import type { Platform } from "$lib/platform/types";
import { APP_CONTEXT_KEY, initApp, type AppContext } from "$lib/store/app.svelte";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";

type MemoryTabHub = ReturnType<typeof createMemoryTabHub>;
import type { SyncContext } from "$lib/sync/context";
import type { SaveInput } from "$lib/sync/remote";
import { createFakeRemote, type FakeRemote } from "$lib/sync/remote-fake";
import { ACCOUNT, SPACE, makeDoc, storeDoc, user } from "$lib/sync/test-support";
import { SyncWorker } from "$lib/sync/worker.svelte";

/**
 * The every-edit rule end to end: an app in an account space over the fake server, the Share
 * dialog, toasts, and the region lookup mocked (any point is in ZIP 93721).
 */

const mocked = vi.hoisted(() => ({
	placeRegion: vi.fn<() => Promise<{ type: string; code: string } | null>>()
}));
vi.mock("$lib/data", () => ({
	placeRegion: mocked.placeRegion,
	getResolvers: () => ({
		regions: { resolve: async () => ({ id: "z1", name: "ZIP 93721" }) }
	})
}));

const POINT = { kind: "point", lat: 36.7378, lon: -119.7871 } as const;
const ZIP = { kind: "region", type: "zipcode", code: "93721" } as const;
const FRESNO = { kind: "region", type: "county", code: "06019" } as const;
const NOTICE = "This dashboard is shared by link, so your location is saved as ZIP 93721.";
const FAILED = "Can't look up your area right now.";

function chart(place: Layer["place"]): WidgetInstance {
	return {
		id: "p",
		type: "chart",
		title: null,
		rect: { x: 0, y: 0, w: 6, h: 6 },
		data: {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			layers: [{ dataset: "air-quality", entryType: "pm25", place }]
		}
	};
}

const docOn = (place: Layer["place"]): Dashboard => ({
	...makeDoc(),
	body: { widgets: [chart(place)] }
});

/** Widget `p` re-picked, as the place picker does. */
function pick(session: DocumentSession, place: Layer["place"]): void {
	const change: Change = {
		op: "setWidgetData",
		target: { widgetId: "p" },
		from: session.doc.body.widgets[0].data,
		to: chart(place).data
	};
	session.apply(change);
}

const placeOf = (doc: Dashboard) => doc.body.widgets[0].data.layers[0].place;
const stored = async (platform: Platform) =>
	(await platform.documents.get(SPACE, "d1")) as Dashboard;

beforeEach(() => {
	mocked.placeRegion.mockReset();
	mocked.placeRegion.mockResolvedValue({ type: "zipcode", code: "93721" });
});

const workers: SyncWorker[] = [];
afterEach(async () => {
	for (const worker of workers.splice(0)) worker.stop();
	toast.dismiss();
	share.open = false;
	share.opts = null;
	// Gone before the next test reads the toasts.
	await expect.poll(() => document.querySelectorAll("[data-sonner-toast]").length).toBe(0);
});

/** One tab: an app over `platform`, its worker (driven by the test), as the app wires it. */
async function tab(platform: Platform, fake: FakeRemote, hub: MemoryTabHub, tabId: string) {
	const app = await initApp(platform, { channel: hub.channel(), tabId, loadSync: null });
	const ctx: SyncContext = {
		platform,
		space: SPACE,
		accountId: ACCOUNT,
		remote: fake,
		channel: app.channel,
		tabId: app.tabId,
		buildId: "test-build",
		now: () => new Date(),
		onPointsHeld: (docId) => app.pointsHeld(docId)
	};
	const worker = new SyncWorker(ctx);
	workers.push(worker);
	app.sync = worker;
	return { app, worker };
}

/**
 * Dashboard `d1` with widget `p` on Fresno County, uploaded, in a signed-in app with the Share
 * dialog and toasts mounted. Every save from here on is kept (`saves`).
 */
async function signedIn() {
	const identity = createMemoryIdentity({ state: "signed-in", user: user(ACCOUNT) });
	identity.start();
	identity.currentSpace = async () => SPACE;
	const platform = createMemoryPlatform({ identity });
	setPlatform(platform);
	const fake = createFakeRemote({ accountId: ACCOUNT });
	const hub = createMemoryTabHub();
	const { app, worker } = await tab(platform, fake, hub, "t1");
	await storeDoc(platform, docOn(FRESNO));
	expect(await worker.syncAll()).toBe(0);
	const saves: SaveInput[] = [];
	const save = fake.save;
	fake.save = (id, input) => {
		saves.push(input);
		return save(id, input);
	};
	const context = new Map([[APP_CONTEXT_KEY, app]]);
	await render(ShareDialog, { context });
	await render(Toaster);
	const session = (await app.sessions.get("d1"))!;
	app.current = { session, isStarter: false };
	return { platform, fake, hub, app, worker, session, saves };
}

const liveSection = () =>
	page
		.getByRole("dialog", { name: "Share dashboard" })
		.getByRole("region", { name: "Anyone with the link can view" });

/** Use my location, then the Share dialog's "Use ZIP 93721 instead" (the link goes on). */
async function sharedAsRegion(app: AppContext, worker: SyncWorker, session: DocumentSession) {
	pick(session, POINT);
	await session.flush();
	const { shareDashboard } = await import("$lib/sharing/actions");
	await shareDashboard(app);
	await liveSection().getByRole("button", { name: "Use ZIP 93721 instead" }).click();
	await expect.poll(() => worker.states.d1?.shareToken).toBeTruthy();
	share.open = false;
	expect(placeOf(session.doc)).toEqual(ZIP);
}

const toastText = () =>
	[...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent ?? "").join("|");

/** No save sent after `from` holds the point, in its body or its changes. */
function expectNoPointSent(saves: SaveInput[], from = 0) {
	const sent = JSON.stringify(saves.slice(from));
	expect(sent).not.toContain('"kind":"point"');
	expect(sent).not.toContain("36.7378");
}

test("Undo after Use ZIP 93721 instead saves the region again, says so, and never uploads the point", async () => {
	const { platform, fake, app, worker, session, saves } = await signedIn();
	await sharedAsRegion(app, worker, session);
	const linked = saves.length;

	session.undo();
	await expect.poll(() => placeOf(session.doc)).toEqual(ZIP);
	await expect.poll(toastText).toContain(NOTICE);
	expect(await worker.syncAll()).toBe(0);
	expect(placeOf(await stored(platform))).toEqual(ZIP);
	expectNoPointSent(saves, linked);
	expect(JSON.stringify((await fake.get("d1")).body)).not.toContain("36.7378");
	// The viewer's copy.
	const shared = await fake.shared(worker.states.d1!.shareToken!);
	expect(JSON.stringify(shared.body)).not.toContain('"point"');

	// One more Undo goes past the swap: back to before the location was picked.
	session.undo();
	expect(placeOf(session.doc)).toEqual(FRESNO);
});

test("Redo back onto the point saves the region and says so", async () => {
	const { platform, app, worker, session, saves } = await signedIn();
	pick(session, POINT);
	session.undo();
	expect(placeOf(session.doc)).toEqual(FRESNO);
	await session.flush();
	// The link goes on with no point on the dashboard (nothing to ask), Redo still holding one.
	expect(await app.sync!.share("d1")).toMatchObject({ kind: "shared" });
	const linked = saves.length;

	session.redo();
	expect(placeOf(session.doc)).toEqual(POINT);
	await expect.poll(() => placeOf(session.doc)).toEqual(ZIP);
	await expect.poll(toastText).toContain(NOTICE);
	expect(await worker.syncAll()).toBe(0);
	expect(placeOf(await stored(platform))).toEqual(ZIP);
	expectNoPointSent(saves, linked);
	// Undo goes past the swap, to before the redone pick.
	session.undo();
	expect(placeOf(session.doc)).toEqual(FRESNO);
});

test("a point another tab left in the journal is swapped when this tab opens it", async () => {
	const { platform, fake, hub, app, worker, session, saves } = await signedIn();
	await sharedAsRegion(app, worker, session);
	await worker.syncAll();
	const linked = saves.length;
	// Another tab picked the point and went away before storing it.
	const stored0 = await stored(platform);
	platform.journal.write(SPACE, "d1", "gone-tab", {
		baseVersion: stored0.version,
		changes: [
			{
				op: "setWidgetData",
				target: { widgetId: "p" },
				from: chart(ZIP).data,
				to: chart(POINT).data
			}
		],
		schemaVersion: 1,
		writtenAt: new Date().toISOString()
	});
	const other = await tab(platform, fake, hub, "t2");
	const opened = (await other.app.sessions.get("d1"))!;
	await expect.poll(() => placeOf(opened.doc)).toEqual(ZIP);
	await expect.poll(toastText).toContain(NOTICE);
	await other.worker.syncAll();
	expect(placeOf(await stored(platform))).toEqual(ZIP);
	expectNoPointSent(saves, linked);
});

test("a point picked in another open tab is swapped there, and never uploaded", async () => {
	const { platform, fake, hub, app, worker, session, saves } = await signedIn();
	await sharedAsRegion(app, worker, session);
	await worker.syncAll();
	const linked = saves.length;
	const other = await tab(platform, fake, hub, "t2");
	const there = (await other.app.sessions.get("d1"))!;
	pick(there, POINT);
	await expect.poll(() => placeOf(there.doc)).toEqual(ZIP);
	await other.worker.syncAll();
	await worker.syncAll();
	// This tab caught up with the region, and no save carried the point.
	await expect.poll(() => placeOf(session.doc)).toEqual(ZIP);
	expect(placeOf(await stored(platform))).toEqual(ZIP);
	expectNoPointSent(saves, linked);
});

test("with Share my exact location, Undo restores the point and it uploads", async () => {
	const { fake, app, worker, session } = await signedIn();
	pick(session, POINT);
	await session.flush();
	const { shareDashboard } = await import("$lib/sharing/actions");
	await shareDashboard(app);
	await liveSection().getByRole("button", { name: "Share my exact location" }).click();
	await expect.poll(() => worker.states.d1?.shareExact).toBe(true);
	share.open = false;
	const lookups = mocked.placeRegion.mock.calls.length;
	pick(session, ZIP);
	await worker.syncAll();
	session.undo();
	expect(placeOf(session.doc)).toEqual(POINT);
	await session.flush();
	expect(await worker.syncAll()).toBe(0);
	expect(placeOf(session.doc)).toEqual(POINT);
	expect(JSON.stringify((await fake.get("d1")).body)).toContain("36.7378");
	expect(toastText()).not.toContain(NOTICE);
	expect(mocked.placeRegion.mock.calls.length).toBe(lookups);
});

test("a failed lookup holds the upload and says so; Retry swaps and uploads", async () => {
	const { platform, fake, app, worker, session, saves } = await signedIn();
	await sharedAsRegion(app, worker, session);
	await worker.syncAll();
	const linked = saves.length;
	mocked.placeRegion.mockRejectedValue(new Error("offline"));

	session.undo();
	await expect.poll(toastText).toContain(FAILED);
	expect(placeOf(session.doc)).toEqual(POINT);
	await session.flush();
	// Held: the stored point never goes up.
	expect(await worker.syncAll()).toBe(1);
	expect(saves.length).toBe(linked);
	expect(JSON.stringify((await fake.get("d1")).body)).not.toContain("36.7378");

	mocked.placeRegion.mockResolvedValue({ type: "zipcode", code: "93721" });
	// The toast's action (off the test page's small screen, so clicked in the DOM).
	document.querySelector<HTMLButtonElement>("[data-sonner-toast] [data-button]")!.click();
	await expect.poll(() => placeOf(session.doc)).toEqual(ZIP);
	await expect.poll(toastText).toContain(NOTICE);
	await expect.poll(toastText).not.toContain(FAILED);
	expect(await worker.syncAll()).toBe(0);
	expect(placeOf(await stored(platform))).toEqual(ZIP);
	expectNoPointSent(saves, linked);
});

test("without a live link, Undo restores the point and it uploads (the owner's account copy)", async () => {
	const { fake, worker, session } = await signedIn();
	pick(session, POINT);
	pick(session, ZIP);
	session.undo();
	expect(placeOf(session.doc)).toEqual(POINT);
	await session.flush();
	expect(await worker.syncAll()).toBe(0);
	expect(placeOf(session.doc)).toEqual(POINT);
	expect(JSON.stringify((await fake.get("d1")).body)).toContain("36.7378");
	expect(mocked.placeRegion).not.toHaveBeenCalled();
});
