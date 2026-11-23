import { describe, expect, it } from "vitest";
import type { Resolution } from "./schema";
import { fetchLevel } from "./resolution";

const ALL: Resolution[] = ["raw", "hour", "day", "month", "quarter", "year"];

describe("fetchLevel", () => {
	it("fetches an offered level as itself", () => {
		for (const level of ["raw", "hour", "day", "month", "year"] as const) {
			expect(fetchLevel(level, ALL)).toEqual({ resolution: level, downsampleFromRaw: false });
		}
	});

	it("downsamples raw when only raw is offered", () => {
		expect(fetchLevel("month", ["raw"])).toEqual({ resolution: "month", downsampleFromRaw: true });
		expect(fetchLevel("hour", ["raw"])).toEqual({ resolution: "hour", downsampleFromRaw: true });
	});

	it("has no coarser fallback", () => {
		expect(fetchLevel("day", ["month", "year"])).toBeNull();
		expect(fetchLevel("hour", ["day"])).toBeNull();
	});

	it("is null when nothing is offered, or raw is asked for and not offered", () => {
		expect(fetchLevel("day", [])).toBeNull();
		expect(fetchLevel("raw", ["hour", "day"])).toBeNull();
	});
});
