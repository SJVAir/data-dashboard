import { DASHBOARD_URL } from "./helpers";
import { expect, test } from "./fixtures";

test("the preview sends the contract CSP, without 'unsafe-eval'", async ({ page }) => {
	const response = await page.goto("./");
	const csp = (await response?.headerValue("content-security-policy")) ?? "";
	expect(csp).toContain("default-src 'none'");
	expect(csp).toContain("script-src 'self'");
	expect(csp).not.toContain("unsafe-eval");
	expect(csp).not.toContain("{static}");
});

test("loading, listing, and making a dashboard raise no CSP violation", async ({ page }) => {
	await page.goto("./");
	await expect(page.getByRole("main")).toBeVisible();
	await page.goto("./dashboards");
	await page.getByRole("button", { name: "New blank dashboard" }).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	// The fixture fails the test on any violation; wait for the page to settle first.
	await page.waitForLoadState("networkidle");
});

test("the checker sees a violation (eval is blocked)", async ({ page, cspViolations }) => {
	await page.goto("./");
	await expect(page.getByRole("main")).toBeVisible();
	await page.addScriptTag({ content: "window.__inline = 1;" }).catch(() => undefined);
	await expect.poll(() => cspViolations.length).toBeGreaterThan(0);
	expect(cspViolations[0].directive).toMatch(/^script-src/);
	// Expected here; clear it so the fixture's own check passes.
	cspViolations.length = 0;
});
