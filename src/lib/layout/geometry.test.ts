import { describe, expect, it } from "vitest";
import { cellAt, cellWidth, rectToPixels, snapDelta, type GridMetrics } from "./geometry";

const m: GridMetrics = { left: 20, top: 100, width: 1200, columns: 12, rowHeight: 64, gap: 12 };

describe("geometry", () => {
	it("cell width leaves the gaps out", () => {
		expect(cellWidth(m)).toBe(89);
	});

	it("cellAt finds the column and row under a point", () => {
		expect(cellAt(m, { x: 101 + m.left, y: m.top })).toEqual({ x: 1, y: 0 });
		expect(cellAt(m, { x: 100 + m.left, y: m.top + 76 })).toEqual({ x: 0, y: 1 });
		expect(cellAt(m, { x: m.left + 5 * 101 + 50, y: m.top + 3 * 76 + 10 })).toEqual({ x: 5, y: 3 });
	});

	it("cellAt clamps negatives to 0 and the last column to 11", () => {
		expect(cellAt(m, { x: m.left - 300, y: m.top - 50 })).toEqual({ x: 0, y: 0 });
		expect(cellAt(m, { x: m.left + 5000, y: m.top })).toEqual({ x: 11, y: 0 });
	});

	it("snapDelta rounds a pixel delta to whole cells", () => {
		expect(snapDelta(m, 0, 0)).toEqual({ dx: 0, dy: 0 });
		expect(snapDelta(m, 50, 37)).toEqual({ dx: 0, dy: 0 });
		expect(snapDelta(m, 51, 39)).toEqual({ dx: 1, dy: 1 });
		expect(snapDelta(m, -202, -152)).toEqual({ dx: -2, dy: -2 });
	});

	it("rectToPixels spans the cells and the gaps between them", () => {
		expect(rectToPixels(m, { x: 1, y: 2, w: 3, h: 2 })).toEqual({
			left: m.left + 101,
			top: m.top + 152,
			width: 3 * 89 + 2 * 12,
			height: 2 * 64 + 12
		});
	});
});
