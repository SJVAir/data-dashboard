import { describe, expect, it } from "vitest";
import type { ResolvedRange } from "$lib/format/range";
import { planSegments } from "./periods";
import type { Resolution } from "./schema";

const NOW = new Date("2026-10-22T19:00:00Z");
const ALL: Resolution[] = ["raw", "hour", "day", "month", "quarter", "season", "year"];

function range(start: string, end: string, includesNow = true): ResolvedRange {
	return {
		firstDate: start.slice(0, 10),
		lastDate: end.slice(0, 10),
		start: new Date(start),
		end: new Date(end),
		rolling: false,
		includesNow
	};
}

const iso = (s: { start: Date; end: Date }) => [s.start.toISOString(), s.end.toISOString()];

describe("planSegments", () => {
	it("month range this year: completed months plus a daily and hourly fill", () => {
		const segs = planSegments({
			resolution: "month",
			range: range("2026-01-01T08:00:00Z", "2027-01-01T08:00:00Z"),
			now: NOW,
			offered: ALL
		});
		expect(segs).toEqual([
			{
				resolution: "month",
				start: new Date("2026-01-01T08:00:00Z"),
				end: new Date("2026-10-01T07:00:00Z")
			},
			{
				resolution: "day",
				start: new Date("2026-09-01T07:00:00Z"),
				end: new Date("2026-10-01T07:00:00Z"),
				aggregateTo: "month",
				backfill: true
			},
			{
				resolution: "day",
				start: new Date("2026-10-01T07:00:00Z"),
				end: new Date("2026-10-22T07:00:00Z"),
				aggregateTo: "month"
			},
			{
				resolution: "hour",
				start: new Date("2026-10-22T07:00:00Z"),
				end: NOW,
				aggregateTo: "month"
			}
		]);
	});

	it("range that ended in the past has a single segment", () => {
		const segs = planSegments({
			resolution: "month",
			range: range("2025-01-01T08:00:00Z", "2026-01-01T08:00:00Z", false),
			now: NOW,
			offered: ALL
		});
		expect(segs.map(iso)).toEqual([["2025-01-01T08:00:00.000Z", "2026-01-01T08:00:00.000Z"]]);
		expect(segs[0].aggregateTo).toBeUndefined();
	});

	it("hour request exactly on the hour has no raw fill, only the backfill", () => {
		const segs = planSegments({
			resolution: "hour",
			range: range("2026-10-21T07:00:00Z", "2026-10-23T07:00:00Z"),
			now: NOW,
			offered: ALL
		});
		expect(segs).toEqual([
			{ resolution: "hour", start: new Date("2026-10-21T07:00:00Z"), end: NOW },
			{
				resolution: "raw",
				start: new Date("2026-10-22T18:00:00Z"),
				end: NOW,
				aggregateTo: "hour",
				backfill: true
			}
		]);
	});

	it("hour request mid-hour: raw fills from the hour start", () => {
		const now = new Date("2026-10-22T19:20:00Z");
		const segs = planSegments({
			resolution: "hour",
			range: range("2026-10-21T07:00:00Z", "2026-10-23T07:00:00Z"),
			now,
			offered: ALL
		});
		expect(segs).toEqual([
			{
				resolution: "hour",
				start: new Date("2026-10-21T07:00:00Z"),
				end: new Date("2026-10-22T19:00:00Z")
			},
			{
				resolution: "raw",
				start: new Date("2026-10-22T18:00:00Z"),
				end: new Date("2026-10-22T19:00:00Z"),
				aggregateTo: "hour",
				backfill: true
			},
			{
				resolution: "raw",
				start: new Date("2026-10-22T19:00:00Z"),
				end: now,
				aggregateTo: "hour"
			}
		]);
	});

	it("backfills the last completed hour from raw at 10:20 PDT", () => {
		const now = new Date("2026-10-22T17:20:00Z");
		const segs = planSegments({
			resolution: "hour",
			range: range("2026-10-22T07:00:00Z", "2026-10-23T07:00:00Z"),
			now,
			offered: ALL
		});
		expect(segs.find((s) => s.backfill)).toEqual({
			resolution: "raw",
			start: new Date("2026-10-22T16:00:00Z"),
			end: new Date("2026-10-22T17:00:00Z"),
			aggregateTo: "hour",
			backfill: true
		});
	});

	it("day resolution just after midnight backfills yesterday from hourly", () => {
		const now = new Date("2026-10-22T07:20:00Z");
		const segs = planSegments({
			resolution: "day",
			range: range("2026-10-01T07:00:00Z", "2026-11-01T07:00:00Z"),
			now,
			offered: ALL
		});
		expect(segs).toEqual([
			{
				resolution: "day",
				start: new Date("2026-10-01T07:00:00Z"),
				end: new Date("2026-10-22T07:00:00Z")
			},
			{
				resolution: "hour",
				start: new Date("2026-10-21T07:00:00Z"),
				end: new Date("2026-10-22T07:00:00Z"),
				aggregateTo: "day",
				backfill: true
			},
			{
				resolution: "hour",
				start: new Date("2026-10-22T07:00:00Z"),
				end: now,
				aggregateTo: "day"
			}
		]);
	});

	it("month resolution on the 1st backfills last month from daily", () => {
		const now = new Date("2026-11-01T07:30:00Z");
		const segs = planSegments({
			resolution: "month",
			range: range("2026-01-01T08:00:00Z", "2027-01-01T08:00:00Z"),
			now,
			offered: ALL
		});
		expect(segs.find((s) => s.backfill)).toEqual({
			resolution: "day",
			start: new Date("2026-10-01T07:00:00Z"),
			end: new Date("2026-11-01T07:00:00Z"),
			aggregateTo: "month",
			backfill: true
		});
	});

	it("a range ending with the last completed period still gets the backfill", () => {
		const now = new Date("2026-10-22T07:20:00Z");
		const segs = planSegments({
			resolution: "day",
			range: range("2026-10-15T07:00:00Z", "2026-10-22T07:00:00Z", false),
			now,
			offered: ALL
		});
		expect(segs.map((s) => [s.resolution, s.backfill, ...iso(s)])).toEqual([
			["day", undefined, "2026-10-15T07:00:00.000Z", "2026-10-22T07:00:00.000Z"],
			["hour", true, "2026-10-21T07:00:00.000Z", "2026-10-22T07:00:00.000Z"]
		]);
	});

	it("no backfill without a finer offered level (regions at hour)", () => {
		const segs = planSegments({
			resolution: "hour",
			range: range("2026-10-22T07:00:00Z", "2026-10-23T07:00:00Z"),
			now: new Date("2026-10-22T17:20:00Z"),
			offered: ["hour", "day", "month"]
		});
		expect(segs.some((s) => s.backfill)).toBe(false);
	});

	it("skips finer levels that are not offered", () => {
		const segs = planSegments({
			resolution: "year",
			range: range("2026-01-01T08:00:00Z", "2027-01-01T08:00:00Z"),
			now: NOW,
			offered: ["day", "year"]
		});
		expect(segs.map((s) => [s.resolution, s.aggregateTo])).toEqual([["day", "year"]]);
		expect(segs[0].end).toEqual(NOW);
	});

	it("leaves the open period to the coarse segment when no finer level is offered", () => {
		const segs = planSegments({
			resolution: "month",
			range: range("2026-01-01T08:00:00Z", "2027-01-01T08:00:00Z"),
			now: NOW,
			offered: ["month"]
		});
		expect(segs).toEqual([
			{ resolution: "month", start: new Date("2026-01-01T08:00:00Z"), end: NOW }
		]);
	});

	it("range starting inside the open month clips the fills", () => {
		const segs = planSegments({
			resolution: "month",
			range: range("2026-10-15T07:00:00Z", "2026-10-23T07:00:00Z"),
			now: NOW,
			offered: ALL
		});
		expect(segs.map((s) => [s.resolution, ...iso(s)])).toEqual([
			["day", "2026-10-15T07:00:00.000Z", "2026-10-22T07:00:00.000Z"],
			["hour", "2026-10-22T07:00:00.000Z", "2026-10-22T19:00:00.000Z"]
		]);
	});

	it("raw has nothing to plan", () => {
		expect(
			planSegments({
				resolution: "raw",
				range: range("2026-10-21T07:00:00Z", "2026-10-23T07:00:00Z"),
				now: NOW,
				offered: ALL
			})
		).toEqual([]);
	});
});
