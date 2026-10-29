import "../../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { commands, page, userEvent } from "vitest/browser";
import { handleUndoShortcut } from "$lib/actions/global";
import type { Dashboard, Rect, WidgetInstance } from "$lib/documents/schema";
import type { Arrangement } from "$lib/layout/arrangement.svelte";
import { createMemoryPlatform } from "$lib/platform/memory";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { pendingFocusTarget } from "$lib/layout/focus-request.svelte";
import { FULLSCREEN_STATE } from "$lib/layout/fullscreen";
import { minimizeChange, restoreChange } from "$lib/layout/windowing";
import { APP_CONTEXT_KEY, initApp, type AppContext } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { PLACEHOLDER_TYPE } from "$lib/widgets/placeholder";
import App from "../../../App.svelte";
import { navigate, route } from "../../../router";
import Harness from "./test-harness/Harness.svelte";

declare module "vitest/browser" {
	interface BrowserCommands {
		setReducedMotion: (reduce: boolean | null) => Promise<void>;
	}
}

const originalUrl = location.href;
let removeUndo: (() => void) | null = null;
beforeEach(async () => {
	await page.viewport(1280, 800);
});
afterEach(() => {
	toast.dismiss();
	removeUndo?.();
	removeUndo = null;
	history.replaceState(null, "", originalUrl);
});

function widget(id: string, rect: Rect, title: string): WidgetInstance {
	return { id, type: PLACEHOLDER_TYPE, title, rect, data: { layers: [] } };
}

