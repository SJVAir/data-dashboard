import { describe, expect, it } from "vitest";
import { resolveRange } from "$lib/format/range";
import type { AdapterRequest, DatasetAdapter, RegionResolver } from "../adapters/registry";
import type { CatalogEntry, MetadataSource } from "../metadata";
import type { Resolution } from "../schema";
import { FIXTURE_CATALOG, fixtureMetadata } from "../testing/fixtures";
import type { QueryData, QueryInput, QueryState } from "../types";
import { createQueryClient } from "./client";

const NOW = new Date("2026-10-22T19:00:00Z");
const DAY = 86_400_000;

type Call = {
	req: AdapterRequest;
	signal: AbortSignal;
	resolve(data: QueryData): void;
	reject(error: unknown): void;
};

function data(tag: number): QueryData {
	return {
		series: [{ place: `monitor:${tag}`, points: [] }],
		resolution: "hour",
		fromRaw: false,
		processor: null,
		fetchedAt: tag
	};
}

/** A fake air-quality adapter; each `fetch` waits until the test settles its call. */
function fakeAdapter(id = "air-quality") {
	const calls: Call[] = [];
	const adapter: DatasetAdapter = {
		id,
		async target(layer) {
			if (layer.place?.kind === "monitor") return { kind: "monitors", ids: [layer.place.id] };
			if (layer.place) return { unavailable: "place-unsupported" };
			return { kind: "all" };
		},
		// Like air quality: no raw data for the whole layer.
		offered: (base, target) => (target.kind === "all" ? base.filter((r) => r !== "raw") : base),
		fetch(req, _ctx, signal) {
			return new Promise((resolve, reject) => calls.push({ req, signal, resolve, reject }));
		}
	};
	return { adapter, calls };
}

const regions: RegionResolver = { resolve: async () => "unsupported" };

function setup(opts: { metadata?: MetadataSource; maxIdleEntries?: number } = {}) {
	const { adapter, calls } = fakeAdapter();
	const clock = { now: NOW };
	const client = createQueryClient({
		adapters: [adapter],
		metadata: opts.metadata ?? fixtureMetadata(),
		regions,
		now: () => clock.now,
		maxIdleEntries: opts.maxIdleEntries
	});
	return { client, calls, clock };
}

function input(monitor = "m-pa", entryType = "pm25"): QueryInput {
	return {
		layer: { dataset: "air-quality", entryType, place: { kind: "monitor", id: monitor } },
		dateRange: { kind: "trailing", amount: 7, unit: "day" }
	};
}

function recorder() {
	const states: QueryState[] = [];
	return { states, listener: (s: QueryState) => states.push(s), last: () => states.at(-1) };
}

