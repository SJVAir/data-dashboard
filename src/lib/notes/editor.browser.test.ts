import { afterEach, expect, test } from "vitest";
import { createNoteEditor, type NoteEditor } from "./editor";
import { toNoteBlocks } from "./markdown";

let root: HTMLElement;
let editor: NoteEditor | null = null;

afterEach(() => {
	editor?.destroy();
	editor = null;
	root?.remove();
});

function start(markdown: string): NoteEditor {
	root = document.createElement("div");
	root.contentEditable = "true";
	document.body.append(root);
	editor = createNoteEditor(root, markdown);
	return editor;
}

/** Lets Lexical see a DOM selection change (it listens for `selectionchange`). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/** Selects the text of the first element matching `selector` (all of it, or `[from, to)`). */
async function select(selector: string, from?: number, to?: number): Promise<void> {
	root.focus();
	const node = root.querySelector(selector)!.firstChild!;
	const range = document.createRange();
	range.setStart(node, from ?? 0);
	range.setEnd(node, to ?? node.textContent!.length);
	const selection = document.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	await settle();
}

/** Puts the caret at the end of the editor. */
async function caretAtEnd(): Promise<void> {
	root.focus();
	const range = document.createRange();
	range.selectNodeContents(root);
	range.collapse(false);
	const selection = document.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	await settle();
}

async function paste(html: string, text = ""): Promise<void> {
	const data = new DataTransfer();
	if (html) data.setData("text/html", html);
	data.setData("text/plain", text);
	root.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
	await settle();
}

test("Markdown round trip leaves a saved note unchanged", () => {
	const markdown = [
		"## A heading",
		"Some **bold**, *italic* and [a link](https://example.com/a) text.",
		"A second line right after.",
		"",
		"- one",
		"- **two**",
		"",
		"A paragraph after the list.",
		"",
		"3. three",
		"4. four",
		"",
		"Write [to us](mailto:hi@example.com).",
		"Literal \\*stars\\* and ## hashes."
	].join("\n");
	expect(start(markdown).markdown()).toBe(markdown);
});

test("shows formatting, not Markdown symbols", () => {
	start("## Title\n**bold** and *it*\n\n- item");
	expect(root.querySelector("h2")?.textContent).toBe("Title");
	expect(root.querySelector("strong")?.textContent).toBe("bold");
	expect(root.querySelector("em")?.textContent).toBe("it");
	expect(root.querySelector("ul li")?.textContent).toBe("item");
	expect(root.textContent).not.toContain("*");
	expect(root.textContent).not.toContain("#");
});

test("only `## ` is a heading; other levels read as text, as the viewer shows them", () => {
	const e = start("# Big\n### Small");
	expect(root.querySelector("h1, h2, h3")).toBeNull();
	// Saved escaped, so the viewer shows them as the text they are.
	expect(e.markdown()).toBe("\\# Big\n\\### Small");
});

test("a paragraph typed after a list stays out of it (a blank line between)", () => {
	const e = start("- one\nafter");
	// Lexical reads "after" as its own paragraph; the viewer would read it into the item.
	expect(e.markdown()).toBe("- one\n\nafter");
	expect(root.querySelectorAll("p")).toHaveLength(1);
	expect(toNoteBlocks(e.markdown()).map((b) => b.kind)).toEqual(["list", "paragraph"]);
});

test("toggle bold on a selection exports **…**", async () => {
	const e = start("make this bold");
	await select("span", 10, 14);
	e.toggle("bold");
	expect(e.markdown()).toBe("make this **bold**");
	expect(e.state().bold).toBe(true);
	e.toggle("italic");
	expect(e.markdown()).toContain("*");
	expect(e.state().italic).toBe(true);
});

test("heading() exports `## ` and toggles back", async () => {
	const e = start("Title\nbody");
	await select("p span");
	e.heading();
	expect(e.markdown()).toBe("## Title\nbody");
	expect(e.state().heading).toBe(true);
	await select("h2 span");
	e.heading();
	expect(e.markdown()).toBe("Title\nbody");
});

