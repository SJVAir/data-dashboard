import "../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { noteEditor, requested } from "$lib/components/dialogs/lazy.svelte";
import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { setPlatform } from "$lib/platform";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { NOTE_TEXT_MAX } from "./options";
import EditorHarness from "./test-harness/EditorHarness.svelte";

const MOD = navigator.platform.includes("Mac") ? "Meta" : "Control";

beforeEach(async () => {
	await page.viewport(1280, 800);
});

afterEach(() => {
	noteEditor.open = false;
	requested.noteEditor = false;
});

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

async function setup(options: Record<string, unknown>) {
	const platform = createMemoryPlatform();
	setPlatform(platform);
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const id = await app.index.createBlank();
	const session = (await app.sessions.get(id))!;
	app.current = { session, isStarter: false };
	session.apply({ op: "addWidget", target: { widgetId: "n1" }, widget: note(options), index: 0 });
	await render(EditorHarness, {
		props: { widgetId: "n1" },
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
	return { app, session };
}

const dialog = () => page.getByRole("dialog", { name: m.note_editor_title() });
const textbox = () => dialog().getByRole("textbox", { name: m.note_editor_text() });
const opener = () => page.getByRole("button", { name: "Open the editor" });
const save = () => dialog().getByRole("button", { name: m.note_editor_save() });
const cancel = () => dialog().getByRole("button", { name: m.note_editor_cancel() });
const options = (session: DocumentSession) =>
	session.doc.body.widgets.find((w) => w.id === "n1")?.options;

async function open(): Promise<void> {
	await opener().click();
	await expect.element(textbox(), { timeout: 5000 }).toBeVisible();
}

/** Puts the caret at the end of the note's text. */
async function typeAtEnd(text: string): Promise<void> {
	await textbox().click();
	await userEvent.keyboard(`{${MOD}>}{End}{/${MOD}}`);
	await userEvent.keyboard(text);
}

test("opens with the Note's text, formatted", async () => {
	await setup({ text: "## Plan\n**Bring** water" });
	await open();
	const el = textbox().element();
	expect(el.querySelector("h2")?.textContent).toBe("Plan");
	expect(el.querySelector("strong")?.textContent).toBe("Bring");
	expect(el.textContent).not.toContain("**");
	await expect.poll(() => el.contains(document.activeElement)).toBe(true);
});

test("a welcome (message) Note opens with the welcome's text", async () => {
	await setup({ message: "starter_note_welcome" });
	await open();
	expect(textbox().element().textContent).toContain("Welcome to the SJVAir Dashboard.");
	expect(textbox().element().querySelector("strong")?.textContent).toBe(
		"Welcome to the SJVAir Dashboard."
	);
});

test("Save writes the text as one undo step, data unchanged; focus returns to the opener", async () => {
	const { session } = await setup({ text: "Hello" });
	const before = structuredClone(session.doc.body.widgets[0].data);
	await open();
	await typeAtEnd(" there");
	await save().click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(options(session)).toEqual({ text: "Hello there" });
	expect(session.doc.body.widgets[0].data).toEqual(before);
	await expect.poll(() => document.activeElement).toBe(opener().element());
	session.undo();
	expect(options(session)).toEqual({ text: "Hello" });
	expect(session.doc.body.widgets).toHaveLength(1);
});

test("Save with no changes changes nothing (a welcome Note stays a message)", async () => {
	const { session } = await setup({ message: "starter_note_welcome" });
	await open();
	await save().click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(options(session)).toEqual({ message: "starter_note_welcome" });
});

test("Cancel with changes asks Discard changes?; Keep editing stays, Discard closes", async () => {
	const { session } = await setup({ text: "Hello" });
	await open();
	await typeAtEnd("!");
	await cancel().click();
	const ask = page.getByRole("alertdialog", { name: m.get_data_discard_title() });
	await expect.element(ask).toBeVisible();
	await ask.getByRole("button", { name: m.get_data_keep_editing() }).click();
	await expect.element(ask).not.toBeInTheDocument();
	await expect.element(dialog()).toBeVisible();
	// Escape asks too.
	await textbox().click();
	await userEvent.keyboard("{Escape}");
	await expect.element(ask).toBeVisible();
	await ask.getByRole("button", { name: m.get_data_discard() }).click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(options(session)).toEqual({ text: "Hello" });
	await expect.poll(() => document.activeElement).toBe(opener().element());
});

test("a Note saved before the editor's normalizing opens unchanged (no discard question)", async () => {
	// Not the editor's own output: it would save it escaped, but nothing was changed.
	const { session } = await setup({ text: "# Not a heading" });
	await open();
	await cancel().click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(page.getByRole("alertdialog").elements()).toHaveLength(0);
	await open();
	await save().click();
	expect(options(session)).toEqual({ text: "# Not a heading" });
});

test("undo inside the editor stops at the text it opened with", async () => {
	await setup({ text: "Hello" });
	await open();
	await typeAtEnd("!");
	await userEvent.keyboard(`{${MOD}>}z{/${MOD}}`);
	await userEvent.keyboard(`{${MOD}>}z{/${MOD}}`);
	await expect.element(textbox()).toHaveTextContent("Hello");
	expect(textbox().element().textContent).toBe("Hello");
});

test("Cancel with no changes just closes", async () => {
	await setup({ text: "Hello" });
	await open();
	await cancel().click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(page.getByRole("alertdialog").elements()).toHaveLength(0);
});

const counter = (count: number) =>
	dialog().getByText(m.note_editor_count({ count: count.toLocaleString("en-US"), max: "5,000" }));

test("no counter far from the limit", async () => {
	await setup({ text: "a".repeat(4400) });
	await open();
	expect(counter(4400).elements()).toHaveLength(0);
});

test("the counter shows near the limit, and Save is disabled over it", async () => {
	await setup({ text: "a".repeat(NOTE_TEXT_MAX - 1) });
	await open();
	await expect.element(counter(4999)).toBeVisible();
	await expect.element(save()).toBeEnabled();
	await typeAtEnd("bc");
	await expect.element(counter(5001)).toBeVisible();
	await expect.element(save()).toBeDisabled();
	await expect.element(dialog().getByText(m.note_editor_too_long({ max: "5,000" }))).toBeVisible();
});

test("toolbar buttons are toggle buttons with aria-pressed", async () => {
	await setup({ text: "word" });
	await open();
	const toolbar = dialog().getByRole("toolbar", { name: m.note_editor_formatting() });
	const names = [
		m.note_editor_bold(),
		m.note_editor_italic(),
		m.note_editor_heading(),
		m.note_editor_bulleted_list(),
		m.note_editor_numbered_list(),
		m.note_editor_link()
	];
	for (const name of names) {
		await expect
			.element(toolbar.getByRole("button", { name, exact: true }))
			.toHaveAttribute("aria-pressed", "false");
	}
	await textbox().click();
	await userEvent.keyboard(`{${MOD}>}a{/${MOD}}`);
	const bold = toolbar.getByRole("button", { name: m.note_editor_bold(), exact: true });
	await bold.click();
	await expect.element(bold).toHaveAttribute("aria-pressed", "true");
	expect(textbox().element().querySelector("strong")?.textContent).toBe("word");
	const heading = toolbar.getByRole("button", { name: m.note_editor_heading(), exact: true });
	await heading.click();
	await expect.element(heading).toHaveAttribute("aria-pressed", "true");
	const bullets = toolbar.getByRole("button", {
		name: m.note_editor_bulleted_list(),
		exact: true
	});
	await bullets.click();
	await expect.element(bullets).toHaveAttribute("aria-pressed", "true");
});

test("the toolbar is one tab stop; arrow keys move along it", async () => {
	await setup({ text: "word" });
	await open();
	const toolbar = dialog().getByRole("toolbar", { name: m.note_editor_formatting() });
	const buttons = () => [...toolbar.element().querySelectorAll("button")];
	expect(buttons().filter((b) => b.tabIndex === 0)).toHaveLength(1);
	buttons()[0].focus();
	await userEvent.keyboard("{ArrowRight}");
	expect(document.activeElement).toBe(buttons()[1]);
	await userEvent.keyboard("{End}");
	expect(document.activeElement).toBe(buttons().at(-1));
	await userEvent.keyboard("{Home}");
	expect(document.activeElement).toBe(buttons()[0]);
});

test("a toolbar button's tooltip shows on keyboard focus; Escape hides it, then closes", async () => {
	await setup({ text: "word" });
	await open();
	await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
	const bold = dialog().getByRole("button", { name: m.note_editor_bold(), exact: true });
	await expect.element(bold).toHaveFocus();
	const tooltip = () =>
		[...bold.element().parentElement!.querySelectorAll("span[aria-hidden=true]")].find(
			(el) => el.textContent?.trim() === m.note_editor_bold()
		);
	await expect.poll(() => tooltip() && getComputedStyle(tooltip()!).visibility).toBe("visible");
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => tooltip()).toBeUndefined();
	await expect.element(dialog()).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await expect.element(dialog()).not.toBeInTheDocument();
});

test("Ctrl/⌘+B and I format; Ctrl/⌘+K asks for a link address", async () => {
	const { session } = await setup({ text: "word" });
	await open();
	await textbox().click();
	await userEvent.keyboard(`{${MOD}>}a{/${MOD}}`);
	await userEvent.keyboard(`{${MOD}>}b{/${MOD}}`);
	await userEvent.keyboard(`{${MOD}>}i{/${MOD}}`);
	await userEvent.keyboard(`{${MOD}>}k{/${MOD}}`);
	const address = page.getByRole("textbox", { name: m.note_link_address() });
	await expect.element(address).toHaveFocus();
	await userEvent.keyboard("javascript:alert(1){Enter}");
	await expect.element(page.getByText(m.note_link_invalid())).toBeVisible();
	await address.fill("example.com");
	await userEvent.keyboard("{Enter}");
	await expect.element(address).not.toBeInTheDocument();
	await expect.poll(() => textbox().element().contains(document.activeElement)).toBe(true);
	await save().click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(options(session)).toEqual({ text: "[***word***](https://example.com/)" });
});

test("Remove link takes the link off", async () => {
	const { session } = await setup({ text: "[site](https://example.com/)" });
	await open();
	await textbox().click();
	await userEvent.keyboard(`{${MOD}>}a{/${MOD}}`);
	const link = dialog().getByRole("button", { name: m.note_editor_link(), exact: true });
	await expect.element(link).toHaveAttribute("aria-pressed", "true");
	await link.click();
	const address = page.getByRole("textbox", { name: m.note_link_address() });
	await expect.element(address).toHaveValue("https://example.com/");
	await page.getByRole("button", { name: m.note_link_remove() }).click();
	await save().click();
	expect(options(session)).toEqual({ text: "site" });
});

test("a Note deleted while the editor is open: Save closes and changes nothing", async () => {
	const { session } = await setup({ text: "Hello" });
	await open();
	await typeAtEnd("!");
	session.apply({
		op: "removeWidget",
		target: { widgetId: "n1" },
		widget: session.doc.body.widgets[0],
		index: 0
	});
	await save().click();
	await expect.element(dialog()).not.toBeInTheDocument();
	expect(session.doc.body.widgets).toHaveLength(0);
});
