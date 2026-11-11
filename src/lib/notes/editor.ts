// The Note editor: Lexical (vanilla API), formatted as you type, saved as Markdown. Loaded only
// with the editor dialog (its own chunk), never in the initial bundle.
import {
	$createParagraphNode,
	$createTextNode,
	$isTextNode,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isParagraphNode,
	$isRangeSelection,
	$isRootNode,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_LOW,
	createEditor,
	FORMAT_TEXT_COMMAND,
	INSERT_LINE_BREAK_COMMAND,
	INSERT_PARAGRAPH_COMMAND,
	LineBreakNode,
	PASTE_COMMAND,
	TextNode,
	type ElementNode,
	type LexicalEditor,
	type LexicalNode,
	type TextFormatType
} from "lexical";
import {
	$createHeadingNode,
	$isHeadingNode,
	HeadingNode,
	registerRichText
} from "@lexical/rich-text";
import {
	$isListItemNode,
	$isListNode,
	INSERT_ORDERED_LIST_COMMAND,
	INSERT_UNORDERED_LIST_COMMAND,
	ListItemNode,
	ListNode,
	registerList,
	REMOVE_LIST_COMMAND
} from "@lexical/list";
import { $createLinkNode, $isLinkNode, $toggleLink, LinkNode } from "@lexical/link";
import {
	$convertFromMarkdownString,
	$convertToMarkdownString,
	BOLD_STAR,
	ITALIC_STAR,
	LINK,
	ORDERED_LIST,
	registerMarkdownShortcuts,
	UNORDERED_LIST,
	type ElementTransformer,
	type TextMatchTransformer,
	type Transformer
} from "@lexical/markdown";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import { report } from "$lib/safety/report";
import { safeHref } from "./markdown";

/** The one heading level a Note has (`## `, shown as a small heading in the widget). */
const NOTE_HEADING: ElementTransformer = {
	dependencies: [HeadingNode],
	export: (node, exportChildren) =>
		$isHeadingNode(node) ? `## ${exportChildren(node as ElementNode)}` : null,
	regExp: /^##\s/,
	replace: (parentNode, children, _match, isImport) => {
		const heading = $createHeadingNode("h2");
		heading.append(...children);
		parentNode.replace(heading);
		if (!isImport) heading.select(0, 0);
	},
	type: "element"
};

/**
 * A run of typed text with the characters that would start inline Markdown escaped, so it reads
 * back as the same text in the editor and the viewer: `\\`, `[`, `]`, a `<` that could open a
 * tag or an autolink, and an `&` that could start a character reference. (Lexical itself escapes
 * `*`, `_`, `` ` `` and `~`; line starts are `escapeLine`'s.) A typed bare web address isn't
 * escaped: the viewer shows it as a link, as intended.
 */
