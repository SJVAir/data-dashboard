import "../../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { handleUndoShortcut } from "$lib/actions/global";
import type { Dashboard, Rect, WidgetInstance } from "$lib/documents/schema";
import type { Arrangement } from "$lib/layout/arrangement.svelte";
import { MAX_HEIGHT } from "$lib/layout/config";
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
	await render(Harness, {
		props: { onArrangement },
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
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

test("dropping where it was picked up applies nothing and says cancelled", async () => {
	// B is saved with a gap above it, so the shown (tidied) layout differs from the saved one.
	const { app, session } = await seed([
		widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings"),
		widget("b", { x: 0, y: 10, w: 6, h: 4 }, "Map")
	]);
	await focusBar("Readings");
	await press("{Enter}");
	await press("{ArrowRight}");
	await press("{ArrowLeft}");
	await announced("Column 1, row 1.");
	await press("{Enter}");
	await announced("Cancelled. Readings is back where it was.");
	expect(rectOf(app, "b").y).toBe(10);
	expect(session.canUndo).toBe(false);
});

test("a drop that would pass the row caps applies nothing and says cancelled", async () => {
	let arrangement: Arrangement | null = null;
	const { session } = await seed(halves(), (a) => (arrangement = a));
	await focusBar("Readings");
	await press("{Enter}");
	arrangement!.resizeTo({ x: 0, y: 0, w: 6, h: MAX_HEIGHT + 1 });
	await press("{Enter}");
	await announced("Cancelled. Readings is back where it was.");
	expect(session.canUndo).toBe(false);
});

test("a screen reader's click (detail 0) on the title bar picks up and drops like Enter", async () => {
	const { app } = await seed(halves());
	await focusBar("Readings");
	const bar = titleBar("Readings").element();
	const srClick = (el: Element) =>
		el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
	srClick(bar);
	await announced(
		"Picked up Readings. Column 1, row 1. Arrow keys move, Shift and arrow keys resize, Enter drops, Escape cancels."
	);
	await press("{ArrowRight}");
	srClick(bar);
	await announced("Dropped Readings at column 2, row 1. 1 other widget moved.");
	expect(rectOf(app, "a").x).toBe(1);

	// A mouse click (detail 1) doesn't, nor a detail-0 click on the ⋯ button.
	bar.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
	await new Promise((r) => setTimeout(r, 50));
	expect(page.getByTestId("drop-target").query()).toBeNull();
	const more = page.getByRole("button", { name: "Actions for Readings" }).element();
	srClick(more);
	await new Promise((r) => setTimeout(r, 50));
	expect(page.getByTestId("drop-target").query()).toBeNull();
	await userEvent.keyboard("{Escape}");
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
	await focusBar("Readings");
	await press("{Enter}");
	await press("{Shift>}{ArrowDown}{/Shift}");
	await announced("5 rows tall.");
	await press("{Shift>}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{/Shift}");
	// Clamps at the minimum height (2).
	await announced("2 rows tall.");
	await press("{Enter}");
	await expect.poll(() => rectOf(app, "a").h).toBe(2);
});

// --- Mouse and touchpad ---

afterEach(() => window.scrollTo(0, 0));

function pointer(el: Element, type: string, x: number, y: number, init: PointerEventInit = {}) {
	const pressed = type !== "pointerup" && type !== "pointercancel";
	el.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			cancelable: true,
			composed: true,
			pointerId: 1,
			pointerType: "mouse",
			isPrimary: true,
			button: type === "pointermove" ? -1 : 0,
			buttons: pressed ? 1 : 0,
			clientX: x,
			clientY: y,
			...init
		})
	);
}

const frame = (id: string) => page.getByTestId(`widget-${id}`).element() as HTMLElement;
const handle = (id: string, edge: string) =>
	frame(id).querySelector(`[data-resize="${edge}"]`) as HTMLElement;
