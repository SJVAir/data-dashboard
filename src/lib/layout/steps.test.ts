import { describe, expect, it } from "vitest";
import type { Rect } from "$lib/documents/schema";
import { MAX_HEIGHT } from "./config";
import type { Layout } from "./engine";
import { actionLayout, type LayoutAction } from "./steps";

const item = (id: string, rect: Rect, minSize = { w: 3, h: 2 }) => ({ id, rect, minSize });
const rectOf = (layout: Layout | null, id: string) => layout?.find((i) => i.id === id)?.rect;

type Case = {
	name: string;
	layout: Layout;
	action: LayoutAction;
	columns?: number;
	/** The widget's rect after, or null for "changes nothing" (the item is disabled). */
	expected: Rect | null;
};

const cases: Case[] = [
	{
		name: "Taller at MAX_HEIGHT changes nothing",
		layout: [item("a", { x: 0, y: 0, w: 6, h: MAX_HEIGHT })],
		action: { kind: "grow", dir: "down" },
		expected: null
	},
	{
		name: "Taller one below MAX_HEIGHT reaches it",
		layout: [item("a", { x: 0, y: 0, w: 6, h: MAX_HEIGHT - 1 })],
		action: { kind: "grow", dir: "down" },
		expected: { x: 0, y: 0, w: 6, h: MAX_HEIGHT }
	},
	{
		name: "Narrower stops at a larger minimum width",
		layout: [item("a", { x: 0, y: 0, w: 5, h: 4 }, { w: 5, h: 3 })],
		action: { kind: "grow", dir: "left" },
		expected: null
	},
	{
		name: "Shorter stops at a larger minimum height",
		layout: [item("a", { x: 0, y: 0, w: 6, h: 3 }, { w: 5, h: 3 })],
		action: { kind: "grow", dir: "up" },
		expected: null
	},
	{
		name: "Wider stops at the grid's right edge",
		layout: [item("a", { x: 4, y: 0, w: 8, h: 4 })],
		action: { kind: "grow", dir: "right" },
		expected: null
	},
	{
		name: "Down with a lower widget in other columns only changes nothing",
		layout: [
			item("a", { x: 0, y: 0, w: 6, h: 4 }),
			item("b", { x: 6, y: 0, w: 6, h: 8 }),
			item("c", { x: 6, y: 8, w: 6, h: 4 })
		],
		action: { kind: "step", dir: "down" },
		expected: null
	},
	{
		name: "Down passes the next widget below in its columns",
		layout: [item("a", { x: 0, y: 0, w: 6, h: 4 }), item("b", { x: 0, y: 4, w: 12, h: 4 })],
		action: { kind: "step", dir: "down" },
		expected: { x: 0, y: 4, w: 6, h: 4 }
	},
	{
		name: "To bottom with only other columns lower changes nothing",
		layout: [
			item("a", { x: 0, y: 0, w: 6, h: 4 }),
			item("b", { x: 6, y: 0, w: 6, h: 8 }),
			item("c", { x: 6, y: 8, w: 6, h: 4 })
		],
		action: { kind: "end", end: "bottom" },
		expected: null
	},
	{
		name: "To bottom passes everything in its columns",
		layout: [
			item("a", { x: 0, y: 0, w: 6, h: 4 }),
			item("b", { x: 0, y: 4, w: 6, h: 2 }),
			item("c", { x: 0, y: 6, w: 12, h: 4 })
		],
		action: { kind: "end", end: "bottom" },
		expected: { x: 0, y: 6, w: 6, h: 4 }
	},
	{
		name: "To top on the top row changes nothing",
		layout: [item("a", { x: 3, y: 0, w: 6, h: 4 })],
		action: { kind: "end", end: "top" },
		expected: null
	},
	{
		name: "Left in column 1 changes nothing",
		layout: [item("a", { x: 0, y: 0, w: 6, h: 4 })],
		action: { kind: "step", dir: "left" },
		expected: null
	},
	{
		name: "Left and Right are never offered on a phone (and change nothing)",
		layout: [item("a", { x: 0, y: 0, w: 6, h: 4 }), item("b", { x: 6, y: 0, w: 6, h: 4 })],
		action: { kind: "step", dir: "right" },
		columns: 1,
		expected: null
	},
	{
		name: "To top on a phone when first changes nothing",
		layout: [item("a", { x: 0, y: 0, w: 6, h: 4 }), item("b", { x: 6, y: 0, w: 6, h: 4 })],
		action: { kind: "end", end: "top" },
		columns: 1,
		expected: null
	},
	{
		name: "Wider on a phone changes nothing (height only)",
		layout: [item("a", { x: 0, y: 0, w: 6, h: 4 })],
		action: { kind: "grow", dir: "right" },
		columns: 1,
		expected: null
	}
];

describe("actionLayout", () => {
	for (const c of cases) {
		it(c.name, () => {
			const after = actionLayout(c.layout, "a", c.action, c.columns ?? 12);
			if (c.expected === null) expect(after).toBeNull();
			else expect(rectOf(after, "a")).toEqual(c.expected);
		});
	}

	it("To bottom on a phone goes last in reading order", () => {
		const layout = [
			item("a", { x: 0, y: 0, w: 6, h: 4 }),
			item("b", { x: 6, y: 0, w: 6, h: 4 }),
			item("c", { x: 0, y: 4, w: 12, h: 4 })
		];
		const after = actionLayout(layout, "a", { kind: "end", end: "bottom" }, 1);
		expect(after?.map((i) => i.id).at(-1)).toBe("a");
	});
});
