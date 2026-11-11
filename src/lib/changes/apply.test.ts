import { describe, expect, it } from "vitest";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import type { WidgetDataConfig } from "$lib/data/schema";
import { ChangeSchema, type Change } from "./types";
import { appliedChange, applyChange, ChangeTargetMissing } from "./apply";

function widget(id: string, title: string | null = null): WidgetInstance {
	return { id, type: "placeholder", title, rect: { x: 0, y: 0, w: 6, h: 4 }, data: { layers: [] } };
}

function makeDoc(overrides: Partial<Dashboard> = {}): Dashboard {
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id: "d1",
		name: "Mine",
		version: 3,
		createdAt: "2026-10-20T00:00:00.000Z",
		updatedAt: "2026-10-20T00:00:00.000Z",
		body: { widgets: [widget("a"), widget("b")] },
		...overrides
	};
}

const emptyData: WidgetDataConfig = { layers: [] };
const otherData: WidgetDataConfig = {
	dateRange: { kind: "trailing", amount: 7, unit: "day" },
	layers: [
		{
			dataset: "air-quality",
			entryType: "pm25",
			place: { kind: "region", type: "county", code: "06019" }
		}
	]
};

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object") {
		Object.values(value).forEach(deepFreeze);
		Object.freeze(value);
	}
	return value;
}

