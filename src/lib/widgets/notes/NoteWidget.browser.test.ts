import "../../../app.css";
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { noteEditor, openNoteEditor, requested } from "$lib/components/dialogs/lazy.svelte";
import { STARTER_ID } from "$lib/starter/starter";
import { registerWidgetType } from "../registry";
import AddHarness from "./test-harness/AddHarness.svelte";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { render } from "vitest-browser-svelte";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { noteType } from "./index";
import NoteWidget from "./NoteWidget.svelte";
import SharedHarness from "./test-harness/SharedHarness.svelte";

function note(options: Record<string, unknown>): WidgetInstance {
	return {
		id: "n1",
		type: "note",
		title: null,
		rect: { x: 0, y: 0, w: 4, h: 3 },
		data: { layers: [] },
		options
	};
}

afterEach(() => {
	noteEditor.open = false;
	noteEditor.widgetId = null;
	requested.noteEditor = false;
});

async function editableApp() {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	const id = await app.index.createBlank();
	const session = (await app.sessions.get(id))!;
	app.current = { session, isStarter: false };
	return { app, session, context: new Map([[APP_CONTEXT_KEY, app]]) };
}

test("each block kind renders as a real element", async () => {
	const text = [
		"## Heading",
		"",
		"A **bold** and *italic* word with [a link](https://example.com/a).",
		"",
		"- one",
		"- two",
		"",
		"3. three",
		"4. four"
	].join("\n");
	const screen = await render(NoteWidget, { widget: note({ text }) });
	const root = screen.container;
	expect(root.querySelector("h3")?.textContent).toBe("Heading");
	expect(root.querySelector("strong")?.textContent).toBe("bold");
	expect(root.querySelector("em")?.textContent).toBe("italic");
	expect([...root.querySelectorAll("ul li")].map((l) => l.textContent?.trim())).toEqual([
		"one",
		"two"
	]);
	const ol = root.querySelector("ol")!;
	expect(ol.getAttribute("start")).toBe("3");
	expect(ol.querySelectorAll("li")).toHaveLength(2);
});

test("a link opens in a new tab, says so, and carries the safe rel", async () => {
	const screen = await render(NoteWidget, {
		widget: note({ text: "[the site](https://example.com/a)" })
	});
	const link = screen.container.querySelector("a")!;
	expect(link.getAttribute("href")).toBe("https://example.com/a");
	expect(link.getAttribute("target")).toBe("_blank");
	expect(link.getAttribute("rel")).toBe("ugc nofollow noopener");
	await expect
		.element(screen.getByRole("link", { name: `the site ${m.opens_in_new_tab()}` }))
		.toBeInTheDocument();
});

test("markup in the text stays inert", async () => {
	const screen = await render(NoteWidget, {
		widget: note({ text: "<img src=x onerror=alert(1)> [x](javascript:alert(1))" })
	});
	expect(screen.container.querySelector("img")).toBeNull();
	expect(screen.container.querySelector("a")).toBeNull();
});

test("the welcome message shows its text", async () => {
	const { context } = await editableApp();
	const screen = await render(NoteWidget, {
		props: { widget: note({ message: "starter_note_welcome" }) },
		context
	});
	await expect.element(screen.getByText("Welcome to the SJVAir Dashboard.")).toBeInTheDocument();
	expect(screen.container.querySelector("strong")).not.toBeNull();
});

test("an empty Note shows the hint where editing is possible", async () => {
	const { context } = await editableApp();
	const screen = await render(NoteWidget, { props: { widget: note({ text: "" }) }, context });
	await expect.element(screen.getByText(m.note_empty_hint())).toBeInTheDocument();
});

test("an unknown message key reads as empty and shows the hint", async () => {
	const { context } = await editableApp();
	const screen = await render(NoteWidget, {
		props: { widget: note({ message: "no_such_message" }) },
		context
	});
	await expect.element(screen.getByText(m.note_empty_hint())).toBeInTheDocument();
});

