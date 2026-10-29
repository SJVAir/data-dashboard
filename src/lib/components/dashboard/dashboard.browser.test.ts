import "../../../app.css";
import { tick } from "svelte";
import { afterEach, beforeEach, expect, test } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { Change } from "$lib/changes/types";
import type { Dashboard, Rect, WidgetInstance } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { APP_CONTEXT_KEY, initApp, type AppContext } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { PLACEHOLDER_TYPE } from "$lib/widgets/placeholder";
import { rectsOverlap } from "$lib/layout/engine";
import { announce } from "$lib/a11y/announcer.svelte";
import type { Arrangement } from "$lib/layout/arrangement.svelte";
import App from "../../../App.svelte";
import Harness from "./test-harness/Harness.svelte";

const originalUrl = location.href;
beforeEach(async () => {
	await page.viewport(1280, 800);
});
afterEach(() => {
	toast.dismiss();
	history.replaceState(null, "", originalUrl);
});

async function setup() {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const id = await app.index.createBlank();
	const session = (await app.sessions.get(id))!;
	app.current = { session, isStarter: false };
	return { platform, app, id, session };
}

function widget(id: string, rect: Rect, title: string | null = null): WidgetInstance {
	return { id, type: PLACEHOLDER_TYPE, title, rect, data: { layers: [] } };
}

function add(w: WidgetInstance, index = 0): Change {
	return { op: "addWidget", target: { widgetId: w.id }, widget: w, index };
}

function renderGrid(app: AppContext, onArrangement?: (arrangement: Arrangement) => void) {
	return render(Harness, { props: { onArrangement }, context: new Map([[APP_CONTEXT_KEY, app]]) });
}

async function renderArranging(app: AppContext) {
	let arrangement: Arrangement | null = null;
	const screen = await renderGrid(app, (a) => (arrangement = a));
	return { screen, arrangement: arrangement! };
}

const frame = (id: string) => page.getByTestId(`widget-${id}`);
const domOrder = () =>
	[...document.querySelectorAll<HTMLElement>("[data-flip-id]")].map((el) => el.dataset.flipId);

test("widgets render at their grid positions", async () => {
	const { app, session } = await setup();
	session.apply(add(widget("a", { x: 0, y: 0, w: 6, h: 4 })));
	session.apply(add(widget("b", { x: 6, y: 0, w: 6, h: 4 }), 1));
	await renderGrid(app);
	const b = frame("b").element();
	await expect.element(frame("b")).toBeVisible();
	const style = getComputedStyle(b);
	expect(style.gridColumnStart).toBe("7");
	expect(style.gridRowStart).toBe("1");
	const grid = getComputedStyle(b.parentElement!);
	expect(grid.gridTemplateColumns.split(" ")).toHaveLength(12);

	// Phone widths: one column in reading order, each widget keeping its height in rows.
	await page.viewport(400, 800);
	await expect
		.poll(() => getComputedStyle(b.parentElement!).gridTemplateColumns.split(" "))
		.toHaveLength(1);
	const a = frame("a").element().getBoundingClientRect();
	const bRect = b.getBoundingClientRect();
	expect(bRect.top).toBeGreaterThan(a.bottom);
	expect(bRect.height).toBeCloseTo(a.height);
});

/** Store `widgets` as the document's body directly (no change is applied), then reopen it. */
async function seed(widgets: WidgetInstance[]) {
	const { platform, app, id } = await setup();
	const stored = (await platform.documents.get(app.space, id)) as Dashboard;
	await platform.documents.commit(app.space, {
		docId: id,
		baseVersion: stored.version,
		doc: { ...stored, body: { widgets } },
		entries: []
	});
	const session = (await DocumentSession.open(platform, app.space, id, "t2"))!;
	app.current = { session, isStarter: false };
	return { app, session };
}

test("an overlapping document shows tidied and writes nothing", async () => {
	const { app, session } = await seed([
		widget("a", { x: 0, y: 0, w: 6, h: 4 }),
		widget("b", { x: 0, y: 2, w: 6, h: 4 })
	]);
	const version = session.doc.version;
	await renderGrid(app);
	await expect.element(frame("b")).toBeVisible();
	expect(getComputedStyle(frame("b").element()).gridRowStart).toBe("5");
	expect(getComputedStyle(frame("a").element()).gridRowStart).toBe("1");
	expect(session.hasPending).toBe(false);
	expect(session.doc.version).toBe(version);
	expect(session.doc.body.widgets.find((w) => w.id === "b")!.rect.y).toBe(2);
});

