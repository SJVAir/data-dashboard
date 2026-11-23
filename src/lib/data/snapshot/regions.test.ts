import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({
	getRegionSummariesBulkDaily: vi.fn(),
	getRegionSummariesBulkDailyOpen: vi.fn(),
	getRegionSummariesBulkMonthly: vi.fn(),
	getRegionSummariesBulkYearly: vi.fn()
}));

import {
	getRegionSummariesBulkDaily,
	getRegionSummariesBulkDailyOpen,
	getRegionSummariesBulkMonthly,
	getRegionSummariesBulkYearly
} from "@sjvair/sdk";
import { pacificDay } from "$lib/format";
import type { Figure, Level } from "../metadata";
import {
	fillableTypes,
	isRegionSummaryBulkType,
	regionDaySource,
	regionPeriodSource,
	regionTodaySource
} from "./regions";
import type { Snapshot } from "./types";

const level = (key: string, min: number, max: number | null, tier: number): Level => ({
	key,
	label: key,
	color: null,
	opacity: null,
	tier,
	guidance: "",
	description: "",
	min,
	max
});
const levels = [level("good", 0, 9.1, 0), level("moderate", 9.1, null, 1)];
const figure: Figure = { field: "mean_24h", label: "24-hour average" };
const DAY = "2026-11-09";
const TODAY = "2026-11-12";

const row = (day: string, mean: number | null, is_final = true) => ({
	timestamp: pacificDay(day).toISOString(),
	is_final,
	mean_24h: mean
});
const daily = vi.mocked(getRegionSummariesBulkDaily) as unknown as ReturnType<typeof vi.fn>;
const open = vi.mocked(getRegionSummariesBulkDailyOpen) as unknown as ReturnType<typeof vi.fn>;
const codes = (sqid: string) => ({ r1: "93721", r2: "93722" })[sqid as "r1" | "r2"];
const signal = new AbortController().signal;

const base = {
	entryType: "pm25",
	regionType: "zipcode",
	figure,
	levels,
	today: () => TODAY,
	codes
};

beforeEach(() => {
	daily.mockReset();
	open.mockReset();
	daily.mockResolvedValue([
		{ id: "r1", summaries: [row(DAY, 5)] },
		{ id: "r2", summaries: [row(DAY, 20)] }
	]);
});

describe("regionDaySource", () => {
	it("keys by entry type, region type and day, on the hourly cadence", () => {
		const s = regionDaySource({ ...base, day: DAY });
		expect(s.key).toBe("snapshot:regions:pm25:zipcode:2026-11-09");
		expect(s.cadence).toBe("hour");
	});

	it("makes one request with the type and no region", async () => {
		await regionDaySource({ ...base, day: DAY }).fetch(signal);
		expect(daily).toHaveBeenCalledTimes(1);
		expect(daily).toHaveBeenCalledWith(
			{ entryType: "pm25", start: DAY, end: DAY, type: "zipcode" },
			{ signal }
		);
		expect(daily.mock.calls[0][0]).not.toHaveProperty("region");
	});

	it("keys figures type:code and rates them", async () => {
		const snap = await regionDaySource({ ...base, day: DAY }).fetch(signal);
		expect(snap.figures.get("zipcode:93721")).toEqual({
			value: 5,
			level: levels[0],
			kind: "rated"
		});
		expect(snap.figures.get("zipcode:93722")?.level).toBe(levels[1]);
		expect(snap.final).toBe(true);
	});

	it("leaves out a region with no external id or no row for the day", async () => {
		daily.mockResolvedValue([
			{ id: "r1", summaries: [row("2026-11-08", 5)] },
			{ id: "unknown", summaries: [row(DAY, 5)] },
			{ id: "r2", summaries: [row(DAY, 7)] }
		]);
		const snap = await regionDaySource({ ...base, day: DAY }).fetch(signal);
		expect([...snap.figures.keys()]).toEqual(["zipcode:93722"]);
	});

	it("marks a not-final row pending and the snapshot not final", async () => {
		daily.mockResolvedValue([{ id: "r1", summaries: [row(DAY, 5, false)] }]);
		const snap = await regionDaySource({ ...base, day: DAY }).fetch(signal);
		expect(snap.figures.get("zipcode:93721")?.kind).toBe("pending");
		expect(snap.final).toBe(false);
	});

	it("is an empty snapshot for an empty type", async () => {
		daily.mockResolvedValue([]);
		const snap = await regionDaySource({ ...base, day: DAY }).fetch(signal);
		expect(snap.figures.size).toBe(0);
	});

	it("requests nothing for a type the bulk summaries do not take", async () => {
		const snap = await regionDaySource({ ...base, regionType: "land_use", day: DAY }).fetch(signal);
		expect(daily).not.toHaveBeenCalled();
		expect(snap.figures.size).toBe(0);
	});

	it("polls until the snapshot is final", () => {
		const s = regionDaySource({ ...base, day: DAY });
		const snap = (final: boolean): Snapshot => ({ figures: new Map(), final, unrated: false });
		expect(s.poll(snap(true))).toBe(false);
		expect(s.poll(snap(false))).toBe(true);
		expect(s.poll(undefined)).toBe(true);
	});
});

