import { beforeEach, expect, test } from "vitest";
import {
	isAssistiveActivation,
	pendingFocusTarget,
	requestFocus,
	takeFocus
} from "./focus-request.svelte";

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

test("a browser Back drops a pending request", () => {
	requestFocus({ kind: "title", id: "w" });
	window.dispatchEvent(new PopStateEvent("popstate"));
	expect(pendingFocusTarget()).toBeNull();
});

// A test can't make a trusted click with no press or key behind it (a screen reader's activation):
// what counts as one is checked on its own, and an untrusted click shows the app's own are left.
test("a screen reader's activation is a trusted click with no pointer behind it", () => {
	expect(isAssistiveActivation({ isTrusted: true, detail: 0 })).toBe(true);
	expect(isAssistiveActivation({ isTrusted: true, detail: 1 })).toBe(false);
	expect(isAssistiveActivation({ isTrusted: false, detail: 0 })).toBe(false);
});

test("the app's own click (a download link, a file input) leaves a pending request", () => {
	const link = document.createElement("a");
	link.href = "#";
	link.addEventListener("click", (event) => event.preventDefault());
	document.body.append(link);
	try {
		requestFocus({ kind: "title", id: "s" });
		link.click();
		expect(pendingFocusTarget()).toEqual({ kind: "title", id: "s" });
	} finally {
		link.remove();
	}
});

test("a request made while handling a screen reader's activation survives it", () => {
	const button = document.createElement("button");
	document.body.append(button);
	button.addEventListener("click", () => requestFocus({ kind: "title", id: "r" }));
	try {
		button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
		expect(pendingFocusTarget()).toEqual({ kind: "title", id: "r" });
	} finally {
		button.remove();
	}
});
