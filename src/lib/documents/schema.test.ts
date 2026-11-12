import { describe, expect, it } from "vitest";
import { DashboardSchema, normalizeName } from "./schema";

function dashboard(overrides: Record<string, unknown> = {}) {
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id: "abc",
		name: null,
		version: 0,
		createdAt: "2026-10-20T01:00:00Z",
		updatedAt: "2026-10-20T01:00:00Z",
		body: {
			widgets: [
				{
					id: "w1",
					type: "placeholder",
					title: null,
					rect: { x: 0, y: 0, w: 6, h: 4 },
					data: { layers: [] }
				}
			]
		},
		...overrides
	};
}

function withWidgets(widgets: unknown[]) {
	return dashboard({ body: { widgets } });
}

describe("DashboardSchema", () => {
	it("parses a valid dashboard", () => {
		expect(DashboardSchema.safeParse(dashboard()).success).toBe(true);
	});

	it("rejects a rect that overflows the grid", () => {
		const bad = withWidgets([
			{
				id: "w1",
				type: "placeholder",
				title: null,
				rect: { x: 8, y: 0, w: 6, h: 4 },
				data: { layers: [] }
			}
		]);
		expect(DashboardSchema.safeParse(bad).success).toBe(false);
	});

	it("rejects duplicate widget ids", () => {
		const w = {
			id: "w1",
			type: "placeholder",
			title: null,
			rect: { x: 0, y: 0, w: 6, h: 4 },
			data: { layers: [] }
		};
		expect(DashboardSchema.safeParse(withWidgets([w, { ...w }])).success).toBe(false);
	});

	it("rejects a 101-character name", () => {
		expect(DashboardSchema.safeParse(dashboard({ name: "a".repeat(101) })).success).toBe(false);
		expect(DashboardSchema.safeParse(dashboard({ name: "a".repeat(100) })).success).toBe(true);
	});

	it("rejects schemaVersion 2", () => {
		expect(DashboardSchema.safeParse(dashboard({ schemaVersion: 2 })).success).toBe(false);
	});
});

describe("normalizeName", () => {
	it("turns blank input into null", () => {
		expect(normalizeName("   ")).toBeNull();
	});
	it("trims", () => {
		expect(normalizeName("  Air  ")).toBe("Air");
	});
	it("cuts to 100 characters", () => {
		expect(normalizeName("a".repeat(150))?.length).toBe(100);
	});
	it("never splits an emoji at the cut", () => {
		const result = normalizeName("a".repeat(99) + "\u{1F44D}\u{1F3FD}");
		expect(result).toBe("a".repeat(99));
		expect(result!.length).toBeLessThanOrEqual(100);
	});
	it("trims again after the cut", () => {
		expect(normalizeName("a".repeat(99) + " b")).toBe("a".repeat(99));
	});
});

describe("minimized", () => {
	const w = {
		id: "w1",
		type: "placeholder",
		title: null,
		rect: { x: 0, y: 0, w: 6, h: 4 },
		data: { layers: [] }
	};

	it("minimized takes an order", () => {
		const ok = withWidgets([{ ...w, minimized: { order: 0 } }]);
		expect(DashboardSchema.safeParse(ok).success).toBe(true);
		const bad = withWidgets([{ ...w, minimized: { order: -1 } }]);
		expect(DashboardSchema.safeParse(bad).success).toBe(false);
	});

	it("the old restoreRect shape is rejected", () => {
		const old = withWidgets([{ ...w, minimized: { restoreRect: w.rect } }]);
		expect(DashboardSchema.safeParse(old).success).toBe(false);
	});
});

describe("widget thresholds", () => {
	const widget = (thresholds: unknown) => ({
		id: "w1",
		type: "placeholder",
		title: null,
		rect: { x: 0, y: 0, w: 6, h: 4 },
		data: { layers: [] },
		thresholds
	});
	it("accepts one threshold", () => {
		expect(DashboardSchema.safeParse(withWidgets([widget([{ level: "unhealthy" }])])).success).toBe(
			true
		);
	});
	it("rejects two thresholds", () => {
		expect(
			DashboardSchema.safeParse(withWidgets([widget([{ level: "a" }, { level: "b" }])])).success
		).toBe(false);
	});
	it("rejects a level key over the code limit", () => {
		expect(
			DashboardSchema.safeParse(withWidgets([widget([{ level: "x".repeat(65) }])])).success
		).toBe(false);
	});
});

describe("note widgets", () => {
	const note = (options: unknown) => ({
		id: "n1",
		type: "note",
		title: null,
		rect: { x: 0, y: 0, w: 6, h: 4 },
		data: { layers: [] },
		options
	});

	it("accepts valid note options", () => {
		expect(DashboardSchema.safeParse(withWidgets([note({ text: "hi" })])).success).toBe(true);
		expect(
			DashboardSchema.safeParse(withWidgets([note({ message: "starter_note_welcome" })])).success
		).toBe(true);
	});

	it("rejects invalid note options at the widget's options path", () => {
		for (const options of [{ text: "a".repeat(5001) }, {}, undefined]) {
			const r = DashboardSchema.safeParse(withWidgets([note(options)]));
			expect(r.success).toBe(false);
			if (!r.success)
				expect(r.error.issues.some((i) => i.path.join(".") === "body.widgets.0.options")).toBe(
					true
				);
		}
	});

	it("leaves other types' options free-form", () => {
		const w = { ...note({ anything: 1 }), type: "other" };
		expect(DashboardSchema.safeParse(withWidgets([w])).success).toBe(true);
	});
});

describe("map widgets", () => {
	const map = (options: unknown) => ({
		id: "m1",
		type: "map",
		title: null,
		rect: { x: 0, y: 0, w: 6, h: 6 },
		data: { layers: [] },
		options
	});

	it("accepts a Map with no options or valid ones", () => {
		expect(DashboardSchema.safeParse(withWidgets([map(undefined)])).success).toBe(true);
		expect(DashboardSchema.safeParse(withWidgets([map({ marks: ["a"] })])).success).toBe(true);
	});

	it("refuses a dashboard whose Map has invalid options", () => {
		const r = DashboardSchema.safeParse(withWidgets([map({ marks: "x" })]));
		expect(r.success).toBe(false);
		if (!r.success)
			expect(r.error.issues.some((i) => i.path.join(".") === "body.widgets.0.options")).toBe(true);
	});
});