export function escapeInline(text: string): string {
	return text.replace(/[\\[\]]|<(?=\S|$)|&(?=#|[a-z][a-z0-9]*;|$)/gi, "\\$&");
}

/** Export only: each plain text run goes out through `escapeInline` (then Lexical's own pass). */
const ESCAPED_TEXT: TextMatchTransformer = {
	dependencies: [],
	export: (node, _exportChildren, exportFormat) =>
		$isTextNode(node) ? exportFormat(node, escapeInline(node.getTextContent())) : null,
	// Never matches: nothing is imported or typed through this transformer.
	regExp: /(?!)/,
	type: "text-match"
};

/** The Markdown a Note may hold: what the viewer renders, and nothing else. */
export const NOTE_TRANSFORMERS: Transformer[] = [
	NOTE_HEADING,
	UNORDERED_LIST,
	ORDERED_LIST,
	LINK,
	BOLD_STAR,
	ITALIC_STAR,
	// Last, so the link transformer exports links first.
	ESCAPED_TEXT
];

/** The text formats a Note keeps (Lexical's bit flags for bold and italic). */
const BOLD = 1;
const ITALIC = 2;
const ALLOWED_FORMATS = BOLD | ITALIC;

/**
 * What a person typed as a link address, as an address: one with no scheme is taken as a web
 * address (`example.com`) or, with an `@`, an email address. Whether it's allowed is
 * `safeHref`'s call.
 */
export function addressFrom(text: string): string {
	const trimmed = text.trim();
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
	if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(trimmed)) return `mailto:${trimmed}`;
	return `https://${trimmed}`;
}

export type ToolbarState = {
	bold: boolean;
	italic: boolean;
	heading: boolean;
	/** The list the selection is in, if any. */
	list: "bullet" | "number" | null;
	/** The address of the link the selection is in, if any. */
	link: string | null;
};

export type NoteEditor = {
	/** The note as Markdown (normalized: only the allowed constructs, line breaks kept). */
	markdown(): string;
	toggle(format: "bold" | "italic"): void;
	/** Turns the selected paragraphs into the heading, or back into paragraphs. */
	heading(): void;
	/** Turns the selected blocks into a list of that kind, or back into paragraphs. */
	list(ordered: boolean): void;
	/**
	 * Links the selection to `url` (`null` removes the link). Only `http:`, `https:` and
	 * `mailto:` addresses: anything else changes nothing and returns `false`.
	 */
	link(url: string | null): boolean;
	state(): ToolbarState;
	destroy(): void;
};

export type NoteEditorOptions = {
	/** Called after every change to the content or the selection. */
	onUpdate?: () => void;
};

const EMPTY_STATE: ToolbarState = {
	bold: false,
	italic: false,
	heading: false,
	list: null,
	link: null
};

function isEmptyParagraph(node: LexicalNode | null): boolean {
	return $isParagraphNode(node) && node.getChildrenSize() === 0;
}

/**
 * The viewer reads a line right after a list as part of its last item (Markdown's "lazy"
 * continuation), so a list and the paragraph or heading next to it are kept a blank line apart.
 */
function needsBlankLine(before: LexicalNode, after: LexicalNode): boolean {
	if (isEmptyParagraph(before) || isEmptyParagraph(after)) return false;
	return $isListNode(before) !== $isListNode(after);
}

/**
 * A paragraph line that would read as Markdown structure (`- `, `1. `, `## `, `> `, a `---`
 * rule, a `--` or `==` line that makes the line above a heading, a `<div` or `<!--` that starts
 * raw HTML), with its marker escaped: text typed or pasted that way stays text in the viewer.
 * Every line is escaped, the first too, as paragraphs are joined by a single line break.
 */
function escapeLine(line: string): string {
	return line
		.replace(/^(\s*)(#{1,6}|[>+*-])(?=\s|$)/, "$1\\$2")
		.replace(/^(\s*)(\d+)([.)])(?=\s|$)/, "$1$2\\$3")
		.replace(/^(\s*)([-=_*])(?=(?:\s*\2){2,}\s*$)/, "$1\\$2")
		.replace(/^(\s*)([-=])(?=\2*\s*$)/, "$1\\$2")
		.replace(/^(\s*)</, "$1\\<");
}

/** The blocks as Markdown, each list a blank line away from the text around it. */
function $exportMarkdown(): string {
	const blocks = $getRoot().getChildren();
	const parts: string[] = [];
	blocks.forEach((block, i) => {
		// One block at a time (its own "root"), so the blank lines can go between them.
		const holder = { getChildren: () => [block] } as unknown as ElementNode;
		let text = $convertToMarkdownString(NOTE_TRANSFORMERS, holder, true);
		if ($isParagraphNode(block)) text = text.split("\n").map(escapeLine).join("\n");
		if (i > 0 && needsBlankLine(blocks[i - 1], block)) parts.push("");
		parts.push(text);
	});
	// Blank lines at the very end show nothing.
	return parts.join("\n").replace(/\n+$/, "");
}

/** Reads Markdown in, dropping the blank line `$exportMarkdown` put next to a list. */
function $importMarkdown(markdown: string): void {
	$convertFromMarkdownString(markdown, NOTE_TRANSFORMERS, undefined, true);
	for (const block of $getRoot().getChildren()) {
		const before = block.getPreviousSibling();
		const after = block.getNextSibling();
		if (isEmptyParagraph(block) && before && after && needsBlankLine(before, after)) {
			block.remove();
		}
	}
}

/** The top-level blocks the selection touches. */
function $selectedBlocks(): ElementNode[] {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) return [];
	const blocks = new Set<ElementNode>();
	const nodes = [...selection.getNodes(), selection.anchor.getNode(), selection.focus.getNode()];
	for (const node of nodes) {
		const block = $isRootNode(node) ? null : node.getTopLevelElement();
		if ($isElementNode(block)) blocks.add(block);
	}
	return [...blocks];
}

function $readState(): ToolbarState {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) return EMPTY_STATE;
	const anchor = selection.anchor.getNode();
	const block = $isRootNode(anchor) ? null : anchor.getTopLevelElement();
	const list = $findMatchingParent(anchor, $isListNode);
	const link =
		$findMatchingParent(anchor, $isLinkNode) ??
		$findMatchingParent(selection.focus.getNode(), $isLinkNode);
	const listType = $isListNode(list) ? list.getListType() : null;
	return {
		bold: selection.hasFormat("bold"),
		italic: selection.hasFormat("italic"),
		heading: $isHeadingNode(block),
		list: listType === "bullet" || listType === "number" ? listType : null,
		link: $isLinkNode(link) ? link.getURL() : null
	};
}

