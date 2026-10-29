import { beforeEach, describe, expect, it } from "vitest";
import { pendingFocusTarget, requestFocus, takeFocus } from "./focus-request.svelte";

describe("focus request", () => {
	beforeEach(() => {
		takeFocus({ kind: "title", id: "a" });
		takeFocus({ kind: "taskbar", id: "a" });
	});

	it("takeFocus matches kind and id, then clears", () => {
		requestFocus({ kind: "title", id: "a" });
		expect(pendingFocusTarget()).toEqual({ kind: "title", id: "a" });
		expect(takeFocus({ kind: "title", id: "a" })).toBe(true);
		expect(pendingFocusTarget()).toBeNull();
		expect(takeFocus({ kind: "title", id: "a" })).toBe(false);
	});

	it("a non-matching takeFocus leaves the request", () => {
		requestFocus({ kind: "taskbar", id: "a" });
		expect(takeFocus({ kind: "title", id: "a" })).toBe(false);
		expect(takeFocus({ kind: "taskbar", id: "b" })).toBe(false);
		expect(pendingFocusTarget()).toEqual({ kind: "taskbar", id: "a" });
	});
});
