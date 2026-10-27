import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import RestoreVersionDialog, { openRestoreVersion } from "./RestoreVersionDialog.svelte";

const original = {
	id: "d1",
	raw: {},
	keptAt: "2026-10-20T19:00:00.000Z",
	fromSchemaVersion: 1
};

test("lists the version by date and Restore calls through, then closes", async () => {
	await render(RestoreVersionDialog);
	const restore = vi.fn().mockResolvedValue(true);
	openRestoreVersion(original, restore);
	const dialog = page.getByRole("dialog");
	await expect.element(dialog.getByText("Before the update on Oct 20, 2026")).toBeVisible();
	await dialog.getByRole("button", { name: "Restore", exact: true }).click();
	expect(restore).toHaveBeenCalledOnce();
	await expect.element(dialog).not.toBeInTheDocument();
});

test("a failure shows the message and keeps the dialog open", async () => {
	await render(RestoreVersionDialog);
	openRestoreVersion(original, async () => false);
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Restore", exact: true }).click();
	await expect.element(dialog.getByText("That version can't be opened.")).toBeVisible();
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect.element(dialog).not.toBeInTheDocument();
});
