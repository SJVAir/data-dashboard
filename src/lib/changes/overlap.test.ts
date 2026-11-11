import { describe, expect, it } from "vitest";
import type { WidgetInstance } from "$lib/documents/schema";
import type { Change, SetWidgetDataChange } from "./types";
import { changesOverlap } from "./overlap";

function widget(id: string): WidgetInstance {
	return {
		id,
		type: "placeholder",
		title: null,
		rect: { x: 0, y: 0, w: 6, h: 4 },
		data: { layers: [] }
	};
}

const title = (widgetId: string, to: string): Change => ({
	op: "setField",
	target: { widgetId, path: "title" },
	from: null,
	to
});
const data = (widgetId: string, amount: number): Change => ({
	op: "setWidgetData",
	target: { widgetId },
	from: { layers: [] },
	to: { dateRange: { kind: "trailing", amount, unit: "day" }, layers: [] }
});
const name = (to: string): Change => ({ op: "setField", target: { path: "name" }, from: null, to });
const remove = (id: string): Change => ({
	op: "removeWidget",
	target: { widgetId: id },
	widget: widget(id),
	index: 0
});
const add = (id: string): Change => ({
	op: "addWidget",
	target: { widgetId: id },
	widget: widget(id),
	index: 0
});

describe("changesOverlap", () => {
	it("same widget same path overlaps", () => {
		expect(changesOverlap(title("a", "One"), title("a", "Two"))).toBe(true);
	});

	it("same widget different path does not", () => {
		// Only `title` is a widget path today; a widget field never overlaps a document field.
		expect(changesOverlap(title("a", "One"), name("Two"))).toBe(false);
		const deleted: Change = {
			op: "setField",
			target: { path: "deletedAt" },
			from: null,
			to: "2026-10-20T01:00:00.000Z"
		};
		expect(changesOverlap(name("One"), deleted)).toBe(false);
	});

	it("different widgets do not", () => {
		expect(changesOverlap(title("a", "One"), title("b", "Two"))).toBe(false);
		expect(changesOverlap(remove("a"), title("b", "Two"))).toBe(false);
		expect(changesOverlap(add("c"), add("d"))).toBe(false);
	});

	it("remove vs title edit of that widget overlaps", () => {
		expect(changesOverlap(remove("a"), title("a", "Two"))).toBe(true);
		expect(changesOverlap(title("a", "Two"), remove("a"))).toBe(true);
	});

	it("two name edits overlap", () => {
		expect(changesOverlap(name("One"), name("Two"))).toBe(true);
	});

	it("two edits setting the same field to the same value agree, so they do not overlap", () => {
		expect(changesOverlap(title("a", "One"), title("a", "One"))).toBe(false);
		expect(changesOverlap(name("One"), name("One"))).toBe(false);
	});

	it("both sides removing the same widget agree, so they do not overlap", () => {
		expect(changesOverlap(remove("a"), remove("a"))).toBe(false);
	});

	it("replaceDocument overlaps every change, on either side, and another replaceDocument", () => {
		const content = { name: null, body: { widgets: [] } };
		const replace: Change = { op: "replaceDocument", target: {}, from: content, to: content };
		for (const other of [add("a"), remove("a"), title("a", "T"), name("N"), replace]) {
			expect(changesOverlap(replace, other)).toBe(true);
			expect(changesOverlap(other, replace)).toBe(true);
		}
	});
});

describe("changesOverlap with setLayout", () => {
	const p = (y: number) => ({ rect: { x: 0, y, w: 6, h: 4 }, minimized: null });
	const layout = (ids: string[], y: number): Change => ({
		op: "setLayout",
		target: { widgetIds: ids },
		from: Object.fromEntries(ids.map((id) => [id, p(0)])),
		to: Object.fromEntries(ids.map((id) => [id, p(y)]))
	});

	it("two setLayouts never overlap", () => {
		// Both move widget a to different rects.
		expect(changesOverlap(layout(["a", "b"], 4), layout(["b", "c"], 8))).toBe(false);
		expect(changesOverlap(layout(["a"], 4), layout(["a"], 8))).toBe(false);
	});
	it("same to doesn't", () => {
		expect(changesOverlap(layout(["a", "b"], 4), layout(["b", "c"], 4))).toBe(false);
	});
	it("disjoint ids don't", () => {
		expect(changesOverlap(layout(["a"], 4), layout(["b"], 8))).toBe(false);
	});
	it("setLayout against removeWidget doesn't overlap", () => {
		expect(changesOverlap(layout(["a", "b"], 4), remove("b"))).toBe(false);
		expect(changesOverlap(remove("b"), layout(["a", "b"], 4))).toBe(false);
		expect(changesOverlap(layout(["a"], 4), remove("b"))).toBe(false);
	});
	it("removeWidget still overlaps a title change", () => {
		const retitle: Change = {
			op: "setField",
			target: { widgetId: "b", path: "title" },
			from: null,
			to: "T"
		};
		expect(changesOverlap(remove("b"), retitle)).toBe(true);
		expect(changesOverlap(retitle, remove("b"))).toBe(true);
	});
	it("an id only on the prototype of the other side's to doesn't overlap", () => {
		const a: Change = {
			op: "setLayout",
			target: { widgetIds: ["toString"] },
			from: { toString: p(0) },
			to: { toString: p(4) }
		};
		expect(changesOverlap(a, layout(["x"], 8))).toBe(false);
	});
	it("the same placement with keys in another order doesn't overlap", () => {
		const b: Change = {
			op: "setLayout",
			target: { widgetIds: ["a"] },
			from: { a: p(0) },
			to: { a: { minimized: null, rect: { h: 4, w: 6, y: 4, x: 0 } } }
		};
		expect(changesOverlap(layout(["a"], 4), b)).toBe(false);
	});

	describe("rect and minimized are separate fields", () => {
		const r = (y: number, h = 4) => ({ x: 0, y, w: 6, h });
		type Spot = { y: number; h?: number; order?: number };
		const placement = ({ y, h, order }: Spot) => ({
			rect: r(y, h),
			minimized: order === undefined ? null : { order }
		});
		const entry = (from: Spot, to: Spot): Change => ({
			op: "setLayout",
			target: { widgetIds: ["a"] },
			from: { a: placement(from) },
			to: { a: placement(to) }
		});
		const fix = entry({ y: 0 }, { y: 0, h: 6 });
		const minimize = entry({ y: 0 }, { y: 0, order: 0 });

		it("a rect-only tidy fix and a minimize of the same widget don't overlap", () => {
			expect(changesOverlap(fix, minimize)).toBe(false);
			expect(changesOverlap(minimize, fix)).toBe(false);
		});
		it("two rect changes to different rects don't overlap", () => {
			expect(changesOverlap(fix, entry({ y: 0 }, { y: 8 }))).toBe(false);
		});
		it("two minimizes with different orders don't overlap", () => {
			expect(changesOverlap(minimize, entry({ y: 0 }, { y: 0, order: 3 }))).toBe(false);
		});
		it("a rect change and a move-and-minimize to another rect don't overlap", () => {
			expect(changesOverlap(fix, entry({ y: 0 }, { y: 8, order: 0 }))).toBe(false);
		});
		it("an entry that changes nothing overlaps nothing", () => {
			const none = entry({ y: 0 }, { y: 0 });
			expect(changesOverlap(none, fix)).toBe(false);
			expect(changesOverlap(none, minimize)).toBe(false);
		});
	});
});

