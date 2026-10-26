import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import ClearDataDialog, { openClearData } from "./ClearDataDialog.svelte";

const backup = vi.hoisted(() => ({ finish: () => {} }));

// The backup itself (loaded lazily by "Download a backup first") stays in progress until told.
vi.mock("$lib/sharing/actions", () => ({
	downloadBackup: () =>
		new Promise<void>((resolve) => {
			backup.finish = resolve;
		})
}));

async function setup() {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	return { app, context: new Map([[APP_CONTEXT_KEY, app]]) };
}

test("Clear everything waits until the backup has been handed over", async () => {
	const { context } = await setup();
	await render(ClearDataDialog, { context });
	openClearData();
	const dialog = page.getByRole("dialog");
	const clear = dialog.getByRole("button", { name: "Clear everything" });
	const backupFirst = dialog.getByRole("button", { name: "Download a backup first" });
	await expect.element(clear).toBeEnabled();
	await backupFirst.click();
	await expect.element(clear).toBeDisabled();
	await expect.element(backupFirst).toBeDisabled();
	backup.finish();
	await expect.element(clear).toBeEnabled();
	await expect.element(backupFirst).toBeEnabled();
});

test("the body reads naturally with no dashboards, or none deleted", async () => {
	const { app, context } = await setup();
	const view = await render(ClearDataDialog, { context });
	openClearData();
	const dialog = page.getByRole("dialog");
	await expect.element(dialog.getByText(m.clear_body_empty())).toBeVisible();

	const id = await app.index.createBlank();
	await expect.element(dialog.getByText(m.clear_body_no_deleted({ count: 1 }))).toBeVisible();

	await app.index.createBlank();
	const session = (await app.sessions.get(id, { remember: false }))!;
	const deletedAt = new Date().toISOString();
	session.apply({ op: "setField", target: { path: "deletedAt" }, from: null, to: deletedAt });
	await session.flush();
	await app.index.refresh();
	await expect.element(dialog.getByText(m.clear_body({ count: 2, deleted: 1 }))).toBeVisible();
	session.dispose();
	view.unmount();
});
