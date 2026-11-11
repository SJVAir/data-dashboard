import { describe, expect, it } from "vitest";
import { safeHref, toNoteBlocks } from "./markdown";

const t = (text: string) => ({ kind: "text", text });

describe("toNoteBlocks", () => {
	it("turns a single newline into a break", () => {
		expect(toNoteBlocks("a\nb")).toEqual([
			{ kind: "paragraph", children: [t("a"), { kind: "break" }, t("b")] }
		]);
	});
	it("splits paragraphs on a blank line", () => {
		expect(toNoteBlocks("a\n\nb")).toEqual([
			{ kind: "paragraph", children: [t("a")] },
			{ kind: "paragraph", children: [t("b")] }
		]);
	});
	it("allows only level-2 headings", () => {
		expect(toNoteBlocks("## Hi")).toEqual([{ kind: "heading", children: [t("Hi")] }]);
		expect(toNoteBlocks("# Hi")).toEqual([{ kind: "paragraph", children: [t("# Hi")] }]);
		expect(toNoteBlocks("### Hi")).toEqual([{ kind: "paragraph", children: [t("### Hi")] }]);
	});
	it("maps strong, em and lists", () => {
		expect(toNoteBlocks("**b** *i*")).toEqual([
			{
				kind: "paragraph",
				children: [
					{ kind: "strong", children: [t("b")] },
					t(" "),
					{ kind: "em", children: [t("i")] }
				]
			}
		]);
		expect(toNoteBlocks("- a\n- b")).toEqual([
			{ kind: "list", ordered: false, start: 1, items: [[t("a")], [t("b")]] }
		]);
		const ol = toNoteBlocks("3. a\n4. b");
		expect(ol[0]).toMatchObject({ kind: "list", ordered: true, start: 3 });
	});
	it("keeps raw HTML as literal text", () => {
		for (const src of ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>"]) {
			const blocks = toNoteBlocks(src);
			expect(blocks).toHaveLength(1);
			const flat = JSON.stringify(blocks);
			expect(flat).not.toMatch(/"kind":"(link|strong|em)"/);
			const [b] = blocks;
			expect(b.kind).toBe("paragraph");
			if (b.kind === "paragraph")
				expect(b.children.every((c) => c.kind === "text" || c.kind === "break")).toBe(true);
			if (b.kind === "paragraph")
				expect(b.children.map((c) => (c.kind === "text" ? c.text : "")).join("")).toContain(src);
		}
	});
	it("drops unsafe link targets", () => {
		for (const src of [
			"[x](javascript:alert(1))",
			"[x](data:text/html,hi)",
			"[x](//evil.test)",
			"[x](/rel)"
		]) {
			expect(toNoteBlocks(src)).toEqual([{ kind: "paragraph", children: [t("x")] }]);
		}
	});
	it("keeps safe links", () => {
		expect(toNoteBlocks("[x](mailto:a@b.test)")).toEqual([
			{
				kind: "paragraph",
				children: [{ kind: "link", href: "mailto:a@b.test", children: [t("x")] }]
			}
		]);
		const bare = toNoteBlocks("https://sjvair.com");
		expect(bare).toEqual([
			{
				kind: "paragraph",
				children: [
					{ kind: "link", href: "https://sjvair.com/", children: [t("https://sjvair.com")] }
				]
			}
		]);
	});
	it("turns images, tables, code and quotes into source text", () => {
		for (const src of [
			"![a](http://x.test/i.png)",
			"| a | b |\n|---|---|\n| 1 | 2 |",
			"```\ncode\n```",
			"> quote"
		]) {
			const blocks = toNoteBlocks(src);
			expect(blocks.every((b) => b.kind === "paragraph")).toBe(true);
			expect(JSON.stringify(blocks)).not.toMatch(/"kind":"(link|strong|em|list|heading)"/);
		}
		expect(toNoteBlocks("> quote")).toEqual([{ kind: "paragraph", children: [t("> quote")] }]);
	});
	it("keeps a `javascript:` autolink as text", () => {
		expect(toNoteBlocks("<javascript:alert(1)>")).toEqual([
			{ kind: "paragraph", children: [t("javascript:alert(1)")] }
		]);
	});
	it("drops a reference link to `javascript:`; the definition shows as text", () => {
		const blocks = toNoteBlocks("[x][r]\n\n[r]: javascript:alert(1)");
		expect(JSON.stringify(blocks)).not.toContain('"kind":"link"');
		expect(blocks).toEqual([
			{ kind: "paragraph", children: [t("x")] },
			{ kind: "paragraph", children: [t("[r]: javascript:alert(1)")] }
		]);
	});
	it("keeps entities literal", () => {
		expect(toNoteBlocks("&amp; &lt;b&gt; &#x41;")).toEqual([
			{ kind: "paragraph", children: [t("&amp; &lt;b&gt; &#x41;")] }
		]);
	});
	it("shows escaped characters as typed (the editor's export of plain text)", () => {
		const blocks = toNoteBlocks(
			"\\[docs\\](x) \\_x\\_ a\\*b\\*c \\`c\\` \\<b> \\&#65; \\&amp; \\~\\~s\\~\\~ \\\\#"
		);
		expect(blocks).toHaveLength(1);
		const block = blocks[0];
		expect(block.kind).toBe("paragraph");
		if (block.kind !== "paragraph") return;
		expect(block.children.every((c) => c.kind === "text")).toBe(true);
		expect(block.children.map((c) => (c.kind === "text" ? c.text : "")).join("")).toBe(
			"[docs](x) _x_ a*b*c `c` <b> &#65; &amp; ~~s~~ \\#"
		);
	});
	it("reads a loose list as a plain list", () => {
		expect(toNoteBlocks("- a\n\n- b")).toEqual([
			{ kind: "list", ordered: false, start: 1, items: [[t("a")], [t("b")]] }
		]);
	});
	it("shows a task list's boxes as text, with no checkbox", () => {
		const blocks = toNoteBlocks("- [ ] c\n- [x] d");
		expect(blocks).toEqual([
			{
				kind: "list",
				ordered: false,
				start: 1,
				items: [
					[t("[ ]"), { kind: "break" }, t("c")],
					[t("[x]"), { kind: "break" }, t("d")]
				]
			}
		]);
	});
});

