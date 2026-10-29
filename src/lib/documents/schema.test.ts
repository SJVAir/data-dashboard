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
