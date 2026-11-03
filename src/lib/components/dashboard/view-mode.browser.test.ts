import "../../../app.css";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { Dashboard, Rect, WidgetInstance } from "$lib/documents/schema";
import type { Arrangement } from "$lib/layout/arrangement.svelte";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp, type AppContext } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { PLACEHOLDER_TYPE } from "$lib/widgets/placeholder";
import { navigate } from "../../../router";
import Harness from "./test-harness/Harness.svelte";

const originalUrl = location.href;
beforeEach(async () => {
	await page.viewport(1280, 800);
	history.replaceState(null, "", "/workspace/shared/tok");
});
afterEach(() => {
	toast.dismiss();
	history.replaceState(null, "", originalUrl);
});

function widget(id: string, rect: Rect, title: string): WidgetInstance {
	return { id, type: PLACEHOLDER_TYPE, title, rect, data: { layers: [] } };
}

/**
 * Open the page on a deep link to `widget`. Through the router (there's no Router component here
 * to read the address on load), as the shared page's route will be.
 */
async function deepLink(widget: string) {
	await navigate("/shared/tok" as "/", { search: { widget }, replace: true, scrollToTop: false });
}

/** Someone else's dashboard, as the shared page has it (no session). */
function shared(widgets: WidgetInstance[]): Dashboard {
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id: "shared-1",
		name: "Class dashboard",
		version: 3,
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-01T00:00:00.000Z",
		body: { widgets }
	};
}

const three = () => [
	widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings"),
	widget("b", { x: 6, y: 0, w: 6, h: 4 }, "Map"),
	{ ...widget("c", { x: 0, y: 4, w: 6, h: 4 }, "Smoke"), minimized: { order: 0 } }
];

