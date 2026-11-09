import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({ getMonitorAlertCurrent: vi.fn() }));

import { getMonitorAlertCurrent } from "@sjvair/sdk";
import { parseMinutes } from "../metadata";
import type { Level } from "../metadata";
import type { PlaceInfo } from "../types";
import {
	ALERT_TIMEOUT_MS,
	alertReading,
	alertSource,
	type AlertConfig,
	type AlertCurrent
} from "./alert";

const levels: Level[] = [
	{
		key: "good",
		label: "Good",
		color: null,
		opacity: null,
		tier: 0,
		guidance: "",
		description: "",
		min: 0,
		max: 12
	},
	{
		key: "moderate",
		label: "Moderate",
		color: null,
		opacity: null,
		tier: 1,
		guidance: "",
		description: "",
		min: 12,
		max: null
	}
];
const place: PlaceInfo = { place: "monitor:m1", name: "Roosevelt" };
const purpleAir: AlertConfig = { windowMinutes: 60, expectedIntervalMinutes: 2 };
const hourly: AlertConfig = { windowMinutes: 60, expectedIntervalMinutes: 60 };
const T1 = "2026-11-08T15:58:00-08:00";
const T0 = "2026-11-08T14:58:00-08:00";

function entry(over: Partial<AlertCurrent> = {}): AlertCurrent {
	return {
		status: "ok",
		value: 14.4,
		level: "moderate",
		window: { start: "2026-11-08T15:00:04-08:00", end: "2026-11-08T16:00:04-08:00" },
		latest_timestamp: T1,
		readings: 29,
		required: 15,
		previous: { status: "ok", value: 8, level: "good", latest_timestamp: T0 },
		evaluated_at: "2026-11-08T16:00:04-08:00",
		...over
	};
}

const read = (e: AlertCurrent, config = purpleAir) => alertReading(e, levels, config, place, 1);

describe("alertReading", () => {
	it("reads an ok result: value, the server's level, the reading's time, a window average", () => {
		const r = read(entry());
		expect(r).toMatchObject({
			status: "ok",
			value: 14.4,
			at: Date.parse(T1),
			trend: "rising",
			source: "alert",
			windowMinutes: 60,
			place
		});
		if (r.status === "ok") expect(r.level?.key).toBe("moderate");
	});

	it("is the latest reading when the monitor reports no more often than the window", () => {
		expect(read(entry(), hourly)).toMatchObject({ status: "ok", source: "alert-latest" });
	});

	it("falls back to the value's level when the server's key is not on the scale", () => {
		const r = read(entry({ level: "gone", value: 3 }));
		if (r.status === "ok") expect(r.level?.key).toBe("good");
	});

	it("counts a new reading by when it was evaluated, falling back to the reading's time", () => {
		expect(read(entry())).toMatchObject({
			at: Date.parse(T1),
			watchAt: Date.parse("2026-11-08T16:00:04-08:00")
		});
		expect(read(entry({ evaluated_at: null }))).toMatchObject({ watchAt: Date.parse(T1) });
		expect(read(entry({ evaluated_at: "soon" }))).toMatchObject({ watchAt: Date.parse(T1) });
	});

	it("maps the other statuses", () => {
		const empty = { value: null, level: null, window: null, latest_timestamp: null } as const;
		expect(read(entry({ status: "pending", ...empty }))).toEqual({ status: "pending", place });
		expect(read(entry({ status: "insufficient", ...empty }))).toEqual({
			status: "insufficient",
			place
		});
		expect(read(entry({ status: "no_data", ...empty }))).toEqual({ status: "no-recent", place });
	});

	it("is no-data for an ok result without a value or time", () => {
		expect(read(entry({ value: null })).status).toBe("no-data");
		expect(read(entry({ latest_timestamp: null })).status).toBe("no-data");
	});

	describe("trend", () => {
		it("is none without a previous result", () => {
			expect(read(entry({ previous: null }))).toMatchObject({ status: "ok", trend: null });
		});
		it("is none when the previous result has no timestamp key (older cache rows)", () => {
			const previous = { status: "ok", value: 8, level: "good" } as never;
			expect(read(entry({ previous }))).toMatchObject({ trend: null });
		});
		it("is none when the previous result is of the same reading", () => {
			const previous = { status: "ok", value: 8, level: "good", latest_timestamp: T1 } as const;
			expect(read(entry({ previous }))).toMatchObject({ trend: null });
		});
		it("is none when the previous result was not ok, even with a timestamp", () => {
			const previous = {
				status: "insufficient",
				value: null,
				level: null,
				latest_timestamp: T0
			} as const;
			expect(read(entry({ previous }))).toMatchObject({ trend: null });
		});
		it("rises, falls and is steady against an earlier ok result", () => {
			const p = (value: number) => ({
				status: "ok" as const,
				value,
				level: null,
				latest_timestamp: T0
			});
			expect(read(entry({ previous: p(8) }))).toMatchObject({ trend: "rising" });
			expect(read(entry({ previous: p(20) }))).toMatchObject({ trend: "falling" });
			expect(read(entry({ previous: p(14.41) }))).toMatchObject({ trend: "steady" });
		});
	});
});

