import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryActivity } from "$lib/platform/memory";
import type { DatasetAdapter, RegionResolver } from "../adapters/registry";
import type { DateRangeSpec } from "../schema";
import { fixtureMetadata } from "../testing/fixtures";
import type { QueryData, QueryInput } from "../types";
import { createQueryClient } from "./client";
import { backoffDelay, nextPollDelay } from "./poller";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// 12:10 PDT, so the next :55 is 45 minutes away.
const NOW = new Date("2026-10-22T19:10:00Z");

describe("nextPollDelay", () => {
	it("polls raw data every 3 minutes", () => {
		expect(nextPollDelay("raw", NOW)).toBe(180_000);
	});

	it("waits until the next :55 Pacific for other resolutions", () => {
		expect(nextPollDelay("hour", NOW)).toBe(45 * MINUTE);
		expect(nextPollDelay("day", new Date("2026-10-22T19:55:00Z"))).toBe(60 * MINUTE);
	});
});

describe("backoffDelay", () => {
	it("doubles from 30 seconds and caps at 30 minutes", () => {
		expect(backoffDelay(1)).toBe(30_000);
		expect(backoffDelay(2)).toBe(60_000);
		expect(backoffDelay(8)).toBe(1_800_000);
	});
});

const regions: RegionResolver = { resolve: async () => "unsupported" };

function setup() {
	const calls: { key: string; resolution: string }[] = [];
	const mode = { fail: false };
	const adapter: DatasetAdapter = {
		id: "air-quality",
		async target(layer) {
			if (layer.place?.kind === "monitor") return { kind: "monitors", ids: [layer.place.id] };
			return { unavailable: "place-unsupported" };
		},
		offered: (base) => base,
		async fetch(req) {
			calls.push({
				key: `${req.range.firstDate}/${req.range.lastDate}`,
				resolution: req.resolution
			});
			if (mode.fail) throw new Error("server down");
			const data: QueryData = {
				series: [],
				resolution: req.resolution,
				fromRaw: false,
				processor: null,
				fetchedAt: Date.now()
			};
			return data;
		}
	};
	const activity = createMemoryActivity();
	const client = createQueryClient({
		adapters: [adapter],
		metadata: fixtureMetadata(),
		regions,
		activity
	});
	return { client, calls, mode, activity };
}

function input(dateRange: DateRangeSpec): QueryInput {
	return {
		layer: { dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: "m-pa" } },
		dateRange
	};
}