async function seed(widgets: WidgetInstance[], onArrangement?: (a: Arrangement) => void) {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const id = await app.index.createBlank();
	const stored = (await platform.documents.get(app.space, id)) as Dashboard;
	await platform.documents.commit(app.space, {
		docId: id,
		baseVersion: stored.version,
		doc: { ...stored, body: { widgets } },
		entries: []
	});
	const session = (await DocumentSession.open(platform, app.space, id, "t2"))!;
	app.current = { session, isStarter: false };
	const screen = await render(Harness, {
		props: { onArrangement },
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
	const onKey = (e: KeyboardEvent) => handleUndoShortcut(app, e);
	window.addEventListener("keydown", onKey);
	removeUndo = () => window.removeEventListener("keydown", onKey);
	return { app, session, screen };
}

const halves = () => [
	widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings"),
	widget("b", { x: 6, y: 0, w: 6, h: 4 }, "Map")
];
const liveText = () =>
	document.querySelector('[role="status"][aria-live="polite"][aria-atomic="true"]')?.textContent;
const titleBar = (name: string) => page.getByRole("group", { name });
const item = (name: string) => page.getByRole("button", { name: `Restore ${name}` });

test("Minimize moves the widget to the taskbar, focuses its item, and announces", async () => {
	const { session } = await seed([
		widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings"),
		widget("b", { x: 0, y: 4, w: 6, h: 4 }, "Map")
	]);
	const before = { ...session.doc.body.widgets.find((w) => w.id === "b")!.rect };
	await expect.element(titleBar("Readings")).toBeVisible();
	const top = page.getByTestId("widget-a").element().getBoundingClientRect().top;
	await page.getByRole("button", { name: "Minimize Readings" }).click();
	await expect.poll(liveText).toBe("Readings minimized to taskbar.");
	await expect.element(item("Readings")).toBeVisible();
	await expect.poll(() => document.activeElement).toBe(item("Readings").element());
	expect(session.doc.body.widgets.find((w) => w.id === "a")!.minimized).toBeDefined();
	// The rest of the grid closes up: Map moves up into Readings' row.
	await expect
		.poll(() => page.getByTestId("widget-b").element().getBoundingClientRect().top)
		.toBe(top);
	// One undo entry; undo restores the exact rect.
	session.undo();
	expect(session.canUndo).toBe(false);
	expect(session.doc.body.widgets.find((w) => w.id === "a")!.minimized).toBeUndefined();
	expect(session.doc.body.widgets.find((w) => w.id === "a")!.rect).toEqual({
		x: 0,
		y: 0,
		w: 6,
		h: 4
	});
	expect(session.doc.body.widgets.find((w) => w.id === "b")!.rect).toEqual(before);
	await expect.element(titleBar("Readings")).toBeVisible();
});

test("Ctrl+Z after Minimize restores the rect and focuses the title bar", async () => {
	const { session } = await seed(halves());
	await page.getByRole("button", { name: "Minimize Readings" }).click();
	await expect.poll(() => document.activeElement).toBe(item("Readings").element());
	await userEvent.keyboard("{Control>}z{/Control}");
	expect(session.doc.body.widgets.find((w) => w.id === "a")!.minimized).toBeUndefined();
	expect(session.doc.body.widgets.find((w) => w.id === "a")!.rect).toEqual({
		x: 0,
		y: 0,
		w: 6,
		h: 4
	});
	await expect.poll(() => document.activeElement).toBe(titleBar("Readings").element());
});

test("a taskbar request isn't re-issued when focus had left the bar", async () => {
	const { screen } = await seed(halves());
	await page.getByRole("button", { name: "Minimize Readings" }).click();
	await expect.poll(() => document.activeElement).toBe(item("Readings").element());
	(document.activeElement as HTMLElement).blur();
	await Promise.resolve();
	await screen.unmount();
	expect(pendingFocusTarget()).toBeNull();
});

test("Minimize from the ⋯ menu does the same", async () => {
	const { session } = await seed(halves());
	await page.getByRole("button", { name: "Actions for Readings" }).click();
	await page.getByRole("menuitem", { name: "Minimize" }).click();
	await expect.poll(liveText).toBe("Readings minimized to taskbar.");
	expect(session.doc.body.widgets.find((w) => w.id === "a")!.minimized).toBeDefined();
	await expect.poll(() => document.activeElement).toBe(item("Readings").element());
});

test("Restore from the taskbar item's menu focuses the title bar", async () => {
	await seed(halves());
	await page.getByRole("button", { name: "Minimize Readings" }).click();
	await expect.element(item("Readings")).toBeVisible();
	await page.getByRole("button", { name: "Actions for Readings" }).last().click();
	await page.getByRole("menuitem", { name: "Restore" }).click();
	await expect.poll(liveText).toBe("Readings restored.");
	await expect.poll(() => document.activeElement).toBe(titleBar("Readings").element());
});

test("a widget picked up by keyboard is cancelled by minimizing it", async () => {
	let arr: Arrangement | undefined;
	const { session } = await seed(halves(), (a) => (arr = a));
	const bar = titleBar("Readings");
	await expect.element(bar).toBeVisible();
	(bar.element() as HTMLElement).focus();
	await userEvent.keyboard("{Enter}");
	await userEvent.keyboard("{ArrowDown}");
	expect(arr!.active).not.toBeNull();
	await page.getByRole("button", { name: "Minimize Readings" }).click();
	await expect.element(item("Readings")).toBeVisible();
	expect(arr!.active).toBeNull();
	const w = session.doc.body.widgets.find((x) => x.id === "a")!;
	expect(w.rect).toEqual({ x: 0, y: 0, w: 6, h: 4 });
	session.undo();
	expect(session.canUndo).toBe(false);
});

test("minimize on the starter makes the copy and focuses the taskbar item", async () => {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	history.replaceState(null, "", "/workspace/");
	await render(App, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect
		.element(page.getByText("This is the starter dashboard.", { exact: false }))
		.toBeVisible();
	const starter = app.current.session!;
	await page
		.getByTestId("widget-starter-1")
		.getByRole("button", { name: /^Minimize/ })
		.click();
	await expect.poll(() => app.current.session).not.toBe(starter);
	const copy = app.current.session!;
	expect(copy.doc.body.widgets.find((w) => w.id === "starter-1")!.minimized).toBeDefined();
	await expect
		.poll(() => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") ?? "")
		.toMatch(/^Restore /);
	expect(document.activeElement?.closest('[role="toolbar"]')).not.toBeNull();
});

test("no Minimize on a read-only dashboard", async () => {
	const { session } = await seed(halves());
	session.readOnly = "newer";
	await expect.element(page.getByText("newer version", { exact: false })).toBeVisible();
	expect(document.querySelectorAll('[data-testid^="widget-"]').length).toBe(0);
	expect(document.querySelector('[role="toolbar"]')).toBeNull();
	expect(document.querySelector('[aria-label^="Minimize"]')).toBeNull();
});

// Fullscreen (Task 6) ------------------------------------------------------------------------

/** The app with the router at `url`, over a stored dashboard holding `widgets`. */
async function seedApp(
	widgets: WidgetInstance[],
	url: (id: string) => string = (id) => `/workspace/dashboards/${id}`,
	prepare?: (app: AppContext) => void
) {
	const platform = createMemoryPlatform();
	const hub = createMemoryTabHub();
	const app = await initApp(platform, { channel: hub.channel(), tabId: "t1" });
	prepare?.(app);
	const id = await app.index.createBlank();
	const stored = (await platform.documents.get(app.space, id)) as Dashboard;
	await platform.documents.commit(app.space, {
		docId: id,
		baseVersion: stored.version,
		doc: { ...stored, body: { widgets } },
		entries: []
	});
	history.replaceState(null, "", url(id));
	const screen = await render(App, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	return { platform, hub, app, id, screen };
}

const placeholder = (id: string) => document.querySelector<HTMLElement>(`[data-widget="${id}"]`);

test("the page doesn't remount when only the query changes", async () => {
	const { id } = await seedApp(halves());
	await expect.poll(() => placeholder("a")).not.toBeNull();
	const before = placeholder("a")!;
	(before as HTMLElement & { marked?: boolean }).marked = true;
	await navigate("/dashboards/:id", {
		params: { id },
		search: { widget: "a" },
		scrollToTop: false
	});
	expect(location.search).toBe("?widget=a");
	expect(placeholder("a")).toBe(before);
});

const frame = (id: string) => page.getByTestId(`widget-${id}`);
const isFullscreen = (id: string) => placeholder(id)?.dataset.fullscreen === "true";
/** Let a FLIP animation on `el` finish, so its box is where it'll stay. */
const settled = async (el: Element) =>
	void (await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {}))));
const focusIn = (id: string) => !!document.activeElement?.closest(`[data-testid="widget-${id}"]`);

async function openFromButton(name: string) {
	await page.getByRole("button", { name: `Show ${name} fullscreen` }).click();
}

test("Fullscreen covers the dashboard area and keeps the widget mounted", async () => {
	const { app } = await seedApp(halves());
	await expect.poll(() => placeholder("a")).not.toBeNull();
	const before = placeholder("a");
	await openFromButton("Readings");
	await expect.poll(() => location.search).toBe("?widget=a");
	await expect.poll(() => isFullscreen("a")).toBe(true);
	expect(placeholder("a")).toBe(before);
	const el = frame("a").element();
	await settled(el);
	const box = el.getBoundingClientRect();
	const main = document.querySelector("main")!.getBoundingClientRect();
	expect(box.top).toBeCloseTo(main.top, 0);
	expect(box.bottom).toBeCloseTo(innerHeight, 0);
	expect(box.left).toBeCloseTo(0, 0);
	expect(box.width).toBeCloseTo(document.documentElement.clientWidth, 0);
	// The rest of the dashboard is inert; the fullscreen widget isn't.
	expect(frame("b").element().closest("[inert]")).not.toBeNull();
	expect(page.getByRole("button", { name: "Add widget" }).element().closest("[inert]")).not.toBe(
		null
	);
	expect(el.closest("[inert]")).toBeNull();
	// Focus moved into it, and fullscreen isn't an edit.
	await expect.poll(() => focusIn("a")).toBe(true);
	expect(app.current.session!.canUndo).toBe(false);
});

test("Tab is trapped in the fullscreen widget", async () => {
	await seedApp(halves());
	await openFromButton("Readings");
	await expect.poll(() => isFullscreen("a")).toBe(true);
	const more = page.getByRole("button", { name: "Actions for Readings" });
	(more.element() as HTMLElement).focus();
	await userEvent.keyboard("{Tab}");
	expect(document.activeElement).toBe(titleBar("Readings").element());
	await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
	expect(document.activeElement).toBe(more.element());
});

test("Escape exits, focus returns to the title bar", async () => {
	await seedApp(halves());
	await openFromButton("Readings");
	await expect.poll(() => isFullscreen("a")).toBe(true);
	await expect.poll(() => focusIn("a")).toBe(true);
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => location.search).toBe("");
	await expect.poll(() => isFullscreen("a")).toBe(false);
	await expect.poll(() => document.activeElement).toBe(titleBar("Readings").element());
	expect(frame("b").element().closest("[inert]")).toBeNull();
});

test("the close button exits", async () => {
	await seedApp(halves());
	await openFromButton("Readings");
	await expect.poll(() => isFullscreen("a")).toBe(true);
	// Inside fullscreen, the title bar has Exit instead of Minimize and Fullscreen.
	expect(frame("a").element().querySelector('[aria-label^="Minimize"]')).toBeNull();
	expect(frame("a").element().querySelector('[aria-label^="Show"]')).toBeNull();
	await page.getByRole("button", { name: "Exit fullscreen" }).click();
	await expect.poll(() => location.search).toBe("");
	await expect.poll(() => document.activeElement).toBe(titleBar("Readings").element());
});

test("Back exits", async () => {
	await seedApp(halves());
	await openFromButton("Readings");
	await expect.poll(() => isFullscreen("a")).toBe(true);
	// Opening pushed an entry of ours.
	expect(route.state).toEqual(FULLSCREEN_STATE);
	history.back();
	await expect.poll(() => location.search).toBe("");
	await expect.poll(() => isFullscreen("a")).toBe(false);
	await expect.poll(() => document.activeElement).toBe(titleBar("Readings").element());
});

test("exit replaces when the page was opened on the link", async () => {
	const { id } = await seedApp(halves(), (id) => `/workspace/dashboards/${id}?widget=a`);
	await expect.poll(() => isFullscreen("a")).toBe(true);
	const length = history.length;
	await expect.poll(() => focusIn("a")).toBe(true);
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => location.search).toBe("");
	expect(location.pathname).toBe(`/workspace/dashboards/${id}`);
	expect(history.length).toBe(length);
	await expect.poll(() => document.activeElement).toBe(titleBar("Readings").element());
});