const center = (el: Element) => {
	const r = el.getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
/** One column's pitch (a cell and a gap), from two widgets 6 columns apart. */
const pitchX = () =>
	(frame("b").getBoundingClientRect().left - frame("a").getBoundingClientRect().left) / 6;
const pitchY = () => {
	const cs = getComputedStyle(frame("a").parentElement!);
	return parseFloat(cs.gridAutoRows) + parseFloat(cs.rowGap);
};

/** Press on `el`, move by (dx, dy) in a few steps, and optionally release. */
async function drag(el: Element, dx: number, dy: number, release = true) {
	const start = center(el);
	pointer(el, "pointerdown", start.x, start.y);
	const steps = 4;
	for (let i = 1; i <= steps; i++) {
		pointer(el, "pointermove", start.x + (dx * i) / steps, start.y + (dy * i) / steps);
		await new Promise((r) => requestAnimationFrame(r));
	}
	if (release) pointer(el, "pointerup", start.x + dx, start.y + dy);
	return { x: start.x + dx, y: start.y + dy };
}

test("dragging a title bar moves the widget on drop", async () => {
	const { app, session } = await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const bar = titleBar("Readings").element();
	await drag(bar, pitchX() * 6, 0, false);
	await expect.element(page.getByTestId("drop-target")).toBeInTheDocument();
	// Nothing is written until the drop.
	expect(rectOf(app, "a").x).toBe(0);
	const end = center(bar);
	pointer(bar, "pointerup", end.x, end.y);
	await announced("Dropped Readings at column 7, row 1. 1 other widget moved.");
	expect(rectOf(app, "a")).toEqual({ x: 6, y: 0, w: 6, h: 4 });
	expect(rectOf(app, "b").y).toBeGreaterThanOrEqual(4);
	await expect.element(page.getByTestId("drop-target")).not.toBeInTheDocument();
	expect(frame("a").style.transform).toBe("");

	// One undo entry.
	await press("{Control>}z{/Control}");
	expect(rectOf(app, "a")).toEqual({ x: 0, y: 0, w: 6, h: 4 });
	expect(session.canUndo).toBe(false);
});

test("a click on the title bar without moving doesn't start a drag", async () => {
	const { app, session } = await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const bar = titleBar("Readings").element();
	await drag(bar, 3, 0, false);
	expect(page.getByTestId("drop-target").query()).toBeNull();
	const end = center(bar);
	pointer(bar, "pointerup", end.x + 3, end.y);
	await new Promise((r) => setTimeout(r, 50));
	expect(page.getByTestId("drop-target").query()).toBeNull();
	expect(rectOf(app, "a").x).toBe(0);
	expect(session.canUndo).toBe(false);
});

test("the ⋯ button isn't a drag handle", async () => {
	const { app, session } = await seed(halves());
	const more = page.getByRole("button", { name: "Actions for Readings" });
	await expect.element(more).toBeVisible();
	await drag(more.element(), pitchX() * 6, 0);
	await new Promise((r) => setTimeout(r, 50));
	expect(page.getByTestId("drop-target").query()).toBeNull();
	expect(rectOf(app, "a").x).toBe(0);
	expect(session.canUndo).toBe(false);
});

test("a touch pointer doesn't start a mouse drag", async () => {
	const { app } = await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const bar = titleBar("Readings").element();
	const start = center(bar);
	pointer(bar, "pointerdown", start.x, start.y, { pointerType: "touch" });
	pointer(bar, "pointermove", start.x + pitchX() * 6, start.y, { pointerType: "touch" });
	await new Promise((r) => setTimeout(r, 50));
	expect(page.getByTestId("drop-target").query()).toBeNull();
	pointer(bar, "pointerup", start.x + pitchX() * 6, start.y, { pointerType: "touch" });
	expect(rectOf(app, "a").x).toBe(0);
});

test("Escape during a drag cancels", async () => {
	const { app, session } = await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const bar = titleBar("Readings").element();
	const end = await drag(bar, pitchX() * 3, 0, false);
	await expect.element(page.getByTestId("drop-target")).toBeInTheDocument();
	await press("{Escape}");
	await announced("Cancelled. Readings is back where it was.");
	await expect.element(page.getByTestId("drop-target")).not.toBeInTheDocument();
	expect(frame("a").style.transform).toBe("");
	// The release that follows does nothing.
	pointer(bar, "pointerup", end.x, end.y);
	await new Promise((r) => setTimeout(r, 50));
	expect(rectOf(app, "a").x).toBe(0);
	expect(session.canUndo).toBe(false);
});

test("pointercancel cancels a drag", async () => {
	const { app, session } = await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const bar = titleBar("Readings").element();
	const end = await drag(bar, pitchX() * 3, 0, false);
	await expect.element(page.getByTestId("drop-target")).toBeInTheDocument();
	pointer(bar, "pointercancel", end.x, end.y);
	await announced("Cancelled. Readings is back where it was.");
	await expect.element(page.getByTestId("drop-target")).not.toBeInTheDocument();
	expect(rectOf(app, "a").x).toBe(0);
	expect(session.canUndo).toBe(false);
});

test("dragging the right edge resizes; the left edge moves x and w", async () => {
	const { app } = await seed([
		widget("a", { x: 3, y: 0, w: 6, h: 4 }, "Readings"),
		widget("b", { x: 9, y: 0, w: 3, h: 4 }, "Map")
	]);
	await expect.element(titleBar("Readings")).toBeVisible();
	const pitch =
		(frame("b").getBoundingClientRect().left - frame("a").getBoundingClientRect().left) / 6;
	await drag(handle("a", "right"), pitch * 2, 0);
	await expect.poll(() => rectOf(app, "a")).toEqual({ x: 3, y: 0, w: 8, h: 4 });
	await announced("Dropped Readings at column 4, row 1. 1 other widget moved.");

	await drag(handle("a", "left"), -pitch * 2, 0);
	await expect.poll(() => rectOf(app, "a")).toEqual({ x: 1, y: 0, w: 10, h: 4 });

	await drag(handle("a", "bottom"), 0, pitchY());
	await expect.poll(() => rectOf(app, "a")).toEqual({ x: 1, y: 0, w: 10, h: 5 });

	// Clamped to the minimum width (3).
	await drag(handle("a", "bottom-right"), -pitch * 9, -pitchY());
	await expect.poll(() => rectOf(app, "a")).toEqual({ x: 1, y: 0, w: 3, h: 4 });

	await drag(handle("a", "bottom-left"), -pitch, 0);
	await expect.poll(() => rectOf(app, "a")).toEqual({ x: 0, y: 0, w: 4, h: 4 });
});

test("handles are hidden from assistive tech", async () => {
	await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const handles = [...frame("a").querySelectorAll<HTMLElement>("[data-resize]")];
	expect(handles.map((h) => h.dataset.resize).sort()).toEqual([
		"bottom",
		"bottom-left",
		"bottom-right",
		"left",
		"right"
	]);
	for (const h of handles) {
		expect(h.closest('[aria-hidden="true"]')).not.toBeNull();
		expect(h.hasAttribute("tabindex")).toBe(false);
		expect(h.tabIndex).toBe(-1);
	}
});

test("on a phone only the bottom handle is offered, and dragging reorders", async () => {
	await page.viewport(400, 800);
	const { app } = await seed([
		widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings"),
		widget("b", { x: 6, y: 0, w: 6, h: 4 }, "Map"),
		widget("c", { x: 0, y: 4, w: 6, h: 4 }, "Chart")
	]);
	await expect.element(titleBar("Chart")).toBeVisible();
	const handles = [...frame("a").querySelectorAll<HTMLElement>("[data-resize]")];
	expect(handles.map((h) => h.dataset.resize)).toEqual(["bottom"]);

	// Chart up by one widget's height: it takes Map's place.
	const bar = titleBar("Chart").element();
	await drag(bar, 0, -pitchY() * 4);
	await announced("Dropped Chart at position 2 of 3.");
	const order = shownLayout(app.current.session!.doc.body.widgets).map((i) => i.id);
	expect(order).toEqual(["a", "c", "b"]);
});

test("dragging near the bottom of the viewport scrolls the page", async () => {
	await seed(
		Array.from({ length: 30 }, (_, i) =>
			widget(`w${i}`, { x: (i % 2) * 6, y: Math.floor(i / 2) * 4, w: 6, h: 4 }, `Widget ${i}`)
		)
	);
	await expect.element(titleBar("Widget 0")).toBeVisible();
	expect(window.scrollY).toBe(0);
	const bar = titleBar("Widget 0").element();
	const start = center(bar);
	pointer(bar, "pointerdown", start.x, start.y);
	pointer(bar, "pointermove", start.x, start.y + 10);
	pointer(bar, "pointermove", start.x, window.innerHeight - 10);
	await expect.poll(() => window.scrollY).toBeGreaterThan(100);
	await press("{Escape}");
	await announced("Cancelled. Widget 0 is back where it was.");
	const y = window.scrollY;
	await new Promise((r) => setTimeout(r, 100));
	// The loop stops with the drag.
	expect(window.scrollY).toBe(y);
});

// --- Carried from the mouse review ---

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a drag ends as soon as its arrangement is no longer its own", async () => {
	let arrangement: Arrangement | null = null;
	await seed(halves(), (a) => (arrangement = a));
	await expect.element(titleBar("Readings")).toBeVisible();
	await drag(titleBar("Readings").element(), pitchX() * 2, 0, false);
	await expect.element(page.getByTestId("drop-target")).toBeInTheDocument();
	expect(frame("a").style.transform).not.toBe("");
	arrangement!.cancel();
	await nextFrame();
	await nextFrame();
	// The autoscroll tick noticed and tore the drag down.
	expect(frame("a").style.transform).toBe("");
});

