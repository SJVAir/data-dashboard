import "../../../app.css";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import { refreshEntryFiles, reloadPage } from "$lib/safety/reload";
import { updateNotice } from "$lib/safety/update-notice.svelte";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { NOW } from "$lib/sync/test-support";
import { accountApp } from "$lib/sync/test-app";
import type { SyncWorker } from "$lib/sync/worker.svelte";
import { navigate } from "../../../router";
import NoticeBars from "./NoticeBars.svelte";

vi.mock("$lib/safety/build-id", () => ({ BUILD_ID: "abc123" }));
vi.mock("$lib/safety/reload", () => ({
	refreshEntryFiles: vi.fn(async () => {}),
	reloadPage: vi.fn()
}));

const originalUrl = location.href;
const workers: SyncWorker[] = [];
afterEach(async () => {
	await navigate("/");
	updateNotice.reason = null;
	history.replaceState(null, "", originalUrl);
	for (const worker of workers.splice(0)) worker.stop();
});

test("the reload bar appears inside a live region that was already there", async () => {
	updateNotice.reason = null;
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	const view = await render(NoticeBars, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	const regions = view.container.querySelectorAll('[role="status"]');
	expect(regions.length).toBeGreaterThan(0);
	const first = regions[0];
	expect(first.textContent?.trim()).toBe("");

	updateNotice.show("new-version");
	await expect.element(page.getByText(m.update_available())).toBeVisible();
	// The same element, not one mounted with the text.
	expect(view.container.querySelector('[role="status"]')).toBe(first);
	expect(first.textContent).toContain(m.update_available());
});

test("a blocked build says saving stopped, with Reload", async () => {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	await render(NoticeBars, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	updateNotice.show("build-blocked");
	await expect.element(page.getByText(m.update_build_blocked())).toBeVisible();
	await expect.element(page.getByRole("button", { name: m.update_reload() })).toBeVisible();
});

test("reload refreshes the cached entry files before reloading the page", async () => {
	const staticBase = new URL("https://s.example/static/workspace/");
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1",
		staticBase
	});
	const order: string[] = [];
	vi.mocked(refreshEntryFiles).mockImplementationOnce(async () => {
		order.push("refresh");
	});
	vi.mocked(reloadPage).mockImplementationOnce(() => {
		order.push("reload");
	});
	await render(NoticeBars, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	updateNotice.show("new-version");
	await page.getByRole("button", { name: m.update_reload() }).click();
	await vi.waitFor(() => expect(order).toEqual(["refresh", "reload"]));
	expect(refreshEntryFiles).toHaveBeenCalledWith(staticBase);
});

test("the offline bar shows while the platform is offline and hides when it is back", async () => {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	await render(NoticeBars, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect.element(page.getByText(m.offline_notice())).not.toBeInTheDocument();

	platform.online.setOnline(false);
	await expect.element(page.getByText(m.offline_notice())).toBeVisible();

	platform.online.setOnline(true);
	await expect.element(page.getByText(m.offline_notice())).not.toBeInTheDocument();
});

test("the notice bar shows while a dashboard is held and leaves once it uploads", async () => {
	const { app, refuseSaves, worker } = await accountApp(["d1", "d2", "d3"]);
	workers.push(worker);
	refuseSaves.push(
		{ code: "too_large", status: 413 },
		{ code: "too_large", status: 413 },
		{ code: "limit_documents", status: 403 }
	);
	const view = await render(NoticeBars, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	worker.start();
	await expect
		.poll(() => Object.values(worker.states).filter((s) => s.state === "held").length)
		.toBe(3);
	await expect
		.element(
			page.getByText(
				"2 dashboards are too large to save to your account, so they're only on this device."
			)
		)
		.toBeVisible();
	await expect
		.element(page.getByText(m.sync_held_limit_documents({ count: "1", countValue: 1 })))
		.toBeVisible();
	const link = page.getByRole("link", { name: m.sync_held_link() });
	await expect.element(link).toHaveAttribute("href", "/workspace/dashboards");
	// Not dismissable: the affected dashboards aren't in the account until it's fixed.
	expect(page.getByRole("button", { name: m.reminder_not_now() }).query()).toBeNull();
	const results = await axe.run(view.container);
	expect(results.violations).toEqual([]);

	await worker.syncAll();
	await expect.poll(() => worker.states.d1?.state).toBe("synced");
	await expect.element(link).not.toBeInTheDocument();
});

test("a refused hold on a deleted dashboard isn't counted", async () => {
	const { app, worker, refuseSaves } = await accountApp(["d1", "d2"]);
	workers.push(worker);
	refuseSaves.push({ code: "too_large", status: 413 }, { code: "too_large", status: 413 });
	await render(NoticeBars, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	worker.start();
	await expect
		.poll(() => Object.values(worker.states).filter((s) => s.state === "held").length)
		.toBe(2);
	await expect
		.element(
			page.getByText(
				"2 dashboards are too large to save to your account, so they're only on this device."
			)
		)
		.toBeVisible();
	const summary = (id: string) => ({
		id,
		name: null,
		createdAt: NOW.toISOString(),
		updatedAt: NOW.toISOString(),
		deletedAt: NOW.toISOString()
	});
	app.index.deleted = [summary("d1")];
	await expect
		.element(
			page.getByText(
				"A dashboard is too large to save to your account, so it's only on this device."
			)
		)
		.toBeVisible();
	app.index.deleted = [summary("d1"), summary("d2")];
	await expect
		.element(page.getByRole("link", { name: m.sync_held_link() }))
		.not.toBeInTheDocument();
	expect(page.getByText("too large to save", { exact: false }).query()).toBeNull();
});

test("on the dashboards list the held bar has no link to it", async () => {
	const { app, worker, refuseSaves } = await accountApp(["d1"]);
	workers.push(worker);
	refuseSaves.push({ code: "too_large", status: 413 });
	await navigate("/dashboards");
	await render(NoticeBars, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	worker.start();
	await expect.element(page.getByText("too large to save", { exact: false })).toBeVisible();
	expect(page.getByRole("link", { name: m.sync_held_link() }).query()).toBeNull();
});

test("a blocked build shows no held notice", async () => {
	const { app, fake, worker } = await accountApp();
	workers.push(worker);
	fake.blockedBuilds.add("test-build");
	await render(NoticeBars, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	worker.start();
	await expect.poll(() => worker.blocked).toBe(true);
	expect(page.getByRole("link", { name: m.sync_held_link() }).query()).toBeNull();
});

/** A dashboard made months ago in unprotected storage, open at the dashboard route. */
async function reminderApp() {
	const identity = createMemoryIdentity({ state: "signed-out" });
	const platform = createMemoryPlatform({ identity });
	platform.persistence.set("unprotected", false);
	const app = await initApp(platform, {
		channel: createMemoryTabHub().channel(),
		tabId: "t1",
		now: () => new Date("2026-01-01T20:00:00.000Z"),
		loadSync: null
	});
	await app.index.createBlank();
	history.replaceState(null, "", "/workspace/");
	return app;
}

test("the anonymous reminder offers sign-in", async () => {
	const app = await reminderApp();
	await render(NoticeBars, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect.element(page.getByText(m.reminder_text())).toBeVisible();
	const signIn = page.getByRole("link", { name: "Sign in to keep this safe everywhere" });
	await expect.element(signIn).toBeVisible();
	// The return path follows the router (tested with the account menu).
	expect(signIn.element().getAttribute("href")).toMatch(/^\/account\/login\/\?next=/);
});

test("no reminder in an account space", async () => {
	// Everything else would show it: unprotected storage, a dashboard from an earlier day.
	const { app, platform, worker } = await accountApp();
	workers.push(worker);
	platform.persistence.set("unprotected", false);
	await app.protection.refresh();
	history.replaceState(null, "", "/workspace/");
	await render(NoticeBars, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(page.getByText(m.reminder_text()).query()).toBeNull();
});
