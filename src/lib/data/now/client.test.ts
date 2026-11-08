import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryActivity } from "$lib/platform/memory";
import { createNowClient, type NowSource, type NowState } from "./client";

const NOW = new Date("2026-10-22T19:10:00Z");

function source(overrides: Partial<NowSource<number>> = {}) {
	let n = 0;
	const fetch = vi.fn(async () => ++n);
	const src: NowSource<number> = { key: "a", cadence: "raw", fetch, ...overrides };
	return { src, fetch };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers({ now: NOW }));
afterEach(() => vi.useRealTimers());

describe("createNowClient", () => {
	it("fetches once for two subscribers to one key", async () => {
		const client = createNowClient({ now: () => new Date() });
		const { src, fetch } = source();
		const a: NowState<number>[] = [];
		const b: NowState<number>[] = [];
		client.subscribe(src, (s) => a.push(s));
		client.subscribe(src, (s) => b.push(s));
		await flush();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(a.at(-1)).toMatchObject({ status: "ready", data: 1 });
		expect(b.at(-1)).toMatchObject({ status: "ready", data: 1 });
	});

	it("ignores refetch while in flight", async () => {
		const client = createNowClient({});
		const { src, fetch } = source();
		client.subscribe(src, () => {});
		client.refetch("a");
		await flush();
		expect(fetch).toHaveBeenCalledTimes(1);
		client.refetch("a");
		await flush();
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("keeps the last data on error and retry refetches", async () => {
		const client = createNowClient({});
		let fail = false;
		const fetch = vi.fn(async () => {
			if (fail) throw new Error("boom");
			return 7;
		});
		const states: NowState<number>[] = [];
		const sub = client.subscribe({ key: "a", cadence: "raw", fetch }, (s) => states.push(s));
		await flush();
		fail = true;
		client.refetch("a");
		await flush();
		expect(states.at(-1)).toMatchObject({ status: "error", data: 7 });
		fail = false;
		sub.retry();
		await flush();
		expect(states.at(-1)).toMatchObject({ status: "ready", data: 7 });
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it("gives a late subscriber the cached state without refetching", async () => {
		const client = createNowClient({});
		const { src, fetch } = source();
		client.subscribe(src, () => {});
		await flush();
		const late: NowState<number>[] = [];
		client.subscribe(src, (s) => late.push(s));
		expect(late.at(-1)).toMatchObject({ status: "ready", data: 1 });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("aborts an in-flight fetch when the last subscriber leaves, and stops polling", async () => {
		const activity = createMemoryActivity();
		const client = createNowClient({ activity });
		let signal!: AbortSignal;
		const fetch = vi.fn((s: AbortSignal) => {
			signal = s;
			return new Promise<number>(() => {});
		});
		const one = client.subscribe({ key: "a", cadence: "raw", fetch }, () => {});
		const two = client.subscribe({ key: "a", cadence: "raw", fetch }, () => {});
		one.unsubscribe();
		expect(signal.aborted).toBe(false);
		two.unsubscribe();
		expect(signal.aborted).toBe(true);
		expect(client.entries()[0]).toMatchObject({ subscribers: 0, inFlight: false });
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("reports now entries to the poller, which refetches raw after 3 minutes", async () => {
		const activity = createMemoryActivity();
		const client = createNowClient({ activity });
		const { src, fetch } = source();
		client.subscribe(src, () => {});
		await flush();
		expect(client.entries()[0]).toMatchObject({
			key: "a",
			includesNow: true,
			resolution: "raw",
			subscribers: 1,
			polling: true,
			failed: false
		});
		await vi.advanceTimersByTimeAsync(179_000);
		expect(fetch).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("does not poll while polling is off", async () => {
		const client = createNowClient({ activity: createMemoryActivity() });
		const { src, fetch } = source();
		const sub = client.subscribe(src, () => {});
		await flush();
		sub.setPolling(false);
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("reports hour cadence as the hour resolution", async () => {
		const client = createNowClient({});
		client.subscribe(source({ cadence: "hour" }).src, () => {});
		expect(client.entries()[0].resolution).toBe("hour");
	});

	it("drops idle entries whose last fetch is over an hour old", async () => {
		let t = NOW.getTime();
		const client = createNowClient({ now: () => new Date(t) });
		const { src } = source();
		const sub = client.subscribe(src, () => {});
		await flush();
		sub.unsubscribe();
		expect(client.entries()).toHaveLength(1);
		t += 61 * 60_000;
		client.subscribe(source({ key: "b" }).src, () => {}).unsubscribe();
		expect(client.entries().map((e) => e.key)).toEqual(["b"]);
	});
});