test("Escape in an open menu closes only the menu", async () => {
	await seedApp(halves());
	await openFromButton("Readings");
	await expect.poll(() => isFullscreen("a")).toBe(true);
	await page.getByRole("button", { name: "Actions for Readings" }).click();
	await expect.element(page.getByRole("menuitem", { name: "Rename widget…" })).toBeVisible();
	// Inside fullscreen, Move…, Resize…, Minimize, and Fullscreen leave the menu.
	for (const name of ["Move…", "Resize…", "Minimize", "Fullscreen"]) {
		expect(page.getByRole("menuitem", { name, exact: true }).elements()).toHaveLength(0);
	}
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();
	expect(location.search).toBe("?widget=a");
	expect(isFullscreen("a")).toBe(true);
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => location.search).toBe("");
});

test("Fullscreen from the widget's ⋯ menu", async () => {
	await seedApp(halves());
	await page.getByRole("button", { name: "Actions for Readings" }).click();
	await page.getByRole("menuitem", { name: "Fullscreen" }).click();
	await expect.poll(() => isFullscreen("a")).toBe(true);
	await expect.poll(() => focusIn("a")).toBe(true);
});

test("a minimized widget opens fullscreen and stays minimized", async () => {
	const { app } = await seedApp([
		{ ...widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings"), minimized: { order: 0 } },
		widget("b", { x: 6, y: 0, w: 6, h: 4 }, "Map")
	]);
	await expect.element(item("Readings")).toBeVisible();
	const doc = app.current.session!.doc;
	await page.getByRole("button", { name: "Actions for Readings" }).click();
	await page.getByRole("menuitem", { name: "Fullscreen" }).click();
	await expect.poll(() => isFullscreen("a")).toBe(true);
	await expect.poll(() => focusIn("a")).toBe(true);
	expect(item("Readings").element().closest("[inert]")).not.toBeNull();
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => location.search).toBe("");
	await expect.poll(() => placeholder("a")).toBeNull();
	await expect.poll(() => document.activeElement).toBe(item("Readings").element());
	expect(app.current.session!.doc).toBe(doc);
	expect(app.current.session!.canUndo).toBe(false);
});