function catalogWith(extra: CatalogEntry[]): MetadataSource {
	return fixtureMetadata({ catalog: async () => [...FIXTURE_CATALOG, ...extra] });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function abortError() {
	return new DOMException("The operation was aborted.", "AbortError");
}

describe("createQueryClient", () => {
	it("two subscribers to the same input share one fetch", async () => {
		const { client, calls } = setup();
		const a = recorder();
		const b = recorder();
		const subA = client.subscribe(input(), a.listener);
		const subB = client.subscribe(input(), b.listener);
		await flush();

		expect(calls).toHaveLength(1);
		expect(subA.key).not.toBeNull();
		expect(subA.key).toBe(subB.key);
		expect(a.last()).toEqual({ status: "loading" });

		calls[0].resolve(data(1));
		await flush();
		expect(a.last()).toEqual({ status: "ready", data: data(1) });
		expect(b.last()).toEqual({ status: "ready", data: data(1) });
	});

	it("passes one `now`, the resolved range, and the offered levels to the adapter", async () => {
		const { client, calls } = setup();
		client.subscribe(input(), () => {});
		await flush();

		const req = calls[0].req;
		expect(req.now).toEqual(NOW);
		expect(req.range).toEqual(resolveRange({ kind: "trailing", amount: 7, unit: "day" }, NOW));
		expect(req.entryType).toBe("pm25");
		expect(req.target).toEqual({ kind: "monitors", ids: ["m-pa"] });
		expect(req.resolution).toBe("hour");
		expect(req.downsampleFromRaw).toBe(false);
		expect(req.offered).toEqual(["raw", "hour", "day", "month", "quarter", "season", "year"]);
	});

	it("superseded requests are aborted and never shown", async () => {
		const { client, calls } = setup();
		const r = recorder();
		const sub = client.subscribe(input("m-1"), r.listener);
		await flush();
		sub.update(input("m-2"));
		await flush();
		sub.update(input("m-3"));
		await flush();

		expect(calls).toHaveLength(3);
		expect(calls[0].signal.aborted).toBe(true);
		expect(calls[1].signal.aborted).toBe(true);
		expect(calls[2].signal.aborted).toBe(false);

		// The fake ignores the signal and answers late; one answer is an AbortError.
		calls[0].resolve(data(1));
		calls[1].reject(abortError());
		await flush();
		expect(r.states.every((s) => s.status === "loading" && !("data" in s && s.data))).toBe(true);

		calls[2].resolve(data(3));
		await flush();
		expect(r.last()).toEqual({ status: "ready", data: data(3) });
		expect(r.states.some((s) => s.status === "error")).toBe(false);
		// The aborted entries had no data, so they are not kept.
		expect(client.entries().map((e) => e.key)).toEqual([sub.key]);
	});

	it("only the last of several quick updates is fetched", async () => {
		const { client, calls } = setup();
		const r = recorder();
		const sub = client.subscribe(input("m-1"), r.listener);
		sub.update(input("m-2"));
		sub.update(input("m-3"));
		await flush();

		expect(calls).toHaveLength(1);
		expect(calls[0].req.target).toEqual({ kind: "monitors", ids: ["m-3"] });
	});

	it("abort spares a request another subscriber still needs", async () => {
		const { client, calls } = setup();
		const a = recorder();
		const b = recorder();
		const subA = client.subscribe(input("m-1"), a.listener);
		client.subscribe(input("m-1"), b.listener);
		await flush();
		subA.update(input("m-2"));
		await flush();

		expect(calls).toHaveLength(2);
		expect(calls[0].signal.aborted).toBe(false);
		calls[0].resolve(data(1));
		calls[1].resolve(data(2));
		await flush();
		expect(b.last()).toEqual({ status: "ready", data: data(1) });
		expect(a.last()).toEqual({ status: "ready", data: data(2) });
		expect(a.states.some((s) => "data" in s && s.data === data(1))).toBe(false);
	});

	it("unsubscribing the last subscriber aborts the request", async () => {
		const { client, calls } = setup();
		const r = recorder();
		const sub = client.subscribe(input(), r.listener);
		await flush();
		sub.unsubscribe();
		expect(calls[0].signal.aborted).toBe(true);
		expect(sub.key).toBeNull();

		const count = r.states.length;
		calls[0].resolve(data(1));
		await flush();
		expect(r.states).toHaveLength(count);
	});

	it("an error keeps the last good data", async () => {
		const { client, calls } = setup();
		const r = recorder();
		const sub = client.subscribe(input(), r.listener);
		await flush();
		calls[0].resolve(data(1));
		await flush();
		expect(r.last()).toEqual({ status: "ready", data: data(1) });

		client.refetch(sub.key!);
		expect(calls).toHaveLength(2);
		expect(r.last()).toEqual({ status: "loading", data: data(1) });

		const error = new Error("boom");
		calls[1].reject(error);
		await flush();
		expect(r.last()).toEqual({ status: "error", error, data: data(1) });

		client.refetch(sub.key!);
		calls[2].resolve(data(2));
		await flush();
		expect(r.last()).toEqual({ status: "ready", data: data(2) });
	});

	it("refetch re-resolves a rolling range with a fresh now", async () => {
		const { client, calls, clock } = setup();
		const sub = client.subscribe(input(), () => {});
		await flush();
		calls[0].resolve(data(1));
		await flush();

		const tomorrow = new Date(NOW.getTime() + DAY);
		clock.now = tomorrow;
		client.refetch(sub.key!);
		expect(calls).toHaveLength(2);
		expect(calls[0].req.range.firstDate).toBe("2026-10-16");
		expect(calls[1].req.range.firstDate).toBe("2026-10-17");
		expect(calls[1].req.now).toEqual(tomorrow);
	});

	it("an aborted refetch leaves the entry stale for the next subscriber", async () => {
		const { client, calls, clock } = setup();
		const sub = client.subscribe(input(), () => {});
		await flush();
		calls[0].resolve(data(1));
		await flush();

		clock.now = new Date(NOW.getTime() + DAY);
		client.refetch(sub.key!);
		sub.unsubscribe();
		expect(calls[1].signal.aborted).toBe(true);
		// The idle entry still describes the request its data came from.
		expect(client.entries()[0]).toMatchObject({ inFlight: false, fetchedAt: 1 });

		const r = recorder();
		client.subscribe(input(), r.listener);
		await flush();
		expect(calls).toHaveLength(3);
		expect(calls[2].req.range.firstDate).toBe("2026-10-17");
		expect(r.last()).toEqual({ status: "loading", data: data(1) });
		expect(client.entries()[0]).toMatchObject({ inFlight: true, fetchedAt: 1 });
	});

	it("refetch dedups with a request already in flight", async () => {
		const { client, calls } = setup();
		const sub = client.subscribe(input(), () => {});
		await flush();
		client.refetch(sub.key!);
		client.refetch("no-such-key");
		expect(calls).toHaveLength(1);
	});

	it("a cached entry is shared without refetching", async () => {
		const { client, calls } = setup();
		const sub = client.subscribe(input(), () => {});
		await flush();
		calls[0].resolve(data(1));
		await flush();
		sub.unsubscribe();

		const r = recorder();
		client.subscribe(input(), r.listener);
		await flush();
		expect(calls).toHaveLength(1);
		expect(r.states).toEqual([{ status: "loading" }, { status: "ready", data: data(1) }]);
	});

	it("updating to the same input changes nothing", async () => {
		const { client, calls } = setup();
		const r = recorder();
		const sub = client.subscribe(input(), r.listener);
		await flush();
		calls[0].resolve(data(1));
		await flush();
		const count = r.states.length;

		sub.update(input());
		await flush();
		expect(calls).toHaveLength(1);
		expect(r.states).toHaveLength(count);
	});

	it("catalog unavailable gives catalog-unavailable", async () => {
		const { client, calls } = setup({
			metadata: fixtureMetadata({ catalog: async () => "unavailable" })
		});
		const r = recorder();
		const sub = client.subscribe(input(), r.listener);
		await flush();
		expect(r.last()).toEqual({ status: "unavailable", reason: "catalog-unavailable" });
		expect(sub.key).toBeNull();
		expect(calls).toHaveLength(0);
	});

	it("unknown dataset gives unknown-dataset", async () => {
		const { client } = setup();
		const r = recorder();
		client.subscribe({ ...input(), layer: { dataset: "nope", entryType: "pm25" } }, r.listener);
		await flush();
		expect(r.last()).toEqual({ status: "unavailable", reason: "unknown-dataset" });
	});

	it("unknown entry type gives unknown-entry-type", async () => {
		const { client } = setup();
		const r = recorder();
		client.subscribe(input("m-pa", "nope"), r.listener);
		await flush();
		expect(r.last()).toEqual({ status: "unavailable", reason: "unknown-entry-type" });

		const r2 = recorder();
		client.subscribe({ ...input(), layer: { dataset: "air-quality" } }, r2.listener);
		await flush();
		expect(r2.last()).toEqual({ status: "unavailable", reason: "unknown-entry-type" });
	});

	it("dataset without adapter gives no-adapter", async () => {
		const smoke: CatalogEntry = {
			id: "smoke",
			label: "Smoke",
			entryTypes: [
				{ id: "density", label: "Density", units: "", kind: "other", resolutions: ["day"] }
			],
			geographies: []
		};
		const { client } = setup({ metadata: catalogWith([smoke]) });
		const r = recorder();
		client.subscribe({ ...input(), layer: { dataset: "smoke", entryType: "density" } }, r.listener);
		await flush();
		expect(r.last()).toEqual({ status: "unavailable", reason: "no-adapter" });
	});

	it("passes the adapter's own unavailable reason through", async () => {
		const { client } = setup();
		const r = recorder();
		const layer = { dataset: "air-quality", entryType: "pm25", place: { kind: "default-place" } };
		client.subscribe({ ...input(), layer } as QueryInput, r.listener);
		await flush();
		expect(r.last()).toEqual({ status: "unavailable", reason: "place-unsupported" });
	});

	it("whole layer at raw gives whole-layer-raw", async () => {
		const { client, calls } = setup();
		const r = recorder();
		client.subscribe(
			{ ...input(), layer: { dataset: "air-quality", entryType: "pm100" } },
			r.listener
		);
		await flush();
		expect(r.last()).toEqual({ status: "unavailable", reason: "whole-layer-raw" });

		// One monitor's pm100 is downsampled from raw instead.
		client.subscribe(input("m-pa", "pm100"), () => {});
		await flush();
		expect(calls).toHaveLength(1);
		expect(calls[0].req.resolution).toBe("hour");
		expect(calls[0].req.downsampleFromRaw).toBe(true);
	});

	it("no usable resolution gives no-resolution", async () => {
		const hourly: CatalogEntry = {
			id: "air-quality",
			label: "Air quality",
			entryTypes: [
				{ id: "co", label: "CO", units: "ppm", kind: "pollutant", resolutions: ["hour"] }
			],
			geographies: []
		};
		const { client } = setup({ metadata: fixtureMetadata({ catalog: async () => [hourly] }) });
		const r = recorder();
		client.subscribe({ ...input("m-pa", "co"), pin: "month" as Resolution }, r.listener);
		await flush();
		expect(r.last()).toEqual({ status: "unavailable", reason: "no-resolution" });
	});

	it("retired datasets and entry types still work", async () => {
		const retired = { since: "2026-01-01" };
		const catalog: CatalogEntry[] = FIXTURE_CATALOG.map((d) => ({
			...d,
			retired,
			entryTypes: d.entryTypes.map((e) => ({ ...e, retired }))
		}));
		const { client, calls } = setup({
			metadata: fixtureMetadata({ catalog: async () => catalog })
		});
		client.subscribe(input(), () => {});
		await flush();
		expect(calls).toHaveLength(1);
	});

	it("a failing resolution step gives an error state", async () => {
		const error = new Error("catalog down");
		const { client } = setup({
			metadata: fixtureMetadata({
				catalog: async () => {
					throw error;
				}
			})
		});
		const r = recorder();
		client.subscribe(input(), r.listener);
		await flush();
		expect(r.last()).toEqual({ status: "error", error });
	});

	it("entries report subscribers, flight, polling, and failure", async () => {
		const { client, calls } = setup();
		const a = client.subscribe(input(), () => {});
		const b = client.subscribe(input(), () => {});
		await flush();
		expect(client.entries()).toEqual([
			{
				key: a.key,
				subscribers: 2,
				inFlight: true,
				fetchedAt: undefined,
				includesNow: true,
				resolution: "hour",
				polling: true,
				failed: false
			}
		]);

		calls[0].resolve(data(1));
		await flush();
		a.setPolling(false);
		expect(client.entries()[0]).toMatchObject({ inFlight: false, fetchedAt: 1, polling: true });
		b.setPolling(false);
		expect(client.entries()[0].polling).toBe(false);
		a.setPolling(true);
		expect(client.entries()[0].polling).toBe(true);
		a.unsubscribe();
		expect(client.entries()[0]).toMatchObject({ subscribers: 1, polling: false });

		client.refetch(b.key!);
		calls[1].reject(new Error("down"));
		await flush();
		expect(client.entries()[0]).toMatchObject({ failed: true, fetchedAt: 1 });
	});

	it("onChange hears subscribers, polling, and fetches starting and settling", async () => {
		const { client, calls } = setup();
		let heard = 0;
		const stop = client.onChange(() => heard++);
		const a = client.subscribe(input(), () => {});
		await flush();
		const afterAttach = heard;
		expect(afterAttach).toBeGreaterThan(0);
		calls[0].resolve(data(1));
		await flush();
		expect(heard).toBeGreaterThan(afterAttach);
		const afterSettle = heard;
		a.setPolling(false);
		expect(heard).toBeGreaterThan(afterSettle);
		const afterPolling = heard;
		a.unsubscribe();
		expect(heard).toBeGreaterThan(afterPolling);
		stop();
		const final = heard;
		client.subscribe(input(), () => {});
		await flush();
		expect(heard).toBe(final);
	});

	it("idle entries beyond the cap are evicted least recently used", async () => {
		const { client, calls } = setup({ maxIdleEntries: 2 });
		const keys: string[] = [];
		async function visit(monitor: string) {
			const sub = client.subscribe(input(monitor), () => {});
			await flush();
			calls.at(-1)!.resolve(data(calls.length));
			await flush();
			keys.push(sub.key!);
			sub.unsubscribe();
		}

		await visit("m-1");
		await visit("m-2");
		await visit("m-3");
		expect(client.entries().map((e) => e.key)).toEqual([keys[1], keys[2]]);

		// Using m-2 again makes m-3 the least recently used.
		const again = client.subscribe(input("m-2"), () => {});
		await flush();
		again.unsubscribe();
		expect(calls).toHaveLength(3);
		await visit("m-4");
		expect(
			client
				.entries()
				.map((e) => e.key)
				.sort()
		).toEqual([keys[1], keys[3]].sort());
	});

	it("retry re-plans after a resolution step fails, as does updating to the same input", async () => {
		let failures = 2;
		const { client, calls } = setup({
			metadata: fixtureMetadata({
				catalog: async () => {
					if (failures-- > 0) throw new Error("catalog down");
					return FIXTURE_CATALOG;
				}
			})
		});
		const r = recorder();
		const sub = client.subscribe(input(), r.listener);
		await flush();
		expect(r.last()?.status).toBe("error");

		sub.update(input());
		await flush();
		expect(r.last()?.status).toBe("error");
		expect(failures).toBe(0);

		sub.retry();
		await flush();
		expect(calls).toHaveLength(1);
		expect(r.last()).toEqual({ status: "loading" });
		expect(sub.key).not.toBeNull();
	});

	it("retry re-plans an unavailable subscription", async () => {
		let catalog: "unavailable" | CatalogEntry[] = "unavailable";
		const { client, calls } = setup({
			metadata: fixtureMetadata({ catalog: async () => catalog })
		});
		const r = recorder();
		const sub = client.subscribe(input(), r.listener);
		await flush();
		expect(r.last()).toEqual({ status: "unavailable", reason: "catalog-unavailable" });

		catalog = FIXTURE_CATALOG;
		sub.retry();
		await flush();
		expect(calls).toHaveLength(1);
	});

	it("retry refetches a failed entry that is never polled", async () => {
		const { client, calls } = setup();
		const r = recorder();
		const past: QueryInput = {
			...input(),
			dateRange: { kind: "custom", start: "2026-01-01", end: "2026-01-07" }
		};
		const sub = client.subscribe(past, r.listener);
		await flush();
		const error = new Error("boom");
		calls[0].reject(error);
		await flush();
		expect(r.last()).toEqual({ status: "error", error });

		sub.retry();
		expect(calls).toHaveLength(2);
		calls[1].resolve(data(2));
		await flush();
		expect(r.last()).toEqual({ status: "ready", data: data(2) });
	});

	describe("timeSubRange", () => {
		const points = [
			"2026-10-19T07:00:00Z",
			"2026-10-20T06:59:00Z",
			"2026-10-20T07:00:00Z",
			"2026-10-21T07:00:00Z"
		].map((iso) => ({
			t: Date.parse(iso),
			mean: 1,
			min: 1,
			max: 1,
			count: 1,
			partial: false
		}));
		const full: QueryData = { ...data(1), series: [{ place: "monitor:m-pa", points }] };
		const times = (s: QueryState | undefined) =>
			s && s.status === "ready" ? s.data.series[0].points.map((p) => p.t) : undefined;

		it("filters to whole Pacific days without changing the key or the fetch", async () => {
			const { client, calls } = setup();
			const plain = client.subscribe(input(), () => {});
			const r = recorder();
			const sub = client.subscribe(
				{ ...input(), timeSubRange: { start: "2026-10-19", end: "2026-10-20" } },
				r.listener
			);
			await flush();
			expect(calls).toHaveLength(1);
			expect(sub.key).toBe(plain.key);

			calls[0].resolve(full);
			await flush();
			expect(times(r.last())).toEqual(points.slice(0, 3).map((p) => p.t));

			// Changing only the sub-range filters the cached data again: no fetch, same entry.
			sub.update({
				...input(),
				timeSubRange: { start: "2026-10-20T00:00:00-07:00", end: "2026-10-21T00:00:00-07:00" }
			});
			await flush();
			expect(calls).toHaveLength(1);
			expect(sub.key).toBe(plain.key);
			expect(times(r.last())).toEqual(points.slice(2).map((p) => p.t));

			sub.update(input());
			expect(times(r.last())).toEqual(points.map((p) => p.t));
		});
	});
});
