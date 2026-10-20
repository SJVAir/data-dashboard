import { describe, expect, it } from "vitest";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import type { Change } from "./types";
import { applyChange } from "./apply";
import { UndoStack } from "./undo";

function widget(id: string): WidgetInstance {
	return {
		id,
		type: "placeholder",
		title: null,
		rect: { x: 0, y: 0, w: 6, h: 4 },
		data: { layers: [] }
	};
}

function makeDoc(): Dashboard {
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id: "d1",
		name: null,
		version: 1,
		createdAt: "2026-10-20T00:00:00.000Z",
		updatedAt: "2026-10-20T00:00:00.000Z",
		body: { widgets: [widget("a"), widget("b")] }
	};
}

const title = (widgetId: string, to: string): Change => ({
	op: "setField",
	target: { widgetId, path: "title" },
	from: null,
	to
});

/** Apply a change and record it, the way the store will. */
function edit(stack: UndoStack, doc: Dashboard, change: Change): Dashboard {
	const result = applyChange(doc, change);
	stack.push(change, result.inverse);
	return result.doc;
}

describe("UndoStack", () => {
	it("undo then redo returns to the same doc", () => {
		const stack = new UndoStack();
		const start = makeDoc();
		const edited = edit(stack, edit(stack, start, title("a", "One")), title("b", "Two"));
		expect(stack.canUndo).toBe(true);
		expect(stack.canRedo).toBe(false);

		const u1 = stack.takeUndo(edited);
		expect(u1?.change).toEqual({ ...title("b", "Two"), from: "Two", to: null });
		const u2 = stack.takeUndo(u1!.doc);
		expect(u2?.doc).toEqual(start);
		expect(stack.canUndo).toBe(false);
		expect(stack.takeUndo(u2!.doc)).toBeNull();

		const r1 = stack.takeRedo(u2!.doc);
		const r2 = stack.takeRedo(r1!.doc);
		expect(r2?.doc).toEqual(edited);
		expect(r2?.change).toEqual(title("b", "Two"));
		expect(stack.canRedo).toBe(false);
		expect(stack.takeRedo(r2!.doc)).toBeNull();
		expect(stack.canUndo).toBe(true);
	});

	it("undo skips an entry whose widget is gone and runs the next", () => {
		const stack = new UndoStack();
		let doc = edit(stack, makeDoc(), {
			op: "setField",
			target: { path: "name" },
			from: null,
			to: "N"
		});
		doc = edit(stack, doc, title("a", "One"));
		// Another tab removed widget "a" (not on this tab's stack).
		doc = applyChange(doc, {
			op: "removeWidget",
			target: { widgetId: "a" },
			widget: doc.body.widgets[0],
			index: 0
		}).doc;

		const undone = stack.takeUndo(doc);
		expect(undone?.change).toMatchObject({ target: { path: "name" }, to: null });
		expect(undone?.doc.name).toBeNull();
		expect(stack.canUndo).toBe(false);
	});

	it("push after undo clears redo", () => {
		const stack = new UndoStack();
		const doc = edit(stack, makeDoc(), title("a", "One"));
		const undone = stack.takeUndo(doc);
		expect(stack.canRedo).toBe(true);
		edit(stack, undone!.doc, title("b", "Two"));
		expect(stack.canRedo).toBe(false);
		expect(stack.takeRedo(undone!.doc)).toBeNull();
	});

	it("clear empties both stacks", () => {
		const stack = new UndoStack();
		const doc = edit(stack, edit(stack, makeDoc(), title("a", "One")), title("b", "Two"));
		stack.takeUndo(doc);
		stack.clear();
		expect(stack.canUndo).toBe(false);
		expect(stack.canRedo).toBe(false);
	});
});
