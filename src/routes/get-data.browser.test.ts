import "../app.css";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { commands, page, userEvent } from "vitest/browser";
import TopNav from "$lib/components/shell/TopNav.svelte";
import type { Dashboard } from "$lib/documents/schema";
import { ADDED_HIGHLIGHT_MS } from "$lib/layout/focus-request.svelte";
import { createMemoryPlatform } from "$lib/platform/memory";
import { blankDashboard, STARTER_ID } from "$lib/starter/starter";
import { APP_CONTEXT_KEY, LAST_OPENED_KEY, initApp, type AppContext } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import App from "../App.svelte";
import { navigate } from "../router";
import GetData from "./GetData.svelte";

declare module "vitest/browser" {
	interface BrowserCommands {
		setReducedMotion: (reduce: boolean | null) => Promise<void>;
	}
}

// The view below the heading runs queries; a client with no adapters keeps them local.
vi.mock("$lib/data", async () => {
	const { createQueryClient } = await import("$lib/data/query/client");
	const { fixtureMetadata } = await import("$lib/data/testing/fixtures");
	const metadata = fixtureMetadata();
	const regions = { resolve: async () => null };
	const client = createQueryClient({ adapters: [], metadata, regions });
	return {
		adapterIds: () => [],
		getQueryClient: () => client,
		getMetadata: () => metadata,
		getResolvers: () => ({
			regions,
			locations: { resolve: async () => null },
			points: { keys: async () => [] }
		}),
		placeRegion: async () => null
	};
});

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

// Add to dashboard ----------------------------------------------------------------------------

/** Where a test opens the app (the router's own navigation, so it shows no route from before). */
const fromDashboard = () =>
	navigate("/dashboards/:id/widgets/new", { params: { id: "d1" }, search: { type: "chart" } });
const fromNav = () => navigate("/data");

/**
 * The whole app over dashboards named `names` (stored oldest first: d1, d2, …), opened by `go`,
 * with `lastOpened` as the last-opened dashboard.
 */
async function appAt(go: () => Promise<unknown>, names: string[] = [], lastOpened?: string) {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	for (const [i, name] of names.entries()) {
		const doc: Dashboard = {
			...blankDashboard(new Date(Date.UTC(2026, 10, 1 + i))),
			id: `d${i + 1}`,
			name
		};
		await platform.documents.commit(app.space, {
			docId: doc.id,
			baseVersion: null,
			doc,
			entries: []
		});
	}
	if (lastOpened) await platform.preferences.set(app.space, LAST_OPENED_KEY, lastOpened);
	await app.index.refresh();
	await go();
	await render(App, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	return app;
}

const addButton = (name: string) => page.getByRole("button", { name: `Add to ${name}` });

/** The one widget added to `app`'s current dashboard, once that dashboard shows it. */
async function landed(app: AppContext, id: string) {
	await expect.poll(() => location.pathname).toBe(`/workspace/dashboards/${id}`);
	await expect.poll(() => app.current.session?.doc.body.widgets.length).toBe(1);
	const widget = app.current.session!.doc.body.widgets[0];
	const frame = page.getByTestId(`widget-${widget.id}`);
	await expect.element(frame).toBeVisible();
	return { widget, frame: frame.element() as HTMLElement };
}

const focusedIn = (frame: HTMLElement) => frame.contains(document.activeElement);

test("Add to the dashboard you came from: lands there with the widget focused and highlighted; one Undo removes it", async () => {
	const app = await appAt(fromDashboard, ["Home", "School"]);
	await addButton("Home").click();
	const { frame } = await landed(app, "d1");
	await expect.poll(() => focusedIn(frame)).toBe(true);
	expect(frame.hasAttribute("data-added")).toBe(true);
	expect(getComputedStyle(frame).animationName).toBe("widget-added");
	// The highlight goes after 2 s.
	await expect
		.poll(() => frame.hasAttribute("data-added"), { timeout: ADDED_HIGHLIGHT_MS + 2000 })
		.toBe(false);
	await userEvent.keyboard("{Control>}z{/Control}");
	expect(app.current.session!.doc.body.widgets).toEqual([]);
	expect(app.current.session!.canUndo).toBe(false);
});

test("from /data the target is the last-opened dashboard; the menu lists the others and New dashboard", async () => {
	const app = await appAt(fromNav, ["Home", "School"], "d2");
	await expect.element(addButton("School")).toBeVisible();
	await page.getByRole("button", { name: "Add to another dashboard" }).click();
	const items = page.getByRole("menuitem");
	await expect.element(items.first()).toBeVisible();
	expect(items.elements().map((e) => e.textContent?.trim())).toEqual(["Home", "New dashboard"]);
	await page.getByRole("menuitem", { name: "New dashboard" }).click();
	await expect.poll(() => app.index.items.length).toBe(3);
	const created = app.index.items.find((d) => d.id !== "d1" && d.id !== "d2")!;
	await landed(app, created.id);
});

test("with no dashboards, Add to Starter dashboard makes the copy and lands on it", async () => {
	const app = await appAt(fromNav);
	await addButton("Starter dashboard").click();
	await expect.poll(() => location.pathname).not.toBe("/workspace/data");
	const copy = app.current.session!;
	expect(copy.doc.id).not.toBe(STARTER_ID);
	expect(copy.doc.copiedFrom).toBe(STARTER_ID);
	await expect.poll(() => location.pathname).toBe(`/workspace/dashboards/${copy.doc.id}`);
	const added = copy.doc.body.widgets.at(-1)!;
	expect(added.type).toBe("chart");
	const frame = page.getByTestId(`widget-${added.id}`);
	await expect.poll(() => focusedIn(frame.element() as HTMLElement)).toBe(true);
	// Undo takes the widget off and keeps the copy.
	await userEvent.keyboard("{Control>}z{/Control}");
	expect(app.current.session!.doc.body.widgets.map((w) => w.id)).not.toContain(added.id);
	expect(app.current.session!.doc.id).toBe(copy.doc.id);
});

test("with reduced motion the added widget is focused, not animated", async () => {
	await commands.setReducedMotion(true);
	try {
		const app = await appAt(fromDashboard, ["Home"]);
		await addButton("Home").click();
		const { frame } = await landed(app, "d1");
		await expect.poll(() => focusedIn(frame)).toBe(true);
		expect(getComputedStyle(frame).animationName).toBe("none");
	} finally {
		await commands.setReducedMotion(null);
	}
});
