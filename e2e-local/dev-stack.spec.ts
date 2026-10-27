import { expect, test } from "@playwright/test";

test("the dev data page reaches the local server through the proxy", async ({ page }) => {
	const response = page.waitForResponse(
		(r) => new URL(r.url()).pathname.startsWith("/api/") && r.status() === 200
	);
	await page.goto("dev/data");
	await response;
	const cookies = await page.context().cookies();
	expect(cookies.some((c) => c.name === "csrftoken")).toBe(true);
});

test("signed out of the stack, /workspace/ offers Sign in", async ({ page }) => {
	// A fresh browser context has no session cookie, so the stack answers the account check 401.
	await page.goto("");
	await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
		"href",
		/^\/account\/login\/\?next=%2Fworkspace(%2F)?$/
	);
});
