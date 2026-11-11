import { marked, type Token, type Tokens } from "marked";

export type NoteInline =
	| { kind: "text"; text: string }
	| { kind: "strong" | "em"; children: NoteInline[] }
	| { kind: "link"; href: string; children: NoteInline[] }
	| { kind: "break" };

export type NoteBlock =
	| { kind: "paragraph" | "heading"; children: NoteInline[] }
	| { kind: "list"; ordered: boolean; start: number; items: NoteInline[][] };

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** The URL when it is absolute with an allowed protocol, else null. */
export function safeHref(url: string): string | null {
	try {
		const parsed = new URL(url);
		return SAFE_PROTOCOLS.has(parsed.protocol) ? parsed.href : null;
	} catch {
		return null;
	}
}

function text(value: string): NoteInline {
	return { kind: "text", text: value };
}

/** A backslash escape of ASCII punctuation (CommonMark's). */
const ESCAPED = /\\([!-/:-@[-`{-~])/g;

/** A GFM bare web or email address (`https://…`, `www.…`, `a@b.org`), not `[…](…)` or `<…>`. */
function isBareAutolink(t: Tokens.Link): boolean {
	return !t.raw.startsWith("[") && !t.raw.startsWith("<");
}

/** The end of a text that an email address's local part can take (`first_` before `last@…`). */
const LOCAL_PART_END = /[A-Za-z0-9._+-]+$/;

/**
 * A bare address as the person typed it. The editor escapes `_`, `~`, `[`, `]` and `\\` in its
 * text, but GFM keeps those backslashes in a bare address (and the URL parser reads `\\` as `/`),
 * so they're read back here. An escaped `_` also ends an email address early (`first\\_last@x.org`
 * links only `last@x.org`): the local part before it, in the text just pushed, is taken back in.
 */
function pushBareAutolink(out: NoteInline[], t: Tokens.Link): void {
	let shown = t.text.replace(ESCAPED, "$1");
	let address = t.href.replace(ESCAPED, "$1");
	if (address.startsWith("mailto:")) {
		let local = "";
		while (out.length > 0) {
			const last = out[out.length - 1];
			if (last.kind !== "text") break;
			const match = LOCAL_PART_END.exec(last.text);
			if (!match) break;
			local = match[0] + local;
			if (match[0].length < last.text.length) {
				out[out.length - 1] = text(last.text.slice(0, -match[0].length));
				break;
			}
			out.pop();
		}
		shown = local + shown;
		address = `mailto:${local}${address.slice("mailto:".length)}`;
	}
	const href = safeHref(address);
	if (href === null) out.push(text(shown));
	else out.push({ kind: "link", href, children: [text(shown)] });
}

function inlines(tokens: Token[] | undefined, fallback: string): NoteInline[] {
	if (!tokens) return fallback ? [text(fallback)] : [];
	const out: NoteInline[] = [];
	for (const token of tokens) {
		switch (token.type) {
			case "text": {
				const t = token as Tokens.Text;
				out.push(...(t.tokens ? inlines(t.tokens, t.raw) : [text(t.raw)]));
				break;
			}
			case "escape":
				out.push(text((token as Tokens.Escape).text));
				break;
			case "br":
				out.push({ kind: "break" });
				break;
			case "strong":
			case "em": {
				const t = token as Tokens.Strong | Tokens.Em;
				out.push({ kind: token.type, children: inlines(t.tokens, t.text) });
				break;
			}
			case "link": {
				const t = token as Tokens.Link;
				if (isBareAutolink(t)) {
					pushBareAutolink(out, t);
					break;
				}
				const children = inlines(t.tokens, t.text);
				const href = safeHref(t.href);
				if (href === null) out.push(...children);
				else out.push({ kind: "link", href, children });
				break;
			}
			default:
				// Everything else (html, images, code, strikethrough...) shows its source.
				out.push(text(token.raw));
		}
	}
	return out;
}

function listItem(item: Tokens.ListItem): NoteInline[] {
	const out: NoteInline[] = [];
	for (const token of item.tokens) {
		if (token.type === "space") continue;
		if (token.type === "text" || token.type === "paragraph") {
			const t = token as Tokens.Text | Tokens.Paragraph;
			if (out.length > 0) out.push({ kind: "break" });
			out.push(...inlines(t.tokens, t.raw.trim()));
		} else {
			if (out.length > 0) out.push({ kind: "break" });
			out.push(text(token.raw.trim()));
		}
	}
	return out;
}

/** Markdown to a small block model: paragraphs, level-2 headings and lists only. */
export function toNoteBlocks(markdown: string): NoteBlock[] {
	const blocks: NoteBlock[] = [];
	for (const token of marked.lexer(markdown, { gfm: true, breaks: true })) {
		switch (token.type) {
			case "space":
				break;
			case "paragraph": {
				const t = token as Tokens.Paragraph;
				blocks.push({ kind: "paragraph", children: inlines(t.tokens, t.text) });
				break;
			}
			case "heading": {
				const t = token as Tokens.Heading;
				if (t.depth === 2) blocks.push({ kind: "heading", children: inlines(t.tokens, t.text) });
				else blocks.push({ kind: "paragraph", children: [text(t.raw.trim())] });
				break;
			}
			case "list": {
				const t = token as Tokens.List;
				blocks.push({
					kind: "list",
					ordered: t.ordered,
					start: t.ordered && typeof t.start === "number" ? t.start : 1,
					items: t.items.map(listItem)
				});
				break;
			}
			default:
				blocks.push({ kind: "paragraph", children: [text(token.raw.trim())] });
		}
	}
	return blocks;
}
