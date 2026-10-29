import { describe, expect, test } from "vitest";
import { MAX_HEIGHT } from "./config";
import { nearestIndex, resizedRect } from "./pointer-drag";

const rows = (...hs: number[]) => hs.map((h) => ({ rect: { x: 0, y: 0, w: 12, h } }));

describe("nearestIndex", () => {
	test("picks the slot whose top is nearest", () => {
		const others = rows(4, 2, 4);
		expect(nearestIndex(others, -3)).toBe(0);
		expect(nearestIndex(others, 1.9)).toBe(0);
		expect(nearestIndex(others, 2.1)).toBe(1);
		expect(nearestIndex(others, 5.5)).toBe(2);
		expect(nearestIndex(others, 50)).toBe(3);
	});
});

describe("resizedRect", () => {
	const start = { x: 3, y: 1, w: 6, h: 4 };
	const min = { w: 3, h: 2 };
	test("right and bottom edges grow, clamped to the grid and the minimum", () => {
		expect(resizedRect(start, min, "right", { dx: 2, dy: 5 }, 12)).toEqual({ ...start, w: 8 });
		expect(resizedRect(start, min, "right", { dx: 9, dy: 0 }, 12).w).toBe(9);
		expect(resizedRect(start, min, "bottom-right", { dx: -9, dy: -9 }, 12)).toEqual({
			...start,
			w: 3,
			h: 2
		});
	});
	test("the left edge keeps the right edge in place", () => {
		expect(resizedRect(start, min, "left", { dx: -2, dy: 0 }, 12)).toEqual({
			...start,
			x: 1,
			w: 8
		});
		expect(resizedRect(start, min, "bottom-left", { dx: -9, dy: 1 }, 12)).toEqual({
			x: 0,
			y: 1,
			w: 9,
			h: 5
		});
		expect(resizedRect(start, min, "left", { dx: 9, dy: 0 }, 12)).toEqual({ ...start, x: 6, w: 3 });
	});
	test("the height stops at the maximum", () => {
		expect(resizedRect(start, min, "bottom", { dx: 0, dy: 500 }, 12).h).toBe(MAX_HEIGHT);
		expect(resizedRect(start, min, "bottom-left", { dx: 0, dy: 500 }, 1).h).toBe(MAX_HEIGHT);
	});
	test("one column changes only the height", () => {
		expect(resizedRect(start, min, "bottom-right", { dx: 3, dy: 1 }, 1)).toEqual({
			...start,
			h: 5
		});
	});
});
