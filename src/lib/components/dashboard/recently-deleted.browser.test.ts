import "../../../app.css";
import { afterEach, expect, test, vi } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { m } from "$lib/paraglide/messages.js";
import { APP_CONTEXT_KEY } from "$lib/store/app.svelte";
import { accountApp } from "$lib/sync/test-app";
import { SPACE, stored } from "$lib/sync/test-support";
import Harness from "./test-harness/DeletedHarness.svelte";

afterEach(async () => {
	toast.dismiss();
	// The confirmation is module state: close one a test left open.
	await userEvent.keyboard("{Escape}");
});

/** An account space with `d1` synced, then trashed and synced. */
async function trashedApp() {
	const setup = await accountApp(["d1"]);
	const { app, platform, worker } = setup;
	await worker.syncAll();
	const doc = await stored(platform);
	await platform.documents.commit(SPACE, {
		docId: "d1",
		baseVersion: doc.version,
		doc: { ...doc, deletedAt: "2026-11-02T11:00:00.000Z", version: doc.version + 1 },
		entries: [
			{
				docId: "d1",
				version: doc.version + 1,
				change: {
					op: "setField",
					target: { path: "deletedAt" },
					from: null,
					to: "2026-11-02T11:00:00.000Z"
				},
				tabId: "t1",
				schemaVersion: 1
			}
		]
	});
	await worker.syncAll();
	await app.index.refresh();
	return setup;
}

test("the account confirmation says every device", async () => {
	const { app, worker } = await trashedApp();
	try {
		await render(Harness, { context: new Map([[APP_CONTEXT_KEY, app]]) });
		await page.getByRole("button", { name: /Delete now: / }).click();
		await expect.element(page.getByText(m.deleted_confirm_body_account())).toBeVisible();
	} finally {
		worker.stop();
	}
});

test("a refused delete keeps the row and says why", async () => {
	const { app, fake, worker } = await trashedApp();
	try {
		await render(Harness, { context: new Map([[APP_CONTEXT_KEY, app]]) });
		fake.offline = true;
		await page.getByRole("button", { name: /Delete now: / }).click();
		await page.getByRole("dialog").getByRole("button", { name: "Delete now" }).click();
		await expect.element(page.getByText(m.deleted_unreachable())).toBeVisible();
		await expect.element(page.getByTestId("deleted-row-d1")).toBeVisible();
		expect(app.index.deleted.map((d) => d.id)).toEqual(["d1"]);
	} finally {
		worker.stop();
	}
});

test("a successful delete removes the row and the server copy", async () => {
	const { app, fake, worker } = await trashedApp();
	try {
		await render(Harness, { context: new Map([[APP_CONTEXT_KEY, app]]) });
		await page.getByRole("button", { name: /Delete now: / }).click();
		await page.getByRole("dialog").getByRole("button", { name: "Delete now" }).click();
		await expect.poll(() => app.index.deleted.length).toBe(0);
		await expect(fake.get("d1")).rejects.toMatchObject({ code: "gone" });
	} finally {
		worker.stop();
	}
});

test("an unexpected failure keeps the row and says it couldn't reach the account", async () => {
	const { app, worker } = await trashedApp();
	try {
		vi.spyOn(worker, "deletePermanently").mockRejectedValue(new Error("boom"));
		await render(Harness, { context: new Map([[APP_CONTEXT_KEY, app]]) });
		await page.getByRole("button", { name: /Delete now: / }).click();
		await page.getByRole("dialog").getByRole("button", { name: "Delete now" }).click();
		await expect.element(page.getByText(m.deleted_unreachable())).toBeVisible();
		await expect.element(page.getByTestId("deleted-row-d1")).toBeVisible();
		expect(app.index.deleted.map((d) => d.id)).toEqual(["d1"]);
	} finally {
		worker.stop();
	}
});
