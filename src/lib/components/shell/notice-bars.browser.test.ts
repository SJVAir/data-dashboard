import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { updateNotice } from "$lib/safety/update-notice.svelte";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import NoticeBars from "./NoticeBars.svelte";

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
