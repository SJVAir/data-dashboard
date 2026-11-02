import { expect, test } from "vitest";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import { checkDeepLink, exitPlan, FULLSCREEN_STATE, fullscreenId } from "./fullscreen";

function widget(id: string, minimized?: number): WidgetInstance {
	return {
		id,
		type: "placeholder",
		title: null,
		rect: { x: 0, y: 0, w: 6, h: 4 },
		data: {},
		...(minimized === undefined ? {} : { minimized: { order: minimized } })
	} as unknown as WidgetInstance;
}

function session(widgets: WidgetInstance[], readOnly: false | "newer" = false) {
	return { doc: { body: { widgets } } as Dashboard, readOnly } as unknown as DocumentSession;
}

test("fullscreenId reads widget from the raw query", () => {
	expect(fullscreenId("?widget=a")).toBe("a");
	expect(fullscreenId("")).toBeNull();
	expect(fullscreenId("?widget=")).toBeNull();
	expect(fullscreenId("?other=1&widget=a%20b")).toBe("a b");
	// Number- and boolean-like ids come back exactly as written.
	for (const id of ["007", "1e3", "0x1A", "true", "12"]) {
		expect(fullscreenId(`?widget=${id}`)).toBe(id);
	}
});

test("exitPlan goes back only from an entry we pushed", () => {
	expect(exitPlan(FULLSCREEN_STATE)).toEqual({ kind: "back" });
	// History state is a structured clone, not the same object.
	expect(exitPlan(structuredClone(FULLSCREEN_STATE))).toEqual({ kind: "back" });
	expect(exitPlan(null)).toEqual({ kind: "replace" });
	expect(exitPlan(undefined)).toEqual({ kind: "replace" });
	expect(exitPlan({ other: 1 })).toEqual({ kind: "replace" });
});

test("checkDeepLink", () => {
	const s = session([widget("a"), widget("m", 0)]);
	expect(checkDeepLink(null, false, "a")).toBe("wait");
	expect(checkDeepLink(s, false, "a")).toBe("wait");
	expect(checkDeepLink(session([widget("a")], "newer"), true, "a")).toBe("read-only");
	expect(checkDeepLink(s, true, "zzz")).toBe("missing");
	expect(checkDeepLink(s, true, "a")).toBe("show");
	expect(checkDeepLink(s, true, "m")).toBe("show");
});