test("a running animation on the frame is cancelled before the drag measures it", async () => {
	await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const running = frame("a").animate(
		[{ transform: "translate(200px, 0)" }, { transform: "none" }],
		{ duration: 10_000 }
	);
	await drag(titleBar("Readings").element(), pitchX() * 2, 0, false);
	expect(running.playState).toBe("idle");
	await press("{Escape}");
});

test("resizing the window cancels a drag", async () => {
	const { app, session } = await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	await drag(titleBar("Readings").element(), pitchX() * 3, 0, false);
	await expect.element(page.getByTestId("drop-target")).toBeInTheDocument();
	await page.viewport(1000, 800);
	await announced("Cancelled. Readings is back where it was.");
	await expect.element(page.getByTestId("drop-target")).not.toBeInTheDocument();
	expect(frame("a").style.transform).toBe("");
	expect(rectOf(app, "a").x).toBe(0);
	expect(session.canUndo).toBe(false);
});

test("a pointer pickup over another widget's keyboard arrangement announces its cancel", async () => {
	await seed(halves());
	await focusBar("Readings");
	await press("{Enter}");
	await announced(
		"Picked up Readings. Column 1, row 1. Arrow keys move, Shift and arrow keys resize, Enter drops, Escape cancels."
	);
	await drag(handle("b", "bottom"), 0, pitchY(), false);
	await announced("Cancelled. Readings is back where it was.");
	await press("{Escape}");
});

