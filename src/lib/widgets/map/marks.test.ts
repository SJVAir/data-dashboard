import { describe, expect, it } from "vitest";
import { ChangeSchema } from "$lib/changes/types";
import type { WidgetInstance } from "$lib/documents/schema";
import { canMark, hiddenMarks, marksChange } from "./marks";
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
