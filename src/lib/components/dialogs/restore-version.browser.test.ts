import "../../../app.css";
import axe from "axe-core";
import { toast } from "svelte-sonner";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { commands, page, userEvent } from "vitest/browser";
import { ANNOUNCE_GAP_MS } from "$lib/a11y/announcer.svelte";
import type { EarlierVersion, EarlierVersions } from "$lib/safety/restore-version";
import RestoreVersionDialog, { openRestoreVersion } from "./RestoreVersionDialog.svelte";
import AnnounceHarness from "./test-harness/AnnounceHarness.svelte";

declare module "vitest/browser" {
	interface BrowserCommands {
		setReducedMotion: (reduce: boolean | null) => Promise<void>;
	}
}

afterEach(async () => {
	toast.dismiss();
	await commands.setReducedMotion(null);
});

const local: EarlierVersion = {
	source: "local",
	at: "2026-10-20T19:00:00.000Z",
	alsoInAccount: false
};
const daily: EarlierVersion = {
	source: "server",
	at: "2026-11-01T09:30:00.000Z",
	id: 5,
	reason: "daily"
};
const conflict: EarlierVersion = {
	source: "server",
	at: "2026-11-02T01:00:00.000Z",
	id: 6,
	reason: "conflict"
};

const loaded =
	(versions: EarlierVersion[], account: EarlierVersions["account"] = "ok") =>
	async () =>
		({ versions, account }) satisfies EarlierVersions;

test("the versions are radios with dates in Pacific time", async () => {
	// The PT label shows only when the device zone isn't Pacific (CI's isn't); format.test.ts covers it.
	await render(RestoreVersionDialog);
	openRestoreVersion(loaded([conflict, daily, local], "offline"), vi.fn());
	const dialog = page.getByRole("dialog");
	const radios = dialog.getByRole("radio");
	await expect.element(radios.first()).toBeVisible();
	expect(radios.elements()).toHaveLength(3);
	await expect.element(radios.first()).toBeChecked();
	await expect
		.element(dialog.getByRole("radio", { name: /^Nov 1, 2026, 5:00\sPM( PT)?: set aside/ }))
		.toBeVisible();
	await expect
		.element(
			dialog.getByRole("radio", {
				name: /^Nov 1, 2026, 1:30\sAM( PT)?: before that day's first change/
			})
		)
		.toBeVisible();
	await expect
		.element(
			dialog.getByRole("radio", {
				name: /^Oct 20, 2026, 12:00\sPM( PT)?: before an app update \(kept on this device\)/
			})
		)
		.toBeVisible();
	await expect.element(dialog.getByRole("group", { name: "Choose a version" })).toBeVisible();
	await expect
		.element(
			dialog.getByText("Versions saved in your account can't be loaded while you're offline.")
		)
		.toBeVisible();
});

test("Restore applies the chosen version and closes", async () => {
	await render(RestoreVersionDialog);
	const restore = vi.fn().mockResolvedValue("restored");
	openRestoreVersion(loaded([conflict, daily]), restore);
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("radio").nth(1).click();
	await dialog.getByRole("button", { name: "Restore", exact: true }).click();
	expect(restore).toHaveBeenCalledWith(daily);
	await expect.element(dialog).not.toBeInTheDocument();
});

test("an empty list says none yet", async () => {
	await render(RestoreVersionDialog);
	openRestoreVersion(loaded([]), vi.fn());
	const dialog = page.getByRole("dialog");
	await expect
		.element(dialog.getByText("No earlier versions yet. Your account keeps one a day for 30 days."))
		.toBeVisible();
	await expect.element(dialog.getByRole("button", { name: "Restore", exact: true })).toBeDisabled();
});

