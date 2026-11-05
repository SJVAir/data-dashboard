import { describe, expect, it, vi } from "vitest";
import type { Change } from "$lib/changes/types";
import type { Layer } from "$lib/data/schema";
import type { WidgetInstance } from "$lib/documents/schema";
import { pullInto, pollList } from "./pull";
import type { SaveInput } from "./remote";
import { resolveHold } from "./resolve";
import { shareDocument, unshareDocument } from "./share";
import { uploadDocument } from "./upload";
import { SyncWorker } from "./worker.svelte";
import {
	SPACE,
	edit,
	makeDoc,
	otherDevice,
	serverSince,
	setupSync,
	storeDoc,
	stored,
	title
} from "./test-support";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

const POINT = { kind: "point", lat: 36.7378, lon: -119.7871 } as const;
const ZIP = { kind: "region", type: "zipcode", code: "93721" } as const;

const layer = (place: Layer["place"]): Layer => ({
	dataset: "air-quality",
	entryType: "pm25",
	place
});

function chart(place: Layer["place"]): WidgetInstance {
	return {
		id: "p",
		type: "chart",
		title: null,
		rect: { x: 0, y: 4, w: 6, h: 6 },
		data: { dateRange: { kind: "trailing", amount: 30, unit: "day" }, layers: [layer(place)] }
	};
}

/** Re-picks widget `p`'s place (`from` → `to`), as the picker or an undo would. */
const pick = (from: Layer["place"], to: Layer["place"]): Change => ({
	op: "setWidgetData",
	target: { widgetId: "p" },
	from: chart(from).data,
	to: chart(to).data
});

/**
 * A dashboard with widget `p` on ZIP 93721, synced at server version 1, with every save's input
 * kept (`saves`) and, when `link`, its live link on.
 */
async function synced({ link = true } = {}) {
	const setup = await setupSync();
	const doc = makeDoc();
	await storeDoc(setup.platform, { ...doc, body: { widgets: [...doc.body.widgets, chart(ZIP)] } });
	expect(await uploadDocument(setup.ctx, "d1")).toBe("saved");
	if (link) expect(await shareDocument(setup.ctx, "d1")).toMatchObject({ kind: "shared" });
	const saves: SaveInput[] = [];
	const save = setup.fake.save;
	setup.fake.save = (id, input) => {
		saves.push(input);
		return save(id, input);
	};
	setup.fake.requests.length = 0;
	return { ...setup, saves };
}

const sent = (saves: SaveInput[]) => JSON.stringify(saves);

