import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { announcer } from "$lib/a11y/announcer.svelte";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { Protection } from "$lib/platform/types";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { accountApp } from "$lib/sync/test-app";
import type { SyncWorker } from "$lib/sync/worker.svelte";
import SavedIndicator from "./SavedIndicator.svelte";
import StorageStatus from "./StorageStatus.svelte";

const workers: SyncWorker[] = [];
afterEach(() => {
	for (const worker of workers.splice(0)) worker.stop();
});

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

test("Protect my dashboards shows only where the browser prompts, and stays after a refusal", async () => {
	const { app, context } = await setup("unprotected", true);
	await render(StorageStatus, { context });
	const button = page.getByRole("button", { name: m.protect_button() });
	await expect.element(button).toBeVisible();
	await button.click();
	await expect.poll(() => app.protection.refused).toBe(true);
	// Refusing takes it out of the reminder bar only; the note keeps offering it.
	expect(app.protection.canOfferInBar).toBe(false);
	await expect.element(page.getByRole("button", { name: m.protect_button() })).toBeVisible();
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

/** An account-space dashboard open in the indicator, its worker started once `before` ran. */
async function openInAccount(before: (setup: Awaited<ReturnType<typeof accountApp>>) => void) {
	const setup = await accountApp();
	workers.push(setup.worker);
	const { app, worker } = setup;
	app.current = { session: (await app.sessions.get("d1"))!, isStarter: false };
	before(setup);
	worker.start();
	await render(SavedIndicator, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	return setup;
}

test("saved on this device until the account has it", async () => {
	let release = () => {};
	const { worker } = await openInAccount(({ fake }) => {
		// The first upload is still on its way.
		const save = fake.save;
		fake.save = async (id, input) => {
			await new Promise<void>((resolve) => (release = resolve));
			return save(id, input);
		};
	});
	await expect.poll(() => worker.states.d1?.state).toBe("pending");
	await expect.element(page.getByText("Saved on this device")).toBeVisible();
	expect(page.getByText("Saved to your account").query()).toBeNull();
	release();
	await expect.element(page.getByText("Saved to your account")).toBeVisible();
});

test("saved to your account once synced", async () => {
	const { worker } = await openInAccount(() => {});
	await expect.poll(() => worker.states.d1?.state).toBe("synced");
	await expect.element(page.getByText("Saved to your account")).toBeVisible();
});

test("the anonymous space keeps the plain Saved label", async () => {
	const { app, context } = await setup("protected", false);
	const id = await app.index.createBlank();
	app.current = { session: (await app.sessions.get(id))!, isStarter: false };
	await render(SavedIndicator, { context });
	await expect.element(page.getByText("Saved", { exact: true })).toBeVisible();
	expect(page.getByText("Saved on this device").query()).toBeNull();
});

test("the popover shows the last confirmed time in Pacific time", async () => {
	const { worker } = await openInAccount(() => {});
	await expect.poll(() => worker.states.d1?.state).toBe("synced");
	await page.getByRole("button", { name: /Storage status/ }).click();
	// NOW is 12:00 UTC on 2026-11-02: 4:00 AM Pacific (standard time).
	await expect
		.element(page.getByText(/Last saved to your account Nov 2, 2026, 4:00/))
		.toBeVisible();
});

test("a refused dashboard says why", async () => {
	const { worker } = await openInAccount(({ refuseSaves }) => {
		refuseSaves.push({ code: "too_large", status: 413 });
	});
	await expect.poll(() => worker.states.d1?.state).toBe("held");
	await expect.element(page.getByText("Saved on this device")).toBeVisible();
	await page.getByRole("button", { name: /Storage status/ }).click();
	await expect.element(page.getByText(m.sync_refused_too_large())).toBeVisible();
	expect(page.getByText(/Last saved to your account/).query()).toBeNull();
});

test("colour is never the only signal: a text label in every state", async () => {
	const { app, worker } = await openInAccount(({ refuseSaves }) => {
		refuseSaves.push({ code: "too_large", status: 413 });
	});
	const session = app.current.session!;
	const button = page.getByRole("button", { name: /Storage status/ });
	const label = () => button.element().querySelector("span:not(.sr-only)")?.textContent?.trim();
	await expect.poll(() => worker.states.d1?.state).toBe("held");
	expect(label()).toBe("Saved on this device");
	await worker.syncAll();
	await expect.poll(label).toBe("Saved to your account");
	session.status = "saving";
	await expect.poll(label).toBe(m.saving());
	session.status = "error";
	await expect.poll(label).toBe(m.save_failed());
});

test("in an account the note says the account keeps the dashboards, without the browser's notes", async () => {
	const { app, platform, worker } = await accountApp();
	workers.push(worker);
	platform.persistence.set("unprotected", true);
	await app.protection.refresh();
	await render(StorageStatus, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect.element(page.getByText(m.storage_note_account())).toBeVisible();
	expect(page.getByText(m.storage_note()).query()).toBeNull();
	expect(page.getByText(m.storage_note_unprotected()).query()).toBeNull();
	expect(page.getByRole("button", { name: m.protect_button() }).query()).toBeNull();
	expect(page.getByRole("button", { name: m.backup_download() }).query()).toBeNull();
});

async function openLocal() {
	const { app, context } = await setup("protected", false);
	const id = await app.index.createBlank();
	const session = (await app.sessions.get(id))!;
	app.current = { session, isStarter: false };
	const view = await render(SavedIndicator, { context });
	return { app, session, view };
}

test("a conflict reads Changed elsewhere, not the failure, and is not red", async () => {
	const { session } = await openLocal();
	session.status = "error";
	session.conflict = {} as never;
	const button = page.getByRole("button", { name: /Storage status/ });
	await expect.poll(() => button.element().textContent).toContain(m.save_conflict());
	expect(page.getByText(m.save_failed()).query()).toBeNull();
	expect(button.element().className).not.toContain("text-destructive");
});

test("the indicator has no live region of its own", async () => {
	const { view } = await openLocal();
	expect(view.container.querySelector("[aria-live]")).toBeNull();
});

test("announces failures, recovery and conflicts, but not a normal save", async () => {
	const { session } = await openLocal();
	session.status = "saving";
	await new Promise((r) => setTimeout(r, 300));
	session.status = "saved";
	await new Promise((r) => setTimeout(r, 300));
	expect(announcer.text).not.toBe(m.save_failed());
	expect(announcer.text).not.toBe(m.save_recovered());
	session.status = "error";
	await expect.poll(() => announcer.text).toBe(m.save_failed());
	session.status = "saved";
	await expect.poll(() => announcer.text).toBe(m.save_recovered());
	session.status = "error";
	session.conflict = {} as never;
	await expect.poll(() => announcer.text).toBe(m.save_conflict_announce());
});
