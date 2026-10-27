import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type { AccountUser } from "../src/lib/account/identity";
import { expect, test } from "./fixtures";
import { DASHBOARD_URL } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const maria: AccountUser = {
	id: "6NKDOOsxRyOUFE4rXMr1nQ",
	full_name: "Maria Lopez",
	email: "maria@example.com",
	phone: null,
	phone_verified: false,
	language: "en"
};

// Motion collapses, so the menu is fully shown when checked.
test.use({ reducedMotion: "reduce" });

function signIn(page: Page) {
	return page.getByRole("link", { name: "Sign in" });
}

function accountButton(page: Page) {
	return page.getByRole("button", { name: "Account menu for Maria Lopez" });
}

/** Sets `document.visibilityState` and fires `visibilitychange`, as switching tabs would. */
async function setVisibility(page: Page, state: "hidden" | "visible"): Promise<void> {
	await page.evaluate((value) => {
		Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
		document.dispatchEvent(new Event("visibilitychange"));
	}, state);
}

test("signed out, Sign in returns to the current dashboard", async ({ page }) => {
	await page.goto("./dashboards");
	await page.getByRole("button", { name: "New blank dashboard" }).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	const id = new URL(page.url()).pathname.split("/").pop()!;
	await page.goto(`./dashboards/${id}`);
	await expect(signIn(page)).toHaveAttribute(
		"href",
		new RegExp(`next=%2Fworkspace%2Fdashboards%2F${id}$`)
	);
});

test.describe("signed in", () => {
	test.use({ account: maria });

	test("the account menu shows the initials and the greeting", async ({ page }) => {
		await page.goto("./");
		await expect(accountButton(page)).toHaveText("ML");
		await expect(signIn(page)).toHaveCount(0);
		await accountButton(page).click();
		await expect(page.getByRole("menu")).toBeVisible();
		await expect(page.getByText("Hi, Maria")).toBeVisible();
		await expect(page.getByText("Signed in as Maria Lopez")).toBeVisible();
		const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
		expect(results.violations).toEqual([]);
	});

	test("signing out flips every tab", async ({ page }) => {
		await page.goto("./");
		const other = await page.context().newPage();
		await other.goto("./");
		await expect(accountButton(other)).toBeVisible();

		await accountButton(page).click();
		await page.getByRole("menuitem", { name: "Sign out" }).click();

		await expect(signIn(page)).toBeVisible();
		await expect(page.getByText("Signed out.", { exact: true })).toBeVisible();
		await expect(signIn(other)).toBeVisible();
		await expect(other.getByText("You've been signed out.")).toBeVisible();
	});

	test("a re-check on coming back into view notices a sign-out elsewhere", async ({
		page,
		accountServer
	}) => {
		await page.clock.install();
		await page.goto("./");
		await expect(accountButton(page)).toBeVisible();

		accountServer.set(null);
		await page.clock.fastForward(31_000);
		await setVisibility(page, "hidden");
		await setVisibility(page, "visible");

		await expect(page.getByText("You've been signed out.")).toBeVisible();
		await expect(signIn(page)).toBeVisible();
	});
});
