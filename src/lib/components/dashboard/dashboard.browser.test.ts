import "../../../app.css";
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

function renderGrid(app: AppContext) {
	return render(Harness, { context: new Map([[APP_CONTEXT_KEY, app]]) });
}

const frame = (id: string) => page.getByTestId(`widget-${id}`);

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
	await expect.element(page.getByRole("menuitem", { name: "Rename…" }).first()).toBeVisible();
	const fromButton = await names();
	await userEvent.keyboard("{Escape}");
	await expect.element(page.getByRole("menu")).not.toBeInTheDocument();

	await page.getByRole("heading", { name: "Readings" }).click({ button: "right" });
	await expect.element(page.getByRole("menuitem", { name: "Rename…" }).first()).toBeVisible();
	const fromRightClick = await names();
	expect(fromRightClick).toEqual(fromButton);
	expect(fromButton).toEqual(expect.arrayContaining(["Duplicate", "Delete", "Add widget"]));
});

test("rename widget to blank shows the generated title", async () => {
	const { app, session } = await setup();
	session.apply(add(widget("a", { x: 0, y: 0, w: 6, h: 4 }, "Readings")));
	await renderGrid(app);
	await page.getByRole("button", { name: "Actions for Readings" }).click();
	await page.getByRole("menuitem", { name: "Rename…" }).first().click();
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
	await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
	expect(session.doc.body.widgets).toHaveLength(0);
	await expect.element(page.getByText("Widget deleted")).toBeVisible();
	await page.getByRole("button", { name: "Undo" }).click();
	expect(session.doc.body.widgets.map((w) => w.id)).toEqual(["a"]);
	await expect.element(frame("a")).toBeVisible();
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
	for (const name of ["Add widget", "Rename…", "Delete dashboard", "Duplicate"]) {
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
	await page.getByRole("menuitem", { name: "Duplicate" }).click();

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
