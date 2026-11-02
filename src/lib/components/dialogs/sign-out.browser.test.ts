import "../../../app.css";
import axe from "axe-core";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import TopNav from "$lib/components/shell/TopNav.svelte";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { HIDDEN_KEY } from "$lib/store/spaces";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { createFakeRemote } from "$lib/sync/remote-fake";
import { ACCOUNT, SPACE, makeDoc, user } from "$lib/sync/test-support";
import { SyncWorker } from "$lib/sync/worker.svelte";

const workers: SyncWorker[] = [];
afterEach(() => {
	for (const worker of workers.splice(0)) worker.stop();
});

/** A signed-in app, offline, holding `count` dashboards never uploaded. */
async function withUnsynced(count: number) {
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
		remote: fake,
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
	const results = await axe.run(page.getByRole("dialog").element());
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
