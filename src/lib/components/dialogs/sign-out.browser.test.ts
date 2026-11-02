import "../../../app.css";
import axe from "axe-core";
import { mount, unmount } from "svelte";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import TopNav from "$lib/components/shell/TopNav.svelte";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp, type AppContext } from "$lib/store/app.svelte";
import { keepInSpace } from "$lib/store/space-switch";
import { HIDDEN_KEY } from "$lib/store/spaces";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import type { RemoteDocuments } from "$lib/sync/remote";
import { createFakeRemote, type FakeRemote } from "$lib/sync/remote-fake";
import { ACCOUNT, SPACE, makeDoc, user } from "$lib/sync/test-support";
import { SyncWorker } from "$lib/sync/worker.svelte";

const workers: SyncWorker[] = [];
afterEach(() => {
	for (const worker of workers.splice(0)) worker.stop();
});

/**
 * A signed-in app, offline, holding `count` dashboards never uploaded. `remote` wraps the fake
 * server the worker uses.
 */
async function withUnsynced(
	count: number,
	remote: (fake: FakeRemote) => RemoteDocuments = (fake) => fake
) {
	const identity = createMemoryIdentity({ state: "signed-in", user: user(ACCOUNT) });
	const platform = createMemoryPlatform({ identity });
	for (let i = 0; i < count; i++) {
		const doc = makeDoc(`d${i}`);
		await platform.documents.commit(SPACE, { docId: doc.id, baseVersion: null, doc, entries: [] });
	}
	const app = await initApp(platform, {
		channel: createMemoryTabHub().channel(),
		tabId: "t1",
		loadSync: null
	});
	const fake = createFakeRemote({ accountId: ACCOUNT });
	fake.offline = true;
	const worker = new SyncWorker({
		platform,
		space: SPACE,
		accountId: ACCOUNT,
		remote: remote(fake),
		channel: app.channel,
		tabId: app.tabId,
		buildId: "test-build",
		now: () => new Date()
	});
	workers.push(worker);
	app.sync = worker;
	worker.start();
	const view = await render(TopNav, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	return { app, platform, identity, fake, view };
}

const trigger = () => page.getByRole("button", { name: /account menu/ });

/** Opens the account menu from the keyboard and chooses Sign out. */
async function chooseSignOut() {
	trigger().element().focus();
	await userEvent.keyboard("{Enter}");
	await page.getByRole("menuitem", { name: "Sign out" }).click();
}

async function expectNoAxeViolations() {
	// After the open animation: mid-fade, the text's contrast is measured too low.
	const dialog = page.getByRole("dialog").element();
	await Promise.all(dialog.getAnimations({ subtree: true }).map((a) => a.finished));
	const results = await axe.run(dialog);
	expect(results.violations).toEqual([]);
}

test("unsynced: the dialog shows the count", async () => {
	const one = await withUnsynced(1);
	await chooseSignOut();
	const dialog = page.getByRole("dialog", { name: "Some changes aren't in your account yet" });
	await expect
		.element(dialog.getByText("1 dashboard has changes not yet saved to your account."))
		.toBeVisible();
	await expect
		.element(dialog.getByRole("button", { name: "Finish saving, then sign out" }))
		.toBeVisible();
	await expect.element(dialog.getByRole("button", { name: "Sign out anyway" })).toBeVisible();
	await expectNoAxeViolations();
	expect(one.identity.current().state).toBe("signed-in");
	await userEvent.keyboard("{Escape}");
	await expect.element(dialog).not.toBeInTheDocument();
	await one.view.unmount();

	await withUnsynced(3);
	await chooseSignOut();
	await expect
		.element(dialog.getByText("3 dashboards have changes not yet saved to your account."))
		.toBeVisible();
	await expectNoAxeViolations();
});

test("closing the dialog keeps you signed in, with focus back on the account menu", async () => {
	const { identity, platform } = await withUnsynced(2);
	await chooseSignOut();
	const dialog = page.getByRole("dialog");
	await expect.element(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect.element(dialog).not.toBeInTheDocument();
	// WCAG 2.4.3: back on the control that opened it, not <body>.
	await expect.element(trigger()).toHaveFocus();
	expect(identity.current().state).toBe("signed-in");
	expect(await platform.preferences.get(SPACE, HIDDEN_KEY)).toBeUndefined();
});

test("finish saving offline stays signed in and says so", async () => {
	const { identity } = await withUnsynced(1);
	await chooseSignOut();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Finish saving, then sign out" }).click();
	await expect
		.element(
			dialog.getByText(
				"Some changes couldn't be saved to your account yet. Check your connection and try again."
			)
		)
		.toBeVisible();
	expect(identity.current().state).toBe("signed-in");
	await expectNoAxeViolations();
});

test("finish saving signs out once everything is up", async () => {
	const { identity, fake } = await withUnsynced(1);
	await chooseSignOut();
	const dialog = page.getByRole("dialog");
	fake.offline = false;
	await dialog.getByRole("button", { name: "Finish saving, then sign out" }).click();
	await expect.poll(() => identity.current().state).toBe("signed-out");
	await expect.element(dialog).not.toBeInTheDocument();
	await expect.element(page.getByRole("link", { name: "Sign in" })).toHaveFocus();
});

test("sign out anyway moves focus to Sign in", async () => {
	const { identity, platform } = await withUnsynced(1);
	await chooseSignOut();
	await page.getByRole("button", { name: "Sign out anyway" }).click();
	await expect.poll(() => identity.current().state).toBe("signed-out");
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	// The account menu that opened it is gone; focus lands on Sign in (WCAG 2.4.3).
	await expect.element(page.getByRole("link", { name: "Sign in" })).toHaveFocus();
	expect(await platform.preferences.get(SPACE, HIDDEN_KEY)).toMatchObject({
		reason: "signed-out"
	});
});

test("Escape and an outside click don't close it while saving", async () => {
	let release!: () => void;
	const held = new Promise<void>((resolve) => (release = resolve));
	const { identity, fake } = await withUnsynced(1, (fake) => ({
		...fake,
		async save(id, input) {
			await held;
			return fake.save(id, input);
		}
	}));
	await chooseSignOut();
	const dialog = page.getByRole("dialog");
	fake.offline = false;
	await dialog.getByRole("button", { name: "Finish saving, then sign out" }).click();
	await userEvent.keyboard("{Escape}");
	await userEvent.click(document.body, { position: { x: 2, y: 2 } });
	await new Promise((resolve) => setTimeout(resolve, 50));
	await expect.element(dialog).toBeVisible();
	release();
	await expect.poll(() => identity.current().state).toBe("signed-out");
	await expect.element(dialog).not.toBeInTheDocument();
});

test("finish saving with a refused dashboard points to the dashboards list", async () => {
	const { identity, fake } = await withUnsynced(1, (fake) => {
		fake.offline = false;
		fake.maxDocuments = 0;
		return fake;
	});
	await expect.poll(() => fake.requests.length).toBeGreaterThan(0);
	await chooseSignOut();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Finish saving, then sign out" }).click();
	await expect
		.element(
			dialog.getByText(
				"Some dashboards can't be saved to your account. The dashboards list shows why."
			)
		)
		.toBeVisible();
	expect(identity.current().state).toBe("signed-in");
});

test("finish saving with this version blocked says to reload", async () => {
	const { identity } = await withUnsynced(1, (fake) => {
		fake.offline = false;
		fake.blockedBuilds.add("test-build");
		return fake;
	});
	await chooseSignOut();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Finish saving, then sign out" }).click();
	await expect
		.element(
			dialog.getByText(
				"This version of the app can't save to your account. Reload the page, then try again."
			)
		)
		.toBeVisible();
	expect(identity.current().state).toBe("signed-in");
});

test("after signing out, focus lands on Sign in in the new app", async () => {
	// The real loop from main.ts: each switch unmounts the app, opens the new space, and mounts it.
	const identity = createMemoryIdentity({ state: "signed-in", user: user(ACCOUNT) });
	const platform = createMemoryPlatform({ identity });
	const hub = createMemoryTabHub();
	const open = () => initApp(platform, { channel: hub.channel(), tabId: "t1", loadSync: null });
	const target = document.body.appendChild(document.createElement("div"));
	let component: ReturnType<typeof mount> | undefined;
	const show = (app: AppContext) => {
		component = mount(TopNav, { target, context: new Map([[APP_CONTEXT_KEY, app]]) });
	};
	const first = await open();
	show(first);
	const kept = keepInSpace(first, {
		open,
		mount: show,
		unmount: () => {
			if (component) void unmount(component);
			component = undefined;
		}
	});
	try {
		await chooseSignOut();
		await expect.poll(() => kept.app.space).toBe("anonymous");
		await expect.poll(() => kept.app !== first).toBe(true);
		await expect.element(page.getByRole("link", { name: "Sign in" })).toHaveFocus();
	} finally {
		kept.stop();
		if (component) await unmount(component);
		target.remove();
		await kept.app.close();
	}
});
