import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({
	getMonitorSummariesBulkDaily: vi.fn(),
	getMonitorSummariesBulkMonthly: vi.fn(),
	getMonitorSummariesBulkYearly: vi.fn()
}));

import {
	getMonitorSummariesBulkDaily,
	getMonitorSummariesBulkMonthly,
	getMonitorSummariesBulkYearly
} from "@sjvair/sdk";
import { pacificDay } from "$lib/format";
import type { Figure, Level } from "../metadata";
import { monitorDaySource, monitorPeriodSource } from "./monitors";
import type { MonitorScope, Snapshot } from "./types";

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
const stub = vi.mocked(getMonitorSummariesBulkDaily) as unknown as ReturnType<typeof vi.fn>;

function source(over: { scope?: MonitorScope; figure?: Figure | null } = {}) {
	return monitorDaySource({
		entryType: "pm25",
		day: DAY,
		scope: over.scope ?? { kind: "all" },
		scopeKey: "all",
		figure: over.figure === undefined ? figure : over.figure,
		levels,
		today: () => TODAY
	});
}

const signal = new AbortController().signal;

beforeEach(() => {
	stub.mockReset();
	stub.mockResolvedValue([
		{ id: "a", summaries: [row(DAY, 5)] },
		{ id: "b", summaries: [row(DAY, 20)] }
	]);
});

describe("monitorDaySource", () => {
	it("keys by entry type, scope and day, on the hourly cadence", () => {
		const s = source();
		expect(s.key).toBe("snapshot:monitors:pm25:all:2026-11-09");
		expect(s.cadence).toBe("hour");
	});

	it("requests the one day, with no region for all", async () => {
		await source().fetch(signal);
		expect(stub).toHaveBeenCalledTimes(1);
		expect(stub).toHaveBeenCalledWith({ entryType: "pm25", start: DAY, end: DAY }, { signal });
	});

	it("sends the region ids for a regions scope", async () => {
		await source({ scope: { kind: "regions", ids: ["r1", "r2"] } }).fetch(signal);
		expect(stub.mock.calls[0][0]).toEqual({
			entryType: "pm25",
			start: DAY,
			end: DAY,
			region: ["r1", "r2"]
		});
	});

	it("filters a monitors scope to its ids, requesting unscoped", async () => {
		const snap = await source({ scope: { kind: "monitors", ids: ["b"] } }).fetch(signal);
		expect(stub.mock.calls[0][0]).not.toHaveProperty("region");
		expect([...snap.figures.keys()]).toEqual(["b"]);
	});

	it("reads the figure field and its level", async () => {
		const snap = await source().fetch(signal);
		expect(snap.figures.get("a")).toEqual({ value: 5, level: levels[0], kind: "rated" });
		expect(snap.figures.get("b")).toEqual({ value: 20, level: levels[1], kind: "rated" });
		expect(snap.final).toBe(true);
		expect(snap.unrated).toBe(false);
	});

	it("marks a not-final row pending and the snapshot not final", async () => {
		stub.mockResolvedValue([{ id: "a", summaries: [row(DAY, 5, false)] }]);
		const snap = await source().fetch(signal);
		expect(snap.figures.get("a")?.kind).toBe("pending");
		expect(snap.final).toBe(false);
	});

	it("treats a day equal to today as today, never final", async () => {
		stub.mockResolvedValue([{ id: "a", summaries: [row(TODAY, 5)] }]);
		const snap = await monitorDaySource({
			entryType: "pm25",
			day: TODAY,
			scope: { kind: "all" },
			scopeKey: "all",
			figure,
			levels,
			today: () => TODAY
		}).fetch(signal);
		expect(snap.figures.get("a")?.kind).toBe("today");
		expect(snap.final).toBe(false);
	});

	it("marks a null field thin", async () => {
		stub.mockResolvedValue([{ id: "a", summaries: [row(DAY, null)] }]);
		const snap = await source().fetch(signal);
		expect(snap.figures.get("a")).toEqual({ value: null, level: null, kind: "thin" });
	});

	it("leaves out a monitor with no row for the day, ignoring other days", async () => {
		stub.mockResolvedValue([
			{ id: "a", summaries: [row("2026-11-08", 30)] },
			{ id: "b", summaries: [row("2026-11-08", 30), row(DAY, 7)] },
			{ id: "c", summaries: [] }
		]);
		const snap = await source().fetch(signal);
		expect([...snap.figures.keys()]).toEqual(["b"]);
		expect(snap.figures.get("b")?.value).toBe(7);
	});

	it("is unrated with no figure", async () => {
		const snap = await source({ figure: null }).fetch(signal);
		expect(snap.unrated).toBe(true);
		for (const f of snap.figures.values()) {
			expect(f).toEqual({ value: null, level: null, kind: "unrated" });
		}
	});

	it("polls until the snapshot is final", () => {
		const s = source();
		const snap = (final: boolean): Snapshot => ({ figures: new Map(), final, unrated: false });
		expect(s.poll(snap(true))).toBe(false);
		expect(s.poll(snap(false))).toBe(true);
		expect(s.poll(undefined)).toBe(true);
	});
});

