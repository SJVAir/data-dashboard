import { describe, expect, it, vi } from "vitest";
import type { Change } from "$lib/changes/types";
import { createMemoryPlatform } from "$lib/platform/memory";
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
});
