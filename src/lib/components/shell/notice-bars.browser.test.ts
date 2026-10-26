import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { refreshEntryFiles, reloadPage } from "$lib/safety/reload";
import { updateNotice } from "$lib/safety/update-notice.svelte";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import NoticeBars from "./NoticeBars.svelte";

vi.mock("$lib/safety/build-id", () => ({ BUILD_ID: "abc123" }));
vi.mock("$lib/safety/reload", () => ({
	refreshEntryFiles: vi.fn(async () => {}),
	reloadPage: vi.fn()
}));

afterEach(() => {
	updateNotice.reason = null;
});

test("the reload bar appears inside a live region that was already there", async () => {
	updateNotice.reason = null;
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	const view = await render(NoticeBars, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	const regions = view.container.querySelectorAll('[role="status"]');
	expect(regions.length).toBeGreaterThan(0);
	const first = regions[0];
	expect(first.textContent?.trim()).toBe("");

	updateNotice.show("new-version");
	await expect.element(page.getByText(m.update_available())).toBeVisible();
	// The same element, not one mounted with the text.
	expect(view.container.querySelector('[role="status"]')).toBe(first);
	expect(first.textContent).toContain(m.update_available());
});

test("reload refreshes the cached entry files before reloading the page", async () => {
	const staticBase = new URL("https://s.example/static/workspace/");
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1",
		staticBase
	});
	const order: string[] = [];
	vi.mocked(refreshEntryFiles).mockImplementationOnce(async () => {
		order.push("refresh");
	});
	vi.mocked(reloadPage).mockImplementationOnce(() => {
		order.push("reload");
	});
	await render(NoticeBars, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	updateNotice.show("new-version");
	await page.getByRole("button", { name: m.update_reload() }).click();
	await vi.waitFor(() => expect(order).toEqual(["refresh", "reload"]));
	expect(refreshEntryFiles).toHaveBeenCalledWith(staticBase);
});

test("the offline bar shows while the platform is offline and hides when it is back", async () => {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	await render(NoticeBars, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect.element(page.getByText(m.offline_notice())).not.toBeInTheDocument();

	platform.online.setOnline(false);
	await expect.element(page.getByText(m.offline_notice())).toBeVisible();

	platform.online.setOnline(true);
	await expect.element(page.getByText(m.offline_notice())).not.toBeInTheDocument();
});
