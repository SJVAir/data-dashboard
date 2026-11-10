import { describe, expect, it } from "vitest";
import {
	clampSelectable,
	fitsRange,
	moveFocus,
	spanOf,
	visibleSelection,
	type Selectable
} from "./selection";

const s: Selectable = { first: "2026-10-01", last: "2026-11-09" };

describe("spanOf", () => {
	it("orders the two ends", () => {
		expect(spanOf("2026-11-08", "2026-11-05")).toEqual({ start: "2026-11-05", end: "2026-11-08" });
		expect(spanOf("2026-11-05", "2026-11-08")).toEqual({ start: "2026-11-05", end: "2026-11-08" });
		expect(spanOf("2026-11-05", "2026-11-05")).toEqual({ start: "2026-11-05", end: "2026-11-05" });
	});
});

describe("clampSelectable", () => {
	it("pulls a date into the selectable days", () => {
		expect(clampSelectable("2026-11-20", s)).toBe(s.last);
		expect(clampSelectable("2026-09-20", s)).toBe(s.first);
		expect(clampSelectable("2026-10-20", s)).toBe("2026-10-20");
	});
});

describe("moveFocus", () => {
	it("moves by day and week in the month layout", () => {
		expect(moveFocus("2026-11-05", "ArrowRight", "month", s)).toBe("2026-11-06");
		expect(moveFocus("2026-11-05", "ArrowLeft", "month", s)).toBe("2026-11-04");
		expect(moveFocus("2026-11-05", "ArrowUp", "month", s)).toBe("2026-10-29");
		expect(moveFocus("2026-11-02", "ArrowDown", "month", s)).toBe("2026-11-09");
	});
	it("clamps to the selectable days", () => {
		expect(moveFocus("2026-11-25", "ArrowDown", "month", s)).toBe("2026-11-09");
		expect(moveFocus("2026-10-03", "ArrowUp", "month", s)).toBe("2026-10-01");
	});
	it("swaps the axes in the weeks layout", () => {
		expect(moveFocus("2026-11-01", "ArrowRight", "weeks", s)).toBe("2026-11-08");
		expect(moveFocus("2026-11-08", "ArrowLeft", "weeks", s)).toBe("2026-11-01");
		expect(moveFocus("2026-11-03", "ArrowDown", "weeks", s)).toBe("2026-11-04");
		expect(moveFocus("2026-11-03", "ArrowUp", "weeks", s)).toBe("2026-11-02");
	});
	it("goes to the week's Sunday and Saturday", () => {
		expect(moveFocus("2026-11-05", "Home", "month", s)).toBe("2026-11-01");
		expect(moveFocus("2026-11-01", "End", "month", { ...s, last: "2026-12-31" })).toBe(
			"2026-11-07"
		);
		expect(moveFocus("2026-11-05", "End", "weeks", s)).toBe("2026-11-07");
	});
	it("pages by month, clamped to the month's length and the selectable days", () => {
		expect(moveFocus("2026-10-31", "PageDown", "month", s)).toBe("2026-11-09");
		expect(moveFocus("2026-10-31", "PageDown", "month", { ...s, last: "2026-12-31" })).toBe(
			"2026-11-30"
		);
		expect(moveFocus("2026-03-31", "PageUp", "month", { ...s, first: "2026-01-01" })).toBe(
			"2026-02-28"
		);
		expect(moveFocus("2026-12-31", "PageUp", "month", { ...s, last: "2026-12-31" })).toBe(
			"2026-11-30"
		);
		expect(moveFocus("2026-11-15", "PageUp", "month", s)).toBe("2026-10-15");
	});
	it("leaves focus alone on other keys", () => {
		expect(moveFocus("2026-11-05", "a", "month", s)).toBe("2026-11-05");
	});
});

describe("visibleSelection", () => {
	const thisMonth: Selectable = { first: "2026-11-01", last: "2026-11-09" };
	it("is null when none of the selection is inside", () => {
		expect(
			visibleSelection({ start: "2026-10-03", end: "2026-10-08" }, thisMonth, "2026-11-30")
		).toBe(null);
		expect(visibleSelection(undefined, thisMonth, "2026-11-30")).toBe(null);
	});
	it("clips to the range", () => {
		expect(
			visibleSelection({ start: "2026-10-30", end: "2026-11-02" }, thisMonth, "2026-11-30")
		).toEqual({ start: "2026-11-01", end: "2026-11-02" });
		expect(
			visibleSelection({ start: "2026-11-05", end: "2026-12-20" }, thisMonth, "2026-11-30")
		).toEqual({ start: "2026-11-05", end: "2026-11-30" });
	});
	it("is null for date-time sub-ranges", () => {
		expect(
			visibleSelection(
				{ start: "2026-11-02T08:00:00Z", end: "2026-11-02T10:00:00Z" },
				thisMonth,
				"2026-11-30"
			)
		).toBe(null);
	});
});

describe("fitsRange", () => {
	it("is true when the dates sit inside", () => {
		expect(fitsRange({ start: "2026-11-02", end: "2026-11-05" }, "2026-11-01", "2026-11-09")).toBe(
			true
		);
		expect(fitsRange({ start: "2026-10-30", end: "2026-11-05" }, "2026-11-01", "2026-11-09")).toBe(
			false
		);
		expect(fitsRange({ start: "2026-11-02", end: "2026-11-12" }, "2026-11-01", "2026-11-09")).toBe(
			false
		);
	});
	it("is false for date-times", () => {
		expect(
			fitsRange(
				{ start: "2026-11-02T08:00:00Z", end: "2026-11-02T10:00:00Z" },
				"2026-11-01",
				"2026-11-09"
			)
		).toBe(false);
	});
});