/** The grid in view mode; the app's own current dashboard (another one) is set to be ignored. */
async function renderView(doc: Dashboard, prepare?: (app: AppContext) => Promise<void>) {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	await prepare?.(app);
	let arrangement: Arrangement | null = null;
	const screen = await render(Harness, {
		props: { view: doc, onArrangement: (a: Arrangement) => (arrangement = a) },
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
	return { app, screen, arrangement: arrangement! };
}

/** An app whose current dashboard is its own (a starter-like page), with widget "z". */
async function withOwnDashboard(app: AppContext) {
	const id = await app.index.createBlank();
	const session = (await app.sessions.get(id))!;
	session.apply({
		op: "addWidget",
		target: { widgetId: "z" },
		widget: widget("z", { x: 0, y: 0, w: 4, h: 4 }, "Mine"),
		index: 0
	});
	app.current = { session, isStarter: true };
}

const frame = (id: string) => page.getByTestId(`widget-${id}`);
const titleBar = (name: string) => page.getByRole("group", { name });
const placeholder = (id: string) => document.querySelector<HTMLElement>(`[data-widget="${id}"]`);
const isFullscreen = (id: string) => placeholder(id)?.dataset.fullscreen === "true";
const menuItems = () =>
	[...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim());

test("view mode shows every widget in its place", async () => {
	await renderView(shared(three()), withOwnDashboard);
	await expect.element(titleBar("Readings")).toBeVisible();
	await expect.element(titleBar("Map")).toBeVisible();
	const a = frame("a").element().getBoundingClientRect();
	const b = frame("b").element().getBoundingClientRect();
	expect(b.top).toBeCloseTo(a.top, 0);
	expect(b.left).toBeGreaterThan(a.right - 1);
	expect(b.width).toBeCloseTo(a.width, 0);
	// The minimized one is in the taskbar, not on the grid.
	await expect.element(frame("c")).not.toBeInTheDocument();
	await expect.element(page.getByTestId("taskbar-c")).toBeVisible();
	// The app's own current dashboard isn't shown.
	await expect.element(frame("z")).not.toBeInTheDocument();
	expect(document.body.textContent).not.toContain("starter dashboard");
});

test("view mode has no handles, no menu edits, and no add button", async () => {
	await renderView(shared(three()), withOwnDashboard);
	await expect.element(titleBar("Readings")).toBeVisible();
	expect(document.querySelector("[data-resize]")).toBeNull();
	expect(document.querySelector('button[aria-label^="Minimize "]')).toBeNull();
	expect(document.querySelector('button[aria-label^="Restore "]')).toBeNull();
	await expect.element(page.getByRole("button", { name: "Add widget" })).not.toBeInTheDocument();
	await expect
		.element(page.getByRole("button", { name: "Dashboard actions" }))
		.not.toBeInTheDocument();
	// No arranging hint on the title bar.
	expect(titleBar("Readings").element().getAttribute("aria-description")).toBeNull();

	// The ⋯ menu and the right-click menu offer Fullscreen only.
	await page.getByRole("button", { name: "Actions for Readings" }).click();
	await expect.element(page.getByRole("menuitem", { name: "Fullscreen" })).toBeVisible();
	expect(menuItems()).toEqual(["Fullscreen"]);
	await userEvent.keyboard("{Escape}");
	await expect.element(page.getByRole("menuitem")).not.toBeInTheDocument();
	await titleBar("Readings").click({ button: "right" });
	await expect.element(page.getByRole("menuitem", { name: "Fullscreen" })).toBeVisible();
	expect(menuItems()).toEqual(["Fullscreen"]);
	await userEvent.keyboard("{Escape}");
	await expect.element(page.getByRole("menuitem")).not.toBeInTheDocument();

	// The dashboard has no actions: a right-click off the widgets opens no (empty) menu.
	const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
	document.querySelector("[data-flip-id]")!.parentElement!.dispatchEvent(event);
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(document.querySelector('[role="menu"]')).toBeNull();
	expect(event.defaultPrevented).toBe(false);

	// The taskbar item's menu too.
	await page.getByRole("button", { name: "Actions for Smoke" }).click();
	await expect.element(page.getByRole("menuitem", { name: "Fullscreen" })).toBeVisible();
	expect(menuItems()).toEqual(["Fullscreen"]);
	await userEvent.keyboard("{Escape}");
});

test("an empty view has no add button", async () => {
	await renderView(shared([]));
	await expect.element(page.getByText("This dashboard is empty.")).toBeVisible();
	await expect.element(page.getByRole("button", { name: "Add widget" })).not.toBeInTheDocument();
});

test("a key press never picks a widget up", async () => {
	const { arrangement } = await renderView(shared(three()));
	await expect.element(titleBar("Readings")).toBeVisible();
	titleBar("Readings").element().focus();
	for (const key of ["{Enter}", " ", "{ArrowRight}", "{Shift>}{ArrowDown}{/Shift}"]) {
		await userEvent.keyboard(key);
		expect(arrangement.active).toBeNull();
		expect(document.querySelector("[data-picked-up]")).toBeNull();
		expect(document.querySelector('[data-testid="arrange-hint"]')).toBeNull();
	}
});

// The harness has no Router listening for popstate, so leaving by Back (an entry this page pushed)
// is covered by the windowing tests on the app; here the exits replace a deep link's entry.
test("fullscreen works from the frame and from the taskbar", async () => {
	const first = await renderView(shared(three()));
	await page.getByRole("button", { name: "Show Readings fullscreen" }).click();
	await expect.poll(() => location.search).toBe("?widget=a");
	await expect.poll(() => isFullscreen("a")).toBe(true);
	// No ⋯ inside fullscreen: there's nothing left in its menu.
	expect(document.querySelector('[aria-label="Actions for Readings"]')).toBeNull();
	await first.screen.unmount();

	// A taskbar item opens its widget fullscreen; it stays minimized.
	history.replaceState(null, "", "/workspace/shared/tok");
	const second = await renderView(shared(three()));
	await page.getByRole("button", { name: "Show Smoke fullscreen" }).click();
	await expect.poll(() => location.search).toBe("?widget=c");
	await expect.poll(() => isFullscreen("c")).toBe(true);
	await second.screen.unmount();

	// And from the ⋯ menu.
	history.replaceState(null, "", "/workspace/shared/tok");
	await renderView(shared(three()));
	await page.getByRole("button", { name: "Actions for Map" }).click();
	await page.getByRole("menuitem", { name: "Fullscreen" }).click();
	await expect.poll(() => location.search).toBe("?widget=b");
	await expect.poll(() => isFullscreen("b")).toBe(true);
});

test("a deep link opens fullscreen in view mode, and Escape leaves it", async () => {
	await deepLink("b");
	await renderView(shared(three()));
	await expect.poll(() => isFullscreen("b")).toBe(true);
	expect(location.search).toBe("?widget=b");
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => location.search).toBe("");
	await expect.poll(() => isFullscreen("b")).toBe(false);
	await expect.poll(() => document.activeElement).toBe(titleBar("Map").element());
});

test("leaving a minimized widget's fullscreen focuses its taskbar item", async () => {
	await deepLink("c");
	await renderView(shared(three()));
	await expect.poll(() => isFullscreen("c")).toBe(true);
	await page.getByRole("button", { name: "Exit fullscreen" }).click();
	await expect.poll(() => location.search).toBe("");
	await expect.poll(() => placeholder("c")).toBeNull();
	await expect
		.poll(() => document.activeElement)
		.toBe(page.getByRole("button", { name: "Show Smoke fullscreen" }).element());
});

test("a deep link to a widget not in the view drops the parameter with a notice", async () => {
	await deepLink("nope");
	await renderView(shared(three()));
	await expect.poll(() => location.search).toBe("");
	await expect.element(page.getByText("isn't on this dashboard", { exact: false })).toBeVisible();
});

test("view mode passes axe", async () => {
	const { screen } = await renderView(shared(three()));
	await expect.element(titleBar("Readings")).toBeVisible();
	const results = await axe.run(screen.container);
	expect(results.violations).toEqual([]);
});
