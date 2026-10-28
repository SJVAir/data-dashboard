import { describe, expect, test } from "vitest";
import { diff, placeNew, readingOrder, tidy, type LayoutItem } from "./engine";

function item(
	id: string,
	x: number,
	y: number,
	w: number,
	h: number,
	minW = 1,
	minH = 1
): LayoutItem {
	return { id, rect: { x, y, w, h }, minSize: { w: minW, h: minH } };
}
const rects = (l: LayoutItem[]) => Object.fromEntries(l.map((i) => [i.id, i.rect]));

describe("readingOrder", () => {
	test("sorts by row, then column, then id", () => {
		const out = readingOrder([
			item("d", 6, 0, 2, 2),
			item("c", 0, 2, 2, 2),
			item("b", 0, 0, 2, 2),
			item("a", 0, 0, 2, 2)
		]);
		expect(out.map((i) => i.id)).toEqual(["a", "b", "d", "c"]);
	});
});

describe("placeNew", () => {
	test("goes below everything at x 0", () => {
		const items = [item("a", 0, 0, 6, 4), item("b", 6, 0, 6, 2)];
		expect(placeNew(items, { w: 6, h: 4 }, 12)).toEqual({ x: 0, y: 4, w: 6, h: 4 });
		expect(placeNew([], { w: 6, h: 4 }, 12)).toEqual({ x: 0, y: 0, w: 6, h: 4 });
	});
});

describe("tidy", () => {
	test("is a no-op on a tidy layout", () => {
		const items = [item("a", 0, 0, 6, 4), item("b", 6, 0, 6, 4), item("c", 0, 4, 12, 2)];
		expect(tidy(items, 12)).toEqual(items);
	});
	test("compacts upward", () => {
		expect(rects(tidy([item("a", 0, 3, 6, 2)], 12)).a).toEqual({ x: 0, y: 0, w: 6, h: 2 });
		const out = rects(tidy([item("a", 0, 0, 6, 2), item("b", 0, 5, 6, 2)], 12));
		expect(out.b).toEqual({ x: 0, y: 2, w: 6, h: 2 });
	});
	test("fixes an overlapping, undersized layout", () => {
		expect(rects(tidy([item("a", 0, 0, 6, 4), item("b", 0, 2, 6, 4)], 12)).b).toEqual({
			x: 0,
			y: 4,
			w: 6,
			h: 4
		});
		expect(rects(tidy([item("c", 10, 0, 4, 1, 3, 2)], 12)).c).toMatchObject({ x: 8, w: 4, h: 2 });
		expect(rects(tidy([item("d", 0, 0, 20, 2)], 12)).d).toMatchObject({ x: 0, w: 12 });
	});
	test("works with another column count", () => {
		const out = rects(tidy([item("a", 0, 0, 6, 2), item("b", 3, 0, 3, 2)], 6));
		expect(out.b).toEqual({ x: 3, y: 2, w: 3, h: 2 });
	});
});

describe("diff", () => {
	test("lists only changed rects", () => {
		const before = [item("a", 0, 0, 6, 2), item("b", 0, 2, 6, 2)];
		const after = [item("a", 0, 0, 6, 2), item("b", 6, 2, 6, 2)];
		expect(diff(before, after)).toEqual({ b: { x: 6, y: 2, w: 6, h: 2 } });
	});
});
