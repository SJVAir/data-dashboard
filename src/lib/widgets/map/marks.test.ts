import { describe, expect, it } from "vitest";
import { ChangeSchema } from "$lib/changes/types";
import type { WidgetInstance } from "$lib/documents/schema";
import {
	HIDDEN_REASON_ORDER,
	canMark,
	hiddenMarks,
	hiddenReasonLines,
	hiddenReasons,
	marksChange,
	marksToSend,
	sameIds
} from "./marks";
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

	it("on a stop, a mark in the places with no figure for the period is period, before the options", () => {
		const dayDrawn = new Set(["d"]);
		const inPlaces = new Set(["c", "d"]);
		expect(hiddenReasons(["c"], monitors, reports, inPlaces, dayDrawn)).toEqual(
			new Map([["period", 1]])
		);
		// Drawn that day but hidden: the options; outside the places: still places.
		expect(hiddenReasons(["d", "a"], monitors, reports, inPlaces, dayDrawn)).toEqual(
			new Map([
				["options", 1],
				["places", 1]
			])
		);
		// The pollutant comes first.
		expect(hiddenReasons(["b"], monitors, reports, new Set(["b"]), dayDrawn)).toEqual(
			new Map([["pollutant", 1]])
		);
	});

	it("does not guess when the type's reports are unknown", () => {
		expect(hiddenReasons(["a"], monitors, () => undefined, loaded)).toEqual(
			new Map([["places", 1]])
		);
	});
});

describe("hiddenReasonLines", () => {
	const reasons = new Map<"pollutant" | "options" | "places" | "unknown", number>([
		["unknown", 1],
		["pollutant", 2],
		["places", 1]
	]);

	it("puts the period's line after the pollutant's", () => {
		expect(HIDDEN_REASON_ORDER).toEqual(["pollutant", "period", "options", "places", "unknown"]);
		expect(
			hiddenReasonLines(
				new Map([
					["places", 1],
					["period", 2],
					["pollutant", 1]
				]),
				"Ozone"
			)
		).toEqual([
			{ reason: "pollutant", count: 1 },
			{ reason: "period", count: 2 },
			{ reason: "places", count: 1 }
		]);
	});

	it("orders the reasons", () => {
		expect(hiddenReasonLines(reasons, "Ozone")).toEqual([
			{ reason: "pollutant", count: 2 },
			{ reason: "places", count: 1 },
			{ reason: "unknown", count: 1 }
		]);
	});

	it("never words a pollutant reason without a label: it joins the aren't-shown line", () => {
		for (const label of [undefined, ""]) {
			expect(hiddenReasonLines(reasons, label)).toEqual([
				{ reason: "places", count: 1 },
				{ reason: "unknown", count: 3 }
			]);
		}
		expect(hiddenReasonLines(new Map([["pollutant", 1]]), undefined)).toEqual([
			{ reason: "unknown", count: 1 }
		]);
	});
});

describe("marksToSend", () => {
	const monitors = new Map([
		["a", { type: "pm25" }],
		["b", { type: "pm25" }],
		["c", { type: "pm25" }],
		["d", { type: "o3" }],
		["e", { type: "pm25" }]
	]);
	const reports = (type: string) => type === "pm25";

	it("keeps a drawn mark", () => {
		const r = marksToSend(["a"], new Set(["a"]), monitors, reports, new Set(["a"]));
		expect(r).toEqual({ ids: ["a"], leftOut: 0 });
	});

	it("keeps a mark hidden only for the period", () => {
		const r = marksToSend(["a"], new Set(), monitors, reports, new Set(["a"]), new Set());
		expect(r).toEqual({ ids: ["a"], leftOut: 0 });
	});

	it("leaves out the other reasons and counts them", () => {
		const r = marksToSend(
			["d", "b", "x", "zz"],
			new Set(),
			monitors,
			reports,
			new Set(["b"]),
			undefined
		);
		// d: pollutant, b: options (no stop), x: unknown (not listed), zz: unknown
		expect(r).toEqual({ ids: [], leftOut: 4 });
		const places = marksToSend(["e"], new Set(), monitors, reports, new Set());
		expect(places).toEqual({ ids: [], leftOut: 1 });
	});

	it("keeps mark order", () => {
		const r = marksToSend(
			["c", "d", "a", "b"],
			new Set(["a"]),
			monitors,
			reports,
			new Set(["a", "b", "c"]),
			new Set(["a"])
		);
		expect(r).toEqual({ ids: ["c", "a", "b"], leftOut: 1 });
	});

	it("sends all when every mark is hidden for the period", () => {
		const r = marksToSend(
			["a", "b", "c"],
			new Set(),
			monitors,
			reports,
			new Set(["a", "b", "c"]),
			new Set()
		);
		expect(r).toEqual({ ids: ["a", "b", "c"], leftOut: 0 });
	});
});