/** Moves a node's children in front of it and removes it. */
function $unwrap(node: ElementNode): void {
	for (const child of node.getChildren()) node.insertBefore(child);
	node.remove();
}

/**
 * Keeps the content to what a Note can hold, however it arrived (typing, Markdown, paste): bold
 * and italic only, no inline styles, one heading level, flat lists, and only safe links.
 */
function registerNormalizers(editor: LexicalEditor): () => void {
	return mergeRegister(
		editor.registerNodeTransform(TextNode, (node) => {
			if (node.getFormat() & ~ALLOWED_FORMATS) node.setFormat(node.getFormat() & ALLOWED_FORMATS);
			if (node.getStyle() !== "") node.setStyle("");
		}),
		editor.registerNodeTransform(HeadingNode, (node) => {
			if (node.getTag() !== "h2") node.replace($createHeadingNode("h2"), true);
		}),
		editor.registerNodeTransform(LinkNode, (node) => {
			const href = safeHref(node.getURL());
			if (href === null) {
				$unwrap(node);
				return;
			}
			if (node.getURL() !== href) node.setURL(href);
			if (node.getTitle() !== null) node.setTitle(null);
			if (node.getTarget() !== null) node.setTarget(null);
			if (node.getRel() !== null) node.setRel(null);
		}),
		editor.registerNodeTransform(ListNode, (node) => {
			if (node.getListType() === "check") node.setListType("bullet");
			// A list inside a list item (pasted, or indented) joins its parent list.
			const wrapper = node.getParent();
			if (!$isListItemNode(wrapper)) return;
			let anchor: LexicalNode = wrapper;
			for (const item of node.getChildren()) {
				anchor.insertAfter(item);
				anchor = item;
			}
			node.remove();
			if (wrapper.getChildrenSize() === 0) wrapper.remove();
		}),
		editor.registerNodeTransform(LineBreakNode, (node) => {
			// A line break only within a paragraph (one in a list item or heading reads back as a
			// new block): elsewhere it becomes a space.
			if (!$isParagraphNode(node.getParent())) node.replace($createTextNode(" "));
		}),
		// Shift+Enter in a list item or the heading starts a new one instead.
		editor.registerCommand(
			INSERT_LINE_BREAK_COMMAND,
			() => {
				const selection = $getSelection();
				if (!$isRangeSelection(selection)) return false;
				const block = selection.anchor.getNode();
				const inside =
					$findMatchingParent(block, $isListItemNode) ?? $findMatchingParent(block, $isHeadingNode);
				if (!inside) return false;
				return editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
			},
			COMMAND_PRIORITY_LOW
		),
		// Only bold and italic (Ctrl+U and the like do nothing).
		editor.registerCommand(
			FORMAT_TEXT_COMMAND,
			(format: TextFormatType) => format !== "bold" && format !== "italic",
			COMMAND_PRIORITY_HIGH
		),
		// A pasted web address becomes a link (of the selection, or of the address itself).
		editor.registerCommand(
			PASTE_COMMAND,
			(event) => {
				const data = event instanceof ClipboardEvent ? event.clipboardData : null;
				if (!data || data.types.includes("text/html")) return false;
				const text = data.getData("text/plain").trim();
				if (!/^(https?:\/\/|mailto:)\S+$/i.test(text)) return false;
				const href = safeHref(text);
				const selection = $getSelection();
				if (href === null || !$isRangeSelection(selection)) return false;
				event.preventDefault();
				if (selection.isCollapsed()) {
					const link = $createLinkNode(href).append($createTextNode(text));
					selection.insertNodes([link]);
				} else {
					$toggleLink(href);
				}
				return true;
			},
			COMMAND_PRIORITY_LOW
		)
	);
}