test("an empty Note shows no hint on a read-only dashboard, reactively", async () => {
	const { context, session } = await editableApp();
	const screen = await render(NoteWidget, { props: { widget: note({ text: "" }) }, context });
	await expect.element(screen.getByText(m.note_empty_hint())).toBeInTheDocument();
	session.readOnly = "invalid";
	await expect.poll(() => screen.getByText(m.note_empty_hint()).query()).toBeNull();
});

test("an empty Note shows nothing when read-only (a shared link)", async () => {
	const screen = await render(SharedHarness, { widget: note({ text: "" }) });
	expect(screen.container.textContent?.trim()).toBe("");
});

test("the welcome message shows to the owner, not on a shared or read-only view", async () => {
	const welcome = note({ message: "starter_note_welcome" });
	const { context, session } = await editableApp();
	const owner = await render(NoteWidget, { props: { widget: welcome }, context });
	await expect.element(owner.getByText("Welcome to the SJVAir Dashboard.")).toBeInTheDocument();
	session.readOnly = "invalid";
	await expect.poll(() => owner.container.textContent?.trim()).toBe("");
	owner.unmount();

	const shared = await render(SharedHarness, { widget: welcome });
	expect(shared.container.textContent?.trim()).toBe("");
	shared.unmount();

	// A Note's own text always shows.
	const typed = await render(SharedHarness, { widget: note({ text: "Bring water" }) });
	await expect.element(typed.getByText("Bring water")).toBeInTheDocument();
});