describe("monitorPeriodSource", () => {
	const monthly = vi.mocked(getMonitorSummariesBulkMonthly) as unknown as ReturnType<typeof vi.fn>;
	const yearly = vi.mocked(getMonitorSummariesBulkYearly) as unknown as ReturnType<typeof vi.fn>;
	const periodFigure: Figure = {
		field: "daily_statistic_mean",
		label: "Average of 24-hour averages"
	};
	const OCT = { start: "2026-10-01", resolution: "month" } as const;
	const periodRow = (start: string, mean: number | null, is_final = true) => ({
		timestamp: pacificDay(start).toISOString(),
		is_final,
		mean: 99,
		daily_statistic_mean: mean
	});

	function period(
		over: {
			at?: { start: string; resolution: "month" | "year" };
			figure?: Figure | null;
			scope?: MonitorScope;
			today?: string;
		} = {}
	) {
		return monitorPeriodSource({
			entryType: "pm25",
			at: over.at ?? OCT,
			scope: over.scope ?? { kind: "all" },
			scopeKey: "all",
			figure: over.figure === undefined ? periodFigure : over.figure,
			levels,
			today: () => over.today ?? TODAY
		});
	}

	beforeEach(() => {
		monthly.mockReset();
		yearly.mockReset();
		monthly.mockResolvedValue([
			{ id: "a", summaries: [periodRow("2026-10-01", 5)] },
			{ id: "b", summaries: [periodRow("2026-10-01", 20)] }
		]);
	});

	it("keys by entry type, scope and period, on the hourly cadence", () => {
		expect(period().key).toBe("snapshot:monitors:pm25:all:month:2026-10-01");
		expect(period().cadence).toBe("hour");
	});

	it("reads the bulk monthly summaries for the whole month, with the regions scope", async () => {
		await period({ scope: { kind: "regions", ids: ["r1"] } }).fetch(signal);
		expect(stub).not.toHaveBeenCalled();
		expect(monthly).toHaveBeenCalledWith(
			{ entryType: "pm25", start: "2026-10-01", end: "2026-10-31", region: ["r1"] },
			{ signal }
		);
	});

	it("reads the bulk yearly summaries for a year stop", async () => {
		yearly.mockResolvedValue([{ id: "a", summaries: [periodRow("2025-01-01", 8)] }]);
		const snap = await period({ at: { start: "2025-01-01", resolution: "year" } }).fetch(signal);
		expect(monthly).not.toHaveBeenCalled();
		expect(yearly).toHaveBeenCalledWith(
			{ entryType: "pm25", start: "2025-01-01", end: "2025-12-31" },
			{ signal }
		);
		expect(snap.figures.get("a")).toEqual({ value: 8, level: levels[0], kind: "rated" });
	});

	it("colours the period's figure (daily_statistic_mean) by the daily scale's levels", async () => {
		const snap = await period().fetch(signal);
		expect(snap.figures.get("a")).toEqual({ value: 5, level: levels[0], kind: "rated" });
		expect(snap.figures.get("b")).toEqual({ value: 20, level: levels[1], kind: "rated" });
		expect(snap.final).toBe(true);
		expect(snap.unrated).toBe(false);
	});

	it("a null figure (fewer than 75% of the days had one) is thin, final or not", async () => {
		monthly.mockResolvedValue([
			{ id: "a", summaries: [periodRow("2026-10-01", null)] },
			{ id: "b", summaries: [periodRow("2026-10-01", null, false)] }
		]);
		const snap = await period().fetch(signal);
		expect(snap.figures.get("a")).toEqual({ value: null, level: null, kind: "thin" });
		expect(snap.figures.get("b")).toEqual({ value: null, level: null, kind: "thin" });
	});

	it("a not-final row is pending, and the snapshot not final (it polls)", async () => {
		monthly.mockResolvedValue([{ id: "a", summaries: [periodRow("2026-10-01", 5, false)] }]);
		const s = period();
		const snap = await s.fetch(signal);
		expect(snap.figures.get("a")?.kind).toBe("pending");
		expect(snap.final).toBe(false);
		expect(s.poll(snap)).toBe(true);
	});

	it("the current month is never final, even before its first nightly row", async () => {
		const NOV = { start: "2026-11-01", resolution: "month" } as const;
		monthly.mockResolvedValue([]);
		const s = period({ at: NOV, today: "2026-11-01" });
		const snap = await s.fetch(signal);
		// No row yet (the 1st, before the nightly run): no data, the usual way.
		expect(snap.figures.size).toBe(0);
		expect(snap.final).toBe(false);
		expect(s.poll(snap)).toBe(true);
	});

	it("leaves out a monitor with no row for the period, and filters a monitors scope", async () => {
		monthly.mockResolvedValue([
			{ id: "a", summaries: [periodRow("2026-09-01", 5)] },
			{ id: "b", summaries: [periodRow("2026-10-01", 7)] },
			{ id: "c", summaries: [periodRow("2026-10-01", 7)] }
		]);
		const snap = await period({ scope: { kind: "monitors", ids: ["a", "b"] } }).fetch(signal);
		expect(monthly.mock.calls[0][0]).not.toHaveProperty("region");
		expect([...snap.figures.keys()]).toEqual(["b"]);
	});

	it("is unrated when the scale names no period figure", async () => {
		const snap = await period({ figure: null }).fetch(signal);
		expect(snap.unrated).toBe(true);
		expect(snap.figures.get("a")).toEqual({ value: null, level: null, kind: "unrated" });
	});
});
