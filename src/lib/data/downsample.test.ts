import { describe, expect, it } from "vitest";
import { downsample } from "./downsample";

const HOUR = 3_600_000;

describe("downsample", () => {
	it("returns [] for empty input", () => {
		expect(downsample([], "hour")).toEqual([]);
	});

	it("makes 25 hourly buckets across the fall-back day", () => {
		// 2026-11-01 00:00 PDT to 2026-11-02 00:00 PST is 25 hours.
		const start = Date.parse("2026-11-01T07:00:00Z");
		const points = Array.from({ length: 25 * 4 }, (_, i) => ({
			t: start + i * (HOUR / 4),
			value: i
		}));
		const out = downsample(points, "hour");
		expect(out).toHaveLength(25);
		expect(out.every((p) => p.count === 4)).toBe(true);
		expect(out[24].t).toBe(Date.parse("2026-11-02T07:00:00Z"));
	});

	it("computes mean, min, max, and count", () => {
		const t = Date.parse("2026-10-20T19:10:00Z");
		const out = downsample(
			[
				{ t, value: 4 },
				{ t: t + 60_000, value: 10 },
				{ t: t + 120_000, value: 1 }
			],
			"hour"
		);
		expect(out).toEqual([
			{ t: Date.parse("2026-10-20T19:00:00Z"), mean: 5, min: 1, max: 10, count: 3, partial: false }
		]);
	});

	it("sorts buckets and marks those at or after openFrom partial", () => {
		const a = Date.parse("2026-10-20T19:10:00Z");
		const b = Date.parse("2026-10-20T20:10:00Z");
		const out = downsample(
			[
				{ t: b, value: 2 },
				{ t: a, value: 1 }
			],
			"hour",
			Date.parse("2026-10-20T20:00:00Z")
		);
		expect(out.map((p) => p.partial)).toEqual([false, true]);
		expect(out[0].t).toBeLessThan(out[1].t);
	});

	it("buckets by Pacific day", () => {
		const out = downsample(
			[
				{ t: Date.parse("2026-10-20T06:59:00Z"), value: 1 },
				{ t: Date.parse("2026-10-20T07:00:00Z"), value: 3 }
			],
			"day"
		);
		expect(out).toHaveLength(2);
	});
});
