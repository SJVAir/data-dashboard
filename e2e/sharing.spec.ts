import { expect, test } from "./fixtures";
import { DASHBOARD_URL, dashboardHeading, shareLinkFor, sharedDoc, widgetTitles } from "./helpers";

test.use({ reducedMotion: "reduce" });

const link = shareLinkFor(sharedDoc("Fresno schools", ["Alpha", "Beta"]));

test("opening a link saves a copy and drops the fragment", async ({ page }) => {
	await page.goto(link);
	await expect(page).toHaveURL(DASHBOARD_URL);
	expect(page.url()).not.toContain("#");
	await expect(dashboardHeading(page, "Fresno schools")).toBeAttached();
	await expect(widgetTitles(page)).toHaveText(["Alpha", "Beta"]);
	await expect(page.getByText("Saved a copy to your dashboards")).toBeVisible();

	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Dashboards" })
		.click();
	await expect(page.getByRole("link", { name: "Fresno schools" })).toHaveCount(1);
});

test("reopening the same link asks; Open my copy goes back to it", async ({ page }) => {
	await page.goto(link);
	await expect(page).toHaveURL(DASHBOARD_URL);
	const first = page.url();

	await page.goto(link);
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByText("You already have a copy of this dashboard")).toBeVisible();
	await expect(dialog.getByText(/^Last changed /)).toBeVisible();
	await dialog.getByRole("button", { name: "Open my copy" }).click();
	await expect(page).toHaveURL(first);
});

test("reopening the same link asks; Make a new copy makes a second one", async ({ page }) => {
	await page.goto(link);
	await expect(page).toHaveURL(DASHBOARD_URL);
	const first = page.url();

	await page.goto(link);
	await page.getByRole("dialog").getByRole("button", { name: "Make a new copy" }).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	expect(page.url()).not.toBe(first);

	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Dashboards" })
		.click();
	await expect(page.getByRole("link", { name: "Fresno schools" })).toHaveCount(2);
});

test("closing the question keeps both choices on the page", async ({ page }) => {
	await page.goto(link);
	await expect(page).toHaveURL(DASHBOARD_URL);

	await page.goto(link);
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toBeHidden();
	await expect(page.getByRole("button", { name: "Open my copy" })).toBeVisible();
	await page.getByRole("button", { name: "Make a new copy" }).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
});

test("a tampered link shows the error and saves nothing", async ({ page }) => {
	await page.goto(link.slice(0, -12));
	await expect(
		page.getByRole("heading", { level: 1, name: "This link can't be opened." })
	).toBeVisible();

	await page.getByRole("link", { name: "Dashboards" }).first().click();
	await expect(page.getByRole("link", { name: "Fresno schools" })).toHaveCount(0);
	await expect(page).not.toHaveURL(DASHBOARD_URL);
});

test("/import with no link goes home", async ({ page }) => {
	await page.goto("./import");
	await expect(page).toHaveURL(/\/workspace\/?$/);
});
