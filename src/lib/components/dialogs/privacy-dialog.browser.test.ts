import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import ClearDataDialog from "./ClearDataDialog.svelte";
import PrivacyDialog, { openPrivacy } from "./PrivacyDialog.svelte";
import HelpMenu from "../shell/HelpMenu.svelte";

async function setup() {
	const staticBase = new URL("https://s.example/static/workspace/");
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1",
		staticBase
	});
	return new Map([[APP_CONTEXT_KEY, app]]);
}

test("shows the title, every paragraph, and the notices link", async () => {
	const context = await setup();
	await render(PrivacyDialog, { context });
	openPrivacy();
	const dialog = page.getByRole("dialog");
	await expect.element(dialog.getByRole("heading", { name: m.privacy_title() })).toBeVisible();
	for (const text of [
		m.privacy_local(),
		m.privacy_server(),
		m.privacy_errors(),
		m.privacy_no_tracking(),
		m.privacy_clear()
	]) {
		await expect.element(dialog.getByText(text)).toBeVisible();
	}
	await expect
		.element(dialog.getByRole("link", { name: m.privacy_notices_link() }))
		.toHaveAttribute("href", "https://s.example/static/workspace/THIRD-PARTY-NOTICES.txt");
});

test("the Clear button opens the Clear my data dialog", async () => {
	const context = await setup();
	await render(ClearDataDialog, { context });
	await render(PrivacyDialog, { context });
	openPrivacy();
	await page.getByRole("button", { name: m.clear_data_button() }).click();
	await expect.element(page.getByRole("heading", { name: m.clear_title() })).toBeVisible();
});

test("the help menu offers the privacy note and a feedback link", async () => {
	const context = await setup();
	await render(PrivacyDialog, { context });
	await render(HelpMenu, { context });
	await page.getByRole("button", { name: m.help_menu() }).click();
	const feedback = page.getByRole("menuitem", { name: m.feedback_link() });
	await expect.element(feedback).toHaveAttribute("href", "https://www.sjvair.com/contact/");
	await expect.element(feedback).toHaveAttribute("target", "_blank");
	await expect.element(feedback).toHaveAttribute("rel", "noopener");
});

test("choosing the privacy item opens the dialog", async () => {
	const context = await setup();
	await render(PrivacyDialog, { context });
	await render(HelpMenu, { context });
	await page.getByRole("button", { name: m.help_menu() }).click();
	await page.getByRole("menuitem", { name: m.privacy_open() }).click();
	await expect.element(page.getByRole("dialog")).toBeVisible();
});
