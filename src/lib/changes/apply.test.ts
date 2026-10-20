import { describe, expect, it } from "vitest";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { ChangeSchema, type Change } from "./types";
import { applyChange, ChangeTargetMissing } from "./apply";

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
		const changes: Change[] = [
			{ op: "addWidget", target: { widgetId: "c" }, widget: widget("c"), index: 0 },
			{ op: "removeWidget", target: { widgetId: "a" }, widget: widget("a"), index: 0 },
			{ op: "setField", target: { widgetId: "a", path: "title" }, from: null, to: "T" },
			{ op: "setField", target: { path: "name" }, from: "Mine", to: "N" },
			{ op: "setField", target: { path: "deletedAt" }, from: null, to: "2026-10-20T01:00:00.000Z" }
		];
		for (const change of changes) expect(() => applyChange(doc, deepFreeze(change))).not.toThrow();
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

	it("accepts a valid change", () => {
		const ok = { op: "addWidget", target: { widgetId: "c" }, widget: widget("c"), index: 0 };
		expect(ChangeSchema.safeParse(ok).success).toBe(true);
	});
});
