import "../../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { handleUndoShortcut } from "$lib/actions/global";
import type { Dashboard, Rect, WidgetInstance } from "$lib/documents/schema";
import type { Arrangement } from "$lib/layout/arrangement.svelte";
import { createMemoryPlatform } from "$lib/platform/memory";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
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
	await render(Harness, {
		props: { onArrangement },
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
	const onKey = (e: KeyboardEvent) => handleUndoShortcut(app, e);
	window.addEventListener("keydown", onKey);
	removeUndo = () => window.removeEventListener("keydown", onKey);
	return { app, session };
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
	await page
		.getByRole("button", { name: "Minimize Readings" })
		.click({ force: true })
		.catch(() => {});
	expect(session.doc.body.widgets.every((w) => !w.minimized)).toBe(true);
	const button = document.querySelector(
		'[aria-label="Minimize Readings"]'
	) as HTMLButtonElement | null;
	expect(button === null || button.disabled).toBe(true);
});
