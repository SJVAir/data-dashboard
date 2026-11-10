import type { WidgetInstance } from "$lib/documents/schema";
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