describe("changesOverlap on deletedAt", () => {
	const del = (from: string | null, to: string | null): Change => ({
		op: "setField",
		target: { path: "deletedAt" },
		from,
		to
	});
	it("two deletes agree even at different times", () => {
		expect(
			changesOverlap(del(null, "2026-10-22T00:00:00.000Z"), del(null, "2026-10-23T00:00:00.000Z"))
		).toBe(false);
	});
	it("a delete against a restore still overlaps", () => {
		expect(
			changesOverlap(del(null, "2026-10-22T00:00:00.000Z"), del("2026-10-22T00:00:00.000Z", null))
		).toBe(true);
	});

	it("setWidgetData overlaps a removal of the same widget, not another widget's", () => {
		expect(changesOverlap(data("a", 7), remove("a"))).toBe(true);
		expect(changesOverlap(remove("a"), data("a", 7))).toBe(true);
		expect(changesOverlap(data("a", 7), remove("b"))).toBe(false);
	});

	it("setWidgetData overlaps another on the same widget unless they agree", () => {
		expect(changesOverlap(data("a", 7), data("a", 14))).toBe(true);
		expect(changesOverlap(data("a", 7), data("a", 7))).toBe(false);
		expect(changesOverlap(data("a", 7), data("b", 14))).toBe(false);
	});

	it("setWidgetData with a type or options overlaps only where both set the same field differently", () => {
		const typed = (to: string, amount = 7): Change => ({
			...(data("a", amount) as SetWidgetDataChange),
			type: { from: "chart", to }
		});
		const opts = (to: Record<string, unknown> | undefined): Change => ({
			...(data("a", 7) as SetWidgetDataChange),
			options: { to }
		});
		expect(changesOverlap(typed("data-table"), typed("chart"))).toBe(true);
		expect(changesOverlap(typed("data-table"), typed("data-table"))).toBe(false);
		// Only one side changes the type, and the data agrees.
		expect(changesOverlap(typed("data-table"), data("a", 7))).toBe(false);
		expect(changesOverlap(typed("data-table", 14), data("a", 7))).toBe(true);
		expect(changesOverlap(opts({ x: 1 }), opts({ x: 2 }))).toBe(true);
		expect(changesOverlap(opts({ x: 1 }), opts(undefined))).toBe(true);
		expect(changesOverlap(opts({ x: 1 }), opts({ x: 1 }))).toBe(false);
		expect(changesOverlap(opts({ x: 1 }), data("a", 7))).toBe(false);
		const alert = (level: string | undefined): Change => ({
			...(data("a", 7) as SetWidgetDataChange),
			thresholds: { to: level ? [{ level }] : undefined }
		});
		expect(changesOverlap(alert("moderate"), alert("unhealthy"))).toBe(true);
		expect(changesOverlap(alert("moderate"), alert(undefined))).toBe(true);
		expect(changesOverlap(alert("moderate"), alert("moderate"))).toBe(false);
		expect(changesOverlap(alert("moderate"), data("a", 7))).toBe(false);
	});

	it("setWidgetData's size clamp, like a layout move, never overlaps a move", () => {
		const clamped: Change = {
			...(data("a", 7) as SetWidgetDataChange),
			rect: { from: { x: 0, y: 0, w: 2, h: 2 }, to: { x: 0, y: 0, w: 3, h: 4 } }
		};
		const move: Change = {
			op: "setLayout",
			target: { widgetIds: ["a"] },
			from: { a: { rect: { x: 0, y: 0, w: 2, h: 2 }, minimized: null } },
			to: { a: { rect: { x: 4, y: 0, w: 2, h: 2 }, minimized: null } }
		};
		expect(changesOverlap(clamped, move)).toBe(false);
		expect(changesOverlap(move, clamped)).toBe(false);
	});

	it("setWidgetData and a title edit of the same widget do not overlap", () => {
		expect(changesOverlap(data("a", 7), title("a", "T"))).toBe(false);
	});
});
