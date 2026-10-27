import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { DashboardSummary } from "$lib/documents/names";
import ExistingCopyDialog, { askExistingCopy } from "./ExistingCopyDialog.svelte";

const copy: DashboardSummary = {
	id: "c1",
	name: "Fresno schools",
	createdAt: "2026-10-01T00:00:00.000Z",
	updatedAt: "2026-10-20T19:00:00.000Z"
};

test("shows the title and when the copy last changed, with two equal choices", async () => {
	await render(ExistingCopyDialog);
	void askExistingCopy(copy);
	const dialog = page.getByRole("dialog");
	await expect.element(dialog.getByText("You already have a copy of this dashboard")).toBeVisible();
	await expect.element(dialog.getByText("Last changed Oct 20, 2026")).toBeVisible();
	const open = dialog.getByRole("button", { name: "Open my copy" });
	const fresh = dialog.getByRole("button", { name: "Make a new copy" });
	await expect.element(open).toBeVisible();
	await expect.element(fresh).toBeVisible();
	expect(open.element().className).toBe(fresh.element().className);
	await userEvent.keyboard("{Escape}");
});

test("each button resolves its choice", async () => {
	await render(ExistingCopyDialog);
	const first = askExistingCopy(copy);
	await page.getByRole("button", { name: "Open my copy" }).click();
	expect(await first).toBe("open");
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();

	const second = askExistingCopy(copy);
	await page.getByRole("button", { name: "Make a new copy" }).click();
	expect(await second).toBe("new");
});

test("Escape resolves null", async () => {
	await render(ExistingCopyDialog);
	const answer = askExistingCopy(copy);
	await expect.element(page.getByRole("dialog")).toBeVisible();
	await userEvent.keyboard("{Escape}");
	expect(await answer).toBeNull();
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});
