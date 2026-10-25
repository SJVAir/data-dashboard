import { describe, expect, it } from "vitest";
import type { Resolution } from "./schema";
import { chooseResolution } from "./resolution";

const ALL: Resolution[] = ["raw", "hour", "day", "month", "quarter", "year"];

describe("chooseResolution", () => {
	it.each([
		[2, "raw"],
		[2.01, "hour"],
		[60, "hour"],
		[61, "day"],
		[730, "day"],
		[731, "month"]
	])("ladder: %s days -> %s", (spanDays, resolution) => {
		expect(chooseResolution({ spanDays, offered: ALL })).toEqual({
			resolution,
			downsampleFromRaw: false,
			reason: "ladder"
		});
	});

	it("downsamples from raw when only raw is offered", () => {
		expect(chooseResolution({ spanDays: 30, offered: ["raw"] })).toEqual({
			resolution: "hour",
			downsampleFromRaw: true,
			reason: "ladder"
		});
	});

	it("pin beats override", () => {
		expect(chooseResolution({ spanDays: 30, offered: ALL, pin: "day", override: "hour" })).toEqual({
			resolution: "day",
			downsampleFromRaw: false,
			reason: "pin"
		});
	});

	it("uses an offered override", () => {
		expect(chooseResolution({ spanDays: 3, offered: ALL, override: "month" })).toEqual({
			resolution: "month",
			downsampleFromRaw: false,
			reason: "override"
		});
	});

	it("auto override falls through to the ladder", () => {
		expect(chooseResolution({ spanDays: 3, offered: ALL, override: "auto" }).reason).toBe("ladder");
	});

	it("picks the nearest coarser offered level", () => {
		expect(chooseResolution({ spanDays: 30, offered: ["raw", "day"] })).toEqual({
			resolution: "day",
			downsampleFromRaw: false,
			reason: "ladder"
		});
	});

	it("keeps the reason of a pin when falling back", () => {
		expect(chooseResolution({ spanDays: 30, offered: ["raw", "month"], pin: "hour" })).toEqual({
			resolution: "month",
			downsampleFromRaw: false,
			reason: "pin"
		});
	});

	it("throws RangeError when nothing coarser and no raw", () => {
		expect(() => chooseResolution({ spanDays: 800, offered: ["hour"] })).toThrow(RangeError);
		expect(() => chooseResolution({ spanDays: 3, offered: [] })).toThrow(RangeError);
	});

	it("uses season only as the ideal", () => {
		expect(chooseResolution({ spanDays: 30, offered: ["season"], override: "season" })).toEqual({
			resolution: "season",
			downsampleFromRaw: false,
			reason: "override"
		});
		expect(() => chooseResolution({ spanDays: 30, offered: ["season"] })).toThrow(RangeError);
	});
});
