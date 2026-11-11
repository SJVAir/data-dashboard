import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { notifyEnabled, setNotifyEnabled } from "$lib/thresholds/notify-pref";
import NotificationsDialog from "./NotificationsDialog.svelte";
import { notifications, openNotifications } from "./lazy.svelte";

async function setup() {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, {
		channel: createMemoryTabHub().channel(),
		tabId: "t1",
		staticBase: new URL("https://s.example/static/workspace/")
	});
	await render(NotificationsDialog, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	return { platform, app };
}

const switchBox = () => page.getByRole("switch", { name: m.notifications_switch_desktop() });

test("off by default; on asks once and a grant is stored for this dashboard only", async () => {
	const { platform, app } = await setup();
	let asks = 0;
	const request = platform.notifications.request.bind(platform.notifications);
	platform.notifications.request = () => (asks++, request());
	openNotifications("doc-a");
	await expect.element(switchBox(), { timeout: 3000 }).not.toBeChecked();
	expect(asks).toBe(0);
	await switchBox().click();
	await expect.element(switchBox()).toBeChecked();
	expect(asks).toBe(1);
	expect(await notifyEnabled(platform, app.space, "doc-a")).toBe(true);
	expect(await notifyEnabled(platform, app.space, "doc-b")).toBe(false);
	await switchBox().click();
	await expect.element(switchBox()).not.toBeChecked();
	expect(await notifyEnabled(platform, app.space, "doc-a")).toBe(false);
	notifications.open = false;
});

test("shows the stored value", async () => {
	const { platform, app } = await setup();
	platform.notifications.script("granted");
	await platform.notifications.request();
	await setNotifyEnabled(platform, app.space, "doc-c", true);
	openNotifications("doc-c");
	await expect.element(switchBox(), { timeout: 3000 }).toBeChecked();
	notifications.open = false;
});

test("denied stays off with the help text", async () => {
	const { platform, app } = await setup();
	platform.notifications.script("denied");
	openNotifications("doc-a");
	await expect.element(switchBox(), { timeout: 3000 }).not.toBeChecked();
	await switchBox().click();
	await expect.element(page.getByText(m.notifications_denied())).toBeVisible();
	await expect.element(switchBox()).not.toBeChecked();
	expect(await notifyEnabled(platform, app.space, "doc-a")).toBe(false);
	notifications.open = false;
});

test("dismissed (default) stays off with no message", async () => {
	const { platform } = await setup();
	platform.notifications.script("default");
	openNotifications("doc-a");
	await expect.element(switchBox(), { timeout: 3000 }).not.toBeChecked();
	await switchBox().click();
	await expect.element(switchBox()).not.toBeChecked();
	expect(page.getByText(m.notifications_denied()).elements()).toHaveLength(0);
	notifications.open = false;
});

test("already denied on open: off with the help text", async () => {
	const { platform, app } = await setup();
	await setNotifyEnabled(platform, app.space, "doc-a", true);
	platform.notifications.script("denied");
	await platform.notifications.request();
	openNotifications("doc-a");
	await expect.element(page.getByText(m.notifications_denied()), { timeout: 3000 }).toBeVisible();
	await expect.element(switchBox()).not.toBeChecked();
	notifications.open = false;
});

test("unsupported: disabled, with the reason as visible text tied to the switch", async () => {
	const { platform } = await setup();
	platform.notifications.script("unsupported");
	openNotifications("doc-a");
	await expect.element(switchBox(), { timeout: 3000 }).toBeDisabled();
	await expect.element(page.getByText(m.notifications_unsupported())).toBeVisible();
	await expect.element(switchBox()).toHaveAccessibleDescription(m.notifications_unsupported());
	notifications.open = false;
});
