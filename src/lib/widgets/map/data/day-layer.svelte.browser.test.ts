import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryActivity } from "$lib/platform/memory";
import { createNowClient, type NowSource } from "$lib/data/now/client";
import type { SnapshotAt } from "$lib/data/snapshot";
import { DayLayer } from "./day-layer.svelte";

const NOW = new Date("2026-11-16T19:10:00Z");
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers({ now: NOW }));
afterEach(() => vi.useRealTimers());

function setup(opts: { fail?: () => boolean } = {}) {
	const client = createNowClient({ activity: createMemoryActivity(), now: () => new Date() });
	const fetch = vi.fn(async (key: string) => {
		if (opts.fail?.()) throw new Error("boom");
		return key.length;
	});
	const asked: string[] = [];
	const pollSources: (string | null)[] = [];
	const key = (at: SnapshotAt, today: string) => (at === "now" ? `now:${today}` : `day:${at.day}`);
	let today = "2026-11-16";
	const sourceFor = vi.fn((at: SnapshotAt): NowSource<number> => {
		asked.push(at === "now" ? "now" : at.day);
		const k = key(at, today);
		return { key: k, cadence: "hour", fetch: () => fetch(k) };
	});
	const layer = new DayLayer<number>(client, {
		sourceFor,
		polls: (at, _v, source) => {
			pollSources.push(source?.key ?? null);
			return at === "now";
		}
	});
	return { layer, fetch, pollSources, sourceFor, asked, setToday: (t: string) => (today = t) };
}

type In = Parameters<DayLayer<number>["update"]>[0];

/** Drives `update` from an owner's `$effect`, as the map data does. */
function owner(layer: DayLayer<number>, first: In) {
	let current = $state.raw(first);
	const stop = $effect.root(() => {
		$effect(() => layer.update(current));
	});
	flushSync();
	return {
		set(next: In) {
			current = next;
			flushSync();
		},
		stop
	};
}

const input = (at: SnapshotAt, today = "2026-11-16") => ({
	on: true,
	at,
	ahead: ["2026-11-09", "2026-11-11"],
	today
});

describe("DayLayer", () => {
	it("fetches the day and its neighbours ahead", async () => {
		const t = setup();
		const o = owner(t.layer, input({ day: "2026-11-10" }));
		await flush();
		expect([...t.asked].sort()).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
		expect(t.fetch).toHaveBeenCalledTimes(3);
		o.stop();
		t.layer.destroy();
	});

	it("a step to a day fetched ahead draws at once, with no second fetch", async () => {
		const t = setup();
		const o = owner(t.layer, input({ day: "2026-11-10" }));
		await flush();
		o.set({
			on: true,
			at: { day: "2026-11-11" },
			ahead: ["2026-11-10", "2026-11-12"],
			today: "2026-11-16"
		});
		expect(t.layer.state.status).toBe("ready");
		await flush();
		const keys = t.fetch.mock.calls.map((c) => c[0]);
		expect(keys.filter((k) => k === "day:2026-11-11")).toHaveLength(1);
		o.stop();
		t.layer.destroy();
	});

	it("retry fetches the failed day again", async () => {
		let fail = true;
		const t = setup({ fail: () => fail });
		const o = owner(t.layer, input({ day: "2026-11-10" }));
		await flush();
		expect(t.layer.failed).toBe(true);
		const before = t.fetch.mock.calls.length;
		fail = false;
		t.layer.retry();
		await flush();
		expect(t.fetch.mock.calls.length).toBeGreaterThan(before);
		expect(t.layer.failed).toBe(false);
		o.stop();
		t.layer.destroy();
	});

	it("polls only while polls() says so", async () => {
		const t = setup();
		const o = owner(t.layer, { ...input("now"), ahead: [] });
		await flush();
		expect(t.fetch).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(60 * 60_000);
		expect(t.fetch.mock.calls.length).toBeGreaterThan(1);
		o.stop();
		t.layer.destroy();

		const d = setup();
		const od = owner(d.layer, { ...input({ day: "2026-11-10" }), ahead: [] });
		await flush();
		await vi.advanceTimersByTimeAsync(60 * 60_000);
		expect(d.fetch).toHaveBeenCalledTimes(1);
		od.stop();
		d.layer.destroy();
	});

	it("remakes the now source when today turns over", async () => {
		const t = setup();
		const o = owner(t.layer, { ...input("now"), ahead: [] });
		await flush();
		t.setToday("2026-11-17");
		o.set({ ...input("now", "2026-11-17"), ahead: [] });
		await flush();
		const keys = t.fetch.mock.calls.map((c) => c[0]);
		expect(keys).toContain("now:2026-11-16");
		expect(keys).toContain("now:2026-11-17");
		o.stop();
		t.layer.destroy();
	});

	it("off clears every query", async () => {
		const t = setup();
		const o = owner(t.layer, { ...input({ day: "2026-11-10" }), on: false });
		await flush();
		expect(t.layer.state.status).toBe("idle");
		expect(t.fetch).not.toHaveBeenCalled();
		o.stop();
		t.layer.destroy();
	});

	it("ahead queries never poll", async () => {
		const t = setup();
		// Now's main source polls, ahead days are hour-cadence sources that must stay still.
		const o = owner(t.layer, input("now"));
		await flush();
		await vi.advanceTimersByTimeAsync(60 * 60_000);
		const keys = t.fetch.mock.calls.map((c) => c[0]);
		expect(keys.filter((k) => k === "day:2026-11-09")).toHaveLength(1);
		expect(keys.filter((k) => k === "day:2026-11-11")).toHaveLength(1);
		expect(keys.filter((k) => k.startsWith("now")).length).toBeGreaterThan(1);
		o.stop();
		t.layer.destroy();
	});

	it("polls receives the main source, not an ahead one", async () => {
		const t = setup();
		const o = owner(t.layer, input({ day: "2026-11-10" }));
		await flush();
		expect(t.layer.source?.key).toBe("day:2026-11-10");
		expect(t.pollSources.at(-1)).toBe("day:2026-11-10");
		expect(t.pollSources.filter((k) => k !== "day:2026-11-10" && k !== null)).toEqual([]);
		o.stop();
		t.layer.destroy();
	});
});