test("long text scrolls inside the widget", async () => {
	const text = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}`).join("\n\n");
	const screen = await render(NoteWidget, { widget: note({ text }) });
	const box = screen.container.querySelector<HTMLElement>("[data-widget]")!;
	box.style.height = "100px";
	expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);
	expect(getComputedStyle(box).overflowY).toBe("auto");
});

test("the descriptor is a time-less, direct-add type", () => {
	expect(noteType.time).toBe("none");
	expect(noteType.accepts).toBeUndefined();
	expect(noteType.addable?.({} as Dashboard)).toEqual({
		data: { layers: [] },
		options: { text: "" }
	});
});

/** An editable app whose current dashboard holds `widget`. */
async function withNote(widget: WidgetInstance) {
	const setup = await editableApp();
	setup.session.apply({ op: "addWidget", target: { widgetId: widget.id }, widget, index: 0 });
	return setup;
}

const menuEnv = (app: Awaited<ReturnType<typeof editableApp>>["app"], widget: WidgetInstance) => ({
	app,
	widget: () => widget
});
const menuCtx = () => ({ target: document.body, payload: {} });

test("double-clicking an empty, editable Note opens its editor", async () => {
	const widget = note({ text: "" });
	const { context } = await withNote(widget);
	const screen = await render(NoteWidget, { props: { widget }, context });
	await screen.getByRole("region").dblClick();
	expect(noteEditor.open).toBe(true);
	expect(noteEditor.widgetId).toBe("n1");
});

test("double-clicking a Note with text, or one that can't be edited, opens nothing", async () => {
	const full = note({ text: "Hello" });
	const { context, session } = await withNote(full);
	const screen = await render(NoteWidget, { props: { widget: full }, context });
	await screen.getByRole("region").dblClick();
	expect(noteEditor.open).toBe(false);
	screen.unmount();

	const empty = note({ text: "" });
	session.readOnly = "invalid";
	const again = await render(NoteWidget, { props: { widget: empty }, context });
	await again.getByRole("region").dblClick();
	expect(noteEditor.open).toBe(false);
	again.unmount();

	const shared = await render(SharedHarness, { widget: empty });
	await shared.getByRole("region").dblClick();
	expect(noteEditor.open).toBe(false);
});

test("Edit note is in the menu only where the Note can be edited", async () => {
	const widget = note({ text: "Hello" });
	const { app, session } = await withNote(widget);
	const items = noteType.menu(menuCtx(), menuEnv(app, widget));
	expect(items.map((i) => i.label)).toEqual([m.widget_edit_note()]);
	session.readOnly = "invalid";
	expect(noteType.menu(menuCtx(), menuEnv(app, widget))).toEqual([]);
	session.readOnly = false;
	// Not in the current dashboard (a view of another one).
	expect(noteType.menu(menuCtx(), menuEnv(app, { ...widget, id: "elsewhere" }))).toEqual([]);
	app.current = { session: null, isStarter: false };
	expect(noteType.menu(menuCtx(), menuEnv(app, widget))).toEqual([]);
});

test("adding a Note opens its editor at once, with focus in the text", async () => {
	registerWidgetType(noteType);
	const { session, context } = await editableApp();
	await render(AddHarness, { context });
	await page.getByRole("button", { name: m.add_widget() }).click();
	await page.getByRole("menuitem", { name: m.widget_note_title() }).click();
	const dialog = page.getByRole("dialog", { name: m.note_editor_title() });
	const text = dialog.getByRole("textbox", { name: m.note_editor_text() });
	await expect.element(text, { timeout: 5000 }).toBeVisible();
	expect(noteEditor.widgetId).toBe(session.doc.body.widgets[0].id);
	await expect.poll(() => text.element().contains(document.activeElement)).toBe(true);
	// It stays there once the menu has finished closing.
	await new Promise((resolve) => setTimeout(resolve, 400));
	expect(text.element().contains(document.activeElement)).toBe(true);
});

/** An app showing the starter, with its welcome Note; storing takes a while, as IndexedDB does. */
async function starterApp() {
	const platform = createMemoryPlatform();
	const commit = platform.documents.commit.bind(platform.documents);
	platform.documents.commit = async (...args) => {
		await new Promise((resolve) => setTimeout(resolve, 50));
		return commit(...args);
	};
	const app = await initApp(platform, {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	const starter = (await app.sessions.get(STARTER_ID))!;
	app.current = { session: starter, isStarter: true };
	return { app, starter, context: new Map([[APP_CONTEXT_KEY, app]]) };
}

/** Adds a Note through Add widget and waits for its editor. */
async function addNoteAndWaitForEditor() {
	await page.getByRole("button", { name: m.add_widget() }).click();
	await page.getByRole("menuitem", { name: m.widget_note_title() }).click();
	const dialog = page.getByRole("dialog", { name: m.note_editor_title() });
	const text = dialog.getByRole("textbox", { name: m.note_editor_text() });
	await expect.element(text, { timeout: 5000 }).toBeVisible();
	return dialog;
}

test("adding a Note on the starter opens its editor on the copy", async () => {
	registerWidgetType(noteType);
	const { app, starter, context } = await starterApp();
	await render(AddHarness, { context });
	await addNoteAndWaitForEditor();
	const copy = app.current.session!;
	expect(copy).not.toBe(starter);
	expect(app.current.isStarter).toBe(false);
	const added = copy.doc.body.widgets.at(-1)!;
	expect(added.type).toBe("note");
	expect(noteEditor.widgetId).toBe(added.id);
});

test("adding a Note on the starter after cancelling Edit note opens the new Note", async () => {
	registerWidgetType(noteType);
	const { app, starter, context } = await starterApp();
	await render(AddHarness, { context });
	const welcome = starter.doc.body.widgets.find((w) => w.type === "note")!;
	// The editor is mounted once, opened on the welcome Note and cancelled.
	openNoteEditor({ widgetId: welcome.id });
	const dialog = page.getByRole("dialog", { name: m.note_editor_title() });
	await expect.element(dialog, { timeout: 5000 }).toBeVisible();
	await dialog.getByRole("button", { name: m.note_editor_cancel() }).click();
	await expect.poll(() => dialog.query()).toBeNull();
	expect(app.current.session).toBe(starter);

	await addNoteAndWaitForEditor();
	const copy = app.current.session!;
	expect(copy).not.toBe(starter);
	const added = copy.doc.body.widgets.at(-1)!;
	expect(added.type).toBe("note");
	expect(noteEditor.widgetId).toBe(added.id);
});
