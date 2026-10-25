import { describe, expect, it, vi } from "vitest";
import type { Dashboard } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { Platform, SpaceId } from "$lib/platform/types";
import { copiesOf, rememberCopy } from "$lib/sharing/fingerprints";
import { STARTER_ID, blankDashboard } from "$lib/starter/starter";
import { DashboardIndex } from "./dashboard-index.svelte";
import { createMemoryTabHub } from "./tab-channel";

const SPACE: SpaceId = "anonymous";

/** A clock that moves one minute per call, so creation order is distinct. */
function clock() {
	let t = Date.parse("2026-10-20T12:00:00.000Z");
	return () => new Date((t += 60_000));
}

async function store(platform: Platform, doc: unknown, id: string) {
	await platform.documents.commit(SPACE, { docId: id, baseVersion: null, doc, entries: [] });
}

describe("DashboardIndex", () => {
	it("index lists new dashboards and numbers untitled ones", async () => {
		const platform = createMemoryPlatform();
		const index = new DashboardIndex({ platform, space: SPACE, now: clock() });
		const a = await index.createBlank();
		const b = await index.createBlank();
		const mine = await index.createFromStarter();

		expect(index.items.map((d) => d.id).sort()).toEqual([a, b, mine].sort());
		expect(index.names.get(a)).toBe("Untitled dashboard");
		expect(index.names.get(b)).toBe("Untitled dashboard 2");
		expect(index.names.get(mine)).toBe("My dashboard");
		const stored = (await platform.documents.get(SPACE, mine)) as Dashboard;
		expect(stored.copiedFrom).toBe(STARTER_ID);
	});

	it("lists newest changes first", async () => {
		const platform = createMemoryPlatform();
		const now = clock();
		await store(platform, { ...blankDashboard(now()), id: "old" }, "old");
		await store(platform, { ...blankDashboard(now()), id: "new" }, "new");
		const index = new DashboardIndex({ platform, space: SPACE });
		await index.refresh();
		expect(index.items.map((d) => d.id)).toEqual(["new", "old"]);
	});

	it("leaves deleted dashboards out of the items and the numbering", async () => {
		const platform = createMemoryPlatform();
		const now = clock();
		const gone = { ...blankDashboard(now()), id: "gone", deletedAt: now().toISOString() };
		await store(platform, gone, "gone");
		await store(platform, { ...blankDashboard(now()), id: "kept" }, "kept");
		const index = new DashboardIndex({ platform, space: SPACE });
		await index.refresh();
		expect(index.items.map((d) => d.id)).toEqual(["kept"]);
		expect(index.names.get("kept")).toBe("Untitled dashboard");
		expect(index.names.has("gone")).toBe(false);
	});

	it("skips invalid documents and lists newer ones by their stored name", async () => {
		const platform = createMemoryPlatform();
		const now = clock();
		await store(platform, { kind: "dashboard", schemaVersion: 1, id: "bad" }, "bad");
		await store(
			platform,
			{ ...blankDashboard(now()), id: "newer", schemaVersion: 99, name: "Future" },
			"newer"
		);
		await store(platform, { ...blankDashboard(now()), id: "ok" }, "ok");
		const index = new DashboardIndex({ platform, space: SPACE });
		await index.refresh();
		expect(index.items.map((d) => d.id).sort()).toEqual(["newer", "ok"]);
		expect(index.names.get("newer")).toBe("Future");
	});

	it("duplicate copies the name and sets copiedFrom", async () => {
		const platform = createMemoryPlatform();
		const now = clock();
		await store(platform, { ...blankDashboard(now()), id: "src", name: "School" }, "src");
		const index = new DashboardIndex({ platform, space: SPACE, now });
		const id = await index.duplicate("src");
		const copy = (await platform.documents.get(SPACE, id)) as Dashboard;
		expect(copy).toMatchObject({ name: "School", copiedFrom: "src", version: 0 });
		expect(index.items).toHaveLength(2);
	});

	it("refreshes when another tab commits", async () => {
		const platform = createMemoryPlatform();
		const hub = createMemoryTabHub();
		const index = new DashboardIndex({ platform, space: SPACE, channel: hub.channel() });
		await index.refresh();
		expect(index.items).toEqual([]);

		const other = new DashboardIndex({ platform, space: SPACE, channel: hub.channel() });
		const id = await other.createBlank();
		await vi.waitFor(() => expect(index.items.map((d) => d.id)).toEqual([id]));
		index.dispose();
		other.dispose();
	});

	it("createFrom stores the given document, lists it, and posts committed", async () => {
		const platform = createMemoryPlatform();
		const hub = createMemoryTabHub();
		const index = new DashboardIndex({
			platform,
			space: SPACE,
			channel: hub.channel(),
			tabId: "t1",
			now: clock()
		});
		const watcher = hub.channel();
		const seen: unknown[] = [];
		watcher.subscribe((msg) => seen.push(msg));
		const doc = { ...blankDashboard(new Date()), id: "made", copiedFrom: "elsewhere" };
		expect(await index.createFrom(doc)).toBe("made");
		expect(index.items.map((d) => d.id)).toEqual(["made"]);
		await vi.waitFor(() =>
			expect(seen).toContainEqual({
				type: "committed",
				space: SPACE,
				docId: "made",
				version: 0,
				tabId: "t1"
			})
		);
		await expect(index.createFrom(doc)).rejects.toThrow();
	});

	it("lists deleted dashboards newest deletion first", async () => {
		const platform = createMemoryPlatform();
		const now = clock();
		for (const [id, deletedAt] of [
			["a", "2026-10-01T00:00:00.000Z"],
			["b", "2026-10-03T00:00:00.000Z"],
			["c", "2026-10-02T00:00:00.000Z"]
		]) {
			await store(platform, { ...blankDashboard(now()), id, deletedAt }, id);
		}
		await store(platform, { ...blankDashboard(now()), id: "live" }, "live");
		const index = new DashboardIndex({ platform, space: SPACE });
		await index.refresh();
		expect(index.deleted.map((d) => d.id)).toEqual(["b", "c", "a"]);
		expect(index.items.map((d) => d.id)).toEqual(["live"]);
		expect(index.deletedNames.get("b")).toBe("Untitled dashboard 2");
	});

	it("remove deletes a dashboard for good, with its journal records and fingerprint", async () => {
		const platform = createMemoryPlatform();
		const hub = createMemoryTabHub();
		const seen = vi.fn();
		hub.channel().subscribe(seen);
		const now = clock();
		await store(
			platform,
			{ ...blankDashboard(now()), id: "gone", deletedAt: now().toISOString() },
			"gone"
		);
		platform.journal.write(SPACE, "gone", "t1", { baseVersion: 1 });
		await rememberCopy(platform, SPACE, "fp", "gone");
		const index = new DashboardIndex({ platform, space: SPACE, channel: hub.channel() });
		await index.refresh();
		await index.remove("gone");
		expect(await platform.documents.get(SPACE, "gone")).toBeUndefined();
		expect(platform.journal.list(SPACE)).toEqual([]);
		expect(await copiesOf(platform, SPACE, "fp")).toEqual([]);
		expect(index.deleted).toEqual([]);
		expect(seen).toHaveBeenCalledWith(
			expect.objectContaining({ type: "committed", docId: "gone" })
		);
	});

	it("shows a name that exists only in a journal record", async () => {
		const platform = createMemoryPlatform();
		await store(platform, { ...blankDashboard(clock()()), id: "d", name: "Old name" }, "d");
		platform.journal.write(SPACE, "d", "t1", {
			baseVersion: 1,
			changes: [{ op: "setField", target: { path: "name" }, from: "Old name", to: "New name" }],
			schemaVersion: 1,
			writtenAt: "2026-10-20T12:00:00.000Z"
		});
		const index = new DashboardIndex({ platform, space: SPACE });
		await index.refresh();
		expect(index.names.get("d")).toBe("New name");
	});
});
