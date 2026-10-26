import { describe, expect, it, vi } from "vitest";
import type { Change } from "$lib/changes/types";
import { createMemoryPlatform } from "$lib/platform/memory";
import { initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { clearMyData } from "./clear";

const rename: Change = { op: "setField", target: { path: "name" }, from: null, to: "Home" };

describe("clearMyData", () => {
	it("empties both tabs and saves nothing that was pending in the other one", async () => {
		const platform = createMemoryPlatform();
		const hub = createMemoryTabHub();
		const a = await initApp(platform, { channel: hub.channel(), tabId: "a" });
		const b = await initApp(platform, { channel: hub.channel(), tabId: "b" });
		const id = await a.index.createBlank();
		await vi.waitFor(() => expect(b.index.items).toHaveLength(1));
		const session = (await b.sessions.get(id))!;
		b.current = { session, isStarter: false };
		const commit = vi.spyOn(platform.documents, "commit");
		session.apply(rename);

		await clearMyData(a);
		await vi.waitFor(() => expect(b.current.session).toBeNull());
		expect(a.current).toEqual({ session: null, isStarter: false });
		expect(a.index.items).toEqual([]);
		expect(b.index.items).toEqual([]);

		await session.flush();
		await new Promise((resolve) => setTimeout(resolve, 600));
		expect(commit).not.toHaveBeenCalled();
		expect(platform.journal.list(a.space)).toEqual([]);
		expect(await platform.documents.list(a.space)).toEqual([]);
	});
});