describe("alertSource", () => {
	beforeEach(() => vi.resetAllMocks());

	it("is keyed by the monitor and polled every 3 minutes", async () => {
		const record = { pm25: entry() };
		vi.mocked(getMonitorAlertCurrent).mockResolvedValue(record);
		const source = alertSource("m1");
		expect(source).toMatchObject({ key: "alert:m1", cadence: "raw" });
		const signal = new AbortController().signal;
		expect(await source.fetch(signal)).toBe(record);
		expect(getMonitorAlertCurrent).toHaveBeenCalledWith("m1", {
			signal: expect.any(AbortSignal)
		});
	});

	it("fails a request that takes longer than the timeout, aborting it", async () => {
		vi.useFakeTimers();
		try {
			let sent: AbortSignal | undefined;
			vi.mocked(getMonitorAlertCurrent).mockImplementation((_id, options) => {
				sent = options?.signal ?? undefined;
				return new Promise(() => {});
			});
			const result = alertSource("m1").fetch(new AbortController().signal);
			const failed = expect(result).rejects.toThrow("timed out");
			await vi.advanceTimersByTimeAsync(ALERT_TIMEOUT_MS);
			await failed;
			expect(sent?.aborted).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("aborts the request when the caller aborts, and never times out after an answer", async () => {
		vi.useFakeTimers();
		try {
			const caller = new AbortController();
			let sent: AbortSignal | undefined;
			vi.mocked(getMonitorAlertCurrent).mockImplementation((_id, options) => {
				sent = options?.signal ?? undefined;
				return new Promise(() => {});
			});
			const aborted = expect(alertSource("m1").fetch(caller.signal)).rejects.toThrow("aborted");
			caller.abort();
			await aborted;
			expect(sent?.aborted).toBe(true);
			vi.mocked(getMonitorAlertCurrent).mockResolvedValue({});
			await expect(alertSource("m1").fetch(new AbortController().signal)).resolves.toEqual({});
			await vi.advanceTimersByTimeAsync(ALERT_TIMEOUT_MS);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("parseMinutes", () => {
	it("reads the meta's durations", () => {
		expect(parseMinutes("60 min")).toBe(60);
		expect(parseMinutes("1h")).toBe(60);
		expect(parseMinutes("1 hour")).toBe(60);
		expect(parseMinutes("30 minutes")).toBe(30);
		expect(parseMinutes("90s")).toBe(1.5);
	});
	it("is null for nothing, zero, or something else", () => {
		expect(parseMinutes(null)).toBeNull();
		expect(parseMinutes("")).toBeNull();
		expect(parseMinutes("0 min")).toBeNull();
		expect(parseMinutes("soon")).toBeNull();
		expect(parseMinutes("5 fortnights")).toBeNull();
	});
});
