import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp, type AppContext } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { saveFields } from "$lib/sync/merge";
import { createFakeRemote } from "$lib/sync/remote-fake";
import { ACCOUNT, SPACE, makeDoc, user } from "$lib/sync/test-support";
import { SyncWorker } from "$lib/sync/worker.svelte";
import { navigate } from "../router";
import DashboardPage from "./DashboardPage.svelte";

const originalUrl = location.href;
const apps: AppContext[] = [];
afterEach(async () => {
	history.replaceState(null, "", originalUrl);
	for (const app of apps.splice(0)) await app.close();
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

test("a dashboard from another device opens by its link", async () => {
	const identity = createMemoryIdentity({ state: "signed-in", user: user(ACCOUNT) });
	const fake = createFakeRemote({ accountId: ACCOUNT });
	const app = await initApp(createMemoryPlatform({ identity }), {
		channel: createMemoryTabHub().channel(),
		loadSync: async (ctx) => new SyncWorker({ ...ctx, remote: fake })
	});
	apps.push(app);
	// Saved on another device after this tab's first poll.
	await expect.poll(() => fake.requests.length).toBeGreaterThan(0);
	await fake.save("d9", {
		...saveFields({ ...makeDoc("d9"), name: "From the laptop" }),
		baseVersion: null,
		changes: [],
		accountId: ACCOUNT,
		buildId: "other-build",
		snapshot: null
	});
	expect(await app.platform.documents.get(SPACE, "d9")).toBeUndefined();

	await navigate("/dashboards/:id", { params: { id: "d9" } });
	await render(DashboardPage, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect.poll(() => app.current.session?.doc.id).toBe("d9");
	await expect.poll(() => document.title).toContain("From the laptop");

	// Not on the server either: the usual message.
	await navigate("/dashboards/:id", { params: { id: "nowhere" } });
	await expect
		.element(page.getByRole("heading", { name: "This dashboard isn't saved in this browser." }))
		.toBeVisible();
});
