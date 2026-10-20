import { describe, expect, it, vi } from "vitest";
import type { Change } from "$lib/changes/types";
import type { DashboardSummary } from "$lib/documents/names";
import { DashboardSchema, type Dashboard } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { SpaceId } from "$lib/platform/types";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import {
	STARTER_ID,
	blankDashboard,
	copyOfStarter,
	duplicateDashboard,
	resolveHome,
	starterDashboard,
	starterSession
} from "./starter";

const SPACE: SpaceId = "anonymous";
const NOW = new Date("2026-10-21T12:00:00.000Z");

function summary(overrides: Partial<DashboardSummary> & { id: string }): DashboardSummary {
	return {
		name: null,
		createdAt: "2026-10-20T00:00:00Z",
		updatedAt: "2026-10-20T00:00:00Z",
		...overrides
	};
}

const renameWidget = (widgetId: string, to: string): Change => ({
	op: "setField",
	target: { widgetId, path: "title" },
	from: null,
	to
});

describe("starter dashboard", () => {
	it("starter is schema-valid and has three placeholders", () => {
		const starter = starterDashboard();
		expect(DashboardSchema.safeParse(starter).success).toBe(true);
		expect(starter.id).toBe(STARTER_ID);
		expect(starter.name).toBeNull();
		expect(starter.version).toBe(0);
		expect(starter.body.widgets.map((w) => [w.id, w.type, w.title, w.rect])).toEqual([
			["starter-1", "placeholder", null, { x: 0, y: 0, w: 6, h: 4 }],
			["starter-2", "placeholder", null, { x: 6, y: 0, w: 6, h: 4 }],
			["starter-3", "placeholder", null, { x: 0, y: 4, w: 12, h: 4 }]
		]);
	});

	it("returns a fresh object each time", () => {
		const a = starterDashboard();
		a.body.widgets.pop();
		expect(starterDashboard().body.widgets).toHaveLength(3);
	});

	it("copies, blanks, and duplicates are schema-valid new documents", () => {
		const copy = copyOfStarter(NOW);
		expect(copy.id).not.toBe(STARTER_ID);
		expect(copy).toMatchObject({
			copiedFrom: STARTER_ID,
			name: null,
			version: 0,
			createdAt: NOW.toISOString(),
			updatedAt: NOW.toISOString()
		});
		expect(copy.body.widgets).toHaveLength(3);

		const blank = blankDashboard(NOW);
		expect(blank.body.widgets).toEqual([]);
		expect(blank.copiedFrom).toBeUndefined();

		const source: Dashboard = { ...copy, name: "School", version: 7 };
		const dup = duplicateDashboard(source, NOW);
		expect(dup.id).not.toBe(source.id);
		expect(dup).toMatchObject({ name: "School", copiedFrom: source.id, version: 0 });
		expect(dup.deletedAt).toBeUndefined();

		for (const doc of [copy, blank, dup]) expect(DashboardSchema.safeParse(doc).success).toBe(true);
	});
});

describe("resolveHome", () => {
	it("no dashboards → starter", () => {
		expect(resolveHome([], undefined)).toEqual({ kind: "starter" });
		expect(resolveHome([], "gone")).toEqual({ kind: "starter" });
	});

	it("last-opened wins", () => {
		const summaries = [
			summary({ id: "a", updatedAt: "2026-10-20T01:00:00Z" }),
			summary({ id: "b", updatedAt: "2026-10-20T05:00:00Z" })
		];
		expect(resolveHome(summaries, "a")).toEqual({ kind: "dashboard", id: "a" });
	});

	it("deleted last-opened falls back to most recently updated", () => {
		const summaries = [
			summary({ id: "a", updatedAt: "2026-10-20T09:00:00Z", deletedAt: "2026-10-20T09:00:00Z" }),
			summary({ id: "b", updatedAt: "2026-10-20T05:00:00Z" }),
			summary({ id: "c", updatedAt: "2026-10-20T01:00:00Z" })
		];
		expect(resolveHome(summaries, "a")).toEqual({ kind: "dashboard", id: "b" });
	});

	it("missing last-opened falls back", () => {
		const summaries = [
			summary({ id: "a", updatedAt: "2026-10-20T01:00:00Z" }),
			summary({ id: "b", updatedAt: "2026-10-20T05:00:00Z" })
		];
		expect(resolveHome(summaries, "gone")).toEqual({ kind: "dashboard", id: "b" });
		expect(resolveHome(summaries, undefined)).toEqual({ kind: "dashboard", id: "b" });
	});

	it("all deleted → starter", () => {
		const summaries = [
			summary({ id: "a", deletedAt: "2026-10-20T09:00:00Z" }),
			summary({ id: "b", deletedAt: "2026-10-20T09:00:00Z" })
		];
		expect(resolveHome(summaries, "a")).toEqual({ kind: "starter" });
	});
});

describe("starterSession", () => {
	async function setup() {
		const platform = createMemoryPlatform();
		const copies: string[] = [];
		const starter = starterSession({
			platform,
			space: SPACE,
			tabId: "tab-1",
			now: () => NOW,
			onCopied: (session) => copies.push(session.doc.id)
		});
		starter.apply(renameWidget("starter-1", "Fresno"));
		await vi.waitFor(() => expect(copies).toHaveLength(1));
		return { platform, starter, copies };
	}

	it("first edit of the starter creates a stored copy with copiedFrom starter and the edit applied", async () => {
		const { platform, copies } = await setup();
		const stored = (await platform.documents.get(SPACE, copies[0])) as Dashboard;
		expect(stored.copiedFrom).toBe(STARTER_ID);
		expect(stored.name).toBeNull();
		expect(stored.body.widgets[0].title).toBe("Fresno");
		expect(await platform.documents.list(SPACE)).toHaveLength(1);
	});

	it("the starter stays unchanged", async () => {
		const { platform, starter } = await setup();
		expect(starter.doc).toEqual(starterDashboard());
		expect(await platform.documents.get(SPACE, STARTER_ID)).toBeUndefined();
	});

	it("later edits go to the copy", async () => {
		const { platform, starter, copies } = await setup();
		starter.apply(renameWidget("starter-2", "Visalia"));
		await vi.waitFor(async () => {
			const stored = (await platform.documents.get(SPACE, copies[0])) as Dashboard;
			expect(stored.body.widgets[1].title).toBe("Visalia");
		});
		expect(copies).toHaveLength(1);
	});

	it("undo after the copy reverts the edit but the copy remains", async () => {
		const platform = createMemoryPlatform();
		const copied: { session?: DocumentSession } = {};
		const starter = starterSession({
			platform,
			space: SPACE,
			tabId: "tab-1",
			now: () => NOW,
			onCopied: (session) => (copied.session = session)
		});
		starter.apply(renameWidget("starter-1", "Fresno"));
		await vi.waitFor(() => expect(copied.session).toBeDefined());
		const session = copied.session!;
		expect(session.canUndo).toBe(true);
		session.undo();
		await session.flush();
		const stored = (await platform.documents.get(SPACE, session.doc.id)) as Dashboard;
		expect(stored.body.widgets[0].title).toBeNull();
		expect(stored.copiedFrom).toBe(STARTER_ID);
	});
});
