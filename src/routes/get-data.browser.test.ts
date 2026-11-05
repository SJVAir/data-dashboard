import "../app.css";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import TopNav from "$lib/components/shell/TopNav.svelte";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { navigate } from "../router";
import GetData from "./GetData.svelte";

const originalUrl = location.href;
afterEach(() => {
	history.replaceState(null, "", originalUrl);
});

async function setup() {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	return new Map([[APP_CONTEXT_KEY, app]]);
}

test("at /data the heading takes focus and the Data nav link is current", async () => {
	const context = await setup();
	await navigate("/data");
	await render(TopNav, { context });
	await render(GetData, { context });
	const heading = page.getByRole("heading", { name: "Get data" });
	await expect.element(heading).toHaveFocus();
	await expect
		.element(page.getByRole("link", { name: "Data" }))
		.toHaveAttribute("aria-current", "page");
});

test("the edit route says Edit data", async () => {
	const context = await setup();
	await navigate("/dashboards/:id/widgets/:widgetId/edit", {
		params: { id: "d1", widgetId: "w1" }
	});
	await render(GetData, { context });
	await expect.element(page.getByRole("heading", { name: "Edit data" })).toBeVisible();
});
