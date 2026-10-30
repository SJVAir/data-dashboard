import "../../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { Dashboard, Rect, WidgetInstance } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { PLACEHOLDER_TYPE } from "$lib/widgets/placeholder";
import Harness from "./test-harness/Harness.svelte";

const originalUrl = location.href;
beforeEach(async () => {
	await page.viewport(1280, 800);
});
afterEach(() => {
	toast.dismiss();
	history.replaceState(null, "", originalUrl);
});

function widget(id: string, rect: Rect, title: string, order?: number): WidgetInstance {
	return {
		id,
		type: PLACEHOLDER_TYPE,
		title,
		rect,
		data: { layers: [] },
		...(order === undefined ? {} : { minimized: { order } })
	};
}

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
	return { app, session };
}

const liveText = () =>
	document.querySelector('[role="status"][aria-live="polite"][aria-atomic="true"]')?.textContent;
const toolbar = () => page.getByRole("toolbar", { name: "Minimized widgets" });
const buttons = () =>
	Array.from(toolbar().element().querySelectorAll("button")) as HTMLButtonElement[];

const three = () => [
	widget("g", { x: 0, y: 0, w: 6, h: 4 }, "Grid one"),
	widget("a", { x: 0, y: 0, w: 4, h: 3 }, "Alpha", 2),
	widget("b", { x: 0, y: 0, w: 4, h: 3 }, "Beta", 0),
	widget("c", { x: 0, y: 0, w: 4, h: 3 }, "Gamma", 1)
];

test("the taskbar is a toolbar with one tab stop", async () => {
	await seed(three());
	await expect.element(toolbar()).toBeVisible();
	const stops = buttons().filter((b) => b.getAttribute("tabindex") === "0");
	expect(buttons().length).toBe(6);
	expect(stops.length).toBe(1);
});

test("arrows, Home, and End move between buttons", async () => {
	await seed(three());
	await expect.element(toolbar()).toBeVisible();
	const all = buttons();
	all[0].focus();
	await userEvent.keyboard("{ArrowRight}");
	expect(document.activeElement).toBe(all[1]);
	await userEvent.keyboard("{End}");
	expect(document.activeElement).toBe(all[5]);
	await userEvent.keyboard("{ArrowRight}");
	expect(document.activeElement).toBe(all[0]);
	await userEvent.keyboard("{ArrowLeft}");
	expect(document.activeElement).toBe(all[5]);
	await userEvent.keyboard("{Home}");
	expect(document.activeElement).toBe(all[0]);
});

test("items follow minimized order", async () => {
	await seed(three());
	await expect.element(toolbar()).toBeVisible();
	const names = buttons()
		.map((b) => b.textContent?.trim())
		.filter(Boolean);
	expect(names).toEqual(["Beta", "Gamma", "Alpha"]);
});

test("activating an item restores it, focuses its title bar, and announces", async () => {
	const { session } = await seed(three());
	await page.getByRole("button", { name: "Restore Gamma" }).click();
	await expect.poll(liveText).toBe("Gamma restored.");
	const w = session.doc.body.widgets.find((x) => x.id === "c")!;
	expect(w.minimized).toBeUndefined();
	expect(w.rect.x).toBe(0);
	expect(w.rect.y).toBeGreaterThanOrEqual(4);
	const bar = page.getByRole("group", { name: "Gamma" });
	await expect.poll(() => document.activeElement).toBe(bar.element());
	// One undo entry.
	session.undo();
	expect(session.doc.body.widgets.find((x) => x.id === "c")!.minimized).toEqual({ order: 1 });
	expect(session.canUndo).toBe(false);
});

test("its menu has Restore and Fullscreen but not Minimize, Move, or Size", async () => {
	await seed(three());
	await page.getByRole("button", { name: "Actions for Beta" }).click();
	const items = async () =>
		(await page.getByRole("menuitem").all()).map((i) => i.element().textContent?.trim());
	await expect.poll(items).toContain("Restore");
	const list = await items();
	expect(list).toContain("Fullscreen");
	expect(list).toContain("Rename widget…");
	for (const bad of ["Minimize", "Move", "Size"]) expect(list).not.toContain(bad);
	await userEvent.keyboard("{Escape}");

	const restore = page.getByRole("button", { name: "Restore Gamma" }).element() as HTMLElement;
	restore.focus();
	await userEvent.keyboard("{Shift>}{F10}{/Shift}");
	await expect.poll(items).toContain("Fullscreen");
	expect(await items()).not.toContain("Minimize");
});

test("with every widget minimized, it says so instead of calling the dashboard empty", async () => {
	await seed([widget("a", { x: 0, y: 0, w: 4, h: 3 }, "Alpha", 0)]);
	await expect.element(toolbar()).toBeVisible();
	await expect.element(page.getByText("All widgets are minimized.")).toBeVisible();
	expect(document.body.textContent).not.toContain("This dashboard is empty.");
	// Adding a widget is still offered.
	await expect.element(page.getByRole("button", { name: "Add widget" })).toBeVisible();
});

test("no taskbar when nothing is minimized", async () => {
	await seed([widget("g", { x: 0, y: 0, w: 6, h: 4 }, "Grid one")]);
	await expect.element(page.getByRole("group", { name: "Grid one" })).toBeVisible();
	expect(document.querySelector('[role="toolbar"]')).toBeNull();
});

test("on a phone the taskbar is a scrolling strip and minimized widgets leave the column", async () => {
	await page.viewport(400, 800);
	const widgets = [widget("g", { x: 0, y: 0, w: 6, h: 4 }, "Grid one")];
	for (let i = 0; i < 8; i++)
		widgets.push(widget(`m${i}`, { x: 0, y: 0, w: 4, h: 3 }, `Widget ${i}`, i));
	await seed(widgets);
	await expect.element(toolbar()).toBeVisible();
	const el = toolbar().element();
	expect(el.scrollWidth).toBeGreaterThan(el.clientWidth);
	expect(document.querySelectorAll('[data-testid^="widget-"]').length).toBe(1);
});
