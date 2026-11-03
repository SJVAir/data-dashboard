import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import {
	APP_CONTEXT_KEY,
	currentDashboardName,
	initApp,
	type AppContext
} from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { saveFields } from "$lib/sync/merge";
import { answerMoveOffer } from "$lib/sync/move-to-account";
import { createFakeRemote } from "$lib/sync/remote-fake";
import { ACCOUNT, SPACE, makeDoc, storeDoc, user } from "$lib/sync/test-support";
import { SyncWorker } from "$lib/sync/worker.svelte";
import { m } from "$lib/paraglide/messages.js";
import { updateNotice } from "$lib/safety/update-notice.svelte";
import { accountApp } from "$lib/sync/test-app";
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

test("a dashboard fetched by its link gets its display name from the list", async () => {
	const identity = createMemoryIdentity({ state: "signed-in", user: user(ACCOUNT) });
	const fake = createFakeRemote({ accountId: ACCOUNT });
	const platform = createMemoryPlatform({ identity });
	await storeDoc(platform, makeDoc("d1"));
	const app = await initApp(platform, {
		channel: createMemoryTabHub().channel(),
		loadSync: async (ctx) => new SyncWorker({ ...ctx, remote: fake })
	});
	apps.push(app);
	await expect.poll(() => fake.requests.length).toBeGreaterThan(0);
	// Untitled, made after d1 on another device: the second untitled dashboard.
	await fake.save("d9", {
		...saveFields({ ...makeDoc("d9"), createdAt: "2026-11-02T00:00:00.000Z" }),
		baseVersion: null,
		changes: [],
		accountId: ACCOUNT,
		buildId: "other-build",
		snapshot: null
	});

	await navigate("/dashboards/:id", { params: { id: "d9" } });
	await render(DashboardPage, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect.poll(() => app.current.session?.doc.id).toBe("d9");
	await expect.poll(() => document.title).toContain("Untitled dashboard 2");
});

test("clearing the name shows the generated name at once, before the autosave", async () => {
	const app = await initApp(createMemoryPlatform(), { channel: createMemoryTabHub().channel() });
	apps.push(app);
	await app.index.createBlank();
	// Untitled names are numbered by creation time, so keep the two apart.
	await new Promise((resolve) => setTimeout(resolve, 5));
	const id = await app.index.createBlank();
	await navigate("/dashboards/:id", { params: { id } });
	await render(DashboardPage, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect.poll(() => app.current.session?.doc.id).toBe(id);
	const session = app.current.session!;
	const generated = app.index.names.get(id)!;
	expect(generated).toBe("Untitled dashboard 2");
	session.apply({ op: "setField", target: { path: "name" }, from: null, to: "Named" });
	await session.flush();
	await expect.poll(() => app.index.names.get(id)).toBe("Named");

	// As a restore of a version with no stored name does: the list still says "Named".
	session.apply({ op: "setField", target: { path: "name" }, from: "Named", to: null });
	expect(currentDashboardName(app)).toBe(generated);
	await expect.poll(() => document.title).toContain(generated);
});

test("a missing dashboard opens once it arrives (Add to my account)", async () => {
	const identity = createMemoryIdentity({ state: "signed-in", user: user(ACCOUNT) });
	const fake = createFakeRemote({ accountId: ACCOUNT });
	const platform = createMemoryPlatform({ identity });
	const doc = makeDoc("a1");
	await platform.documents.commit("anonymous", {
		docId: "a1",
		baseVersion: null,
		doc,
		entries: []
	});
	const app = await initApp(platform, {
		channel: createMemoryTabHub().channel(),
		loadSync: async (ctx) => new SyncWorker({ ...ctx, remote: fake })
	});
	apps.push(app);

	await navigate("/dashboards/:id", { params: { id: "a1" } });
	await render(DashboardPage, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	const notHere = page.getByRole("heading", {
		name: "This dashboard isn't saved in this browser."
	});
	await expect.element(notHere).toBeVisible();

	await answerMoveOffer(app, "yes");
	await expect.poll(() => app.current.session?.doc.id).toBe("a1");
	await expect.element(notHere).not.toBeInTheDocument();
});

test("a dashboard a newer build saved to the account opens read-only with Reload to edit", async () => {
	const { app, platform, worker } = await accountApp(["d1"]);
	apps.push(app);
	updateNotice.reason = null;
	try {
		worker.start();
		await expect.poll(() => worker.states.d1?.state).toBe("synced");
		await navigate("/dashboards/:id", { params: { id: "d1" } });
		await render(DashboardPage, { context: new Map([[APP_CONTEXT_KEY, app]]) });
		await expect.poll(() => app.current.session?.doc.id).toBe("d1");
		const session = app.current.session!;
		expect(session.readOnly).toBe(false);

		// A save from this tab's queue found the server's copy in a newer format.
		const record = (await platform.sync.get(SPACE, "d1"))!;
		await platform.sync.put(SPACE, { ...record, hold: { kind: "newer", schemaVersion: 2 } });
		app.channel.post({ type: "sync", space: SPACE, docId: "d1", tabId: "other" });

		await expect.poll(() => session.readOnly).toBe("newer");
		await expect.element(page.getByText(m.doc_readonly_newer())).toBeVisible();
		expect(updateNotice.reason).toBe("newer-data");
		// The hold stays for the build that can read it.
		expect((await platform.sync.get(SPACE, "d1"))?.hold?.kind).toBe("newer");
	} finally {
		worker.stop();
		updateNotice.reason = null;
	}
});
