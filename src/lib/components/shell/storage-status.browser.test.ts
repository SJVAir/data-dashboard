import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { Protection } from "$lib/platform/types";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import SavedIndicator from "./SavedIndicator.svelte";
import StorageStatus from "./StorageStatus.svelte";

async function setup(state: Protection, prompts: boolean) {
	const platform = createMemoryPlatform();
	platform.persistence.set(state, prompts);
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	return { app, context: new Map([[APP_CONTEXT_KEY, app]]) };
}

test("protected storage shows only the note", async () => {
	const { context } = await setup("protected", false);
	await render(StorageStatus, { context });
	await expect.element(page.getByText(m.storage_note())).toBeVisible();
	expect(page.getByText(m.storage_note_unprotected()).query()).toBeNull();
	expect(page.getByRole("button", { name: m.protect_button() }).query()).toBeNull();
});

test("unprotected storage adds the warning and the backup link", async () => {
	const { app, context } = await setup("unprotected", false);
	await app.index.createBlank();
	await render(StorageStatus, { context });
	await expect.element(page.getByText(m.storage_note_unprotected())).toBeVisible();
	await expect.element(page.getByRole("button", { name: m.backup_download() })).toBeVisible();
	expect(page.getByRole("button", { name: m.protect_button() }).query()).toBeNull();
});

test("Protect my dashboards shows only where the browser prompts and until refused", async () => {
	const { app, context } = await setup("unprotected", true);
	await render(StorageStatus, { context });
	const button = page.getByRole("button", { name: m.protect_button() });
	await expect.element(button).toBeVisible();
	await button.click();
	await expect.poll(() => app.protection.refused).toBe(true);
	expect(page.getByRole("button", { name: m.protect_button() }).query()).toBeNull();
});

test("each save error is explained", async () => {
	const { context } = await setup("protected", false);
	const view = await render(StorageStatus, { context, props: { errorKind: "quota" } });
	await expect.element(page.getByText(m.save_failed_quota())).toBeVisible();
	await view.rerender({ errorKind: "unavailable" });
	await expect.element(page.getByText(m.save_failed_unavailable())).toBeVisible();
});

test("the Saved indicator opens the status popover", async () => {
	const { app, context } = await setup("protected", false);
	const id = await app.index.createBlank();
	app.current = { session: (await app.sessions.get(id))!, isStarter: false };
	await render(SavedIndicator, { context });
	await expect.element(page.getByText("Saved")).toBeVisible();
	await page.getByRole("button", { name: /Storage status/ }).click();
	await expect.element(page.getByText(m.storage_note())).toBeVisible();
});
