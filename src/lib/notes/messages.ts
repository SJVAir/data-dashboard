import { m } from "$lib/paraglide/messages.js";
import type { NoteOptions } from "./options";

/**
 * The messages a Note may name with `{ message }` (an allowlist: a document never picks any
 * other message). The Markdown English is rendered in place, never stored.
 */
export const NOTE_MESSAGES: Record<string, () => string> = {
	starter_note_welcome: m.starter_note_welcome
};

/** A note's Markdown: its text, or its message's; "" for an unknown message key. */
export function noteMarkdown(options: NoteOptions): string {
	if ("text" in options) return options.text;
	return Object.hasOwn(NOTE_MESSAGES, options.message) ? NOTE_MESSAGES[options.message]() : "";
}
