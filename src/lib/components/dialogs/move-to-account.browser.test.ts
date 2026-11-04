import "../../../app.css";
import axe from "axe-core";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import type { Platform } from "$lib/platform/types";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { MOVE_OFFER_KEY } from "$lib/sync/move-to-account";
import { ACCOUNT, SPACE, makeDoc, user } from "$lib/sync/test-support";
import MoveToAccountDialog from "./MoveToAccountDialog.svelte";
import { animationsSettled } from "../../../test/animations";

/** A signed-in app whose browser holds `count` signed-out dashboards. */
async function withAnonymous(count: number) {
	const platform: Platform = createMemoryPlatform({
		identity: createMemoryIdentity({ state: "signed-in", user: user(ACCOUNT) })
	});
	for (let i = 0; i < count; i++) {
		const doc = makeDoc(`a${i}`);
		await platform.documents.commit("anonymous", {
			docId: doc.id,
			baseVersion: null,
			doc,
			entries: []
		});
	}
	const app = await initApp(platform, {
		channel: createMemoryTabHub().channel(),
		tabId: "t1",
		loadSync: null
	});
	return { app, platform };
}

async function expectNoAxeViolations() {
	// After the open animation: mid-fade, the text's contrast is measured too low.
	const dialog = page.getByRole("dialog").element();
	await animationsSettled(dialog);
	const results = await axe.run(dialog);
	expect(results.violations).toEqual([]);
}

test("the question counts dashboards in words", async () => {
	const one = await withAnonymous(1);
	const first = await render(MoveToAccountDialog, {
		context: new Map([[APP_CONTEXT_KEY, one.app]])
	});
	const dialog = page.getByRole("dialog", { name: "Dashboards on this browser" });
	await expect
		.element(dialog.getByText("Add the dashboard made on this browser to your account?"))
		.toBeVisible();
	await expect
		.element(
			dialog.getByText("Your account keeps it and opens it on your other devices.", {
				exact: false
			})
		)
		.toBeVisible();
	await expect.element(dialog.getByRole("button", { name: "Add to my account" })).toBeVisible();
	await expect.element(dialog.getByRole("button", { name: "Keep on this browser" })).toBeVisible();
	await expectNoAxeViolations();
	await first.unmount();

	const many = await withAnonymous(3);
	await render(MoveToAccountDialog, { context: new Map([[APP_CONTEXT_KEY, many.app]]) });
	await expect
		.element(dialog.getByText("Add the 3 dashboards made on this browser to your account?"))
		.toBeVisible();
	await expect
		.element(
			dialog.getByText("Your account keeps them and opens them on your other devices.", {
				exact: false
			})
		)
		.toBeVisible();
	await expectNoAxeViolations();

	await dialog.getByRole("button", { name: "Add to my account" }).click();
	await expect.element(dialog).not.toBeInTheDocument();
	await expect.poll(async () => (await many.platform.documents.list(SPACE)).length).toBe(3);
	expect(await many.platform.preferences.get(SPACE, MOVE_OFFER_KEY)).toBe("yes");
});

test("Escape dismisses it without an answer", async () => {
	const { app, platform } = await withAnonymous(2);
	await render(MoveToAccountDialog, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	const dialog = page.getByRole("dialog");
	await expect.element(dialog).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await expect.element(dialog).not.toBeInTheDocument();
	expect(await platform.preferences.get(SPACE, MOVE_OFFER_KEY)).toBeUndefined();
	expect(await platform.documents.list("anonymous")).toHaveLength(2);
});

test("no keeps them here and stores the answer", async () => {
	const { app, platform } = await withAnonymous(2);
	await render(MoveToAccountDialog, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await page.getByRole("button", { name: "Keep on this browser" }).click();
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	await expect.poll(() => platform.preferences.get(SPACE, MOVE_OFFER_KEY)).toBe("no");
	expect(await platform.documents.list("anonymous")).toHaveLength(2);
});

test("not asked in the anonymous space", async () => {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, {
		channel: createMemoryTabHub().channel(),
		tabId: "t1",
		loadSync: null
	});
	await render(MoveToAccountDialog, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(page.getByRole("dialog").query()).toBeNull();
});

test("the failure message counts the dashboards too", () => {
	expect(m.move_offer_failed({ count: 1 })).toBe(
		"Couldn't add the dashboard to your account. You'll be asked again next time."
	);
	expect(m.move_offer_failed({ count: 2 })).toBe(
		"Couldn't add the dashboards to your account. You'll be asked again next time."
	);
});