// --- Touch ---

const touch = (el: Element, type: string, x: number, y: number) =>
	pointer(el, type, x, y, { pointerType: "touch" });
/** A cancelable touchmove on `el`: whether something prevented it (the page wouldn't scroll). */
function touchmovePrevented(el: Element): boolean {
	const event = new TouchEvent("touchmove", { bubbles: true, cancelable: true });
	el.dispatchEvent(event);
	return event.defaultPrevented;
}
const done = () => page.getByRole("button", { name: "Done" });
const lifted = () => page.getByTestId("drop-target").query() !== null;

/** Hold a touch on `el` until it lifts (past the 500 ms long-press), without releasing. */
async function longPress(el: Element) {
	const at = center(el);
	touch(el, "pointerdown", at.x, at.y);
	await wait(600);
	return at;
}

/** A touch already down on `el` at `from`: slide by (dx, dy) in a few steps, then release. */
async function slide(el: Element, from: { x: number; y: number }, dx: number, dy: number) {
	const steps = 4;
	for (let i = 1; i <= steps; i++) {
		touch(el, "pointermove", from.x + (dx * i) / steps, from.y + (dy * i) / steps);
		await nextFrame();
	}
	touch(el, "pointerup", from.x + dx, from.y + dy);
}

test("a long-press on the title bar lifts the widget; sliding moves it", async () => {
	const { app, session } = await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const bar = titleBar("Readings").element();
	// Page swipes over the title bar still scroll vertically.
	expect(getComputedStyle(bar).touchAction).toBe("pan-y");
	const pitch = pitchX();
	const at = center(bar);
	// Browsers decide at touchstart whether a touch's moves can be cancelled, so the listener
	// that stops the page scrolling must be in place before the press, not added at the lift.
	const onWindow = vi.spyOn(window, "addEventListener");
	const onElements = vi.spyOn(EventTarget.prototype, "addEventListener");
	touch(bar, "pointerdown", at.x, at.y);
	await wait(300);
	expect(lifted()).toBe(false);
	expect(touchmovePrevented(bar)).toBe(false);
	await wait(300);
	expect(lifted()).toBe(true);
	// While lifted, the page doesn't scroll under the finger.
	expect(touchmovePrevented(bar)).toBe(true);
	const added = [...onWindow.mock.calls, ...onElements.mock.calls].map(([type]) => type);
	onWindow.mockRestore();
	onElements.mockRestore();
	// The spies saw the lift's own listeners.
	expect(added).toContain("pointermove");
	expect(added).not.toContain("touchmove");

	const steps = 4;
	for (let i = 1; i <= steps; i++) {
		touch(bar, "pointermove", at.x + (pitch * 6 * i) / steps, at.y);
		await nextFrame();
	}
	// Nothing is written until the release.
	expect(rectOf(app, "a").x).toBe(0);
	touch(bar, "pointerup", at.x + pitch * 6, at.y);
	await announced("Dropped Readings at column 7, row 1. 1 other widget moved.");
	expect(rectOf(app, "a")).toEqual({ x: 6, y: 0, w: 6, h: 4 });
	expect(lifted()).toBe(false);
	expect(touchmovePrevented(bar)).toBe(false);
	await expect.element(done()).not.toBeInTheDocument();

	await press("{Control>}z{/Control}");
	expect(rectOf(app, "a")).toEqual({ x: 0, y: 0, w: 6, h: 4 });
	expect(session.canUndo).toBe(false);
});

test("a swipe that starts before the long-press doesn't pick up", async () => {
	const { session } = await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const bar = titleBar("Readings").element();
	const at = center(bar);
	touch(bar, "pointerdown", at.x, at.y);
	await wait(100);
	touch(bar, "pointermove", at.x, at.y + 12);
	await wait(600);
	expect(lifted()).toBe(false);
	expect(touchmovePrevented(bar)).toBe(false);
	touch(bar, "pointerup", at.x, at.y + 12);
	await wait(50);
	expect(lifted()).toBe(false);
	expect(session.canUndo).toBe(false);
});