test("minimized widgets aren't on the grid", async () => {
	const { app } = await seed([
		widget("a", { x: 0, y: 0, w: 6, h: 4 }),
		{ ...widget("b", { x: 6, y: 0, w: 6, h: 4 }), minimized: { order: 0 } }
	]);
	await renderGrid(app);
	await expect.element(frame("a")).toBeVisible();
	await expect.element(frame("b")).not.toBeInTheDocument();
});

test("the live region is polite and announces", async () => {
	const { app } = await setup();
	await renderGrid(app);
	announce("x");
	const region = page.getByRole("status").filter({ hasText: /^x$/ });
	await expect.element(region).toHaveAttribute("aria-live", "polite");
	const el = region.element();

	// The same text again is cleared first, so it's read again.
	announce("x");
	await tick();
	expect(el.textContent).toBe("");
	// Still empty a frame later: a one-frame gap can be merged and the repeat skipped.
	await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
	expect(el.textContent).toBe("");
	await expect.poll(() => el.textContent).toBe("x");

	// A newer message replaces one still waiting.
	announce("y");
	announce("z");
	await expect.poll(() => el.textContent).toBe("z");
	await new Promise((r) => setTimeout(r, 150));
	expect(el.textContent).toBe("z");
});

test("the preview shows while arranging, with the drop target outlined at the active widget's rect", async () => {
	const { app, session } = await setup();
	session.apply(add(widget("a", { x: 0, y: 0, w: 6, h: 4 })));
	session.apply(add(widget("b", { x: 0, y: 4, w: 6, h: 4 }), 1));
	const { arrangement } = await renderArranging(app);
	await expect.element(frame("b")).toBeVisible();
	await expect.element(page.getByTestId("drop-target")).not.toBeInTheDocument();
	const before = frame("b").element().getBoundingClientRect();

	arrangement.pickUp("b", "move", "keyboard");
	arrangement.moveTo({ x: 0, y: 0 });
	const target = page.getByTestId("drop-target");
	await expect.element(target).toBeInTheDocument();
	await expect.poll(() => getComputedStyle(frame("a").element()).gridRowStart).toBe("5");
	expect(getComputedStyle(frame("b").element()).gridRowStart).toBe("1");
	const t = getComputedStyle(target.element());
	expect([t.gridRowStart, t.gridColumnStart, t.borderStyle]).toEqual(["1", "1", "dashed"]);
	expect(target.element().getAttribute("aria-hidden")).toBe("true");
	// The pushed widget animates from where it was; nothing is written yet.
	expect(frame("a").element().getAnimations().length).toBeGreaterThan(0);
	expect(session.doc.body.widgets.find((w) => w.id === "b")!.rect.y).toBe(4);
	// The elements keep their order while arranging (moving one would drop its focus).
	expect(domOrder()).toEqual(["a", "b"]);

	arrangement.cancel();
	await expect.element(target).not.toBeInTheDocument();
	await expect.poll(() => getComputedStyle(frame("b").element()).gridRowStart).toBe("5");
	await expect.poll(() => frame("b").element().getBoundingClientRect().top).toBeCloseTo(before.top);
});