describe("applyChange", () => {
	it("addWidget inserts at index and inverse removes it", () => {
		const doc = makeDoc();
		const w = widget("c");
		const { doc: next, inverse } = applyChange(doc, {
			op: "addWidget",
			target: { widgetId: "c" },
			widget: w,
			index: 1
		});
		expect(next.body.widgets.map((x) => x.id)).toEqual(["a", "c", "b"]);
		expect(inverse.op).toBe("removeWidget");
		expect(applyChange(next, inverse).doc).toEqual(doc);
	});

	it("removeWidget inverse restores widget at its index", () => {
		const doc = makeDoc();
		const { doc: next, inverse } = applyChange(doc, {
			op: "removeWidget",
			target: { widgetId: "a" },
			widget: widget("a"),
			index: 0
		});
		expect(next.body.widgets.map((x) => x.id)).toEqual(["b"]);
		expect(inverse).toMatchObject({ op: "addWidget", index: 0 });
		expect(applyChange(next, inverse).doc).toEqual(doc);
	});

	it("setField title round-trips; inverse has from/to swapped", () => {
		const doc = makeDoc();
		const change: Change = {
			op: "setField",
			target: { widgetId: "a", path: "title" },
			from: null,
			to: "Hello"
		};
		const { doc: next, inverse } = applyChange(doc, change);
		expect(next.body.widgets[0].title).toBe("Hello");
		expect(inverse).toEqual({ ...change, from: "Hello", to: null });
		expect(applyChange(next, inverse).doc).toEqual(doc);
	});

	it("setField inverse restores the actual prior value even when `from` is stale", () => {
		const doc = makeDoc({ body: { widgets: [widget("a", "Real"), widget("b")] } });
		const change: Change = {
			op: "setField",
			target: { widgetId: "a", path: "title" },
			from: "Stale",
			to: "New"
		};
		const { doc: next, inverse } = applyChange(doc, change);
		expect(inverse).toEqual({ ...change, from: "New", to: "Real" });
		expect(applyChange(next, inverse).doc).toEqual(doc);

		const named = applyChange(doc, {
			op: "setField",
			target: { path: "name" },
			from: "Stale",
			to: "Other"
		});
		expect(named.inverse).toMatchObject({ from: "Other", to: "Mine" });
		expect(applyChange(named.doc, named.inverse).doc).toEqual(doc);

		const deleted = applyChange(doc, {
			op: "setField",
			target: { path: "deletedAt" },
			from: "2026-10-19T00:00:00.000Z",
			to: "2026-10-20T01:00:00.000Z"
		});
		expect(deleted.inverse).toMatchObject({ to: null });
		expect(applyChange(deleted.doc, deleted.inverse).doc).toEqual(doc);
	});

	it("setField name on the document", () => {
		const doc = makeDoc();
		const { doc: next, inverse } = applyChange(doc, {
			op: "setField",
			target: { path: "name" },
			from: "Mine",
			to: null
		});
		expect(next.name).toBeNull();
		expect(applyChange(next, inverse).doc.name).toBe("Mine");
	});

	it("setField deletedAt null removes the key", () => {
		const doc = makeDoc({ deletedAt: "2026-10-20T01:00:00.000Z" });
		const { doc: next, inverse } = applyChange(doc, {
			op: "setField",
			target: { path: "deletedAt" },
			from: "2026-10-20T01:00:00.000Z",
			to: null
		});
		expect("deletedAt" in next).toBe(false);
		expect(applyChange(next, inverse).doc).toEqual(doc);
	});

	it("does not touch version or updatedAt", () => {
		const doc = makeDoc();
		const { doc: next } = applyChange(doc, {
			op: "setField",
			target: { path: "name" },
			from: "Mine",
			to: "Other"
		});
		expect(next.version).toBe(doc.version);
		expect(next.updatedAt).toBe(doc.updatedAt);
	});

	it("does not mutate input", () => {
		const doc = deepFreeze(makeDoc());
		const snapshot = structuredClone(doc);
		const changes: Change[] = [
			{ op: "addWidget", target: { widgetId: "c" }, widget: widget("c"), index: 0 },
			{ op: "removeWidget", target: { widgetId: "a" }, widget: widget("a"), index: 0 },
			{ op: "setField", target: { widgetId: "a", path: "title" }, from: null, to: "T" },
			{ op: "setField", target: { path: "name" }, from: "Mine", to: "N" },
			{ op: "setField", target: { path: "deletedAt" }, from: null, to: "2026-10-20T01:00:00.000Z" },
			{ op: "setWidgetData", target: { widgetId: "a" }, from: emptyData, to: otherData },
			{
				op: "setLayout",
				target: { widgetIds: ["a"] },
				from: { a: { rect: { x: 0, y: 0, w: 6, h: 4 }, minimized: null } },
				to: { a: { rect: { x: 1, y: 1, w: 6, h: 4 }, minimized: null } }
			},
			{
				op: "replaceDocument",
				target: {},
				from: { name: "Mine", body: doc.body },
				to: { name: "X", body: { widgets: [] } }
			}
		];
		for (const change of changes) {
			const result = applyChange(doc, deepFreeze(structuredClone(change)));
			expect(result.doc).not.toEqual(doc);
			expect(doc).toEqual(snapshot);
		}
	});

	it("addWidget clamps an index past the end and records the clamped index", () => {
		const doc = makeDoc();
		const { doc: next, inverse } = applyChange(doc, {
			op: "addWidget",
			target: { widgetId: "c" },
			widget: widget("c"),
			index: 99
		});
		expect(next.body.widgets.map((x) => x.id)).toEqual(["a", "b", "c"]);
		expect(inverse).toMatchObject({ op: "removeWidget", index: 2 });
		expect(applyChange(next, inverse).doc).toEqual(doc);
		const atStart = applyChange(doc, {
			op: "addWidget",
			target: { widgetId: "c" },
			widget: widget("c"),
			index: 0
		});
		expect(atStart.doc.body.widgets.map((x) => x.id)).toEqual(["c", "a", "b"]);
		expect(atStart.inverse).toMatchObject({ index: 0 });
	});

	it("setWidgetData replaces only that widget's data and inverts to the actual prior data", () => {
		const doc = makeDoc();
		const change: Change = {
			op: "setWidgetData",
			target: { widgetId: "a" },
			from: otherData,
			to: otherData
		};
		const { doc: next, inverse } = applyChange(doc, change);
		expect(next.body.widgets[0].data).toEqual(otherData);
		expect(next.body.widgets[1]).toBe(doc.body.widgets[1]);
		expect(next.body.widgets[0].title).toBe(doc.body.widgets[0].title);
		// `from` was stale: the inverse restores what was really there.
		expect(inverse).toEqual({ ...change, from: otherData, to: emptyData });
		expect(applyChange(next, inverse).doc).toEqual(doc);
		expect(appliedChange(inverse)).toEqual({ ...change, from: emptyData, to: otherData });
	});

	it("setWidgetData with type, options and rect sets them all and inverts to what was there", () => {
		const doc = makeDoc({
			body: { widgets: [{ ...widget("a"), options: { keep: 1 } }, widget("b")] }
		});
		const change: Change = {
			op: "setWidgetData",
			target: { widgetId: "a" },
			from: emptyData,
			to: otherData,
			// `from`s are stale: the inverse restores what was really there.
			type: { from: "stale", to: "data-table" },
			options: { from: { stale: true }, to: { overlayFor: "x" } },
			rect: { from: { x: 9, y: 9, w: 1, h: 1 }, to: { x: 0, y: 0, w: 8, h: 6 } }
		};
		const { doc: next, inverse } = applyChange(doc, change);
		expect(next.body.widgets[0]).toEqual({
			id: "a",
			type: "data-table",
			title: null,
			rect: { x: 0, y: 0, w: 8, h: 6 },
			data: otherData,
			options: { overlayFor: "x" }
		});
		expect(inverse).toEqual({
			op: "setWidgetData",
			target: { widgetId: "a" },
			from: otherData,
			to: emptyData,
			type: { from: "data-table", to: "placeholder" },
			options: { from: { overlayFor: "x" }, to: { keep: 1 } },
			rect: { from: { x: 0, y: 0, w: 8, h: 6 }, to: { x: 0, y: 0, w: 6, h: 4 } }
		});
		expect(applyChange(next, inverse).doc).toEqual(doc);
		expect(appliedChange(inverse)).toEqual({
			...change,
			from: emptyData,
			type: { from: "placeholder", to: "data-table" },
			options: { from: { keep: 1 }, to: { overlayFor: "x" } },
			rect: { from: { x: 0, y: 0, w: 6, h: 4 }, to: { x: 0, y: 0, w: 8, h: 6 } }
		});
	});

	it("setWidgetData options with no `to` removes them; the inverse puts them back", () => {
		const doc = makeDoc({
			body: { widgets: [{ ...widget("a"), options: { keep: 1 } }, widget("b")] }
		});
		const { doc: next, inverse } = applyChange(doc, {
			op: "setWidgetData",
			target: { widgetId: "a" },
			from: emptyData,
			to: emptyData,
			options: { from: { keep: 1 } }
		});
		expect("options" in next.body.widgets[0]).toBe(false);
		expect(applyChange(next, inverse).doc).toEqual(doc);
	});

	it("setWidgetData thresholds set them, with no `to` remove them, and invert to what was there", () => {
		const doc = makeDoc({
			body: { widgets: [{ ...widget("a"), thresholds: [{ level: "moderate" }] }, widget("b")] }
		});
		const change: Change = {
			op: "setWidgetData",
			target: { widgetId: "a" },
			from: emptyData,
			to: emptyData,
			// `from` is stale: the inverse restores what was really there.
			thresholds: { from: [{ level: "stale" }], to: [{ level: "unhealthy" }] }
		};
		const { doc: next, inverse } = applyChange(doc, change);
		expect(next.body.widgets[0].thresholds).toEqual([{ level: "unhealthy" }]);
		expect(inverse).toMatchObject({
			thresholds: { from: [{ level: "unhealthy" }], to: [{ level: "moderate" }] }
		});
		expect(applyChange(next, inverse).doc).toEqual(doc);
		expect(appliedChange(inverse)).toMatchObject({
			thresholds: { from: [{ level: "moderate" }], to: [{ level: "unhealthy" }] }
		});
		const off = applyChange(doc, { ...change, thresholds: { from: [{ level: "moderate" }] } });
		expect("thresholds" in off.doc.body.widgets[0]).toBe(false);
		expect(applyChange(off.doc, off.inverse).doc).toEqual(doc);
		expect(
			ChangeSchema.safeParse({ ...change, thresholds: { to: [{ level: "a" }, { level: "b" }] } })
				.success
		).toBe(false);
	});

	it("setWidgetData without type, options or rect leaves them as they are", () => {
		const doc = makeDoc({
			body: { widgets: [{ ...widget("a"), options: { keep: 1 } }, widget("b")] }
		});
		const { doc: next, inverse } = applyChange(doc, {
			op: "setWidgetData",
			target: { widgetId: "a" },
			from: emptyData,
			to: otherData
		});
		expect(next.body.widgets[0]).toEqual({ ...doc.body.widgets[0], data: otherData });
		expect(Object.keys(inverse).sort()).toEqual(["from", "op", "target", "to"]);
	});

	it("ChangeSchema validates setWidgetData's type, options and rect", () => {
		const good = {
			op: "setWidgetData",
			target: { widgetId: "a" },
			from: emptyData,
			to: otherData,
			type: { from: "chart", to: "data-table" },
			options: { from: { a: 1 } },
			rect: { from: { x: 0, y: 0, w: 3, h: 4 }, to: { x: 0, y: 0, w: 4, h: 5 } }
		};
		expect(ChangeSchema.safeParse(good).success).toBe(true);
		expect(ChangeSchema.safeParse({ ...good, type: { from: "chart", to: "" } }).success).toBe(
			false
		);
		expect(ChangeSchema.safeParse({ ...good, options: { to: "no" } }).success).toBe(false);
		expect(
			ChangeSchema.safeParse({
				...good,
				rect: { from: good.rect.from, to: { x: 10, y: 0, w: 4, h: 5 } }
			}).success
		).toBe(false);
	});

	it("setWidgetData throws ChangeTargetMissing for a missing widget", () => {
		expect(() =>
			applyChange(makeDoc(), {
				op: "setWidgetData",
				target: { widgetId: "zzz" },
				from: emptyData,
				to: otherData
			})
		).toThrow(ChangeTargetMissing);
	});

	it("ChangeSchema validates setWidgetData data", () => {
		const good = {
			op: "setWidgetData",
			target: { widgetId: "a" },
			from: emptyData,
			to: otherData
		};
		expect(ChangeSchema.safeParse(good).success).toBe(true);
		expect(ChangeSchema.safeParse({ ...good, to: { layers: "no" } }).success).toBe(false);
		expect(ChangeSchema.safeParse({ ...good, target: { widgetId: "" } }).success).toBe(false);
	});

	it("throws ChangeTargetMissing for unknown widgetId", () => {
		const doc = makeDoc();
		expect(() =>
			applyChange(doc, {
				op: "setField",
				target: { widgetId: "zzz", path: "title" },
				from: null,
				to: "x"
			})
		).toThrow(ChangeTargetMissing);
		expect(() =>
			applyChange(doc, {
				op: "removeWidget",
				target: { widgetId: "zzz" },
				widget: widget("zzz"),
				index: 0
			})
		).toThrow(ChangeTargetMissing);
	});

	it("throws ChangeTargetMissing when adding an id that already exists", () => {
		expect(() =>
			applyChange(makeDoc(), {
				op: "addWidget",
				target: { widgetId: "a" },
				widget: widget("a"),
				index: 0
			})
		).toThrow(ChangeTargetMissing);
	});
});

