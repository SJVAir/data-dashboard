import "../../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { handleUndoShortcut } from "$lib/actions/global";
import type { Dashboard, Rect, WidgetInstance } from "$lib/documents/schema";
import { shownLayout } from "$lib/layout/items";
import { createMemoryPlatform } from "$lib/platform/memory";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { APP_CONTEXT_KEY, initApp, type AppContext } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { PLACEHOLDER_TYPE } from "$lib/widgets/placeholder";
import App from "../../../App.svelte";
import Harness from "./test-harness/Harness.svelte";

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

function widget(id: string, rect: Rect, title: string | null = null): WidgetInstance {
	return { id, type: PLACEHOLDER_TYPE, title, rect, data: { layers: [] } };
}

/** A stored dashboard holding `widgets` (no undo entries), current and shown in the grid. */
async function seed(widgets: WidgetInstance[]) {
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
	await render(Harness, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	// The page's Ctrl+Z, as App installs it.
	const onKey = (e: KeyboardEvent) => handleUndoShortcut(app, e);
	window.addEventListener("keydown", onKey);
	removeUndo = () => window.removeEventListener("keydown", onKey);
	return { app, session };
}

const halves = () => [
	widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings"),
	widget("b", { x: 6, y: 0, w: 6, h: 4 }, "Map")
];

const rectOf = (app: AppContext, id: string) =>
	app.current.session!.doc.body.widgets.find((w) => w.id === id)!.rect;
const titleBar = (name: string) => page.getByRole("group", { name });
const liveText = () =>
	document.querySelector('[role="status"][aria-live="polite"][aria-atomic="true"]')?.textContent;
const announced = (text: string) => expect.poll(liveText).toBe(text);

async function focusBar(name: string) {
	await expect.element(titleBar(name)).toBeVisible();
	(titleBar(name).element() as HTMLElement).focus();
}

async function press(key: string, times = 1) {
	for (let i = 0; i < times; i++) await userEvent.keyboard(key);
}

test("the title bar says how to move it", async () => {
	await seed(halves());
	const bar = titleBar("Readings");
	await expect.element(bar).toHaveAttribute("aria-keyshortcuts", "Enter Shift+F10");
	await expect.element(bar).toHaveAttribute("aria-description", "Press Enter to move");
});

test("Enter picks up, arrows move, Enter drops", async () => {
	const { app, session } = await seed(halves());
	await focusBar("Readings");
	await press("{Enter}");
	await announced(
		"Picked up Readings. Column 1, row 1. Arrow keys move, Shift and arrow keys resize, Enter drops, Escape cancels."
	);
	await press("{ArrowRight}", 6);
	await announced("Column 7, row 1.");
	// Nothing is written until the drop.
	expect(rectOf(app, "a").x).toBe(0);
	expect(session.canUndo).toBe(false);
	await press("{Enter}");
	await announced("Dropped Readings at column 7, row 1. 1 other widget moved.");
	expect(rectOf(app, "a")).toEqual({ x: 6, y: 0, w: 6, h: 4 });
	expect(rectOf(app, "b").y).toBeGreaterThanOrEqual(4);
	expect(document.activeElement).toBe(titleBar("Readings").element());

	// One undo entry.
	await press("{Control>}z{/Control}");
	expect(rectOf(app, "a")).toEqual({ x: 0, y: 0, w: 6, h: 4 });
	expect(rectOf(app, "b")).toEqual({ x: 6, y: 0, w: 6, h: 4 });
	expect(session.canUndo).toBe(false);
});

test("Space picks up and drops too", async () => {
	const { app } = await seed(halves());
	await focusBar("Readings");
	await press(" ");
	await press("{ArrowRight}");
	await press(" ");
	await expect.poll(() => rectOf(app, "a").x).toBe(1);
});

test("Shift+arrows resize", async () => {
	const { app } = await seed([widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings")]);
	await focusBar("Readings");
	await press("{Enter}");
	await press("{Shift>}{ArrowRight}{/Shift}");
	await announced("7 columns wide, 4 rows tall.");
	await press("{Shift>}{ArrowDown}{/Shift}");
	await announced("7 columns wide, 5 rows tall.");
	// Clamps at the minimum (3 × 2).
	await press("{Shift>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{/Shift}");
	await announced("3 columns wide, 5 rows tall.");
	await press("{Enter}");
	await expect.poll(() => rectOf(app, "a")).toEqual({ x: 0, y: 0, w: 3, h: 5 });
});

test("Escape cancels", async () => {
	const { app, session } = await seed(halves());
	await focusBar("Readings");
	await press("{Enter}");
	await press("{ArrowRight}", 3);
	await expect
		.poll(() => getComputedStyle(page.getByTestId("widget-b").element()).gridRowStart)
		.toBe("5");
	let escapeReachedWindow = false;
	const onKey = () => (escapeReachedWindow = true);
	window.addEventListener("keydown", onKey);
	await press("{Escape}");
	window.removeEventListener("keydown", onKey);
	await announced("Cancelled. Readings is back where it was.");
	expect(escapeReachedWindow).toBe(false);
	await expect
		.poll(() => getComputedStyle(page.getByTestId("widget-b").element()).gridRowStart)
		.toBe("1");
	await expect.element(page.getByTestId("drop-target")).not.toBeInTheDocument();
	expect(rectOf(app, "a").x).toBe(0);
	expect(session.canUndo).toBe(false);
	expect(document.activeElement).toBe(titleBar("Readings").element());
});

test("moving focus away cancels", async () => {
	const { app, session } = await seed(halves());
	await focusBar("Readings");
	await press("{Enter}");
	await press("{ArrowRight}");
	await expect.element(page.getByTestId("drop-target")).toBeInTheDocument();
	await press("{Tab}");
	await announced("Cancelled. Readings is back where it was.");
	await expect.element(page.getByTestId("drop-target")).not.toBeInTheDocument();
	expect(rectOf(app, "a").x).toBe(0);
	expect(session.canUndo).toBe(false);
});

test("keys from the ⋯ button don't pick the widget up", async () => {
	await seed(halves());
	const more = page.getByRole("button", { name: "Actions for Readings" });
	(more.element() as HTMLElement).focus();
	await press("{Enter}");
	await expect.element(page.getByRole("menu")).toBeVisible();
	await press("{Escape}");
	await expect.element(page.getByTestId("drop-target")).not.toBeInTheDocument();
});

test("Down at the bottom announces it", async () => {
	const { session } = await seed([widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings")]);
	await focusBar("Readings");
	await press("{Enter}");
	await press("{ArrowDown}");
	await announced("Readings is already at the bottom.");
	await press("{Enter}");
	expect(session.canUndo).toBe(false);
});

test("phone column: arrows reorder", async () => {
	await page.viewport(400, 800);
	const { app } = await seed([
		widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings"),
		widget("b", { x: 6, y: 0, w: 6, h: 4 }, "Map"),
		widget("c", { x: 0, y: 4, w: 6, h: 4 }, "Chart")
	]);
	await focusBar("Chart");
	await press("{Enter}");
	await announced(
		"Picked up Chart. Position 3 of 3. Up and down arrows move, Shift and up and down arrows resize, Enter drops, Escape cancels."
	);
	await press("{ArrowUp}");
	await announced("Position 2 of 3.");
	await press("{Enter}");
	await announced("Dropped Chart at position 2 of 3.");
	const order = shownLayout(app.current.session!.doc.body.widgets).map((i) => i.id);
	expect(order).toEqual(["a", "c", "b"]);
	// On desktop it takes the second's spot.
	expect(rectOf(app, "c")).toEqual({ x: 6, y: 0, w: 6, h: 4 });
});

test("Move… from the menu picks up with focus on the title bar", async () => {
	const { app } = await seed(halves());
	await page.getByRole("button", { name: "Actions for Readings" }).click();
	await page.getByRole("menuitem", { name: "Move…" }).click();
	await announced(
		"Picked up Readings. Column 1, row 1. Arrow keys move, Shift and arrow keys resize, Enter drops, Escape cancels."
	);
	await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
	await expect.poll(() => document.activeElement).toBe(titleBar("Readings").element());
	// Still picked up once the menu's focus has settled.
	await new Promise((r) => setTimeout(r, 300));
	await expect.element(page.getByTestId("drop-target")).toBeInTheDocument();
	await press("{ArrowRight}");
	await press("{Enter}");
	await expect.poll(() => rectOf(app, "a").x).toBe(1);
});

test("Resize… announces the resize instructions", async () => {
	await seed(halves());
	await page.getByRole("heading", { name: "Readings" }).click({ button: "right" });
	await page.getByRole("menuitem", { name: "Resize…" }).click();
	await announced(
		"Resizing Readings: 6 columns wide, 4 rows tall. Shift and arrow keys resize, Enter drops, Escape cancels."
	);
	await expect.poll(() => document.activeElement).toBe(titleBar("Readings").element());
	await new Promise((r) => setTimeout(r, 300));
	await expect.element(page.getByTestId("drop-target")).toBeInTheDocument();
});

test("Move… and Resize… are disabled when locked and hidden when minimized", async () => {
	const { app, session } = await seed([
		widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings"),
		{ ...widget("b", { x: 6, y: 0, w: 6, h: 4 }, "Map"), minimized: { order: 0 } }
	]);
	const { widgetActions } = await import("$lib/actions/widget");
	const { Arrangement } = await import("$lib/layout/arrangement.svelte");
	const arrangement = new Arrangement(
		() => app.current.session,
		() => 12
	);
	const ctx = { target: document.body, payload: {} };
	const items = (id: string) => widgetActions(app, id, arrangement)(ctx);
	const item = (id: string, itemId: string) => items(id).find((i) => i.id === itemId);
	expect(item("a", "move-widget")).toMatchObject({ group: "layout", disabled: false });
	expect(item("a", "resize-widget")).toMatchObject({ group: "layout", disabled: false });
	expect(item("b", "move-widget")).toBeUndefined();
	expect(item("b", "resize-widget")).toBeUndefined();

	session.readOnly = "newer";
	expect(item("a", "move-widget")?.disabled).toBe(true);
	expect(item("a", "resize-widget")?.disabled).toBe(true);
	arrangement.dispose();
});

test("a keyboard drop on the starter keeps focus through the hand-off", async () => {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	history.replaceState(null, "", "/workspace/");
	await render(App, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect
		.element(page.getByText("This is the starter dashboard.", { exact: false }))
		.toBeVisible();
	const starter = app.current.session!;
	const first = page.getByTestId("widget-starter-1").getByRole("group");
	(first.element() as HTMLElement).focus();
	await press("{Enter}");
	await press("{ArrowRight}", 6);
	await press("{Enter}");

	await expect.poll(() => app.current.session).not.toBe(starter);
	const copy = app.current.session!;
	expect(copy.doc.copiedFrom).toBe("starter");
	await expect.poll(() => location.pathname).toBe(`/workspace/dashboards/${copy.doc.id}`);
	expect(copy.doc.body.widgets.find((w) => w.id === "starter-1")!.rect.x).toBe(6);
	await expect
		.poll(() => document.activeElement)
		.toBe(page.getByTestId("widget-starter-1").getByRole("group").element());
});

test("the window losing focus cancels", async () => {
	const { app, session } = await seed(halves());
	await focusBar("Readings");
	await press("{Enter}");
	await press("{ArrowRight}");
	await expect.element(page.getByTestId("drop-target")).toBeInTheDocument();
	window.dispatchEvent(new FocusEvent("blur"));
	await announced("Cancelled. Readings is back where it was.");
	await expect.element(page.getByTestId("drop-target")).not.toBeInTheDocument();
	expect(rectOf(app, "a").x).toBe(0);
	expect(session.canUndo).toBe(false);
});

test("on a phone, resizing speaks only the height", async () => {
	await page.viewport(400, 800);
	const { app } = await seed([
		widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings"),
		widget("b", { x: 6, y: 0, w: 6, h: 4 }, "Map")
	]);
	await page.getByRole("button", { name: "Actions for Readings" }).click();
	await page.getByRole("menuitem", { name: "Resize…" }).click();
	await announced(
		"Resizing Readings: 4 rows tall. Shift and up and down arrows resize, Enter drops, Escape cancels."
	);
	await expect.poll(() => document.activeElement).toBe(titleBar("Readings").element());
	await press("{Shift>}{ArrowDown}{/Shift}");
	await announced("5 rows tall.");
	await press("{Shift>}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{/Shift}");
	// Clamps at the minimum height (2).
	await announced("2 rows tall.");
	await press("{Enter}");
	await expect.poll(() => rectOf(app, "a").h).toBe(2);
});