const WEEK: DateRangeSpec = { kind: "trailing", amount: 7, unit: "day" };
const ignore = () => {};
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("startPoller", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("polls only ranges that include now", async () => {
		const { client, calls } = setup();
		client.subscribe(input(WEEK), ignore);
		client.subscribe(input({ kind: "custom", start: "2026-01-01", end: "2026-01-07" }), ignore);
		client.subscribe(input({ kind: "trailing", amount: 1, unit: "day" }), ignore);
		await flush();
		expect(calls).toHaveLength(3);
		const past = calls.find((c) => c.key.startsWith("2026-01-01"));
		expect(past).toBeDefined();

		// Raw polls every 3 minutes.
		await vi.advanceTimersByTimeAsync(3 * MINUTE);
		expect(calls).toHaveLength(4);
		expect(calls[3].resolution).toBe("raw");

		// The hourly entry polls at 12:55 PDT; by then raw has polled 15 times in all.
		await vi.advanceTimersByTimeAsync(42 * MINUTE);
		const hourly = calls.filter((c) => c.resolution === "hour" && c !== past);
		expect(hourly).toHaveLength(2);
		expect(calls.filter((c) => c.resolution === "raw")).toHaveLength(16);
		expect(calls.filter((c) => c.key.startsWith("2026-01-01"))).toHaveLength(1);
	});

	it("stops when the last subscriber leaves", async () => {
		const { client, calls } = setup();
		const a = client.subscribe(input(WEEK), ignore);
		const b = client.subscribe(input(WEEK), ignore);
		await flush();
		expect(calls).toHaveLength(1);

		a.unsubscribe();
		await vi.advanceTimersByTimeAsync(45 * MINUTE);
		expect(calls).toHaveLength(2);

		b.unsubscribe();
		await vi.advanceTimersByTimeAsync(5 * HOUR);
		expect(calls).toHaveLength(2);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("setPolling(false) pauses one subscription's entry only when no other subscriber polls it", async () => {
		const { client, calls } = setup();
		const a = client.subscribe(input(WEEK), ignore);
		const b = client.subscribe(input(WEEK), ignore);
		await flush();

		a.setPolling(false);
		await vi.advanceTimersByTimeAsync(45 * MINUTE);
		expect(calls).toHaveLength(2);

		b.setPolling(false);
		await vi.advanceTimersByTimeAsync(3 * HOUR);
		expect(calls).toHaveLength(2);
		expect(vi.getTimerCount()).toBe(0);

		// The last fetch (12:55 PDT) is hours old: polling again refetches at once.
		b.setPolling(true);
		await flush();
		expect(calls).toHaveLength(3);
		// Then 16:55 PDT is next, 60 minutes on.
		await vi.advanceTimersByTimeAsync(59 * MINUTE);
		expect(calls).toHaveLength(3);
		await vi.advanceTimersByTimeAsync(1 * MINUTE);
		expect(calls).toHaveLength(4);
	});

	it("an entry pollable again is scheduled from its last fetch", async () => {
		const { client, calls } = setup();
		const a = client.subscribe(input(WEEK), ignore);
		await flush();
		a.unsubscribe();

		// Back 10 minutes later: due at 12:55 as before.
		await vi.advanceTimersByTimeAsync(10 * MINUTE);
		const b = client.subscribe(input(WEEK), ignore);
		await flush();
		expect(calls).toHaveLength(1);
		b.unsubscribe();

		// Back 2 hours later, the same day: the cached data is overdue, so it refetches at once.
		await vi.advanceTimersByTimeAsync(2 * HOUR);
		client.subscribe(input(WEEK), ignore);
		await flush();
		expect(calls).toHaveLength(2);
	});

	it("paused while hidden", async () => {
		const { client, calls, activity } = setup();
		client.subscribe(input(WEEK), ignore);
		client.subscribe(input({ kind: "trailing", amount: 1, unit: "day" }), ignore);
		await flush();
		expect(calls).toHaveLength(2);

		activity.setVisible(false);
		await vi.advanceTimersByTimeAsync(2 * HOUR);
		expect(calls).toHaveLength(2);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("one catch-up poll after a long hidden period", async () => {
		const { client, calls, activity } = setup();
		client.subscribe(input(WEEK), ignore);
		await flush();
		activity.setVisible(false);
		await vi.advanceTimersByTimeAsync(10 * HOUR);
		expect(calls).toHaveLength(1);

		activity.setVisible(true);
		await flush();
		expect(calls).toHaveLength(2);

		// Then back on the cadence: 22:10 PDT, so next at 22:55.
		await vi.advanceTimersByTimeAsync(44 * MINUTE);
		expect(calls).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(1 * MINUTE);
		expect(calls).toHaveLength(3);
	});

	it("does not poll on becoming visible when nothing is due", async () => {
		const { client, calls, activity } = setup();
		client.subscribe(input(WEEK), ignore);
		await flush();
		activity.setVisible(false);
		await vi.advanceTimersByTimeAsync(10 * MINUTE);
		activity.setVisible(true);
		await flush();
		expect(calls).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(35 * MINUTE);
		expect(calls).toHaveLength(2);
	});

	it("backs off after failures and resets on success", async () => {
		const { client, calls, mode } = setup();
		client.subscribe(input(WEEK), ignore);
		await flush();

		mode.fail = true;
		await vi.advanceTimersByTimeAsync(45 * MINUTE); // 12:55:00, fails
		expect(calls).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(30_000); // 12:55:30, fails
		expect(calls).toHaveLength(3);
		await vi.advanceTimersByTimeAsync(59_000);
		expect(calls).toHaveLength(3);
		await vi.advanceTimersByTimeAsync(1_000); // 12:56:30, fails
		expect(calls).toHaveLength(4);

		mode.fail = false;
		await vi.advanceTimersByTimeAsync(120_000); // 12:58:30, succeeds
		expect(calls).toHaveLength(5);

		// Back on the cadence: nothing until 13:55.
		await vi.advanceTimersByTimeAsync(56 * MINUTE);
		expect(calls).toHaveLength(5);
		await vi.advanceTimersByTimeAsync(31 * 1_000);
		expect(calls).toHaveLength(6);
	});
});