test("lifting without moving selects with touch handles and Done", async () => {
	const { app, session } = await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const pitch = pitchX();
	const bar = titleBar("Readings").element();
	const at = await longPress(bar);
	// A finger never holds perfectly still.
	touch(bar, "pointermove", at.x + 3, at.y + 2);
	touch(bar, "pointerup", at.x + 3, at.y + 2);
	await expect.element(done()).toBeVisible();
	expect(lifted()).toBe(true);
	// The long-press didn't open the context menu either.
	await wait(400);
	expect(page.getByRole("menu").query()).toBeNull();

	const big = (el: Element) => {
		const r = el.getBoundingClientRect();
		return r.width >= 44 && r.height >= 44;
	};
	expect(big(done().element())).toBe(true);
	const handles = [...frame("a").querySelectorAll<HTMLElement>("[data-resize]")];
	expect(handles.map((h) => h.dataset.resize).sort()).toEqual([
		"bottom",
		"bottom-left",
		"bottom-right",
		"left",
		"right"
	]);
	for (const h of handles) expect(big(h), h.dataset.resize).toBe(true);

	// Resize by the right handle, then move by the title bar (no second long-press): both stay
	// in the one selection until Done.
	const right = handle("a", "right");
	const r = center(right);
	touch(right, "pointerdown", r.x, r.y);
	await slide(right, r, pitch * 2, 0);
	await expect.element(done()).toBeVisible();
	const b = center(bar);
	touch(bar, "pointerdown", b.x, b.y);
	await slide(bar, b, pitch * 2, 0);
	await expect.element(done()).toBeVisible();
	expect(rectOf(app, "a")).toEqual({ x: 0, y: 0, w: 6, h: 4 });
	expect(session.canUndo).toBe(false);

	const d = center(done().element());
	touch(done().element(), "pointerdown", d.x, d.y);
	touch(done().element(), "pointerup", d.x, d.y);
	(done().element() as HTMLElement).click();
	await announced("Dropped Readings at column 3, row 1. 1 other widget moved.");
	expect(rectOf(app, "a")).toEqual({ x: 2, y: 0, w: 8, h: 4 });
	await expect.element(done()).not.toBeInTheDocument();
	expect(lifted()).toBe(false);

	// One change for the whole selection.
	await press("{Control>}z{/Control}");
	expect(rectOf(app, "a")).toEqual({ x: 0, y: 0, w: 6, h: 4 });
	expect(session.canUndo).toBe(false);

	// Tapping outside the frame finishes too.
	const again = await longPress(bar);
	touch(bar, "pointerup", again.x, again.y);
	await expect.element(done()).toBeVisible();
	const bottom = handle("a", "bottom");
	const h = center(bottom);
	touch(bottom, "pointerdown", h.x, h.y);
	await slide(bottom, h, 0, pitchY());
	// A swipe outside just scrolls the page: the selection stays.
	touch(document.body, "pointerdown", 5, 5);
	touch(document.body, "pointermove", 5, 40);
	touch(document.body, "pointerup", 5, 40);
	await wait(50);
	await expect.element(done()).toBeVisible();
	expect(rectOf(app, "a").h).toBe(4);
	// A tap outside finishes it.
	touch(document.body, "pointerdown", 5, 5);
	touch(document.body, "pointermove", 7, 6);
	touch(document.body, "pointerup", 7, 6);
	await announced("Dropped Readings at column 1, row 1.");
	expect(rectOf(app, "a").h).toBe(5);
	await expect.element(done()).not.toBeInTheDocument();
});

test("a touch long-press menu is cancelled on the title bar and handles, not the body", async () => {
	await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const contextmenu = (el: Element) => {
		const r = el.getBoundingClientRect();
		const event = new PointerEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
			pointerType: "touch",
			clientX: r.left + 2,
			clientY: r.top + 2
		});
		el.dispatchEvent(event);
		return event.defaultPrevented;
	};
	const body = frame("a").children[1];
	// A touch press comes first (it keeps the dashboard's own menu from opening).
	const b = center(body);
	touch(body, "pointerdown", b.x, b.y);
	touch(body, "pointerup", b.x, b.y);
	await nextFrame();
	expect(contextmenu(titleBar("Readings").element())).toBe(true);
	expect(contextmenu(body)).toBe(false);

	// While selected, the touch handles cancel it too; the body still doesn't.
	const bar = titleBar("Readings").element();
	const at = await longPress(bar);
	touch(bar, "pointerup", at.x, at.y);
	await expect.element(done()).toBeVisible();
	expect(contextmenu(handle("a", "right"))).toBe(true);
	expect(contextmenu(body)).toBe(false);
	await press("{Escape}");
});

test("Escape cancels a touch selection", async () => {
	const { app, session } = await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const bar = titleBar("Readings").element();
	const at = await longPress(bar);
	touch(bar, "pointerup", at.x, at.y);
	await expect.element(done()).toBeVisible();
	await press("{Escape}");
	await announced("Cancelled. Readings is back where it was.");
	await expect.element(done()).not.toBeInTheDocument();
	expect(lifted()).toBe(false);
	expect(rectOf(app, "a").x).toBe(0);
	expect(session.canUndo).toBe(false);
});

test("on a phone only the bottom handle shows", async () => {
	await page.viewport(400, 800);
	await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const bar = titleBar("Readings").element();
	const at = await longPress(bar);
	touch(bar, "pointerup", at.x, at.y);
	await expect.element(done()).toBeVisible();
	const handles = [...frame("a").querySelectorAll<HTMLElement>("[data-resize]")];
	expect(handles.map((h) => h.dataset.resize)).toEqual(["bottom"]);
	const box = handles[0].getBoundingClientRect();
	expect(box.height).toBeGreaterThanOrEqual(44);
	await press("{Escape}");
});