describe("pointsHeld: a live link never gets a point the owner didn't choose", () => {
	it("an upload of a point on a live link is held, and nothing is sent", async () => {
		const { platform, fake, ctx, saves } = await synced();
		await edit(platform, [pick(ZIP, POINT)]);
		expect(await uploadDocument(ctx, "d1")).toBe("points");
		expect(fake.requests).toEqual([]);
		expect(saves).toEqual([]);
		expect(JSON.stringify((await fake.get("d1")).body)).not.toContain("36.7378");
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			serverVersion: 1,
			syncedThrough: 0
		});
	});

	it("once the point is swapped back, the save holds no point, not even in its changes", async () => {
		const { platform, fake, ctx, saves } = await synced();
		// An undo restored the point, then the app swapped it for its region again.
		await edit(platform, [pick(ZIP, POINT)]);
		expect(await uploadDocument(ctx, "d1")).toBe("points");
		await edit(platform, [pick(POINT, ZIP), title("a", "Mine")]);
		expect(await uploadDocument(ctx, "d1")).toBe("saved");
		expect(saves).toHaveLength(1);
		expect(sent(saves)).not.toContain('"kind":"point"');
		expect(sent(saves)).not.toContain("36.7378");
		expect(saves[0].changes.map((c) => (c.change as { op: string }).op)).toEqual([
			"replaceDocument"
		]);
		const server = await fake.get("d1");
		expect(server.body).toEqual((await stored(platform)).body);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({ syncedThrough: 3 });
	});

	it("without a live link, a point uploads as it is (the owner's own account copy)", async () => {
		const { platform, fake, ctx, saves } = await synced({ link: false });
		await edit(platform, [pick(ZIP, POINT)]);
		expect(await uploadDocument(ctx, "d1")).toBe("saved");
		expect(saves[0].changes.map((c) => (c.change as { op: string }).op)).toEqual(["setWidgetData"]);
		expect(JSON.stringify((await fake.get("d1")).body)).toContain("36.7378");
	});

	it("with Share my exact location chosen for the link, a point uploads", async () => {
		const { platform, fake, ctx } = await synced();
		await edit(platform, [pick(ZIP, POINT)]);
		expect(await uploadDocument(ctx, "d1")).toBe("points");
		// Chosen on the link that's already on: remembered first, so the point goes now.
		expect(await shareDocument(ctx, "d1", { exact: true })).toMatchObject({
			kind: "shared",
			unsynced: false
		});
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({ shareExact: true });
		expect(JSON.stringify((await fake.get("d1")).body)).toContain("36.7378");
		await edit(platform, [title("a", "Later")]);
		expect(await uploadDocument(ctx, "d1")).toBe("saved");
	});

	it("a new link made with the exact choice remembers it", async () => {
		const { platform, fake, ctx } = await synced({ link: false });
		await edit(platform, [pick(ZIP, POINT)]);
		expect(await shareDocument(ctx, "d1", { exact: true })).toMatchObject({ kind: "shared" });
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			shareToken: (await fake.get("d1")).shareToken,
			shareExact: true
		});
	});

	it("turning the link off forgets the choice, and a new link starts without it", async () => {
		const { platform, fake, ctx } = await synced();
		await shareDocument(ctx, "d1", { exact: true });
		await unshareDocument(ctx, "d1");
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			shareToken: null,
			shareExact: false
		});
		await shareDocument(ctx, "d1");
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({ shareExact: false });
		await edit(platform, [pick(ZIP, POINT)]);
		expect(await uploadDocument(ctx, "d1")).toBe("points");
		expect(JSON.stringify((await fake.get("d1")).body)).not.toContain("36.7378");
	});

	it("Use … instead on an exact link (exact: false) goes back to swapping", async () => {
		const { platform, ctx } = await synced();
		await shareDocument(ctx, "d1", { exact: true });
		await shareDocument(ctx, "d1", { exact: false });
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({ shareExact: false });
	});

	it("a share without a choice keeps the link's", async () => {
		const { platform, ctx } = await synced();
		await shareDocument(ctx, "d1", { exact: true });
		await shareDocument(ctx, "d1");
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({ shareExact: true });
	});

	it("a link turned off elsewhere, or a different one, drops the choice here", async () => {
		const { platform, fake, ctx } = await synced();
		await shareDocument(ctx, "d1", { exact: true });
		await fake.unshare("d1");
		await pollList(ctx);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			shareToken: null,
			shareExact: false
		});
		// Shared again elsewhere (a new token) while this record still says exact.
		const record = (await platform.sync.get(SPACE, "d1"))!;
		await platform.sync.put(SPACE, { ...record, shareToken: "old", shareExact: true });
		const token = await fake.share("d1");
		await otherDevice(fake, [title("a", "Theirs")]);
		expect(await pullInto(ctx, "d1", await serverSince(fake, 1))).toBe("merged");
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			shareToken: token,
			shareExact: false
		});
	});

	it("a pull on the same link keeps the choice", async () => {
		const { platform, fake, ctx } = await synced();
		await shareDocument(ctx, "d1", { exact: true });
		await otherDevice(fake, [title("a", "Theirs")]);
		expect(await pullInto(ctx, "d1", await serverSince(fake, 1))).toBe("merged");
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({ shareExact: true });
	});

	it("settling a conflict that would save a point is refused, and nothing is sent", async () => {
		const { platform, fake, ctx, saves } = await synced();
		await edit(platform, [pick(ZIP, POINT)]);
		await otherDevice(fake, [pick(ZIP, { kind: "region", type: "zipcode", code: "93722" })]);
		expect(await pullInto(ctx, "d1", await serverSince(fake, 1))).toBe("held");
		saves.length = 0;
		await expect(resolveHold(ctx, "d1", "keep-mine")).rejects.toThrow(/exact location/);
		expect(saves).toEqual([]);
		expect(JSON.stringify((await fake.get("d1")).body)).not.toContain("36.7378");
	});

	it("the worker tells the app when an upload is held for a point, and doesn't retry it", async () => {
		const { platform, fake, ctx } = await synced();
		const held = vi.fn();
		const worker = new SyncWorker({ ...ctx, onPointsHeld: held });
		await edit(platform, [pick(ZIP, POINT)]);
		expect(await worker.syncAll()).toBe(1);
		expect(held).toHaveBeenCalledWith("d1");
		expect(fake.requests.filter((r) => r.startsWith("save"))).toEqual([]);
		worker.stop();
	});

	it("the worker tells the app when a link starts guarding points, not when it's exact", async () => {
		const { fake, ctx } = await synced({ link: false });
		const held = vi.fn();
		const worker = new SyncWorker({ ...ctx, onPointsHeld: held });
		expect(await worker.syncAll()).toBe(0);
		expect(held).not.toHaveBeenCalled();
		// Turned on elsewhere, then learned here.
		await fake.share("d1");
		await pollList(ctx);
		await worker.syncAll();
		expect(held).toHaveBeenCalledWith("d1");
		held.mockClear();
		await worker.syncAll();
		expect(held).not.toHaveBeenCalled();
		worker.stop();

		const exact = vi.fn();
		const other = new SyncWorker({ ...ctx, onPointsHeld: exact });
		await worker.share("d1", { exact: true });
		await other.syncAll();
		expect(exact).not.toHaveBeenCalled();
		other.stop();
	});
});
