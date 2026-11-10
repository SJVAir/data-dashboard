import { describe, expect, it } from "vitest";
import type { WidgetInstance } from "$lib/documents/schema";
import {
	forViewers,
	isMessageNote,
	NOTE_TEXT_MAX,
	NOTE_TYPE,
	NoteOptionsSchema,
	noteOptions
} from "./options";
import type { Dashboard } from "$lib/documents/schema";

function widget(options?: Record<string, unknown>): WidgetInstance {
	return {
		id: "w1",
		type: NOTE_TYPE,
		title: null,
		rect: { x: 0, y: 0, w: 6, h: 4 },
		data: { layers: [] },
		options
	} as WidgetInstance;
}

describe("NoteOptionsSchema", () => {
	it("accepts text up to the limit", () => {
		expect(NoteOptionsSchema.safeParse({ text: "a".repeat(NOTE_TEXT_MAX) }).success).toBe(true);
		expect(NoteOptionsSchema.safeParse({ text: "a".repeat(NOTE_TEXT_MAX + 1) }).success).toBe(
			false
		);
	});
	it("accepts a message key", () => {
		expect(NoteOptionsSchema.safeParse({ message: "starter_note_welcome" }).success).toBe(true);
	});
	it("rejects bad keys, both fields and empty", () => {
		expect(NoteOptionsSchema.safeParse({ message: "Bad Key" }).success).toBe(false);
		expect(NoteOptionsSchema.safeParse({ text: "a", message: "a" }).success).toBe(false);
		expect(NoteOptionsSchema.safeParse({}).success).toBe(false);
	});
});

describe("noteOptions", () => {
	it("returns valid options", () => {
		expect(noteOptions(widget({ text: "hi" }))).toEqual({ text: "hi" });
	});
	it("falls back to empty text", () => {
		expect(noteOptions(widget())).toEqual({ text: "" });
		expect(noteOptions(widget({ nope: 1 }))).toEqual({ text: "" });
	});
});

describe("forViewers", () => {
	const welcome = { ...widget({ message: "starter_note_welcome" }), id: "welcome" };
	const typed = { ...widget({ text: "Bring water" }), id: "typed" };
	const chart = { ...widget(), id: "chart", type: "chart" } as WidgetInstance;
	const doc = (widgets: WidgetInstance[]) =>
		({ id: "d1", body: { widgets, placeBar: null } }) as unknown as Dashboard;

	it("leaves out only built-in message Notes", () => {
		expect(isMessageNote(welcome)).toBe(true);
		expect(isMessageNote(typed)).toBe(false);
		expect(isMessageNote(chart)).toBe(false);
		const shown = forViewers(doc([welcome, typed, chart]));
		expect(shown.body.widgets.map((w) => w.id)).toEqual(["typed", "chart"]);
		expect(shown.body).toMatchObject({ placeBar: null });
	});
	it("returns the same document when there's nothing to leave out", () => {
		const d = doc([typed, chart]);
		expect(forViewers(d)).toBe(d);
	});
});
