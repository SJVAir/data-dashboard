import "../../../app.css";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { updateNotice } from "$lib/safety/update-notice.svelte";
import { setPlatform } from "$lib/platform";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { confirmAction } from "./ConfirmDialog.svelte";
import { askExistingCopy, dialogLoaders, requested, share as shareState } from "./lazy.svelte";
import LazyHarness from "./test-harness/LazyHarness.svelte";

const URL_TEXT = "http://localhost/workspace/import#1.abcdef";

const realShareLoader = dialogLoaders.share;
const realCopyLoader = dialogLoaders.existingCopy;
/** A confirm a test left open; answered before the next test. */
let pendingConfirm: Promise<boolean> | null = null;

// The open state outlives each test's render (which is removed before the next test).
afterEach(async () => {
	if (pendingConfirm) {
		await page.getByRole("button", { name: "Cancel" }).click();
		expect(await pendingConfirm).toBe(false);
		pendingConfirm = null;
	}
	shareState.open = false;
	for (const key of Object.keys(requested) as (keyof typeof requested)[]) requested[key] = false;
	dialogLoaders.share = realShareLoader;
	dialogLoaders.existingCopy = realCopyLoader;
	updateNotice.reason = null;
});

async function setup() {
	const memory = createMemoryPlatform();
	setPlatform(memory);
	const app = await initApp(memory, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	await render(LazyHarness, {
		props: { url: URL_TEXT },
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
}

const share = () => page.getByRole("dialog", { name: "Share dashboard" });

test("the Share dialog, loaded on demand, opens on the first click with focus inside it", async () => {
	await setup();
	expect(share().elements()).toHaveLength(0);
	await page.getByRole("button", { name: "Share" }).click();
	await expect.element(share()).toBeVisible();
	await expect.poll(() => share().element().contains(document.activeElement)).toBe(true);
});

test("a confirm opens over the lazily loaded Share dialog", async () => {
	await setup();
	await page.getByRole("button", { name: "Share" }).click();
	await expect.element(share()).toBeVisible();
	pendingConfirm = confirmAction({ title: "Stop sharing?", body: "Body", confirm: "Stop" });
	const confirm = page
		.getByRole("alertdialog", { name: "Stop sharing?" })
		.or(page.getByRole("dialog", { name: "Stop sharing?" }));
	await expect.element(confirm).toBeVisible();
	// Dialogs stack in document order: the confirm comes after the Share dialog.
	const order = share().element().compareDocumentPosition(confirm.element());
	expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("Escape after the first opening returns focus to the button that opened it", async () => {
	await setup();
	const trigger = page.getByRole("button", { name: "Share" });
	await trigger.click();
	await expect.element(share()).toBeVisible();
	await expect.poll(() => share().element().contains(document.activeElement)).toBe(true);
	await userEvent.keyboard("{Escape}");
	await expect.element(share()).not.toBeInTheDocument();
	await expect.element(trigger).toHaveFocus();
});

test("a dialog whose file won't load offers a reload and leaves the app usable", async () => {
	await setup();
	dialogLoaders.share = () =>
		Promise.reject(new Error("Failed to fetch dynamically imported module"));
	await page.getByRole("button", { name: "Share" }).click();
	await expect.poll(() => updateNotice.reason).toBe("chunk-failed");
	await expect.poll(() => requested.share).toBe(false);
	expect(shareState.open).toBe(false);
	expect(share().elements()).toHaveLength(0);
	// Nothing blocks the page: the next opening tries again and works.
	dialogLoaders.share = realShareLoader;
	await page.getByRole("button", { name: "Share" }).click();
	await expect.element(share()).toBeVisible();
});

test("a question whose dialog won't load resolves as dismissed", async () => {
	await setup();
	dialogLoaders.existingCopy = () => Promise.reject(new Error("gone"));
	const answer = askExistingCopy({ id: "d1", name: "Copy", updatedAt: Date.now() } as never);
	expect(await answer).toBeNull();
	expect(updateNotice.reason).toBe("chunk-failed");
	expect(requested.existingCopy).toBe(false);
});