test("a touch selection's handles stop the page scrolling only during a gesture", async () => {
	await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const bar = titleBar("Readings").element();
	const at = await longPress(bar);
	touch(bar, "pointerup", at.x, at.y);
	await expect.element(done()).toBeVisible();
	const right = handle("a", "right");
	expect(touchmovePrevented(right)).toBe(false);
	const r = center(right);
	touch(right, "pointerdown", r.x, r.y);
	touch(right, "pointermove", r.x + 20, r.y);
	expect(touchmovePrevented(right)).toBe(true);
	touch(right, "pointerup", r.x + 20, r.y);
	expect(touchmovePrevented(right)).toBe(false);
	await press("{Escape}");
});

test("a width change while selected cancels the selection", async () => {
	const { app, session } = await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const bar = titleBar("Readings").element();
	const at = await longPress(bar);
	touch(bar, "pointerup", at.x, at.y);
	await expect.element(done()).toBeVisible();
	await page.viewport(1000, 800);
	await announced("Cancelled. Readings is back where it was.");
	await expect.element(done()).not.toBeInTheDocument();
	expect(lifted()).toBe(false);
	expect(rectOf(app, "a").x).toBe(0);
	expect(session.canUndo).toBe(false);
});

test("a keyboard pickup over another widget's touch selection announces its cancel", async () => {
	await seed(halves());
	await expect.element(titleBar("Map")).toBeVisible();
	const bar = titleBar("Map").element();
	const at = await longPress(bar);
	touch(bar, "pointerup", at.x, at.y);
	await expect.element(done()).toBeVisible();
	await focusBar("Readings");
	await press("{Enter}");
	await announced(
		"Cancelled. Map is back where it was. Picked up Readings. Column 1, row 1. Arrow keys move, Shift and arrow keys resize, Enter drops, Escape cancels."
	);
	await expect.element(done()).not.toBeInTheDocument();
	await press("{Escape}");
});

// --- The picked-up outline and key hint ---

const hint = () => page.getByTestId("arrange-hint");
const pickedUp = (id: string) => frame(id).hasAttribute("data-picked-up");

test("a keyboard pickup marks the widget and shows the key hint", async () => {
	const { app } = await seed(halves());
	expect(pickedUp("a")).toBe(false);
	await focusBar("Readings");
	await press("{Enter}");
	await expect.poll(() => pickedUp("a")).toBe(true);
	expect(pickedUp("b")).toBe(false);
	await expect
		.element(hint())
		.toHaveTextContent("Arrow keys move · Shift+arrows resize · Enter drops · Esc cancels");
	// The live region already says the keys.
	expect(hint().element().closest("[aria-hidden='true']")).not.toBeNull();
	// An overlay: the frame's layout doesn't change.
	expect(getComputedStyle(hint().element()).position).toBe("absolute");
	await press("{ArrowRight}");
	await press("{Enter}");
	await expect.poll(() => rectOf(app, "a").x).toBe(1);
	expect(pickedUp("a")).toBe(false);
	expect(hint().query()).toBeNull();
});

test("Escape or a click elsewhere ends the marking", async () => {
	await seed(halves());
	await focusBar("Readings");
	await press("{Enter}");
	await expect.element(hint()).toBeVisible();
	await press("{Escape}");
	await announced("Cancelled. Readings is back where it was.");
	expect(pickedUp("a")).toBe(false);
	expect(hint().query()).toBeNull();

	await press("{Enter}");
	await expect.element(hint()).toBeVisible();
	await page.getByRole("heading", { name: "Map" }).click();
	await announced("Cancelled. Readings is back where it was.");
	expect(pickedUp("a")).toBe(false);
	expect(hint().query()).toBeNull();
});

test("a keyboard pickup on a phone hints at up and down", async () => {
	await page.viewport(400, 800);
	await seed(halves());
	await focusBar("Readings");
	await press("{Enter}");
	await expect
		.element(hint())
		.toHaveTextContent("Up and Down move · Shift+Up and Down resize · Enter drops · Esc cancels");
	await press("{Escape}");
});

test("a touch arrangement is marked but shows no key hint", async () => {
	await seed(halves());
	await expect.element(titleBar("Readings")).toBeVisible();
	const bar = titleBar("Readings").element();
	const at = await longPress(bar);
	touch(bar, "pointerup", at.x, at.y);
	await expect.element(done()).toBeVisible();
	expect(pickedUp("a")).toBe(true);
	expect(hint().query()).toBeNull();
	await press("{Escape}");
});

// --- The Move and Size submenus ---

const menuItem = (name: string) => page.getByRole("menuitem", { name, exact: true });

async function openSubmenu(widget: string, submenu: "Move" | "Size", how: "menu" | "right-click") {
	if (how === "menu") await page.getByRole("button", { name: `Actions for ${widget}` }).click();
	else await page.getByRole("heading", { name: widget }).click({ button: "right" });
	await menuItem(submenu).click();
	await expect.element(page.getByRole("menu").nth(1)).toBeVisible();
}