describe("regionTodaySource", () => {
	beforeEach(() => {
		open.mockResolvedValue([
			{ id: "r1", summaries: [row("2026-11-11", 30), row(TODAY, 6, false)] },
			{ id: "r2", summaries: [row("2026-11-11", 30)] }
		]);
	});

	it("keys by today's date, polls always, and requests the open days by type", async () => {
		const s = regionTodaySource(base);
		expect(s.key).toBe(`snapshot:regions:pm25:zipcode:today:${TODAY}`);
		expect(s.cadence).toBe("hour");
		expect(s.poll()).toBe(true);
		await s.fetch(signal);
		expect(open).toHaveBeenCalledWith({ entryType: "pm25", type: "zipcode" }, { signal });
	});

	it("reads only today's row and is never final", async () => {
		const snap = await regionTodaySource(base).fetch(signal);
		expect([...snap.figures.keys()]).toEqual(["zipcode:93721"]);
		expect(snap.figures.get("zipcode:93721")).toEqual({
			value: 6,
			level: levels[0],
			kind: "today"
		});
		expect(snap.final).toBe(false);
	});
});

describe("regionPeriodSource", () => {
	const monthly = vi.mocked(getRegionSummariesBulkMonthly) as unknown as ReturnType<typeof vi.fn>;
	const yearly = vi.mocked(getRegionSummariesBulkYearly) as unknown as ReturnType<typeof vi.fn>;
	const periodFigure: Figure = { field: "daily_statistic_mean", label: "Average" };
	const periodRow = (start: string, mean: number | null, is_final = true) => ({
		timestamp: pacificDay(start).toISOString(),
		is_final,
		daily_statistic_mean: mean
	});
	const OCT = { start: "2026-10-01", resolution: "month" } as const;
	const args = { ...base, figure: periodFigure };

	beforeEach(() => {
		monthly.mockReset();
		yearly.mockReset();
		monthly.mockResolvedValue([
			{ id: "r1", summaries: [periodRow("2026-10-01", 5)] },
			{ id: "r2", summaries: [periodRow("2026-10-01", null)] }
		]);
	});

	it("keys by period and reads the bulk monthly summaries for the month, by type", async () => {
		const s = regionPeriodSource({ ...args, at: OCT });
		expect(s.key).toBe("snapshot:regions:pm25:zipcode:month:2026-10-01");
		const snap = await s.fetch(signal);
		expect(daily).not.toHaveBeenCalled();
		expect(monthly).toHaveBeenCalledWith(
			{ entryType: "pm25", start: "2026-10-01", end: "2026-10-31", type: "zipcode" },
			{ signal }
		);
		expect(snap.figures.get("zipcode:93721")).toEqual({
			value: 5,
			level: levels[0],
			kind: "rated"
		});
		expect(snap.figures.get("zipcode:93722")).toEqual({ value: null, level: null, kind: "thin" });
		expect(snap.final).toBe(true);
		expect(s.poll(snap)).toBe(false);
	});

	it("reads the bulk yearly summaries for a year; the current year polls while not final", async () => {
		yearly.mockResolvedValue([{ id: "r1", summaries: [periodRow("2026-01-01", 6, false)] }]);
		const s = regionPeriodSource({ ...args, at: { start: "2026-01-01", resolution: "year" } });
		const snap = await s.fetch(signal);
		expect(yearly).toHaveBeenCalledWith(
			{ entryType: "pm25", start: "2026-01-01", end: "2026-12-31", type: "zipcode" },
			{ signal }
		);
		expect(snap.figures.get("zipcode:93721")?.kind).toBe("pending");
		expect(snap.final).toBe(false);
		expect(s.poll(snap)).toBe(true);
	});

	it("requests nothing for a type the bulk summaries do not take", async () => {
		const snap = await regionPeriodSource({ ...args, regionType: "land_use", at: OCT }).fetch(
			signal
		);
		expect(monthly).not.toHaveBeenCalled();
		expect(snap.figures.size).toBe(0);
	});
});

describe("fillableTypes", () => {
	it("keeps the types the bulk summaries take, in order", () => {
		const types = ["zipcode", "land_use", "county", "nope"].map((type) => ({ type }));
		expect(fillableTypes(types)).toEqual([{ type: "zipcode" }, { type: "county" }]);
	});
});

describe("isRegionSummaryBulkType", () => {
	it("accepts bulk types and rejects land_use, place and unknown values", () => {
		expect(isRegionSummaryBulkType("tract")).toBe(true);
		for (const t of ["land_use", "place", "nope"]) expect(isRegionSummaryBulkType(t)).toBe(false);
	});
});
