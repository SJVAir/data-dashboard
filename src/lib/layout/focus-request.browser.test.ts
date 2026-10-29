import { afterEach, expect, test } from "vitest";
import { pendingFocusTarget, requestFocus, takeFocus } from "./focus-request.svelte";

afterEach(() => takeFocus({ kind: "title", id: "x" }));

test("a pending request is dropped on the next keydown or pointerdown", () => {
	for (const type of ["keydown", "pointerdown"]) {
		requestFocus({ kind: "title", id: "x" });
		expect(pendingFocusTarget()).toEqual({ kind: "title", id: "x" });
		window.dispatchEvent(new Event(type));
		expect(pendingFocusTarget()).toBeNull();
	}
});

test("a taken request needs no listener afterwards", () => {
	requestFocus({ kind: "title", id: "x" });
	expect(takeFocus({ kind: "title", id: "x" })).toBe(true);
	requestFocus({ kind: "title", id: "y" });
	expect(takeFocus({ kind: "title", id: "x" })).toBe(false);
	expect(pendingFocusTarget()).toEqual({ kind: "title", id: "y" });
});
