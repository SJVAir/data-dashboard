import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { navigate } from "../router";
import DashboardPage from "./DashboardPage.svelte";

const originalUrl = location.href;
afterEach(() => {
	history.replaceState(null, "", originalUrl);
});

test("a moved dashboard stores this tab's edits and follows to the new id", async () => {
	const app = await initApp(createMemoryPlatform(), { channel: createMemoryTabHub().channel() });
	const from = await app.index.createBlank();
	const to = await app.index.createBlank();
	await navigate("/dashboards/:id", { params: { id: from } });
	await render(DashboardPage, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect.poll(() => app.current.session?.doc.id).toBe(from);
	const session = app.current.session!;
	session.apply({ op: "setField", target: { path: "name" }, from: null, to: "Late" });

	app.channel.post({ type: "moved", space: app.space, from, to, tabId: "other" });
	await expect.poll(() => location.pathname).toBe(`/workspace/dashboards/${to}`);
	const stored = (await app.platform.documents.get(app.space, from)) as { name: string | null };
	expect(stored.name).toBe("Late");
	await expect.poll(() => app.current.session?.doc.id).toBe(to);
});
