import { describe, expect, it } from "vitest";
import { ChangeSchema } from "$lib/changes/types";
import type { WidgetInstance } from "$lib/documents/schema";
import { canMark, hiddenMarks, hiddenReasons, marksChange, sameIds } from "./marks";
import { MAP_MARKS_MAX } from "./options";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);

function mapWidget(options?: Record<string, unknown>): WidgetInstance {
	return {
		id: "w1",
		type: "map",
		title: null,
		rect: { x: 0, y: 0, w: 6, h: 6 },
		data: { layers: [{ dataset: "air-quality", entryType: "pm25" }] },
		...(options ? { options } : {})
	};
}

describe("canMark", () => {
	it("lets up to 25 marks through", () => {
		expect(canMark({ kind: "monitors", ids: ids(MAP_MARKS_MAX) }, "L")).toBe(true);
		expect(canMark(null, "L")).toBe(true);
	});

	it("refuses a 26th mark with the limit message", () => {
		expect(canMark({ kind: "monitors", ids: ids(26) }, "L")).toBe("L");
	});
});

describe("sameIds", () => {
	it("is true for the same ids in the same order only", () => {
		expect(sameIds([], [])).toBe(true);
		expect(sameIds(["a", "b"], ["a", "b"])).toBe(true);
		expect(sameIds(["a", "b"], ["b", "a"])).toBe(false);
		expect(sameIds(["a"], ["a", "b"])).toBe(false);
	});
});

describe("hiddenMarks", () => {
	it("lists marks that aren't drawn", () => {
		expect(hiddenMarks(["a", "b", "c"], new Set(["b"]))).toEqual(["a", "c"]);
	});

	it("is empty when every mark is drawn", () => {
		expect(hiddenMarks(["a"], new Set(["a", "b"]))).toEqual([]);
	});
});

describe("marksChange", () => {
	it("saves marks as one setWidgetData change, and null when unchanged", () => {
		const widget = mapWidget({ showing: "pm25", marks: ["a"] });
		const change = marksChange(widget, ["a", "b"]);
		expect(change).toEqual({
			op: "setWidgetData",
			target: { widgetId: "w1" },
			from: widget.data,
			to: widget.data,
			options: {
				from: { showing: "pm25", marks: ["a"] },
				to: { showing: "pm25", marks: ["a", "b"] }
			}
		});
		expect(ChangeSchema.safeParse(change).success).toBe(true);
		expect(marksChange(widget, ["a"])).toBeNull();
	});

	it("drops the marks key when the last mark goes, keeping the other options", () => {
		const widget = mapWidget({ showing: "o3", marks: ["a"] });
		expect(marksChange(widget, [])).toMatchObject({
			options: { from: { showing: "o3", marks: ["a"] }, to: { showing: "o3" } }
		});
	});

	it("marks a tile with no options", () => {
		expect(marksChange(mapWidget(), ["a"])).toMatchObject({
			options: { from: undefined, to: { marks: ["a"] } }
		});
		expect(marksChange(mapWidget(), [])).toBeNull();
	});
});

describe("hiddenReasons", () => {
	const monitors = new Map([
		["a", { type: "purpleair" }],
		["b", { type: "airnow" }],
		["c", { type: "purpleair" }],
		["d", { type: "purpleair" }]
	]);
	const reports = (type: string) => (type === "airnow" ? false : true);
	const loaded = new Set(["c"]);

	it("names each reason", () => {
		expect(hiddenReasons(["a"], monitors, reports, loaded)).toEqual(new Map([["places", 1]]));
		expect(hiddenReasons(["b"], monitors, reports, loaded)).toEqual(new Map([["pollutant", 1]]));
		expect(hiddenReasons(["c"], monitors, reports, loaded)).toEqual(new Map([["options", 1]]));
		expect(hiddenReasons(["zz"], monitors, reports, loaded)).toEqual(new Map([["unknown", 1]]));
	});

	it("checks the pollutant before the loaded monitors", () => {
		expect(hiddenReasons(["b"], monitors, reports, new Set(["b"]))).toEqual(
			new Map([["pollutant", 1]])
		);
	});

	it("counts a mix", () => {
		const out = hiddenReasons(["b", "b", "a", "zz"], monitors, reports, loaded);
		expect(out).toEqual(
			new Map([
				["pollutant", 2],
				["places", 1],
				["unknown", 1]
			])
		);
	});

	it("is unknown for all while the metadata isn't there", () => {
		expect(hiddenReasons(["a", "b"], null, reports, loaded)).toEqual(new Map([["unknown", 2]]));
	});

	it("does not guess when the type's reports are unknown", () => {
		expect(hiddenReasons(["a"], monitors, () => undefined, loaded)).toEqual(
			new Map([["places", 1]])
		);
	});
});