describe("setLayout with prototype-named ids", () => {
	it("doesn't take a placement from the prototype", () => {
		const doc = makeDoc({ body: { widgets: [widget("toString")] } });
		const change = {
			op: "setLayout",
			target: { widgetIds: ["toString"] },
			from: {},
			to: {}
		} as Change;
		expect(() => applyChange(doc, change)).toThrow(ChangeTargetMissing);
	});
});

describe("ChangeSchema", () => {
	it("rejects title change without widgetId", () => {
		const bad = { op: "setField", target: { path: "title" }, from: null, to: "x" };
		expect(ChangeSchema.safeParse(bad).success).toBe(false);
	});

	it("rejects widgetId on a non-title path", () => {
		const bad = { op: "setField", target: { widgetId: "a", path: "name" }, from: null, to: "x" };
		expect(ChangeSchema.safeParse(bad).success).toBe(false);
	});

	it("rejects over-long names and bad deletedAt values", () => {
		const long = "x".repeat(101);
		expect(
			ChangeSchema.safeParse({ op: "setField", target: { path: "name" }, from: null, to: long })
				.success
		).toBe(false);
		expect(
			ChangeSchema.safeParse({
				op: "setField",
				target: { path: "deletedAt" },
				from: null,
				to: "yesterday"
			}).success
		).toBe(false);
	});

	it("add/remove with mismatched target and widget ids is rejected by ChangeSchema", () => {
		for (const op of ["addWidget", "removeWidget"]) {
			const bad = { op, target: { widgetId: "x" }, widget: widget("c"), index: 0 };
			expect(ChangeSchema.safeParse(bad).success).toBe(false);
		}
	});

	it("rejects a setLayout whose from/to keys only match through the prototype", () => {
		const p = { rect: { x: 0, y: 0, w: 6, h: 4 }, minimized: null };
		const bad = {
			op: "setLayout",
			target: { widgetIds: ["toString"] },
			from: { x: p },
			to: { x: p }
		};
		expect(ChangeSchema.safeParse(bad).success).toBe(false);
	});

	it("accepts a valid change", () => {
		const ok = { op: "addWidget", target: { widgetId: "c" }, widget: widget("c"), index: 0 };
		expect(ChangeSchema.safeParse(ok).success).toBe(true);
	});

	it("replaceDocument sets name and body, keeps the rest, and inverts to the actual prior content", () => {
		const doc = makeDoc({ deletedAt: "2026-10-21T00:00:00.000Z" });
		const to = { name: "Older", body: { widgets: [widget("z", "Zed")] } };
		const change: Change = {
			op: "replaceDocument",
			target: {},
			from: { name: "stale", body: { widgets: [] } },
			to
		};
		expect(ChangeSchema.safeParse(change).success).toBe(true);
		const { doc: next, inverse } = applyChange(deepFreeze(doc), change);
		expect(next).toEqual({ ...doc, name: "Older", body: to.body });
		expect(inverse).toEqual({
			op: "replaceDocument",
			target: {},
			from: to,
			to: { name: "Mine", body: doc.body }
		});
		expect(applyChange(next, inverse).doc).toEqual(doc);
		expect(appliedChange(inverse)).toEqual({
			op: "replaceDocument",
			target: {},
			from: { name: "Mine", body: doc.body },
			to
		});
	});

	it("rejects a replaceDocument with an over-long name", () => {
		const content = { name: "x".repeat(101), body: { widgets: [] } };
		const change = { op: "replaceDocument", target: {}, from: content, to: content };
		expect(ChangeSchema.safeParse(change).success).toBe(false);
	});
});