test("a failed restore keeps the dialog open with the reason", async () => {
	await render(RestoreVersionDialog);
	openRestoreVersion(loaded([daily]), async () => "unreachable");
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Restore", exact: true }).click();
	await expect
		.element(dialog.getByText(/Couldn't reach your account, so nothing was restored/))
		.toBeVisible();
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect.element(dialog).not.toBeInTheDocument();
});

test("a gone dashboard explains why only the device copy is listed", async () => {
	await render(RestoreVersionDialog);
	openRestoreVersion(loaded([local], "gone"), vi.fn());
	const dialog = page.getByRole("dialog");
	await expect
		.element(
			dialog.getByText(
				"This dashboard is no longer in your account, so only the copy on this device is listed."
			)
		)
		.toBeVisible();
});

test("a copy also in the account says so", async () => {
	await render(RestoreVersionDialog);
	openRestoreVersion(loaded([{ ...local, alsoInAccount: true }]), vi.fn());
	await expect
		.element(page.getByRole("dialog").getByText(/kept on this device and in your account/))
		.toBeVisible();
});

test("a status region is always present and holds the loading text while loading", async () => {
	await render(RestoreVersionDialog);
	let release: (v: EarlierVersions) => void = () => {};
	openRestoreVersion(() => new Promise<EarlierVersions>((r) => (release = r)), vi.fn());
	const dialog = page.getByRole("dialog");
	// The first status is the list's; the last is the dialog's region for announcements.
	const status = dialog.getByRole("status").first();
	await expect.element(status).toHaveTextContent("Loading earlier versions…");
	release({ versions: [daily], account: "ok" });
	await expect.element(dialog.getByRole("radio").first()).toBeVisible();
	await expect.poll(() => status.element().textContent).toBe("");
});

test("focus moves to the first radio when the list arrives", async () => {
	await render(RestoreVersionDialog);
	openRestoreVersion(loaded([conflict, daily]), vi.fn());
	const radio = page.getByRole("dialog").getByRole("radio").first();
	await expect.element(radio).toBeVisible();
	await expect.element(radio).toHaveFocus();
});

test("Escape and Cancel don't close the dialog while a restore runs", async () => {
	await render(RestoreVersionDialog);
	let finish: (r: "restored") => void = () => {};
	openRestoreVersion(loaded([daily]), () => new Promise((r) => (finish = r)));
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Restore", exact: true }).click();
	await expect.element(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
	await userEvent.keyboard("{Escape}");
	await expect.element(dialog).toBeInTheDocument();
	await dialog.getByRole("button", { name: "Close" }).click({ force: true });
	await expect.element(dialog).toBeInTheDocument();
	finish("restored");
	await expect.element(dialog).not.toBeInTheDocument();
});

/** Longer than the dialog's close animation, so a dialog that started closing is gone by then. */
const settle = () => new Promise((r) => setTimeout(r, 300));

test("Escape, the X, and a click outside can't close it during a restore, even after the animation", async () => {
	await render(RestoreVersionDialog);
	let finish: (r: "unreachable") => void = () => {};
	openRestoreVersion(loaded([daily]), () => new Promise((r) => (finish = r)));
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Restore", exact: true }).click();
	await expect.element(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
	await userEvent.keyboard("{Escape}");
	await settle();
	await expect.element(dialog).toBeInTheDocument();
	await dialog.getByRole("button", { name: "Close" }).click({ force: true });
	await settle();
	await expect.element(dialog).toBeInTheDocument();
	const overlay = document.querySelector('[data-slot="dialog-overlay"]');
	if (!overlay) throw new Error("no overlay");
	await page.elementLocator(overlay).click({ position: { x: 5, y: 5 } });
	await settle();
	await expect.element(dialog).toBeInTheDocument();
	finish("unreachable");
	await expect
		.element(dialog.getByText(/Couldn't reach your account, so nothing was restored/))
		.toBeVisible();
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect.element(dialog).not.toBeInTheDocument();
	openRestoreVersion(loaded([daily]), vi.fn());
	await expect.element(page.getByRole("dialog").getByRole("radio").first()).toBeVisible();
});

test("reopening shows a fresh list with nothing selected and no old failure", async () => {
	await render(RestoreVersionDialog);
	openRestoreVersion(loaded([conflict, daily]), async () => "unreachable");
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("radio").nth(1).click();
	await dialog.getByRole("button", { name: "Restore", exact: true }).click();
	await expect.element(dialog.getByText(/Couldn't reach your account/)).toBeVisible();
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect.element(dialog).not.toBeInTheDocument();
	openRestoreVersion(loaded([conflict, daily]), vi.fn());
	await expect.element(page.getByRole("dialog").getByRole("radio").first()).toBeChecked();
	await expect.element(page.getByText(/Couldn't reach your account/)).not.toBeInTheDocument();
});

test("the open dialog has no axe violations", async () => {
	await render(RestoreVersionDialog);
	openRestoreVersion(loaded([conflict, daily, local], "offline"), vi.fn());
	const dialog = page.getByRole("dialog");
	await expect.element(dialog.getByRole("radio").first()).toBeVisible();
	const el = dialog.element();
	await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished));
	const results = await axe.run(el);
	expect(results.violations).toEqual([]);
});

for (const reduce of [false, true]) {
	test(`the Restored toast is read once, from the page, after the dialog closes${reduce ? " (reduced motion)" : ""}`, async () => {
		await commands.setReducedMotion(reduce);
		await render(AnnounceHarness);
		const done = "Restored the earlier version. Undo to go back.";
		// As in the app: the restore shows the toast, then the dialog closes.
		openRestoreVersion(loaded([daily]), async () => {
			toast(done);
			return "restored";
		});
		const dialog = page.getByRole("dialog");
		await dialog.getByRole("button", { name: "Restore", exact: true }).click();
		await expect.element(dialog).not.toBeInTheDocument();
		const selector = '[role="status"][aria-live="polite"][aria-atomic="true"]';
		const holding = () =>
			[...document.querySelectorAll(selector)].filter((r) => r.textContent === done);
		await expect.poll(() => holding().length).toBe(1);
		await new Promise((r) => setTimeout(r, ANNOUNCE_GAP_MS * 2));
		expect(holding()).toHaveLength(1);
		expect(document.querySelector('[aria-modal="true"]')).toBeNull();
	});
}

test("an account list that can't be loaded for another reason doesn't say offline", async () => {
	await render(RestoreVersionDialog);
	openRestoreVersion(loaded([local], "unavailable"), vi.fn());
	const dialog = page.getByRole("dialog");
	await expect
		.element(
			dialog.getByText("Versions saved in your account can't be loaded right now. Try again later.")
		)
		.toBeVisible();
	expect(dialog.getByText(/offline/).elements()).toHaveLength(0);
});

test("a list that fails to load on this device says so, not offline", async () => {
	await render(RestoreVersionDialog);
	openRestoreVersion(() => Promise.reject(new Error("storage")), vi.fn());
	const dialog = page.getByRole("dialog");
	await expect
		.element(dialog.getByText("Earlier versions couldn't be loaded. Close this and try again."))
		.toBeVisible();
	expect(dialog.getByText(/offline/).elements()).toHaveLength(0);
	expect(dialog.getByText(/No earlier versions yet/).elements()).toHaveLength(0);
});

test("an empty list picks one line by the account's status", async () => {
	await render(RestoreVersionDialog);
	const cases: [EarlierVersions["account"], string][] = [
		["ok", "No earlier versions yet. Your account keeps one a day for 30 days."],
		["none", "No earlier versions yet."],
		["offline", "No earlier versions on this device."],
		["unavailable", "No earlier versions on this device."],
		[
			"gone",
			"This dashboard is no longer in your account, and there are no earlier versions on this device."
		]
	];
	for (const [account, line] of cases) {
		openRestoreVersion(loaded([], account), vi.fn());
		const dialog = page.getByRole("dialog");
		await expect.element(dialog.getByText(line, { exact: true })).toBeVisible();
		if (account !== "ok") {
			expect(dialog.getByText(/Your account keeps/).elements()).toHaveLength(0);
		}
		expect(dialog.getByText(/only the copy on this device is listed/).elements()).toHaveLength(0);
		await dialog.getByRole("button", { name: "Cancel" }).click();
		await expect.element(dialog).not.toBeInTheDocument();
	}
});

test("a restore the account refused for another reason doesn't say to check the connection", async () => {
	await render(RestoreVersionDialog);
	openRestoreVersion(loaded([daily]), async () => "unavailable");
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Restore", exact: true }).click();
	await expect
		.element(
			dialog.getByText(
				"Your account couldn't complete the restore right now, so nothing was restored. Try again later."
			)
		)
		.toBeVisible();
	expect(dialog.getByText(/connection/).elements()).toHaveLength(0);
});
