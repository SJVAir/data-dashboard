import "../../../app.css";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { setPlatform } from "$lib/platform";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { confirmAction } from "./ConfirmDialog.svelte";
import { share as shareState } from "./lazy.svelte";
import LazyHarness from "./test-harness/LazyHarness.svelte";

const URL_TEXT = "http://localhost/workspace/import#1.abcdef";

// The open state outlives each test's render.
afterEach(() => {
	shareState.open = false;
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
	void confirmAction({ title: "Stop sharing?", body: "Body", confirm: "Stop" });
	const confirm = page
		.getByRole("alertdialog", { name: "Stop sharing?" })
		.or(page.getByRole("dialog", { name: "Stop sharing?" }));
	await expect.element(confirm).toBeVisible();
	// Dialogs stack in document order: the confirm comes after the Share dialog.
	const order = share().element().compareDocumentPosition(confirm.element());
	expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