describe("setLayout", () => {
	const r = (x: number, y: number, w = 6, h = 4) => ({ x, y, w, h });
	const place = (rect: ReturnType<typeof r>, minimized: { order: number } | null = null) => ({
		rect,
		minimized
	});
	const layout = (from: Record<string, ReturnType<typeof place>>, to = from): Change => ({
		op: "setLayout",
		target: { widgetIds: Object.keys(to) },
		from,
		to
	});

	it("requires from and to keys to equal target.widgetIds", () => {
		const p = place(r(0, 0));
		const bad = {
			op: "setLayout",
			target: { widgetIds: ["a", "b"] },
			from: { a: p },
			to: { a: p }
		};
		expect(ChangeSchema.safeParse(bad).success).toBe(false);
		const ok = {
			op: "setLayout",
			target: { widgetIds: ["a"] },
			from: { a: p },
			to: { a: p }
		};
		expect(ChangeSchema.safeParse(ok).success).toBe(true);
	});

	it("ids must be unique and non-empty", () => {
		const p = place(r(0, 0));
		const dup = {
			op: "setLayout",
			target: { widgetIds: ["a", "a"] },
			from: { a: p },
			to: { a: p }
		};
		expect(ChangeSchema.safeParse(dup).success).toBe(false);
		const none = { op: "setLayout", target: { widgetIds: [] }, from: {}, to: {} };
		expect(ChangeSchema.safeParse(none).success).toBe(false);
	});

	it("sets rects and minimized", () => {
		const doc = makeDoc({
			body: { widgets: [widget("a"), { ...widget("b"), minimized: { order: 2 } }] }
		});
		const change = layout(
			{ a: place(r(0, 0)), b: place(r(0, 0), { order: 2 }) },
			{ a: place(r(0, 4)), b: place(r(6, 0)) }
		);
		const { doc: next } = applyChange(deepFreeze(doc), change);
		expect(next.body.widgets[0].rect).toEqual(r(0, 4));
		expect(next.body.widgets[1].rect).toEqual(r(6, 0));
		expect("minimized" in next.body.widgets[1]).toBe(false);
		const min = applyChange(
			doc,
			layout({ a: place(r(0, 0)) }, { a: place(r(0, 0), { order: 0 }) })
		);
		expect(min.doc.body.widgets[0].minimized).toEqual({ order: 0 });
	});

	it("its inverse restores the document", () => {
		const doc = makeDoc({
			body: { widgets: [widget("a"), { ...widget("b"), minimized: { order: 2 } }] }
		});
		const change = layout(
			{ a: place(r(0, 0)), b: place(r(0, 0), { order: 2 }) },
			{ a: place(r(0, 4)), b: place(r(6, 0)) }
		);
		const { doc: next, inverse } = applyChange(doc, change);
		expect(applyChange(next, inverse).doc).toEqual(doc);
	});

	it("the inverse reads from the document, not the change", () => {
		const doc = makeDoc();
		const change = layout({ a: place(r(9, 9, 3, 3)) }, { a: place(r(0, 4)) });
		const { inverse } = applyChange(doc, change);
		expect(inverse).toEqual({
			op: "setLayout",
			target: { widgetIds: ["a"] },
			from: { a: place(r(0, 4)) },
			to: { a: place(r(0, 0)) }
		});
	});

	it("skips ids that are gone", () => {
		const doc = makeDoc({ body: { widgets: [widget("a")] } });
		const change = layout(
			{ a: place(r(0, 0)), b: place(r(6, 0)) },
			{ a: place(r(0, 4)), b: place(r(6, 4)) }
		);
		const { doc: next, inverse } = applyChange(doc, change);
		expect(next.body.widgets[0].rect).toEqual(r(0, 4));
		expect(inverse).toMatchObject({ target: { widgetIds: ["a"] } });
		expect(Object.keys((inverse as { to: object }).to)).toEqual(["a"]);
	});

	it("with every id gone throws ChangeTargetMissing", () => {
		const change = layout({ x: place(r(0, 0)) }, { x: place(r(0, 4)) });
		expect(() => applyChange(makeDoc(), change)).toThrow(ChangeTargetMissing);
	});

	it("an entry sets only the fields it changes", () => {
		// Another tab minimized a; this tidy fix (rect only) leaves its minimized alone.
		const doc = makeDoc({ body: { widgets: [{ ...widget("a"), minimized: { order: 3 } }] } });
		const fix = layout({ a: place(r(0, 0)) }, { a: place(r(0, 0, 6, 6)) });
		const fixed = applyChange(deepFreeze(doc), fix).doc.body.widgets[0];
		expect(fixed.rect).toEqual(r(0, 0, 6, 6));
		expect(fixed.minimized).toEqual({ order: 3 });

		// Another tab moved b; this minimize (minimized only) leaves its rect alone.
		const moved = makeDoc({ body: { widgets: [{ ...widget("b"), rect: r(0, 8) }] } });
		const minimize = layout({ b: place(r(0, 0)) }, { b: place(r(0, 0), { order: 0 }) });
		const minimized = applyChange(deepFreeze(moved), minimize).doc.body.widgets[0];
		expect(minimized.rect).toEqual(r(0, 8));
		expect(minimized.minimized).toEqual({ order: 0 });
	});

	it("a partial entry's inverse and applied change are exact", () => {
		const doc = makeDoc({
			body: { widgets: [{ ...widget("a"), rect: r(0, 8), minimized: { order: 3 } }] }
		});
		const fix = layout({ a: place(r(0, 0)) }, { a: place(r(0, 0, 6, 6)) });
		const { doc: next, inverse } = applyChange(doc, fix);
		expect(inverse).toEqual(
			layout({ a: place(r(0, 0, 6, 6), { order: 3 }) }, { a: place(r(0, 8), { order: 3 }) })
		);
		expect(appliedChange(inverse)).toEqual(
			layout({ a: place(r(0, 8), { order: 3 }) }, { a: place(r(0, 0, 6, 6), { order: 3 }) })
		);
		expect(applyChange(next, inverse).doc).toEqual(doc);
	});

	it("appliedChange round-trips", () => {
		const change = layout({ a: place(r(9, 9, 3, 3)) }, { a: place(r(0, 4)) });
		const { inverse } = applyChange(makeDoc(), change);
		expect(appliedChange(inverse)).toEqual(layout({ a: place(r(0, 0)) }, { a: place(r(0, 4)) }));
	});
});