test("the active widget's title bar keeps focus while the preview reorders, and a drop reorders the elements", async () => {
	const { app, session } = await setup();
	session.apply(add(widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings")));
	session.apply(add(widget("b", { x: 0, y: 4, w: 6, h: 4 }), 1));
	const { arrangement } = await renderArranging(app);
	const bar = page.getByRole("group", { name: "Readings" });
	(bar.element() as HTMLElement).focus();
	arrangement.pickUp("a", "move", "keyboard");
	arrangement.moveTo({ x: 0, y: 8 });
	await expect.poll(() => getComputedStyle(frame("a").element()).gridRowStart).toBe("5");
	expect(document.activeElement).toBe(bar.element());

	arrangement.drop();
	await expect.poll(domOrder).toEqual(["b", "a"]);
	expect(session.doc.body.widgets.find((w) => w.id === "a")!.rect.y).toBe(4);
});

test("the first render doesn't animate", async () => {
	const { app, session } = await setup();
	session.apply(add(widget("a", { x: 0, y: 0, w: 6, h: 4 })));
	session.apply(add(widget("b", { x: 0, y: 4, w: 6, h: 4 }), 1));
	await renderGrid(app);
	await expect.element(frame("b")).toBeVisible();
	expect(frame("a").element().getAnimations()).toHaveLength(0);
	expect(frame("b").element().getAnimations()).toHaveLength(0);
});

test("a widget removed while it's picked up announces that the move was cancelled", async () => {
	const { app, session } = await setup();
	session.apply(add(widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings")));
	const { arrangement } = await renderArranging(app);
	await expect.element(frame("a")).toBeVisible();
	arrangement.pickUp("a", "move", "keyboard");
	await expect.element(page.getByTestId("drop-target")).toBeInTheDocument();
	session.apply({
		op: "removeWidget",
		target: { widgetId: "a" },
		widget: session.doc.body.widgets[0],
		index: 0
	});
	await expect
		.element(page.getByRole("status").filter({ hasText: "Readings was removed in another tab." }))
		.toBeInTheDocument();
	expect(arrangement.active).toBeNull();
});

test("on a phone the drop target covers the active widget's slot without moving the others", async () => {
	await page.viewport(400, 800);
	const { app, session } = await setup();
	session.apply(add(widget("a", { x: 0, y: 0, w: 6, h: 4 })));
	session.apply(add(widget("b", { x: 6, y: 0, w: 6, h: 3 }), 1));
	const { arrangement } = await renderArranging(app);
	await expect.element(frame("b")).toBeVisible();
	const a = frame("a").element().getBoundingClientRect();
	arrangement.pickUp("b", "move", "touch");
	const target = page.getByTestId("drop-target");
	await expect.element(target).toBeInTheDocument();
	const t = target.element().getBoundingClientRect();
	const b = frame("b").element().getBoundingClientRect();
	expect(frame("a").element().getBoundingClientRect().top).toBeCloseTo(a.top);
	expect([t.top, t.left, t.width, t.height]).toEqual([b.top, b.left, b.width, b.height]);
});

test("add widget appends a placeholder at the bottom", async () => {
	const { app, session } = await setup();
	session.apply(add(widget("a", { x: 0, y: 0, w: 12, h: 3 })));
	await renderGrid(app);
	await page.getByRole("button", { name: "Add widget" }).click();
	const widgets = session.doc.body.widgets;
	expect(widgets).toHaveLength(2);
	expect(widgets[1].type).toBe(PLACEHOLDER_TYPE);
	expect(widgets[1].rect).toEqual({ x: 0, y: 3, w: 6, h: 4 });
	await expect.element(frame(widgets[1].id)).toBeVisible();
});

test("widget ⋯ menu and right-click show the same items", async () => {
	const { app, session } = await setup();
	session.apply(add(widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings")));
	await renderGrid(app);
	const names = async () =>
		(await page.getByRole("menuitem").all()).map((item) => item.element().textContent?.trim());

	await page.getByRole("button", { name: "Actions for Readings" }).click();
	await expect.element(page.getByRole("menuitem", { name: "Rename widget…" })).toBeVisible();
	const fromButton = await names();
	await userEvent.keyboard("{Escape}");
	await expect.element(page.getByRole("menu")).not.toBeInTheDocument();

	await page.getByRole("heading", { name: "Readings" }).click({ button: "right" });
	await expect.element(page.getByRole("menuitem", { name: "Rename widget…" })).toBeVisible();
	const fromRightClick = await names();
	expect(fromRightClick).toEqual(fromButton);
	expect(fromButton).toEqual(expect.arrayContaining(["Duplicate widget", "Delete widget"]));
	// Dashboard actions stay in the dashboard's own menu.
	expect(fromButton).not.toContain("Add widget");
	expect(fromButton).not.toContain("Rename dashboard…");
	// Undo's text includes its shortcut, so check the start.
	expect(fromButton.some((name) => name?.startsWith("Undo"))).toBe(false);
});

test("the dashboard's own menu has its actions plus Undo and Redo", async () => {
	const { app } = await setup();
	await renderGrid(app);
	await page.getByText("This dashboard is empty.").click({ button: "right" });
	// Undo and Redo also show their shortcut, so match the start of the name.
	for (const name of [/^Add widget/, /^Rename dashboard…/, /^Undo/, /^Redo/]) {
		await expect.element(page.getByRole("menuitem", { name })).toBeVisible();
	}
});

test("a widget is a named group announcing its shortcuts, not a region landmark", async () => {
	const { app, session } = await setup();
	session.apply(add(widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings")));
	await renderGrid(app);
	const group = page.getByRole("group", { name: "Readings" });
	await expect.element(group).toHaveAttribute("aria-keyshortcuts", "Enter Shift+F10");
	await expect.element(page.getByRole("region", { name: "Readings" })).not.toBeInTheDocument();
});

test("rename widget to blank shows the generated title", async () => {
	const { app, session } = await setup();
	session.apply(add(widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings")));
	await renderGrid(app);
	await page.getByRole("button", { name: "Actions for Readings" }).click();
	await page.getByRole("menuitem", { name: "Rename widget…" }).click();
	const input = page.getByRole("textbox", { name: "Name" });
	await expect.element(input).toHaveValue("Readings");
	await expect.element(input).toHaveAttribute("maxlength", "100");
	await input.fill("   ");
	await page.getByRole("button", { name: "Save" }).click();
	expect(session.doc.body.widgets[0].title).toBeNull();
	await expect
		.element(page.getByRole("heading", { name: "Placeholder widget" }))
		.toBeInTheDocument();
});

test("delete widget shows a toast whose undo restores it", async () => {
	const { app, session } = await setup();
	session.apply(add(widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings")));
	await renderGrid(app);
	await page.getByRole("button", { name: "Actions for Readings" }).click();
	await page.getByRole("menuitem", { name: "Delete widget" }).click();
	expect(session.doc.body.widgets).toHaveLength(0);
	await expect.element(page.getByText("Widget deleted")).toBeVisible();
	await page.getByRole("button", { name: "Undo" }).click();
	expect(session.doc.body.widgets.map((w) => w.id)).toEqual(["a"]);
	await expect.element(frame("a")).toBeVisible();
});

test("a widget's undo after its row was taken puts it back below, not on top", async () => {
	const { app, session } = await setup();
	session.apply(add(widget("a", { x: 0, y: 0, w: 12, h: 3 })));
	session.apply(add(widget("b", { x: 0, y: 3, w: 6, h: 4 }, "Readings"), 1));
	await renderGrid(app);
	await page.getByRole("button", { name: "Actions for Readings" }).click();
	await page.getByRole("menuitem", { name: "Delete widget" }).click();
	// The new placeholder takes the freed row.
	await page.getByRole("button", { name: "Add widget" }).click();
	expect(session.doc.body.widgets[1].rect).toEqual({ x: 0, y: 3, w: 6, h: 4 });
	const toastItem = page.getByRole("listitem").filter({ hasText: "Widget deleted" });
	await toastItem.getByRole("button", { name: "Undo" }).click();

	const widgets = session.doc.body.widgets;
	expect(widgets.map((w) => w.id)).toContain("b");
	const overlapping = widgets.flatMap((w, i) =>
		widgets.slice(i + 1).filter((v) => rectsOverlap(w.rect, v.rect))
	);
	expect(overlapping).toEqual([]);
});

test("editing the starter creates a copy, replaces the URL, and shows the toast", async () => {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	history.replaceState(null, "", "/workspace/");
	await render(App, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect
		.element(page.getByText("This is the starter dashboard.", { exact: false }))
		.toBeVisible();
	const starter = app.current.session!;
	const historyLength = history.length;

	await page.getByRole("button", { name: "Add widget" }).click();
	await expect.element(page.getByText("Saved as your own dashboard")).toBeVisible();
	const copy = app.current.session!;
	expect(copy).not.toBe(starter);
	expect(copy.doc.copiedFrom).toBe("starter");
	await expect.poll(() => location.pathname).toBe(`/workspace/dashboards/${copy.doc.id}`);
	expect(history.length).toBe(historyLength);

	// The navigation keeps the copy's session and its undo history.
	await expect
		.element(page.getByText("This is the starter dashboard.", { exact: false }))
		.not.toBeInTheDocument();
	expect(app.current.session).toBe(copy);
	expect(app.current.isStarter).toBe(false);
	expect(copy.doc.body.widgets).toHaveLength(4);
	expect(copy.canUndo).toBe(true);
	copy.undo();
	expect(copy.doc.body.widgets).toHaveLength(3);
});

test("empty dashboard shows the empty state", async () => {
	const { app, session } = await setup();
	await renderGrid(app);
	await expect.element(page.getByText("This dashboard is empty.")).toBeVisible();
	await page.getByRole("button", { name: "Add widget" }).click();
	expect(session.doc.body.widgets).toHaveLength(1);
	await expect.element(page.getByText("This dashboard is empty.")).not.toBeInTheDocument();
});

test("read-only dashboard shows the message and no edit actions", async () => {
	const { platform, app, id } = await setup();
	const stored = (await platform.documents.get(app.space, id)) as Dashboard;
	const newer = {
		...stored,
		schemaVersion: 99,
		body: { widgets: [widget("a", { x: 0, y: 0, w: 6, h: 4 })] }
	};
	await platform.documents.commit(app.space, {
		docId: id,
		baseVersion: stored.version,
		doc: newer as unknown as Dashboard,
		entries: []
	});
	const reopened = await DocumentSession.open(platform, app.space, id, "t2");
	expect(reopened?.readOnly).toBe("newer");
	app.current = { session: reopened, isStarter: false };
	await renderGrid(app);

	await expect
		.element(page.getByText("This dashboard was saved by a newer version. Reload to edit."))
		.toBeVisible();
	await expect.element(frame("a")).not.toBeInTheDocument();
	await expect.element(page.getByRole("button", { name: "Add widget" })).not.toBeInTheDocument();

	await page.getByText("This dashboard was saved by a newer version.", { exact: false }).click({
		button: "right"
	});
	for (const name of [
		"Add widget",
		"Rename dashboard…",
		"Delete dashboard",
		"Duplicate dashboard"
	]) {
		await expect
			.element(page.getByRole("menuitem", { name }))
			.toHaveAttribute("aria-disabled", "true");
	}
	await expect
		.element(page.getByRole("menuitem", { name: "New blank dashboard" }))
		.not.toHaveAttribute("aria-disabled", "true");
});

test("delete dashboard goes home and its toast's undo brings it back", async () => {
	const { app, id, session } = await setup();
	session.apply({ op: "setField", target: { path: "name" }, from: null, to: "Home" });
	history.replaceState(null, "", `/workspace/dashboards/${id}`);
	await render(App, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await page.getByRole("button", { name: "Home" }).click();
	await page.getByRole("menuitem", { name: "Delete dashboard" }).click();

	const toastItem = page.getByRole("listitem").filter({ hasText: "Dashboard deleted" });
	await expect.element(toastItem).toBeVisible();
	await expect.poll(() => app.current.isStarter).toBe(true);
	expect(app.index.items).toHaveLength(0);
	expect(location.pathname).toMatch(/^\/workspace\/?$/);

	await toastItem.getByRole("button", { name: "Undo" }).click();
	await expect.poll(() => location.pathname).toBe(`/workspace/dashboards/${id}`);
	await expect.poll(() => app.current.session?.doc.id).toBe(id);
	expect(session.doc.deletedAt).toBeUndefined();
	expect(app.index.items.map((d) => d.id)).toEqual([id]);
});

test("duplicate opens the copy with the rename dialog's text selected", async () => {
	const { app, id, session } = await setup();
	session.apply({ op: "setField", target: { path: "name" }, from: null, to: "Home" });
	history.replaceState(null, "", `/workspace/dashboards/${id}`);
	await render(App, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await page.getByRole("button", { name: "Home" }).click();
	await page.getByRole("menuitem", { name: "Duplicate dashboard" }).click();

	const input = page.getByRole("textbox", { name: "Name" });
	await expect.element(input).toHaveValue("Home");
	const el = input.element() as HTMLInputElement;
	expect([el.selectionStart, el.selectionEnd]).toEqual([0, 4]);
	const copyId = location.pathname.split("/").pop()!;
	expect(copyId).not.toBe(id);

	await input.fill("Home 2");
	await page.getByRole("button", { name: "Save" }).click();
	await expect.poll(() => app.current.session?.doc.name).toBe("Home 2");
	expect(app.current.session?.doc.id).toBe(copyId);
	expect(session.doc.name).toBe("Home");
});

test("a widget's undo restores it on its own dashboard after switching", async () => {
	const { app, session } = await setup();
	session.apply(add(widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings")));
	const otherId = await app.index.createBlank();
	const other = (await app.sessions.get(otherId))!;
	await renderGrid(app);
	await page.getByRole("button", { name: "Actions for Readings" }).click();
	await page.getByRole("menuitem", { name: "Delete widget" }).click();
	const toastItem = page.getByRole("listitem").filter({ hasText: "Widget deleted" });
	await expect.element(toastItem).toBeVisible();

	app.current = { session: other, isStarter: false };
	await toastItem.getByRole("button", { name: "Undo" }).click();
	expect(other.doc.body.widgets).toHaveLength(0);
	expect(session.doc.body.widgets.map((w) => w.id)).toEqual(["a"]);
});

test("undoing a dashboard's restore leaves it again", async () => {
	const { app, id, session } = await setup();
	session.apply({ op: "setField", target: { path: "name" }, from: null, to: "Home" });
	history.replaceState(null, "", `/workspace/dashboards/${id}`);
	await render(App, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await page.getByRole("button", { name: "Home" }).click();
	await page.getByRole("menuitem", { name: "Delete dashboard" }).click();
	const toastItem = page.getByRole("listitem").filter({ hasText: "Dashboard deleted" });
	await toastItem.getByRole("button", { name: "Undo" }).click();
	await expect.poll(() => app.current.session).toBe(session);
	expect(session.doc.deletedAt).toBeUndefined();

	// Ctrl+Z undoes the restore while the dashboard is shown: the page moves on.
	session.undo();
	expect(typeof session.doc.deletedAt).toBe("string");
	await expect.poll(() => app.current.isStarter).toBe(true);
	expect(location.pathname).toMatch(/^\/workspace\/?$/);
	expect(app.index.items).toHaveLength(0);
});

const menuState = async () =>
	(await page.getByRole("menuitem").all()).map((entry) => [
		entry.element().textContent?.trim(),
		entry.element().getAttribute("aria-disabled")
	]);
const dashboardMore = () => page.getByRole("button", { name: "Dashboard actions" });

test("the dashboard ⋯ opens the dashboard's actions", async () => {
	const { app, session } = await setup();
	session.apply(add(widget("a", { x: 0, y: 0, w: 6, h: 4 })));
	await renderGrid(app);
	await dashboardMore().click();
	for (const name of [
		/^Add widget/,
		/^Undo/,
		/^Redo/,
		/^Rename dashboard…/,
		/^Duplicate dashboard/,
		/^Share/,
		/^Delete dashboard/
	]) {
		await expect.element(page.getByRole("menuitem", { name })).toBeVisible();
	}
	const fromButton = await menuState();
	await userEvent.keyboard("{Escape}");
	await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
	// Blank grid space: the right half of the grid, away from the widget.
	const grid = frame("a").element().parentElement!;
	const box = grid.getBoundingClientRect();
	await page
		.elementLocator(grid)
		.click({ button: "right", position: { x: box.width * 0.9, y: box.height * 0.5 } });
	await expect.element(page.getByRole("menuitem", { name: /^Add widget/ })).toBeVisible();
	expect(await menuState()).toEqual(fromButton);
});

test("it's shown on the starter and on an empty dashboard", async () => {
	const { app } = await setup();
	await renderGrid(app);
	await expect.element(dashboardMore()).toBeVisible();
	app.current = { ...app.current, isStarter: true };
	await expect
		.element(page.getByText("This is the starter dashboard.", { exact: false }))
		.toBeVisible();
	await expect.element(dashboardMore()).toBeVisible();
});

test("focus returns to it when the menu closes", async () => {
	const { app } = await setup();
	await renderGrid(app);
	await dashboardMore().click();
	await expect.element(page.getByRole("menuitem", { name: /^Add widget/ })).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await expect.element(dashboardMore()).toHaveFocus();
});

test("the dashboard ⋯ is inert while a widget is fullscreen", async () => {
	const { app, session, id } = await setup();
	session.apply(add(widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings")));
	history.replaceState(null, "", `/workspace/dashboards/${id}`);
	await render(App, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect.element(dashboardMore()).toBeVisible();
	expect(dashboardMore().element().closest("[inert]")).toBeNull();
	await page.getByRole("button", { name: "Show Readings fullscreen" }).click();
	await expect.poll(() => location.search).toBe("?widget=a");
	const more = document.querySelector('[aria-label="Dashboard actions"]')!;
	await expect.poll(() => more.closest("[inert]")).not.toBeNull();
});

test("the dashboard ⋯ shows on a read-only dashboard", async () => {
	const { app, session } = await setup();
	session.readOnly = "newer";
	await renderGrid(app);
	await expect.element(dashboardMore()).toBeVisible();
	await dashboardMore().click();
	await expect.element(page.getByRole("menuitem", { name: /^New blank dashboard/ })).toBeVisible();
});
