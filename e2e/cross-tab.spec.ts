import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { expectSaved, makeOwnCopy, widgetMenuItem, widgetTitles } from "./helpers";

test.use({ reducedMotion: "reduce" });

/** Two tabs on the person's own copy of the starter (one context: shared storage and channel). */
async function twoTabs(page: Page): Promise<Page> {
	await makeOwnCopy(page, "Shared widget");
	const other = await page.context().newPage();
	await other.goto(page.url());
	await expect(widgetTitles(other).first()).toHaveText("Shared widget");
	return other;
}

/** Opens the rename dialog for the shared widget and types `value` without saving. */
async function startRename(page: Page, value: string): Promise<void> {
	await widgetMenuItem(page, "Shared widget", "Rename widget…");
	await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill(value);
}

test("a rename in one tab appears in the other", async ({ page }) => {
	const other = await twoTabs(page);
	await startRename(page, "Renamed in tab one");
	await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
	await expect(widgetTitles(other).first()).toHaveText("Renamed in tab one");
	await expectSaved(other);
});

test("same widget renamed in both tabs within the save window shows the conflict dialog", async ({
	page
}) => {
	const other = await twoTabs(page);
	await startRename(page, "One");
	await startRename(other, "Two");
	// Submitted together, so both renames are applied before either tab's autosave runs.
	await Promise.all([page.keyboard.press("Enter"), other.keyboard.press("Enter")]);

	// The tab that saves second finds an overlapping change and asks; the other doesn't.
	const dialogs = [page, other].map((tab) =>
		tab.getByRole("dialog", { name: "Changed in another tab" })
	);
	const shown = () => Promise.all(dialogs.map((dialog) => dialog.isVisible()));
	await expect.poll(async () => (await shown()).filter(Boolean).length).toBe(1);
	const asked = (await shown()).indexOf(true);
	await expect(dialogs[1 - asked]).toBeHidden();
	const mine = asked === 0 ? "One" : "Two";

	await dialogs[asked].getByRole("button", { name: "Keep mine" }).click();
	await expect(dialogs[asked]).toBeHidden();
	for (const tab of [page, other]) await expect(widgetTitles(tab).first()).toHaveText(mine);
	await expectSaved([page, other][asked]);
});
