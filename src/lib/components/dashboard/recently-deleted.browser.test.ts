import "../../../app.css";
import { afterEach, expect, test, vi } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { restoreDeleted } from "$lib/actions/dashboard";
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

async function deleteWith(result: string) {
	const setup = await trashedApp();
	vi.spyOn(setup.worker, "deletePermanently").mockResolvedValue(result as never);
	await render(Harness, { context: new Map([[APP_CONTEXT_KEY, setup.app]]) });
	await page.getByRole("button", { name: /Delete now: / }).click();
	await page.getByRole("dialog").getByRole("button", { name: "Delete now" }).click();
	return setup;
}

test("a dashboard restored elsewhere is an informational toast, not an error", async () => {
	const info = vi.spyOn(toast, "info");
	const error = vi.spyOn(toast, "error");
	const { worker } = await deleteWith("restored-elsewhere");
	try {
		await expect.element(page.getByText(m.deleted_restored_elsewhere())).toBeVisible();
		expect(info).toHaveBeenCalledWith(m.deleted_restored_elsewhere());
		expect(error).not.toHaveBeenCalled();
	} finally {
		worker.stop();
	}
});

test("an unreadable local copy says so and keeps the row", async () => {
	const { app, worker } = await deleteWith("unreadable");
	try {
		await expect.element(page.getByText(m.deleted_unreadable())).toBeVisible();
		expect(app.index.deleted.map((d) => d.id)).toEqual(["d1"]);
	} finally {
		worker.stop();
	}
});

test("a copy from a newer version says to reload", async () => {
	const { worker } = await deleteWith("newer");
	try {
		await expect.element(page.getByText(m.deleted_newer())).toBeVisible();
	} finally {
		worker.stop();
	}
});

test("a copy missing on this device says so", async () => {
	const { worker } = await deleteWith("missing");
	try {
		await expect.element(page.getByText(m.deleted_missing())).toBeVisible();
	} finally {
		worker.stop();
	}
});

test("restoring a read-only dashboard is an informational toast", async () => {
	const info = vi.spyOn(toast, "info");
	const error = vi.spyOn(toast, "error");
	const { app, worker } = await trashedApp();
	try {
		vi.spyOn(app.sessions, "get").mockResolvedValue({ readOnly: "newer" } as never);
		await restoreDeleted(app, "d1");
		expect(info).toHaveBeenCalledWith(m.deleted_restore_read_only());
		expect(error).not.toHaveBeenCalled();
	} finally {
		worker.stop();
	}
});