/** Starts the editor in `root` (a `contenteditable` element) with the note's Markdown. */
export function createNoteEditor(
	root: HTMLElement,
	markdown: string,
	options: NoteEditorOptions = {}
): NoteEditor {
	const editor = createEditor({
		namespace: "note",
		nodes: [HeadingNode, ListNode, ListItemNode, LinkNode],
		// Reported (scrubbed, through the platform adapter); the editor carries on.
		onError: (error) => report(error)
	});
	editor.setRootElement(root);
	const unregister = mergeRegister(
		registerRichText(editor),
		registerList(editor),
		registerHistory(editor, createEmptyHistoryState(), 300),
		registerNormalizers(editor),
		registerMarkdownShortcuts(editor, NOTE_TRANSFORMERS),
		editor.registerUpdateListener(() => options.onUpdate?.())
	);
	// The opening content isn't an undo step.
	editor.update(() => $importMarkdown(markdown), { discrete: true, tag: "history-merge" });

	const read = <T>(fn: () => T): T => editor.getEditorState().read(fn);
	/** Applies an edit at once (so `markdown()` and `state()` see it straight away). */
	const edit = (fn: () => void): void => editor.update(fn, { discrete: true });

	return {
		markdown: () => read($exportMarkdown),
		toggle(format) {
			edit(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format));
		},
		heading() {
			edit(() => {
				const blocks = $selectedBlocks().filter((b) => !$isListNode(b));
				const off = blocks.length > 0 && blocks.every($isHeadingNode);
				for (const block of blocks) {
					const empty = block.getChildrenSize() === 0;
					const next = off ? $createParagraphNode() : $createHeadingNode("h2");
					block.replace(next, true);
					if (empty) next.select();
				}
			});
		},
		list(ordered) {
			const current = read($readState).list;
			edit(() => {
				if (current === (ordered ? "number" : "bullet")) {
					editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
				} else {
					editor.dispatchCommand(
						ordered ? INSERT_ORDERED_LIST_COMMAND : INSERT_UNORDERED_LIST_COMMAND,
						undefined
					);
				}
			});
		},
		link(url) {
			const href = url === null ? null : safeHref(url);
			if (url !== null && href === null) return false;
			edit(() => {
				const selection = $getSelection();
				if (!$isRangeSelection(selection)) return;
				const inLink = $findMatchingParent(selection.anchor.getNode(), $isLinkNode);
				if (href !== null && selection.isCollapsed() && !$isLinkNode(inLink)) {
					// Nothing selected: the address itself is the link's text.
					selection.insertNodes([$createLinkNode(href).append($createTextNode(href))]);
				} else if (href !== null && selection.isCollapsed() && $isLinkNode(inLink)) {
					inLink.setURL(href);
				} else if (href === null && selection.isCollapsed() && $isLinkNode(inLink)) {
					$unwrap(inLink);
				} else {
					$toggleLink(href);
				}
			});
			return true;
		},
		state: () => read($readState),
		destroy() {
			unregister();
			editor.setRootElement(null);
		}
	};
}
