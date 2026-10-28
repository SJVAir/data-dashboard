import { describe, expect, test } from "vitest";
import {
	diff,
	move,
	moveInOrder,
	placeNew,
	readingOrder,
	rectsOverlap,
	resize,
	stepDown,
	tidy,
	type LayoutItem
} from "./engine";

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

describe("rectsOverlap", () => {
	test("is true when rects share cells", () => {
		expect(rectsOverlap({ x: 0, y: 0, w: 4, h: 4 }, { x: 3, y: 3, w: 2, h: 2 })).toBe(true);
		expect(rectsOverlap({ x: 0, y: 0, w: 12, h: 1 }, { x: 5, y: 0, w: 1, h: 1 })).toBe(true);
	});
	test("is false when rects only touch at an edge", () => {
		expect(rectsOverlap({ x: 0, y: 0, w: 4, h: 4 }, { x: 4, y: 0, w: 4, h: 4 })).toBe(false);
		expect(rectsOverlap({ x: 0, y: 0, w: 4, h: 4 }, { x: 0, y: 4, w: 4, h: 4 })).toBe(false);
		expect(rectsOverlap({ x: 0, y: 0, w: 4, h: 4 }, { x: 4, y: 4, w: 4, h: 4 })).toBe(false);
	});
});

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
	test("cascades: a pushed widget lands on a third and pushes it too", () => {
		const out = rects(
			tidy([item("a", 0, 0, 6, 4), item("b", 0, 2, 6, 4), item("c", 0, 5, 6, 2)], 12)
		);
		expect(out.b).toEqual({ x: 0, y: 4, w: 6, h: 4 });
		expect(out.c).toEqual({ x: 0, y: 8, w: 6, h: 2 });
	});
	test("is idempotent on a messy layout", () => {
		const messy = [
			item("a", 3, 5, 20, 1, 3, 2),
			item("b", 0, 2, 6, 4),
			item("c", 8, 0, 6, 3),
			item("d", 2, 3, 4, 4),
			item("e", 0, 9, 2, 2)
		];
		const once = tidy(messy, 12);
		expect(tidy(once, 12)).toEqual(once);
	});
	test("returns unsorted input in reading order", () => {
		const out = tidy([item("c", 0, 4, 12, 2), item("b", 6, 0, 6, 4), item("a", 0, 0, 6, 4)], 12);
		expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
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

describe("move", () => {
	test("move pushes overlapped widgets down", () => {
		const out = rects(
			move([item("a", 0, 0, 6, 4), item("b", 6, 0, 6, 4)], "a", { x: 6, y: 0 }, 12)
		);
		expect(out.a).toEqual({ x: 6, y: 0, w: 6, h: 4 });
		expect(out.b).toEqual({ x: 6, y: 4, w: 6, h: 4 });
	});
	test("move into empty space below snaps back up", () => {
		const out = rects(move([item("a", 0, 0, 6, 4)], "a", { x: 0, y: 5 }, 12));
		expect(out.a).toEqual({ x: 0, y: 0, w: 6, h: 4 });
	});
	test("moving up past a widget swaps them", () => {
		const out = rects(
			move([item("a", 0, 0, 12, 2), item("b", 0, 2, 12, 3)], "b", { x: 0, y: 1 }, 12)
		);
		expect(out.b).toMatchObject({ x: 0, y: 0 });
		expect(out.a).toMatchObject({ x: 0, y: 3 });
	});
	test("move clamps x so the widget stays on the grid", () => {
		expect(rects(move([item("a", 0, 0, 6, 4)], "a", { x: 9, y: 0 }, 12)).a.x).toBe(6);
	});
});

describe("resize", () => {
	test("resize pushes and clamps", () => {
		const pushed = rects(
			resize([item("a", 0, 0, 6, 4), item("b", 6, 0, 6, 4)], "a", { x: 0, y: 0, w: 8, h: 4 }, 12)
		);
		expect(pushed.a).toEqual({ x: 0, y: 0, w: 8, h: 4 });
		expect(pushed.b).toEqual({ x: 6, y: 4, w: 6, h: 4 });
		const small = rects(resize([item("a", 0, 0, 6, 4, 3, 2)], "a", { x: 0, y: 0, w: 1, h: 1 }, 12));
		expect(small.a).toEqual({ x: 0, y: 0, w: 3, h: 2 });
		const wide = rects(resize([item("a", 0, 0, 6, 4)], "a", { x: 0, y: 0, w: 20, h: 4 }, 12));
		expect(wide.a.w).toBe(12);
	});
});

describe("stepDown", () => {
	test("stepDown jumps past the next widget below in the same columns", () => {
		const items = [item("a", 0, 0, 12, 2), item("b", 0, 2, 12, 3)];
		const out = stepDown(items, "a", 12);
		expect(out).not.toBeNull();
		expect(rects(out!).b).toMatchObject({ x: 0, y: 0 });
		expect(rects(out!).a).toMatchObject({ x: 0, y: 3 });
		expect(stepDown(items, "b", 12)).toBeNull();
		expect(stepDown([item("a", 0, 0, 6, 2), item("b", 6, 0, 6, 4)], "a", 12)).toBeNull();
	});
});

/** A small seeded linear congruential generator, so the property test is reproducible. */
function lcg(seed: number) {
	let s = seed >>> 0;
	const next = () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
	/** An integer in [min, max]. */
	return (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
}

describe("moveInOrder", () => {
	const order = (l: LayoutItem[]) => readingOrder(l).map((i) => i.id);

	test("moveInOrder places the widget at the requested reading position", () => {
		const items = [item("a", 0, 0, 12, 2), item("b", 0, 2, 12, 2), item("c", 0, 4, 12, 2)];
		expect(order(moveInOrder(items, "c", 0, 12))).toEqual(["c", "a", "b"]);
		expect(order(moveInOrder(items, "a", 2, 12))).toEqual(["b", "c", "a"]);
	});

	test("moveInOrder lands as near as it can when the position can't be reached", () => {
		// A full-width widget can't sit between widgets that start on the same row.
		const items = [
			item("a", 0, 0, 12, 2),
			item("b", 0, 2, 6, 2),
			item("c", 6, 2, 6, 2),
			item("d", 0, 4, 12, 2)
		];
		// Reachable: exactly there.
		expect(order(moveInOrder(items, "a", 2, 12))).toEqual(["b", "c", "a", "d"]);
		expect(order(moveInOrder(items, "d", 1, 12))).toEqual(["a", "d", "b", "c"]);
		// Unreachable (between b and c): never past the target, so these stay put.
		expect(moveInOrder(items, "d", 2, 12)).toEqual(items);
		expect(moveInOrder(items, "a", 1, 12)).toEqual(items);
	});

	test("moveInOrder property: random layouts move toward the target, never past it", () => {
		const sizes = (l: LayoutItem[]) =>
			Object.fromEntries(l.map((i) => [i.id, { w: i.rect.w, h: i.rect.h }]));
		for (const seed of [20261028, 1, 42, 7919, 123456789]) {
			const rand = lcg(seed);
			for (let run = 0; run < 400; run++) {
				const n = rand(2, 10);
				const raw: LayoutItem[] = [];
				for (let i = 0; i < n; i++) {
					const w = rand(1, 12);
					raw.push(item(`w${i}`, rand(0, 12 - w), rand(0, 20), w, rand(1, 6)));
				}
				const layout = tidy(raw, 12);
				const id = layout[rand(0, n - 1)].id;
				const index = rand(0, n - 1);
				const from = order(layout).indexOf(id);
				const result = moveInOrder(layout, id, index, 12);
				const context = JSON.stringify({ seed, run, id, index, layout: rects(layout) });

				expect(tidy(result, 12), context).toEqual(result);
				for (let i = 0; i < result.length; i++) {
					for (let j = i + 1; j < result.length; j++) {
						expect(rectsOverlap(result[i].rect, result[j].rect), context).toBe(false);
					}
				}
				expect(sizes(result), context).toEqual(sizes(layout));
				const r = order(result).indexOf(id);
				if (index === from) expect(result, context).toEqual(layout);
				else if (index < from) {
					expect(r, context).toBeGreaterThanOrEqual(index);
					expect(r, context).toBeLessThanOrEqual(from);
				} else {
					expect(r, context).toBeGreaterThanOrEqual(from);
					expect(r, context).toBeLessThanOrEqual(index);
				}
			}
		}
	});
});
