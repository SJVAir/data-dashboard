import { beforeEach, expect, test } from "vitest";
import { pendingFocusTarget, requestFocus, takeFocus } from "./focus-request.svelte";

// Start each test with no request: a press drops whatever is pending, whatever its target.
beforeEach(() => {
	window.dispatchEvent(new Event("pointerdown"));
	expect(pendingFocusTarget()).toBeNull();
});

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

test("a request made while handling a keydown survives that keydown", () => {
	// As Ctrl+Z (a window listener) and Enter on an element (its own listener) do.
	for (const target of [window, document.body]) {
		const onKey = () => requestFocus({ kind: "taskbar", id: "k" });
		target.addEventListener("keydown", onKey);
		try {
			document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true }));
		} finally {
			target.removeEventListener("keydown", onKey);
		}
		expect(pendingFocusTarget()).toEqual({ kind: "taskbar", id: "k" });
		// The next key is the user's own, so it drops the request.
		document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
		expect(pendingFocusTarget()).toBeNull();
	}
});
