import "../../../app.css";
import axe from "axe-core";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { Change } from "$lib/changes/types";
import type { Dashboard } from "$lib/documents/schema";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import type { SyncContext } from "$lib/sync/context";
import { createFakeRemote } from "$lib/sync/remote-fake";
import {
	ACCOUNT,
	SPACE,
	makeDoc,
	otherDevice,
	storeDoc,
	title,
	titles,
	user
} from "$lib/sync/test-support";
import { uploadDocument } from "$lib/sync/upload";
import { SyncWorker } from "$lib/sync/worker.svelte";
import ConflictDialog from "./ConflictDialog.svelte";
import RemoteDecisionDialog from "./RemoteDecisionDialog.svelte";
import AnnounceHarness from "./test-harness/AnnounceHarness.svelte";

const workers: SyncWorker[] = [];
afterEach(() => {
	for (const worker of workers.splice(0)) worker.stop();
});

const deleteDoc: Change = {
	op: "setField",
	target: { path: "deletedAt" },
	from: null,
	to: "2026-11-02T11:00:00.000Z"
};

/**
 * A synced dashboard open in an account space, `mine` edited here and `theirs` saved by another
 * device (or the dashboard purged there), then a started sync worker that finds the hold.
 */
async function held(mine: Change[], theirs: Change[] | "purge") {
	const identity = createMemoryIdentity({ state: "signed-in", user: user(ACCOUNT) });
	identity.currentSpace = async () => SPACE;
	const platform = createMemoryPlatform({ identity });
	const fake = createFakeRemote({ accountId: ACCOUNT });
	// The test drives its own worker.
	const app = await initApp(platform, {
		channel: createMemoryTabHub().channel(),
		tabId: "t1",
		loadSync: null
	});
	await storeDoc(platform);
	const ctx: SyncContext = {
		platform,
		space: SPACE,
		accountId: ACCOUNT,
		remote: fake,
		channel: app.channel,
		tabId: app.tabId,
		buildId: "test-build",
		now: () => new Date()
	};
	expect(await uploadDocument(ctx, "d1")).toBe("saved");
	const session = (await app.sessions.get("d1"))!;
	for (const change of mine) session.apply(change);
	await session.flush();
	if (theirs === "purge") fake.purge("d1");
	else await otherDevice(fake, theirs);

	const worker = new SyncWorker(ctx);
	workers.push(worker);
	app.sync = worker;
	app.current = { session, isStarter: false };
	worker.start();
	await expect.poll(() => worker.states.d1?.state).toBe("held");
	return { app, fake, session, worker };
}

async function expectNoAxeViolations() {
	const results = await axe.run(page.getByRole("dialog").element());
	expect(results.violations).toEqual([]);
}

test("a device conflict opens the three choices", async () => {
	const { app, fake } = await held([title("a", "Mine")], [title("a", "Theirs")]);
	await render(ConflictDialog, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	const dialog = page.getByRole("dialog", { name: "Changed on another device" });
	await expect
		.element(
			dialog.getByText(
				"This dashboard was changed on another device while you were editing the same thing."
			)
		)
		.toBeVisible();
	await expect.element(dialog.getByRole("button", { name: "Use the other version" })).toBeVisible();
	await expect.element(dialog.getByRole("button", { name: "Save mine as a copy" })).toBeVisible();
	await expectNoAxeViolations();

	await dialog.getByRole("button", { name: "Keep mine" }).click();
	await expect.element(dialog).not.toBeInTheDocument();
	const server = await fake.get("d1");
	expect(titles({ ...makeDoc(), body: server.body as Dashboard["body"] })).toEqual(["Mine", null]);
	expect(fake.snapshots("d1").filter((s) => s.reason === "conflict")).toHaveLength(1);
});

/** Elements in the open dialog whose right edge is past the dialog's own. */
function spillingPastDialog(): string[] {
	const dialog = page.getByRole("dialog").element();
	const right = dialog.getBoundingClientRect().right;
	return [...dialog.querySelectorAll("p, button, h2")]
		.filter((el) => el.getBoundingClientRect().right > right + 0.5)
		.map((el) => el.textContent?.trim() ?? "");
}

test("at desktop width the conflict dialog's text and buttons stay inside it", async () => {
	await page.viewport(1280, 800);
	const { app } = await held([title("a", "Mine")], [title("a", "Theirs")]);
	await render(ConflictDialog, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect.element(page.getByRole("button", { name: "Save mine as a copy" })).toBeVisible();
	expect(spillingPastDialog()).toEqual([]);
});

test("deleted elsewhere offers restore or discard", async () => {
	const { app, fake } = await held([title("a", "Mine")], [deleteDoc]);
	await render(RemoteDecisionDialog, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	const dialog = page.getByRole("dialog");
	await expect
		.element(
			dialog.getByText(
				"This dashboard was deleted on another device. Restore it, or discard your changes?"
			)
		)
		.toBeVisible();
	await expect.element(dialog.getByRole("button", { name: "Discard my changes" })).toBeVisible();
	await expectNoAxeViolations();

	await dialog.getByRole("button", { name: "Restore", exact: true }).click();
	await expect.element(dialog).not.toBeInTheDocument();
	expect((await fake.get("d1")).deletedAt).toBeNull();
});

test("neither dialog closes on Escape", async () => {
	const conflict = await held([title("a", "Mine")], [title("a", "Theirs")]);
	const first = await render(ConflictDialog, {
		context: new Map([[APP_CONTEXT_KEY, conflict.app]])
	});
	await expect.element(page.getByRole("button", { name: "Keep mine" })).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await userEvent.click(document.body, { position: { x: 2, y: 2 } });
	await expect.element(page.getByRole("button", { name: "Keep mine" })).toBeVisible();
	await first.unmount();

	const gone = await held([title("a", "Mine")], "purge");
	await render(RemoteDecisionDialog, { context: new Map([[APP_CONTEXT_KEY, gone.app]]) });
	const dialog = page.getByRole("dialog");
	await expect
		.element(
			dialog.getByText(
				"This dashboard was permanently deleted from your account. Keep your version as a new dashboard, or discard it?"
			)
		)
		.toBeVisible();
	await expect
		.element(dialog.getByRole("button", { name: "Keep as a new dashboard" }))
		.toBeVisible();
	await expect.element(dialog.getByRole("button", { name: "Discard", exact: true })).toBeVisible();
	await expectNoAxeViolations();
	await userEvent.keyboard("{Escape}");
	await userEvent.click(document.body, { position: { x: 2, y: 2 } });
	await expect
		.element(dialog.getByRole("button", { name: "Keep as a new dashboard" }))
		.toBeVisible();
	expect(gone.worker.states.d1?.hold).toEqual({ kind: "gone" });
});

test("settling a device conflict announces Saved again, read from the page once the dialog is gone", async () => {
	const { app } = await held([title("a", "Mine")], [title("a", "Theirs")]);
	await render(AnnounceHarness, {
		context: new Map([[APP_CONTEXT_KEY, app]]),
		props: { indicator: true }
	});
	const dialog = page.getByRole("dialog", { name: "Changed on another device" });
	await dialog.getByRole("button", { name: "Keep mine" }).click();
	// Its title changes as it closes, so wait for any dialog to be gone.
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	const selector = '[role="status"][aria-live="polite"][aria-atomic="true"]';
	const holding = () =>
		[...document.querySelectorAll(selector)].filter((r) => r.textContent === "Saved again");
	await expect.poll(() => holding().length).toBe(1);
	expect(document.querySelector('[aria-modal="true"]')).toBeNull();
});
