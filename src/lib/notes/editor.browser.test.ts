import { afterEach, expect, test } from "vitest";
import { createNoteEditor, type NoteEditor } from "./editor";
import { toNoteBlocks, type NoteInline } from "./markdown";

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

/** Pastes `text` into an empty editor, then checks its Markdown reads back the same. */
async function pasteAndReopen(text: string): Promise<string> {
	const e = start("");
	await caretAtEnd();
	await paste("", text);
	const markdown = e.markdown();
	e.destroy();
	root.remove();
	expect(start(markdown).markdown()).toBe(markdown);
	return markdown;
}

/** The viewer's text of a paragraph, its breaks as newlines. */
function paragraphText(markdown: string): string[] {
	return toNoteBlocks(markdown).map((b) =>
		b.kind === "paragraph"
			? b.children
					.map((c) => (c.kind === "text" ? c.text : c.kind === "break" ? "\n" : ""))
					.join("")
			: `<${b.kind}>`
	);
}

test("a `--` or `==` line stays text and doesn't make the line above a heading", async () => {
	const markdown = await pasteAndReopen("Thanks\n--\nMs. Smith");
	expect(root.querySelector("h2")).toBeNull();
	expect(root.textContent).toContain("--");
	expect(paragraphText(markdown)).toEqual(["Thanks\n--\nMs. Smith"]);

	const equals = await pasteAndReopen("a\n==");
	expect(paragraphText(equals)).toEqual(["a\n=="]);
	const single = await pasteAndReopen("a\n=\nb\n-");
	expect(paragraphText(single)).toEqual(["a\n=\nb\n-"]);
});

test("a line starting with `<` stays text, and the heading after it stays a heading", async () => {
	const e = start("");
	await caretAtEnd();
	await paste("", "<div>x\n<!-- y\nTitle");
	await select("p:last-child span");
	e.heading();
	const markdown = e.markdown();
	expect(markdown.endsWith("## Title")).toBe(true);
	expect(toNoteBlocks(markdown).map((b) => b.kind)).toEqual(["paragraph", "heading"]);
	expect(paragraphText(markdown)[0]).toBe("<div>x\n<!-- y");
	e.destroy();
	root.remove();
	expect(start(markdown).markdown()).toBe(markdown);
	expect(root.querySelector("h2")?.textContent).toBe("Title");
});

test("a pasted web address becomes a link", async () => {
	const e = start("see ");
	await caretAtEnd();
	await paste("", "https://example.com/page");
	expect(e.markdown()).toBe("see [https://example.com/page](https://example.com/page)");
});

/** The viewer's inlines as text, a link as `<link:its text>`; marks anything else. */
function viewerText(inlines: NoteInline[]): string {
	return inlines
		.map((c) =>
			c.kind === "text"
				? c.text
				: c.kind === "link"
					? `<link:${viewerText(c.children)}>`
					: c.kind === "break"
						? "\n"
						: `<${c.kind}>`
		)
		.join("");
}

test("text that looks like inline Markdown stays text, in the editor and the viewer", async () => {
	// Typed text, and what the viewer shows: the same characters (a bare web address still
	// shows as a link, as intended).
	const cases: [string, string][] = [
		["[docs](https://x.org)", "[docs](<link:https://x.org>)"],
		["\\#", "\\#"],
		["_x_", "_x_"],
		["a*b*c", "a*b*c"],
		["**not bold**", "**not bold**"],
		["`code`", "`code`"],
		["<b>", "<b>"],
		["<https://x.org>", "<https://x.org>"],
		["&amp;", "&amp;"],
		["&#65; &#x41;", "&#65; &#x41;"],
		["~~x~~", "~~x~~"],
		["ends with \\", "ends with \\"],
		["a \\*b\\* c", "a \\*b\\* c"],
		["[a]: x", "[a]: x"],
		["![i](x.png) [y]", "![i](x.png) [y]"],
		["Tom & Jerry < 3", "Tom & Jerry < 3"]
	];
	for (const [text, shown] of cases) {
		const markdown = await pasteAndReopen(text);
		// The editor reads it back as the same plain text.
		expect(root.textContent, markdown).toBe(text);
		expect(root.querySelector("a, strong, em, b, i, code, s"), markdown).toBeNull();
		// The viewer shows the typed characters, with no formatting.
		const blocks = toNoteBlocks(markdown);
		expect(
			blocks.map((b) => b.kind),
			markdown
		).toEqual(["paragraph"]);
		const block = blocks[0];
		if (block.kind === "paragraph") expect(viewerText(block.children), markdown).toBe(shown);
		editor?.destroy();
		editor = null;
		root.remove();
	}
});

