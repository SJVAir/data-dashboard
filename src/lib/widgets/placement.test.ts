import { describe, expect, test } from "vitest";
import type { WidgetInstance } from "$lib/documents/schema";
import { placeAtBottom, readingOrder, rectsOverlap } from "./placement";

function widget(id: string, x: number, y: number, w: number, h: number): WidgetInstance {
	return { id, type: "placeholder", title: null, rect: { x, y, w, h }, data: { layers: [] } };
}

describe("rectsOverlap", () => {
	test("true for shared cells", () => {
		expect(rectsOverlap({ x: 0, y: 0, w: 6, h: 4 }, { x: 5, y: 3, w: 4, h: 4 })).toBe(true);
	});
	test("false for edge-touching", () => {
		expect(rectsOverlap({ x: 0, y: 0, w: 6, h: 4 }, { x: 6, y: 0, w: 6, h: 4 })).toBe(false);
		expect(rectsOverlap({ x: 0, y: 0, w: 6, h: 4 }, { x: 0, y: 4, w: 6, h: 4 })).toBe(false);
	});
});

describe("placeAtBottom", () => {
	test("empty dashboard starts at the origin", () => {
		expect(placeAtBottom([], { w: 6, h: 4 })).toEqual({ x: 0, y: 0, w: 6, h: 4 });
	});
	test("goes below the lowest widget", () => {
		const ws = [widget("a", 0, 0, 6, 4), widget("b", 6, 0, 6, 5)];
		expect(placeAtBottom(ws, { w: 6, h: 4 })).toEqual({ x: 0, y: 5, w: 6, h: 4 });
	});
});

describe("readingOrder", () => {
	test("sorts by y then x", () => {
		const ws = [widget("a", 0, 4, 6, 4), widget("b", 6, 0, 6, 4), widget("c", 0, 0, 6, 4)];
		expect(readingOrder(ws).map((w) => w.id)).toEqual(["c", "b", "a"]);
	});
});
