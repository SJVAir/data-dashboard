import { describe, expect, it, vi } from "vitest";
import type { Change } from "$lib/changes/types";
import { createMemoryPlatform } from "$lib/platform/memory";
import { updateNotice } from "$lib/safety/update-notice.svelte";
import { STARTER_ID } from "$lib/starter/starter";
import { getWidgetType } from "$lib/widgets/registry";
import { LAST_OPENED_KEY, homeTarget, initApp } from "./app.svelte";
import { createMemoryTabHub } from "./tab-channel";

const rename: Change = { op: "setField", target: { path: "name" }, from: null, to: "Home" };

async function setup() {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	return { platform, app };
}

describe("initApp", () => {
	it("registers the placeholder type and opens the starter when nothing is stored", async () => {
		const { app } = await setup();
		expect(getWidgetType("placeholder")).toBeDefined();
		expect(app.space).toBe("anonymous");
		expect(await homeTarget(app)).toEqual({ kind: "starter" });
		const starter = await app.sessions.get(STARTER_ID);
		expect(starter?.doc.id).toBe(STARTER_ID);
		expect(await app.sessions.get(STARTER_ID)).toBe(starter);
	});

	it("the starter's first edit replaces the current session with the stored copy", async () => {
		const { platform, app } = await setup();
		const starter = (await app.sessions.get(STARTER_ID))!;
		app.current = { session: starter, isStarter: true };
		starter.apply(rename);
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));

		const copy = app.current.session!;
		expect(copy.doc.name).toBe("Home");
		expect(await app.sessions.get(copy.doc.id)).toBe(copy);
		expect(await platform.preferences.get(app.space, LAST_OPENED_KEY)).toBe(copy.doc.id);
		await vi.waitFor(() => expect(app.index.names.get(copy.doc.id)).toBe("Home"));
		expect(await homeTarget(app)).toEqual({ kind: "dashboard", id: copy.doc.id });
		// The next visit to the starter gets a fresh one.
		expect((await app.sessions.get(STARTER_ID))?.doc.name).toBeNull();
	});

	it("opening a dashboard records it as last opened; unknown ids give null", async () => {
		const { platform, app } = await setup();
		const a = await app.index.createBlank();
		const b = await app.index.createBlank();
		expect(await app.sessions.get("missing")).toBeNull();
		await app.sessions.get(a);
		expect(await homeTarget(app)).toEqual({ kind: "dashboard", id: a });
		await app.sessions.get(b);
		expect(await platform.preferences.get(app.space, LAST_OPENED_KEY)).toBe(b);
	});

	it("the index picks up this tab's own saves", async () => {
		const { app } = await setup();
		const id = await app.index.createBlank();
		const session = (await app.sessions.get(id))!;
		session.apply(rename);
		await session.flush();
		await vi.waitFor(() => expect(app.index.names.get(id)).toBe("Home"));
	});

	it("resetAfterClear discards sessions and empties the index", async () => {
		const { platform, app } = await setup();
		const id = await app.index.createBlank();
		const session = (await app.sessions.get(id))!;
		app.current = { session, isStarter: false };
		const commit = vi.spyOn(platform.documents, "commit");
		session.apply(rename);
		await platform.reset.clearAll();
		const before = app.resetCount;

		await app.resetAfterClear();
		expect(app.resetCount).toBe(before + 1);
		expect(app.current).toEqual({ session: null, isStarter: false });
		expect(app.index.items).toEqual([]);
		// The discarded session saves and journals nothing.
		await session.flush();
		await new Promise((resolve) => setTimeout(resolve, 600));
		expect(commit).not.toHaveBeenCalled();
		expect(platform.journal.list(app.space)).toEqual([]);
		// Opening again starts fresh.
		expect(await app.sessions.get(id)).toBeNull();
		expect(await homeTarget(app)).toEqual({ kind: "starter" });
	});

	it("suspendAll journals every open session and stops their saves", async () => {
		const { platform, app } = await setup();
		const id = await app.index.createBlank();
		const session = (await app.sessions.get(id))!;
		const commit = vi.spyOn(platform.documents, "commit");
		session.apply(rename);
		app.suspendAll();
		expect(platform.journal.readAll(app.space, id)).toHaveLength(1);
		await session.flush();
		expect(commit).not.toHaveBeenCalled();
	});

	it("a session that finds data cleared elsewhere resets the app", async () => {
		const { platform, app } = await setup();
		const id = await app.index.createBlank();
		const session = (await app.sessions.get(id))!;
		app.current = { session, isStarter: false };
		const before = app.resetCount;
		await platform.reset.clearAll();
		session.apply(rename);
		await session.flush();
		await vi.waitFor(() => expect(app.resetCount).toBe(before + 1));
		expect(app.current).toEqual({ session: null, isStarter: false });
	});

	it("a session that finds newer data shows the reload notice and suspends every session", async () => {
		const { platform, app } = await setup();
		const [a, b] = [await app.index.createBlank(), await app.index.createBlank()];
		const first = (await app.sessions.get(a))!;
		const second = (await app.sessions.get(b))!;
		// A newer version of the app saved the first one.
		const doc = { ...first.doc, schemaVersion: first.doc.schemaVersion + 1, version: 1 };
		await platform.documents.commit(app.space, { docId: a, baseVersion: 0, doc, entries: [] });
		const commit = vi.spyOn(platform.documents, "commit");
		second.apply(rename);
		first.apply(rename);
		await first.flush();
		expect(updateNotice.reason).toBe("newer-data");
		await second.flush();
		// Only the first session's refused commit got through.
		expect(commit).toHaveBeenCalledTimes(1);
		expect(platform.journal.readAll(app.space, b)).toHaveLength(1);
	});
});