test("escaped text next to real bold, italic and a link keeps both", async () => {
	const e = start("");
	await caretAtEnd();
	await paste("", "a_b [c] bold");
	await select("span", 8, 12);
	e.toggle("bold");
	const markdown = e.markdown();
	expect(markdown).toBe("a\\_b \\[c\\] **bold**");
	const blocks = toNoteBlocks(markdown);
	if (blocks[0].kind === "paragraph")
		expect(viewerText(blocks[0].children)).toBe("a_b [c] <strong>");
	e.destroy();
	root.remove();
	const again = start("*it* [x_[y]](https://example.com/a) **b**");
	expect(root.querySelector("em")?.textContent).toBe("it");
	expect(root.querySelector("a")?.textContent).toBe("x_[y]");
	expect(again.markdown()).toBe("*it* [x\\_\\[y\\]](https://example.com/a) **b**");
});

test("a typed bare address with `_`, `~` or brackets links to exactly what was typed", async () => {
	const cases: [string, string, string][] = [
		[
			"https://en.wikipedia.org/wiki/San_Joaquin_Valley",
			"https://en.wikipedia.org/wiki/San_Joaquin_Valley",
			"https://en.wikipedia.org/wiki/San_Joaquin_Valley"
		],
		["https://x.org/~u", "https://x.org/~u", "https://x.org/~u"],
		["https://x.org/?q=[1]", "https://x.org/?q=[1]", "https://x.org/?q=[1]"],
		["www.x.org/a_b", "www.x.org/a_b", "http://www.x.org/a_b"],
		["first_last@x.org", "first_last@x.org", "mailto:first_last@x.org"],
		["a.b_c+d@x.org", "a.b_c+d@x.org", "mailto:a.b_c+d@x.org"]
	];
	for (const [address, shown, href] of cases) {
		// Typed among other words (a paste of the address alone would make it a link at once).
		const typed = `see ${address} now`;
		const markdown = await pasteAndReopen(typed);
		expect(root.textContent, markdown).toBe(typed);
		expect(root.querySelector("a"), markdown).toBeNull();
		const blocks = toNoteBlocks(markdown);
		const block = blocks[0];
		expect(block.kind, markdown).toBe("paragraph");
		if (block.kind !== "paragraph") continue;
		expect(viewerText(block.children), markdown).toBe(`see <link:${shown}> now`);
		const link = block.children.find((c) => c.kind === "link");
		expect(link?.kind === "link" && link.href, markdown).toBe(href);
		editor?.destroy();
		editor = null;
		root.remove();
	}
});

test("a `!` right before a link stays text (not an image)", async () => {
	const e = start("Wow!");
	await caretAtEnd();
	await paste("", "https://example.com/site");
	const markdown = e.markdown();
	expect(markdown).toBe("Wow\\![https://example.com/site](https://example.com/site)");
	const block = toNoteBlocks(markdown)[0];
	if (block.kind === "paragraph") {
		expect(viewerText(block.children)).toBe("Wow!<link:https://example.com/site>");
	}
	e.destroy();
	root.remove();
	expect(start(markdown).markdown()).toBe(markdown);
	expect(root.textContent).toBe("Wow!https://example.com/site");
	// Only before a link: a `!` ending a line stays as it is.
	editor?.destroy();
	root.remove();
	expect(start("Wow!").markdown()).toBe("Wow!");
});

test("a typed bare address ending in `_` or `~` shows no stray backslash", async () => {
	for (const end of ["_", "~"]) {
		const typed = `see https://x.org/a${end} now`;
		const markdown = await pasteAndReopen(typed);
		expect(root.textContent, markdown).toBe(typed);
		const block = toNoteBlocks(markdown)[0];
		expect(block.kind, markdown).toBe("paragraph");
		if (block.kind !== "paragraph") continue;
		// GFM leaves the trailing `_` or `~` out of the link.
		expect(viewerText(block.children), markdown).toBe(`see <link:https://x.org/a>${end} now`);
		const link = block.children.find((c) => c.kind === "link");
		expect(link?.kind === "link" && link.href, markdown).toBe("https://x.org/a");
		editor?.destroy();
		editor = null;
		root.remove();
	}
});