test("a deep link waits for the dashboard to load", async () => {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const id = await app.index.createBlank();
	const stored = (await platform.documents.get(app.space, id)) as Dashboard;
	await platform.documents.commit(app.space, {
		docId: id,
		baseVersion: stored.version,
		doc: { ...stored, body: { widgets: halves() } },
		entries: []
	});
	const get = app.sessions.get.bind(app.sessions);
	let release: () => void = () => {};
	const held = new Promise<void>((resolve) => (release = resolve));
	app.sessions.get = async (...args) => {
		await held;
		return get(...args);
	};
	history.replaceState(null, "", `/workspace/dashboards/${id}?widget=a`);
	await render(App, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(location.search).toBe("?widget=a");
	expect(document.body.textContent).not.toContain("isn't on this dashboard");
	release();
	await expect.poll(() => isFullscreen("a")).toBe(true);
	expect(location.search).toBe("?widget=a");
});

test("a deep link to a missing widget drops the parameter with a notice", async () => {
	const { id } = await seedApp(halves(), (id) => `/workspace/dashboards/${id}?widget=zzz`);
	const length = history.length;
	await expect
		.element(page.getByText("That widget isn't on this dashboard anymore."))
		.toBeVisible();
	expect(location.search).toBe("");
	expect(location.pathname).toBe(`/workspace/dashboards/${id}`);
	expect(history.length).toBe(length);
	expect(document.querySelector('[data-fullscreen="true"]')).toBeNull();
});

async function otherTab(
	platform: ReturnType<typeof createMemoryPlatform>,
	hub: ReturnType<typeof createMemoryTabHub>,
	app: Awaited<ReturnType<typeof initApp>>,
	id: string
) {
	return (await DocumentSession.open(platform, app.space, id, "t9", { channel: hub.channel() }))!;
}

/** The router's index of the current history entry (a push adds one; a replace keeps it). */
const entryIndex = () => (history.state as { _routerIndex: number })._routerIndex;
const toastTexts = () =>
	Array.from(document.querySelectorAll("[data-sonner-toast]"), (t) => t.textContent ?? "");

test("a fullscreen widget deleted in another tab exits", async () => {
	const { platform, hub, app, id } = await seedApp(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const before = entryIndex();
	await openFromButton("Readings");
	await expect.poll(() => isFullscreen("a")).toBe(true);
	expect(entryIndex()).toBe(before + 1);
	const other = await otherTab(platform, hub, app, id);
	const w = other.doc.body.widgets[0];
	other.apply({ op: "removeWidget", target: { widgetId: "a" }, widget: w, index: 0 });
	await other.flush();
	await expect
		.element(page.getByText("That widget isn't on this dashboard anymore."))
		.toBeVisible();
	await expect.poll(() => location.search).toBe("");
	// Back to the entry it was opened from (a replace would leave a second dashboard entry).
	expect(entryIndex()).toBe(before);
	expect(frame("b").element().closest("[inert]")).toBeNull();
	other.dispose();
});

test("a deep-linked widget deleted in another tab replaces the entry", async () => {
	const { platform, hub, app, id } = await seedApp(
		halves(),
		(id) => `/workspace/dashboards/${id}?widget=a`
	);
	await expect.poll(() => isFullscreen("a")).toBe(true);
	const before = entryIndex();
	const length = history.length;
	const other = await otherTab(platform, hub, app, id);
	const w = other.doc.body.widgets[0];
	other.apply({ op: "removeWidget", target: { widgetId: "a" }, widget: w, index: 0 });
	await other.flush();
	await expect.poll(() => location.search).toBe("");
	expect(location.pathname).toBe(`/workspace/dashboards/${id}`);
	expect(entryIndex()).toBe(before);
	expect(history.length).toBe(length);
	other.dispose();
});

test("Delete in fullscreen exits with one toast and no extra history entry", async () => {
	const { app } = await seedApp(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const before = entryIndex();
	await openFromButton("Readings");
	await expect.poll(() => isFullscreen("a")).toBe(true);
	await page.getByRole("button", { name: "Actions for Readings" }).click();
	await page.getByRole("menuitem", { name: "Delete widget" }).click();
	await expect.element(page.getByText("Widget deleted")).toBeVisible();
	await expect.poll(() => location.search).toBe("");
	expect(entryIndex()).toBe(before);
	expect(app.current.session!.doc.body.widgets.map((x) => x.id)).toEqual(["b"]);
	// Give a stray notice time to appear.
	await new Promise((resolve) => setTimeout(resolve, 100));
	// Only Delete's own toast (others may linger from earlier tests).
	expect(toastTexts().some((t) => t.includes("isn't on this dashboard"))).toBe(false);
	expect(toastTexts().filter((t) => t.includes("Widget deleted"))).toHaveLength(1);
	expect(frame("b").element().closest("[inert]")).toBeNull();
});

test("a deep link on a read-only dashboard drops the parameter silently", async () => {
	const { id } = await seedApp(
		halves(),
		(id) => `/workspace/dashboards/${id}?widget=a`,
		(app) => {
			const get = app.sessions.get.bind(app.sessions);
			app.sessions.get = async (...args) => {
				const session = await get(...args);
				if (session) session.readOnly = "newer";
				return session;
			};
		}
	);
	await expect.element(page.getByText("newer version", { exact: false })).toBeVisible();
	await expect.poll(() => location.search).toBe("");
	expect(location.pathname).toBe(`/workspace/dashboards/${id}`);
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(toastTexts().some((t) => t.includes("isn't on this dashboard"))).toBe(false);
});

test("minimized in another tab stays fullscreen", async () => {
	const { platform, hub, app, id } = await seedApp(halves());
	await openFromButton("Readings");
	await expect.poll(() => isFullscreen("a")).toBe(true);
	const other = await otherTab(platform, hub, app, id);
	other.apply(minimizeChange(other.doc.body.widgets, "a")!);
	await other.flush();
	await expect
		.poll(() => app.current.session!.doc.body.widgets.find((w) => w.id === "a")!.minimized)
		.toBeDefined();
	await expect.element(item("Readings")).toBeInTheDocument();
	expect(isFullscreen("a")).toBe(true);
	expect(location.search).toBe("?widget=a");
	// The widget moved to another frame; focus follows it.
	await expect.poll(() => document.activeElement).toBe(titleBar("Readings").element());
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => location.search).toBe("");
	await expect.poll(() => document.activeElement).toBe(item("Readings").element());
	other.dispose();
});

test("restored in another tab stays fullscreen, with focus kept", async () => {
	const { platform, hub, app, id } = await seedApp(
		[
			{ ...widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings"), minimized: { order: 0 } },
			widget("b", { x: 6, y: 0, w: 6, h: 4 }, "Map")
		],
		(id) => `/workspace/dashboards/${id}?widget=a`
	);
	await expect.poll(() => isFullscreen("a")).toBe(true);
	await expect.poll(() => document.activeElement).toBe(titleBar("Readings").element());
	const other = await otherTab(platform, hub, app, id);
	other.apply(restoreChange(other.doc.body.widgets, "a")!);
	await other.flush();
	await expect
		.poll(() => app.current.session!.doc.body.widgets.find((w) => w.id === "a")!.minimized)
		.toBeUndefined();
	expect(isFullscreen("a")).toBe(true);
	await expect.poll(() => document.activeElement).toBe(titleBar("Readings").element());
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => location.search).toBe("");
	await expect.poll(() => document.activeElement).toBe(titleBar("Readings").element());
	other.dispose();
});

async function starterApp(url: string) {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	history.replaceState(null, "", url);
	await render(App, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect
		.element(page.getByText("This is the starter dashboard.", { exact: false }))
		.toBeVisible();
	return app;
}

test("an edit in starter fullscreen keeps fullscreen on the copy", async () => {
	const app = await starterApp("/workspace/?widget=starter-1");
	await expect.poll(() => isFullscreen("starter-1")).toBe(true);
	const starter = app.current.session!;
	await frame("starter-1")
		.getByRole("button", { name: /^Actions for/ })
		.click();
	await page.getByRole("menuitem", { name: "Rename widget…" }).click();
	await page.getByLabelText("Name").fill("Renamed");
	await page.getByRole("button", { name: "Save" }).click();
	await expect.poll(() => app.current.session).not.toBe(starter);
	const copy = app.current.session!;
	await expect.poll(() => location.pathname).toBe(`/workspace/dashboards/${copy.doc.id}`);
	expect(location.search).toBe("?widget=starter-1");
	await expect.poll(() => isFullscreen("starter-1")).toBe(true);
	await expect.poll(() => focusIn("starter-1")).toBe(true);
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => location.search).toBe("");
	expect(location.pathname).toBe(`/workspace/dashboards/${copy.doc.id}`);
	expect(isFullscreen("starter-1")).toBe(false);
});

test("the bare base is canonicalized, keeping ?widget and the router's history state", async () => {
	const replace = history.replaceState.bind(history);
	const seen: { state: unknown; url: unknown }[] = [];
	history.replaceState = (state, unused, url) => {
		seen.push({ state, url });
		replace(state, unused, url);
	};
	try {
		await starterApp("/workspace?widget=starter-1");
		await expect.poll(() => isFullscreen("starter-1")).toBe(true);
	} finally {
		history.replaceState = replace;
	}
	expect(location.pathname).toBe("/workspace/");
	expect(location.search).toBe("?widget=starter-1");
	const canonical = seen.find((call) => String(call.url) === "/workspace/?widget=starter-1");
	expect(canonical).toBeTruthy();
	// The state passed through is the router's own (its history index), not a fresh one.
	expect(canonical!.state).toMatchObject({ _routerIndex: expect.any(Number) });
});

test("opening fullscreen never makes a starter copy", async () => {
	const app = await starterApp("/workspace/");
	const starter = app.current.session!;
	await frame("starter-1")
		.getByRole("button", { name: /^Show .* fullscreen$/ })
		.click();
	await expect.poll(() => isFullscreen("starter-1")).toBe(true);
	expect(location.pathname).toBe("/workspace/");
	expect(location.search).toBe("?widget=starter-1");
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => location.search).toBe("");
	expect(location.pathname).toBe("/workspace/");
	expect(app.current.session).toBe(starter);
	expect(app.current.isStarter).toBe(true);
	expect(starter.canUndo).toBe(false);
	expect(starter.hasPending).toBe(false);
});

test("on a phone fullscreen covers the area below the top bar", async () => {
	await page.viewport(400, 800);
	await seedApp(halves());
	await openFromButton("Readings");
	await expect.poll(() => isFullscreen("a")).toBe(true);
	const el = frame("a").element();
	await settled(el);
	const box = el.getBoundingClientRect();
	const main = document.querySelector("main")!.getBoundingClientRect();
	expect(main.top).toBeGreaterThan(0);
	expect(box.top).toBeCloseTo(main.top, 0);
	expect(box.bottom).toBeCloseTo(innerHeight, 0);
	expect(box.width).toBeCloseTo(document.documentElement.clientWidth, 0);
});

test("reduced motion: no animation", async () => {
	await seedApp(halves());
	// With motion, opening animates the frame from its grid box.
	await openFromButton("Readings");
	await expect.poll(() => isFullscreen("a")).toBe(true);
	expect(frame("a").element().getAnimations().length).toBeGreaterThan(0);
	await page.getByRole("button", { name: "Exit fullscreen" }).click();
	await expect.poll(() => location.search).toBe("");
	await settled(frame("a").element());
	await commands.setReducedMotion(true);
	try {
		await openFromButton("Readings");
		await expect.poll(() => isFullscreen("a")).toBe(true);
		expect(frame("a").element().getAnimations()).toEqual([]);
	} finally {
		await commands.setReducedMotion(null);
	}
});