test("list() makes a list of the right kind and toggles back", async () => {
	const e = start("item");
	await select("span");
	e.list(false);
	expect(e.markdown()).toBe("- item");
	expect(e.state().list).toBe("bullet");
	e.list(true);
	expect(e.markdown()).toBe("1. item");
	expect(e.state().list).toBe("number");
	e.list(true);
	expect(e.markdown()).toBe("item");
});

test("link() accepts only http, https and mailto", async () => {
	const e = start("a word here");
	await select("span", 2, 6);
	expect(e.link("javascript:alert(1)")).toBe(false);
	expect(e.link("data:text/html,x")).toBe(false);
	expect(e.link("not a url")).toBe(false);
	expect(e.markdown()).toBe("a word here");
	expect(root.querySelector("a")).toBeNull();
	expect(e.link("https://example.com/")).toBe(true);
	expect(e.markdown()).toBe("a [word](https://example.com/) here");
	await select("a span", 1, 1);
	expect(e.state().link).toBe("https://example.com/");
	expect(e.link(null)).toBe(true);
	expect(e.markdown()).toBe("a word here");
});

test("an unsafe link in the Markdown comes in as plain text", () => {
	const e = start("[bad](javascript:alert(1)) and [ok](https://ok.example/)");
	expect(root.querySelectorAll("a")).toHaveLength(1);
	expect(e.markdown()).toBe("bad and [ok](https://ok.example/)");
});

test("paste keeps only the allowed formatting", async () => {
	const e = start("");
	await caretAtEnd();
	await paste(
		[
			"<h1>Big title</h1>",
			'<p>Hi <span style="color:red;font-weight:bold">red</span> <u>under</u> ',
			'<a href="javascript:alert(1)">bad</a>',
			' <a href="https://ok.example/" title="t" target="_self">ok</a>',
			'<img src="https://example.com/x.png" alt="pic"></p>',
			"<table><tr><td>cell</td></tr></table>",
			"<ul><li>a<ul><li>nested</li></ul></li></ul>",
			"<h4>Small</h4>"
		].join("")
	);
	const markdown = e.markdown();
	expect(markdown).toBe(
		[
			"## Big title",
			"Hi **red** under bad [ok](https://ok.example/)",
			"cell",
			"",
			"- a",
			"- nested",
			"",
			"## Small"
		].join("\n")
	);
	expect(root.querySelector("img, table, u, h1, h4, [style]")).toBeNull();
	expect(root.querySelectorAll("a")).toHaveLength(1);
	expect(markdown).not.toContain("javascript");
	// The saved Markdown reads back the same.
	e.destroy();
	root.remove();
	expect(start(markdown).markdown()).toBe(markdown);
});

test("pasted text that looks like Markdown structure stays text", async () => {
	const e = start("");
	await caretAtEnd();
	await paste("", "- not a list\n1. not numbered\n## not a heading\n---\nplain");
	const markdown = e.markdown();
	expect(markdown).toBe("\\- not a list\n1\\. not numbered\n\\## not a heading\n\\---\nplain");
	expect(root.querySelector("ul, ol, h2")).toBeNull();
	// It reads back as the same text.
	e.destroy();
	root.remove();
	const again = start(markdown);
	expect(again.markdown()).toBe(markdown);
	expect(root.querySelector("ul, ol, h2")).toBeNull();
	expect(root.textContent).toContain("- not a list");
	// The viewer shows it as one paragraph of text too.
	expect(toNoteBlocks(markdown).map((b) => b.kind)).toEqual(["paragraph"]);
});

test("a pasted web address becomes a link", async () => {
	const e = start("see ");
	await caretAtEnd();
	await paste("", "https://example.com/page");
	expect(e.markdown()).toBe("see [https://example.com/page](https://example.com/page)");
});
