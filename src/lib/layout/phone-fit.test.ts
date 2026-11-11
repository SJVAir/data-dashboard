import { describe, expect, test } from "vitest";
import { PHONE_FIT_MAX_ROWS, PhoneFit, rowsFor } from "./phone-fit.svelte";

describe("rowsFor", () => {
	// 64 px rows, 12 px gaps: n rows are 76n − 12 px.
	test("the fewest rows whose span holds the height", () => {
		expect(rowsFor(64, 64, 12)).toBe(1);
		expect(rowsFor(65, 64, 12)).toBe(2);
		expect(rowsFor(140, 64, 12)).toBe(2);
		expect(rowsFor(141, 64, 12)).toBe(3);
	});
	test("a subpixel sliver over a span doesn't take another row", () => {
		expect(rowsFor(140.4, 64, 12)).toBe(2);
	});
	test("nothing measurable is one row", () => {
		expect(rowsFor(0, 64, 12)).toBe(1);
		expect(rowsFor(100, 0, 0)).toBe(1);
	});
});

describe("PhoneFit", () => {
	test("a span is the widget's height, grown to its content, up to the cap", () => {
		const fit = new PhoneFit();
		expect(fit.span("a", 2)).toBe(2);
		fit.report("a", 5);
		expect(fit.span("a", 2)).toBe(5);
		expect(fit.span("a", 8)).toBe(8);
		fit.report("a", 40);
		expect(fit.span("a", 2)).toBe(PHONE_FIT_MAX_ROWS);
		expect(fit.span("a", 20)).toBe(20);
		fit.report("a", null);
		expect(fit.span("a", 2)).toBe(2);
	});
	test("the version changes only when a report does", () => {
		const fit = new PhoneFit();
		fit.report("a", 3);
		const v = fit.version;
		fit.report("a", 3);
		fit.report("b", null);
		expect(fit.version).toBe(v);
		fit.report("a", 4);
		expect(fit.version).toBe(v + 1);
		// Past the cap every count is the same span.
		fit.report("a", PHONE_FIT_MAX_ROWS + 5);
		fit.report("a", PHONE_FIT_MAX_ROWS + 9);
		expect(fit.version).toBe(v + 2);
	});
});
