import "../../../app.css";
import axe from "axe-core";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import type { EarlierVersion, EarlierVersions } from "$lib/safety/restore-version";
import RestoreVersionDialog, { openRestoreVersion } from "./RestoreVersionDialog.svelte";

const local: EarlierVersion = { source: "local", at: "2026-10-20T19:00:00.000Z" };
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
	(versions: EarlierVersion[], accountUnreachable = false) =>
	async () =>
		({ versions, accountUnreachable }) satisfies EarlierVersions;

test("the versions are radios with dates in Pacific time", async () => {
	// The PT label shows only when the device zone isn't Pacific (CI's isn't); format.test.ts covers it.
	await render(RestoreVersionDialog);
	openRestoreVersion(loaded([conflict, daily, local], true), vi.fn());
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
		.element(dialog.getByText("Earlier versions saved in your account can't be loaded right now."))
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

test("the open dialog has no axe violations", async () => {
	await render(RestoreVersionDialog);
	openRestoreVersion(loaded([conflict, daily, local], true), vi.fn());
	const dialog = page.getByRole("dialog");
	await expect.element(dialog.getByRole("radio").first()).toBeVisible();
	const el = dialog.element();
	await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished));
	const results = await axe.run(el);
	expect(results.violations).toEqual([]);
});
