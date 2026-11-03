import "../../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { createMemoryPlatform } from "$lib/platform/memory";
import { resetBasedOn } from "$lib/shared/credit.svelte";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import Harness from "./test-harness/Harness.svelte";

const credits = vi.hoisted(() => ({
	map: new Map<string, { name: string | null; displayName: string | null }>()
}));
vi.mock("$lib/shared/remote", () => ({
	sharedRemote: () =>
		Promise.resolve({
			credit: async (id: string) => {
				const c = credits.map.get(id);
				if (!c) throw new Error("not found");
				return c;
			}
		})
}));

beforeEach(async () => {
	await page.viewport(1280, 800);
	resetBasedOn();
	credits.map.clear();
	history.replaceState(null, "", "/workspace/");
});
afterEach(() => history.replaceState(null, "", "/workspace/"));

/** A dashboard copied from `copiedFrom`, open in the grid. */
async function renderCopy(copiedFrom: string | undefined, seed?: (id: string) => void) {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	const id = await app.index.createBlank();
	const session = (await app.sessions.get(id))!;
	if (copiedFrom) session.doc.copiedFrom = copiedFrom;
	seed?.(id);
	app.current = { session, isStarter: false };
	return render(Harness, { props: {}, context: new Map([[APP_CONTEXT_KEY, app]]) });
}

test("the header shows the credit line", async () => {
	credits.map.set("a", { name: "Class", displayName: "Ms. Lee" });
	await renderCopy("a");
	await expect.element(page.getByText("Based on Class by Ms. Lee")).toBeVisible();
});

test("the header shows the credit line without a display name", async () => {
	credits.map.set("b", { name: "Class", displayName: null });
	await renderCopy("b");
	await expect.element(page.getByText("Based on Class", { exact: true })).toBeVisible();
});

test("the header shows the credit line without a name", async () => {
	credits.map.set("c", { name: null, displayName: "Ms. Lee" });
	await renderCopy("c");
	await expect.element(page.getByText("Based on a shared dashboard by Ms. Lee")).toBeVisible();
});

test("the header shows the credit line with neither", async () => {
	credits.map.set("d", { name: null, displayName: null });
	await renderCopy("d");
	await expect
		.element(page.getByText("Based on a shared dashboard", { exact: true }))
		.toBeVisible();
});

test("the header shows nothing when the source is unknown", async () => {
	await renderCopy("nope");
	await expect.element(page.getByTestId("dashboard-header")).toBeVisible();
	await new Promise((r) => setTimeout(r, 50));
	expect(document.querySelector('[data-testid="based-on"]')).toBeNull();
});