test("Move ▸ Right moves one column per click and the menu stays open", async () => {
	const { app, session } = await seed(halves());
	await openSubmenu("Readings", "Move", "menu");
	await menuItem("Right").click();
	await announced("Moved Readings to column 2, row 1. 1 other widget moved.");
	expect(rectOf(app, "a").x).toBe(1);
	await expect.element(menuItem("Right")).toBeVisible();
	await menuItem("Right").click();
	await expect.poll(() => rectOf(app, "a").x).toBe(2);
	await announced("Moved Readings to column 3, row 1.");
	// Each click is one undo step.
	await press("{Escape}");
	await press("{Escape}");
	await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
	await press("{Control>}z{/Control}");
	expect(rectOf(app, "a").x).toBe(1);
	await press("{Control>}z{/Control}");
	expect(rectOf(app, "a").x).toBe(0);
	expect(session.canUndo).toBe(false);
});

test("an item is disabled once it would change nothing", async () => {
	const { app } = await seed([
		widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings"),
		widget("b", { x: 0, y: 4, w: 6, h: 4 }, "Map")
	]);
	await openSubmenu("Readings", "Move", "menu");
	const disabled = (name: string) => menuItem(name).element().hasAttribute("data-disabled");
	expect(disabled("Left")).toBe(true);
	expect(disabled("Up")).toBe(true);
	expect(disabled("Right")).toBe(false);
	for (let i = 0; i < 6; i++) await menuItem("Right").click();
	await expect.poll(() => rectOf(app, "a").x).toBe(6);
	await expect.poll(() => disabled("Right")).toBe(true);
	expect(disabled("Left")).toBe(false);
	await press("{Escape}");
});

test("Size ▸ Wider and Taller resize from the right and bottom edges", async () => {
	const { app } = await seed(halves());
	await openSubmenu("Readings", "Size", "menu");
	await menuItem("Wider").click();
	await announced("Resized Readings to 7 columns wide, 4 rows tall.");
	await menuItem("Taller").click();
	await expect.poll(() => rectOf(app, "a")).toEqual({ x: 0, y: 0, w: 7, h: 5 });
	await announced("Resized Readings to 7 columns wide, 5 rows tall.");
	await press("{Escape}");
});

test("right-click shows the same submenus", async () => {
	const { app } = await seed(halves());
	await openSubmenu("Readings", "Move", "right-click");
	await menuItem("Right").click();
	await expect.poll(() => rectOf(app, "a").x).toBe(1);
	await expect.element(menuItem("Right")).toBeVisible();
	await press("{Escape}");
	await press("{Escape}");
	await page.getByRole("heading", { name: "Readings" }).click({ button: "right" });
	await menuItem("Size").click();
	await expect.element(menuItem("Wider")).toBeVisible();
	await press("{Escape}");
	await press("{Escape}");
});

test("on a phone, Move has Up, Down, To top, To bottom, and Size only the height", async () => {
	await page.viewport(400, 800);
	const { app } = await seed(halves());
	await openSubmenu("Readings", "Move", "menu");
	const names = async () =>
		[...page.getByRole("menu").nth(1).element().querySelectorAll("[role=menuitem]")].map((el) =>
			el.textContent?.trim()
		);
	expect(await names()).toEqual(["Up", "Down", "To top", "To bottom"]);
	await menuItem("To bottom").click();
	await announced("Moved Readings to position 2 of 2.");
	expect(rectOf(app, "a").y).toBeGreaterThan(rectOf(app, "b").y);
	await press("{Escape}");
	await press("{Escape}");
	await openSubmenu("Readings", "Size", "menu");
	expect(await names()).toEqual(["Taller", "Shorter"]);
	await press("{Escape}");
	await press("{Escape}");
});

test("Move and Size are disabled when read-only and hidden when minimized", async () => {
	const { app, session } = await seed([
		widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings"),
		{ ...widget("b", { x: 6, y: 0, w: 6, h: 4 }, "Map"), minimized: { order: 0 } }
	]);
	// Called directly: a read-only dashboard shows no widgets (so no frames or menus), and a
	// minimized widget has no frame (its taskbar menu leaves them out too).
	const { widgetActions } = await import("$lib/actions/widget");
	const { isDisabled } = await import("$lib/actions/types");
	const { Arrangement } = await import("$lib/layout/arrangement.svelte");
	const arrangement = new Arrangement(
		() => app.current.session,
		() => 12
	);
	const ctx = { target: document.body, payload: {} };
	const item = (id: string, itemId: string) =>
		widgetActions(app, id, arrangement)(ctx).find((i) => i.id === itemId);
	expect(isDisabled(item("a", "move-widget")!)).toBe(false);
	expect(isDisabled(item("a", "size-widget")!)).toBe(false);
	expect(item("b", "move-widget")).toBeUndefined();
	expect(item("b", "size-widget")).toBeUndefined();

	const right = item("a", "move-widget")!.children!.find((i) => i.id === "move-right")!;
	expect(isDisabled(right)).toBe(false);
	session.readOnly = "newer";
	expect(isDisabled(item("a", "move-widget")!)).toBe(true);
	expect(isDisabled(item("a", "size-widget")!)).toBe(true);
	// An item already shown turns disabled too.
	expect(isDisabled(right)).toBe(true);
	arrangement.dispose();
});