describe("safeHref", () => {
	it("allows http, https, mailto only", () => {
		expect(safeHref("https://a.test/x")).toBe("https://a.test/x");
		expect(safeHref("http://a.test/")).toBe("http://a.test/");
		expect(safeHref("mailto:a@b.test")).toBe("mailto:a@b.test");
		for (const u of ["javascript:1", "data:x", "vbscript:1", "//e.test", "/r", "x"])
			expect(safeHref(u)).toBeNull();
	});
});

describe("bare addresses as the editor saves them", () => {
	it("reads the editor's escapes back in a web address", () => {
		expect(toNoteBlocks("see https://x.org/San\\_J\\~u?q=\\[1\\]&a=\\\\b")).toEqual([
			{
				kind: "paragraph",
				children: [
					t("see "),
					{
						kind: "link",
						href: "https://x.org/San_J~u?q=[1]&a=\\b",
						children: [t("https://x.org/San_J~u?q=[1]&a=\\b")]
					}
				]
			}
		]);
	});
	it("keeps an email address whole across an escaped `_`", () => {
		expect(toNoteBlocks("hi first\\_last@x.org.")).toEqual([
			{
				kind: "paragraph",
				children: [
					t("hi "),
					{ kind: "link", href: "mailto:first_last@x.org", children: [t("first_last@x.org")] },
					t(".")
				]
			}
		]);
	});
	it("leaves a `[text](url)` link's escapes to marked", () => {
		expect(toNoteBlocks("[a\\_b](https://x.org/c_d)")).toEqual([
			{
				kind: "paragraph",
				children: [{ kind: "link", href: "https://x.org/c_d", children: [t("a"), t("_"), t("b")] }]
			}
		]);
	});
});
