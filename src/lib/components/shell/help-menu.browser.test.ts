import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import HelpMenu from "./HelpMenu.svelte";

afterEach(() => document.documentElement.removeAttribute("data-theme"));

async function setup() {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, {
		channel: createMemoryTabHub().channel(),
		tabId: "t1",
		loadSync: null
	});
	await render(HelpMenu, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await page.getByRole("button", { name: "Help" }).click();
	return { platform };
}

test("Appearance offers Light, Dark, and Match my device, with System checked", async () => {
	await setup();
	await expect.element(page.getByText("Appearance")).toBeVisible();
	await expect.element(page.getByRole("menuitemradio", { name: "Light" })).toBeVisible();
	await expect.element(page.getByRole("menuitemradio", { name: "Dark" })).toBeVisible();
	await expect
		.element(page.getByRole("menuitemradio", { name: "Match my device" }))
		.toHaveAttribute("aria-checked", "true");
});

test("choosing Dark sets data-theme and stores the choice", async () => {
	const { platform } = await setup();
	await page.getByRole("menuitemradio", { name: "Dark" }).click();
	expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
	expect(platform.display.theme()).toBe("dark");
	await expect
		.element(page.getByRole("menuitemradio", { name: "Dark" }))
		.toHaveAttribute("aria-checked", "true");
});

test("a change from another tab updates the checked item and the page", async () => {
	const { platform } = await setup();
	platform.display.setTheme("light");
	await expect
		.element(page.getByRole("menuitemradio", { name: "Light" }))
		.toHaveAttribute("aria-checked", "true");
	expect(document.documentElement.getAttribute("data-theme")).toBe("light");
});

test("the feedback link says it opens in a new tab and shows an icon", async () => {
	await setup();
	const link = page.getByRole("menuitem", { name: "Send feedback (opens in a new tab)" });
	await expect.element(link).toBeVisible();
	expect(link.element().querySelector("svg")).not.toBeNull();
});