test("the ⋯ menu stays put while the widget moves, so the next click lands on the same item", async () => {
	const { app } = await seed(halves());
	await openSubmenu("Readings", "Move", "menu");
	// Measured once the menus' opening animations have finished.
	const settled = () =>
		Promise.all(
			[...document.querySelectorAll("[role=menu]")].flatMap((menu) =>
				menu.getAnimations({ subtree: true }).map((a) => a.finished)
			)
		);
	await settled();
	const before = menuItem("Right").element().getBoundingClientRect();
	await menuItem("Right").click();
	await expect.poll(() => rectOf(app, "a").x).toBe(1);
	// Long enough for the widget's move, a menu reposition, and a submenu's pointer grace.
	await wait(1100);
	await settled();
	expect(document.querySelectorAll("[role=menu]")).toHaveLength(2);
	const after = menuItem("Right").element().getBoundingClientRect();
	expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
	// A click at the same spot hits Right again.
	const at = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
	const under = document.elementFromPoint(at.x, at.y)!.closest("[role=menuitem]")!;
	expect(under.textContent?.trim()).toBe("Right");
	await userEvent.click(under);
	await expect.poll(() => rectOf(app, "a").x).toBe(2);
	await press("{Escape}");
	await press("{Escape}");
});

/** The starter at /workspace/, in the real App. */
async function starterApp() {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	history.replaceState(null, "", "/workspace/");
	await render(App, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	await expect
		.element(page.getByText("This is the starter dashboard.", { exact: false }))
		.toBeVisible();
	return { app, starter: app.current.session! };
}

/** After a menu edit on the starter: the copy is shown, no menu is left, focus is on its title bar. */
async function expectHandedOff(app: AppContext, starter: DocumentSession) {
	await expect.poll(() => app.current.session).not.toBe(starter);
	const copy = app.current.session!;
	await expect.poll(() => location.pathname).toBe(`/workspace/dashboards/${copy.doc.id}`);
	expect(copy.doc.body.widgets.find((w) => w.id === "starter-1")!.rect.x).toBe(1);
	await expect.poll(() => document.querySelectorAll("[role=menu]").length).toBe(0);
	await expect.poll(() => getComputedStyle(document.body).pointerEvents).not.toBe("none");
	await expect
		.poll(() => document.activeElement)
		.toBe(page.getByTestId("widget-starter-1").getByRole("group").element());
}

test("Move ▸ Right from the ⋯ menu on the starter closes the menu and keeps focus", async () => {
	const { app, starter } = await starterApp();
	await page
		.getByTestId("widget-starter-1")
		.getByRole("button", { name: /^Actions for/ })
		.click();
	await menuItem("Move").click();
	await menuItem("Right").click();
	await expectHandedOff(app, starter);
});

/** Focus moves down the open submenu until it's on `name`. */
async function focusItem(name: string) {
	for (let i = 0; i < 8 && document.activeElement?.textContent?.trim() !== name; i++) {
		await press("{ArrowDown}");
	}
	expect(document.activeElement?.textContent?.trim()).toBe(name);
}

test("Move ▸ Right from the keyboard menu on the starter closes the menu and keeps focus", async () => {
	const { app, starter } = await starterApp();
	const bar = page.getByTestId("widget-starter-1").getByRole("group").element() as HTMLElement;
	bar.focus();
	await press("{Shift>}{F10}{/Shift}");
	await expect.element(menuItem("Move")).toHaveFocus();
	await press("{ArrowRight}");
	await expect.poll(() => document.querySelectorAll("[role=menu]").length).toBe(2);
	await focusItem("Right");
	await press("{Enter}");
	await expectHandedOff(app, starter);
});

test("the submenu by keyboard: Enter repeats, focus leaves an item that turns disabled", async () => {
	const { app } = await seed([
		widget("a", { x: 4, y: 0, w: 6, h: 4 }, "Readings"),
		widget("b", { x: 0, y: 4, w: 6, h: 4 }, "Map")
	]);
	await focusBar("Readings");
	await press("{Shift>}{F10}{/Shift}");
	await expect.element(menuItem("Move")).toHaveFocus();
	await press("{ArrowRight}");
	await expect.poll(() => document.querySelectorAll("[role=menu]").length).toBe(2);
	await focusItem("Right");
	await press("{Enter}");
	await expect.poll(() => rectOf(app, "a").x).toBe(5);
	await press("{Enter}");
	await expect.poll(() => rectOf(app, "a").x).toBe(6);
	// Right is now disabled: focus moved on to an enabled item in the open submenu.
	await expect.poll(() => menuItem("Right").element().hasAttribute("data-disabled")).toBe(true);
	expect(document.querySelectorAll("[role=menu]")).toHaveLength(2);
	const focused = document.activeElement!;
	expect(focused.getAttribute("role")).toBe("menuitem");
	expect(focused.hasAttribute("data-disabled")).toBe(false);
	expect(focused.textContent?.trim()).not.toBe("Right");
	await press("{Escape}");
	await press("{Escape}");
	await expect.poll(() => document.activeElement).toBe(titleBar("Readings").element());
});
