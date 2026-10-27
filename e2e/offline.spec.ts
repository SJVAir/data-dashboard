import { expect, test } from "./fixtures";

test("going offline shows the notice and coming back hides it", async ({ page, context }) => {
	await page.goto("/workspace/");
	const notice = page.getByRole("status").getByText("You're offline. Data may be out of date.");
	await expect(notice).toHaveCount(0);
	await context.setOffline(true);
	await expect(notice).toBeVisible();
	await context.setOffline(false);
	await expect(notice).toHaveCount(0);
});
