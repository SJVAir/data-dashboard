import { describe, expect, it } from "vitest";
import { CHUNK_DAYS, calendarUnits, runLimited, splitChunks } from "./chunks";
import { pacificDay } from "$lib/format";

describe("splitChunks", () => {
	it("covers the segment exactly with no gaps or overlaps", () => {
		const seg = {
			resolution: "day" as const,
			start: new Date("2024-10-01T07:00:00Z"),
			end: new Date("2026-10-22T07:00:00Z"),
			aggregateTo: "month" as const
		};
		const chunks = splitChunks(seg, 366);
		expect(chunks).toHaveLength(3);
		expect(chunks[0].start).toEqual(seg.start);
		expect(chunks[2].end).toEqual(seg.end);
		for (let i = 1; i < chunks.length; i++) expect(chunks[i].start).toEqual(chunks[i - 1].end);
		for (const c of chunks) {
			expect(c.resolution).toBe("day");
			expect(c.aggregateTo).toBe("month");
		}
	});

	it("returns a short segment unchanged", () => {
		const seg = {
			resolution: "hour" as const,
			start: new Date("2026-10-01T07:00:00Z"),
			end: new Date("2026-10-05T07:00:00Z")
		};
		expect(splitChunks(seg, 31)).toEqual([seg]);
	});

	it("matches the server hourly span cap", () => {
		expect(CHUNK_DAYS.raw).toBe(31);
	});
});

describe("runLimited", () => {
	it("never exceeds the limit and keeps order", async () => {
		let running = 0;
		let peak = 0;
		const tasks = Array.from({ length: 10 }, (_, i) => async () => {
			running++;
			peak = Math.max(peak, running);
			await new Promise((r) => setTimeout(r, 5 * ((i * 7) % 4)));
			running--;
			return i;
		});
		const out = await runLimited(tasks, 3);
		expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(peak).toBe(3);
	});

	it("rejects with the abort reason and stops starting tasks", async () => {
		const ac = new AbortController();
		let started = 0;
		const tasks = Array.from({ length: 6 }, () => async () => {
			started++;
			await new Promise((r) => setTimeout(r, 10));
		});
		const p = runLimited(tasks, 2, ac.signal);
		const reason = new Error("stop");
		ac.abort(reason);
		await expect(p).rejects.toBe(reason);
		await new Promise((r) => setTimeout(r, 40));
		expect(started).toBe(2);
	});

	it("rejects immediately when already aborted", async () => {
		const ac = new AbortController();
		ac.abort();
		let started = 0;
		await expect(runLimited([async () => started++], 1, ac.signal)).rejects.toBe(ac.signal.reason);
		expect(started).toBe(0);
	});

	it("propagates a task failure", async () => {
		await expect(
			runLimited([async () => 1, async () => Promise.reject(new Error("x"))], 1)
		).rejects.toThrow("x");
	});
});

describe("calendarUnits", () => {
	const at = (d: string) => pacificDay(d);

	it("splits a daily segment into whole months with the clipped part", () => {
		const seg = { resolution: "day" as const, start: at("2026-10-06"), end: at("2026-11-05") };
		const units = calendarUnits(seg);
		expect(units).toEqual([
			{
				fetchStart: at("2026-10-01"),
				fetchEnd: at("2026-11-01"),
				start: seg.start,
				end: at("2026-11-01")
			},
			{
				fetchStart: at("2026-11-01"),
				fetchEnd: at("2026-12-01"),
				start: at("2026-11-01"),
				end: seg.end
			}
		]);
	});

	it("uses whole years for monthly segments", () => {
		const seg = { resolution: "month" as const, start: at("2025-03-01"), end: at("2026-03-01") };
		const units = calendarUnits(seg);
		expect(units.map((u) => [u.fetchStart, u.fetchEnd])).toEqual([
			[at("2025-01-01"), at("2026-01-01")],
			[at("2026-01-01"), at("2027-01-01")]
		]);
		expect(units[0].start).toEqual(seg.start);
		expect(units[1].end).toEqual(seg.end);
	});

	it("is one unit for a yearly segment", () => {
		const seg = { resolution: "year" as const, start: at("2019-01-01"), end: at("2026-01-01") };
		expect(calendarUnits(seg)).toEqual([
			{ fetchStart: seg.start, fetchEnd: seg.end, start: seg.start, end: seg.end }
		]);
	});

	it("starts units at Pacific midnight across the November DST change", () => {
		const seg = { resolution: "hour" as const, start: at("2026-10-31"), end: at("2026-11-03") };
		const units = calendarUnits(seg);
		expect(units[1].fetchStart.toISOString()).toBe("2026-11-01T07:00:00.000Z");
		expect(units[1].fetchEnd.toISOString()).toBe("2026-12-01T08:00:00.000Z");
	});
});
