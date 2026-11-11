import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { z } from "$lib/zod";

export const NOTE_TYPE = "note";
export const NOTE_TEXT_MAX = 5000;

export const NoteOptionsSchema = z.union([
	z.strictObject({ text: z.string().max(NOTE_TEXT_MAX) }),
	z.strictObject({ message: z.string().regex(/^[a-z0-9_]{1,64}$/) })
]);
export type NoteOptions = z.infer<typeof NoteOptionsSchema>;

/** A note's options; invalid or missing options read as an empty note. */
export function noteOptions(widget: WidgetInstance): NoteOptions {
	const parsed = NoteOptionsSchema.safeParse(widget.options);
	return parsed.success ? parsed.data : { text: "" };
}

/**
 * A Note showing a built-in message (the starter's welcome). Its text is written for the
 * dashboard's owner (Change place, "your first change saves…"), so only the owner sees it.
 */
export function isMessageNote(widget: WidgetInstance): boolean {
	return widget.type === NOTE_TYPE && "message" in noteOptions(widget);
}

/** `doc` as someone else sees it (a live share): without its built-in message Notes. */
export function forViewers(doc: Dashboard): Dashboard {
	const widgets = doc.body.widgets.filter((w) => !isMessageNote(w));
	return widgets.length === doc.body.widgets.length
		? doc
		: { ...doc, body: { ...doc.body, widgets } };
}
