import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryActivity } from "$lib/platform/memory";
import { createNowClient } from "$lib/data/now/client";
import type { Snapshot, SnapshotAt } from "$lib/data/snapshot";
import type { WidgetInstance } from "$lib/documents/schema";
import type { FillData } from "./fill";
import type { HmsData } from "./hms";
import { MapData, type MapDataInput } from "./loaded.svelte";

const fakes = vi.hoisted(() => ({
	hmsFetch: vi.fn<(key: string) => Promise<unknown>>(async () => ({ smoke: [], fires: [] })),
	dayFinal: { value: false },
	fillFetch: vi.fn<(key: string) => Promise<unknown>>(async () => ({
		features: { type: "FeatureCollection", features: [] },
		final: true
	})),
	noticesFetch: vi.fn<(key: string) => Promise<unknown>>(async () => []),
	noticesUnavailable: { value: false }
}));

vi.mock("./notices", async (original) => {
	const real = await original<typeof import("./notices")>();
	return {
		...real,
		noticesEntry: {
			...real.noticesEntry,
			source: async ({ data, at }: { data: WidgetInstance["data"]; at: SnapshotAt }) => {
				if (!data.layers.some((l) => l.dataset === "pesticide-notices")) return null;
				if (fakes.noticesUnavailable.value) return { unavailable: "filter-gone" };
				const key = `notices:${at === "now" ? "now" : at.day}`;
				return { key, cadence: "hour", fetch: () => fakes.noticesFetch(key) };
			}
		},
		noticeFilterNames: async () => ["chemical_id", "category"]
	};
});

vi.mock("./hms", async (original) => {
	const real = await original<typeof import("./hms")>();
	return {
		...real,
		hmsEntry: {
			...real.hmsEntry,
			source: async ({ at }: { at: SnapshotAt }) => {
				const key = `hms:${at === "now" ? "now" : at.day}`;
				return { key, cadence: "hour", fetch: () => fakes.hmsFetch(key) };
			}
		}
	};
});

vi.mock("./fill", async (original) => {
	const real = await original<typeof import("./fill")>();
	return {
		...real,
		fillEntry: {
			source: ({ at }: { at: SnapshotAt }) => {
				const key = `fill:${at === "now" ? "now" : at.day}`;
				return {
					key,
					cadence: "hour",
					poll: (value: FillData | undefined) => at === "now" || !value?.final,
					fetch: () => fakes.fillFetch(key)
				};
			}
		}
	};
});

vi.mock("./monitors", async (original) => {
	const real = await original<typeof import("./monitors")>();
	return {
		...real,
		monitorsEntry: {
			...real.monitorsEntry,
			source: async () => ({
				key: "monitors:list",
				cadence: "raw",
				scope: { kind: "regions", ids: ["1"], key: "1" },
				fetch: async () => []
			}),
			daySource: ({ day }: { day: string }) => ({
				key: `monitors:day:${day}`,
				cadence: "hour",
				poll: (s: Snapshot | undefined) => !s?.final,
				fetch: async (): Promise<Snapshot> => ({
					figures: new Map(),
					final: fakes.dayFinal.value,
					unrated: false
				})
			})
		}
	};
});

const NOW = new Date("2026-11-16T19:10:00Z");
const HOUR = 60 * 60_000;
const flush = () => vi.advanceTimersByTimeAsync(0);

const WIDGET: WidgetInstance = {
	id: "w1",
	type: "map",
	title: null,
	rect: { x: 0, y: 0, w: 4, h: 4 },
	data: {
		layers: [
			{
				dataset: "air-quality",
				entryType: "pm25",
				place: { kind: "region", type: "county", code: "fresno" }
			},
			{ dataset: "hms-smoke" },
			{ dataset: "hms-fire" }
		]
	}
} as WidgetInstance;

const WITH_NOTICES: WidgetInstance = {
	...WIDGET,
	data: {
		layers: [
			...WIDGET.data.layers,
			{ dataset: "pesticide-notices", filters: { chemical: "c1", commodity: "k1" } }
		]
	}
} as WidgetInstance;

function setup(first: {
	at: SnapshotAt;
	ahead?: string[];
	fill?: MapDataInput["fill"];
	widget?: WidgetInstance;
}) {
	const now = createNowClient({ activity: createMemoryActivity(), now: () => new Date() });
	let at = $state.raw<SnapshotAt>(first.at);
	let ahead = $state.raw<readonly string[]>(first.ahead ?? []);
	const widget = first.widget ?? WIDGET;
	const input: MapDataInput = {
		widget,
		layer: widget.data.layers[0],
		entryType: "pm25",
		loads: true,
		filters: null,
		get at() {
			return at;
		},
		get ahead() {
			return ahead;
		},
		today: "2026-11-16",
		fill: first.fill ?? null
	};
	const rating = { dailyFigure: vi.fn(), levels: vi.fn() } as never;
	const data = new MapData(() => input, { now, rating });
	return {
		data,
		set(next: { at: SnapshotAt; ahead?: string[] }) {
			at = next.at;
			ahead = next.ahead ?? [];
		}
	};
}

const hmsKeys = () => fakes.hmsFetch.mock.calls.map((c) => c[0]);

beforeEach(() => {
	vi.useFakeTimers({ now: NOW });
	fakes.hmsFetch.mockClear();
	fakes.hmsFetch.mockImplementation(async () => ({ smoke: [], fires: [] }) satisfies HmsData);
	fakes.fillFetch.mockClear();
	fakes.fillFetch.mockImplementation(async () => ({
		features: { type: "FeatureCollection", features: [] },
		final: true
	}));
	fakes.dayFinal.value = false;
	fakes.noticesFetch.mockClear();
	fakes.noticesFetch.mockImplementation(async () => []);
	fakes.noticesUnavailable.value = false;
});
afterEach(() => vi.useRealTimers());

describe("MapData", () => {
	it("smoke and fire on a day poll only while the day's figures aren't final", async () => {
		fakes.dayFinal.value = false;
		const open = setup({ at: { day: "2026-11-10" } });
		await flush();
		expect(open.data.dayNotFinal).toBe(true);
		await vi.advanceTimersByTimeAsync(HOUR);
		expect(hmsKeys().filter((k) => k === "hms:2026-11-10").length).toBeGreaterThan(1);
		open.data.destroy();

		fakes.hmsFetch.mockClear();
		fakes.dayFinal.value = true;
		const final = setup({ at: { day: "2026-11-09" } });
		await flush();
		expect(final.data.dayNotFinal).toBe(false);
		await vi.advanceTimersByTimeAsync(HOUR);
		expect(hmsKeys().filter((k) => k === "hms:2026-11-09")).toHaveLength(1);
		final.data.destroy();
	});

	it("smoke and fire on now poll whatever the day's figures", async () => {
		const t = setup({ at: "now" });
		await flush();
		await vi.advanceTimersByTimeAsync(HOUR);
		expect(hmsKeys().filter((k) => k === "hms:now").length).toBeGreaterThan(1);
		t.data.destroy();
	});

	it("smoke and fire fetch the neighbouring days ahead", async () => {
		const t = setup({ at: { day: "2026-11-10" }, ahead: ["2026-11-09", "2026-11-11"] });
		await flush();
		expect([...hmsKeys()].sort()).toEqual(["hms:2026-11-09", "hms:2026-11-10", "hms:2026-11-11"]);
		expect(fakes.hmsFetch).toHaveBeenCalledTimes(3);
		// A step to a day fetched ahead fetches nothing new for it.
		t.set({ at: { day: "2026-11-11" }, ahead: ["2026-11-10", "2026-11-12"] });
		await flush();
		expect(hmsKeys().filter((k) => k === "hms:2026-11-11")).toHaveLength(1);
		expect(hmsKeys().filter((k) => k === "hms:2026-11-10")).toHaveLength(1);
		t.data.destroy();
	});

	it("the fill on a day polls only until its figures are final", async () => {
		fakes.fillFetch.mockImplementation(async () => ({
			features: { type: "FeatureCollection", features: [] },
			final: false
		}));
		const t = setup({ at: { day: "2026-11-10" }, ahead: ["2026-11-09"], fill: "zipcode" });
		await flush();
		expect(t.data.fillFor).toBe("pm25");
		expect(t.data.fillSource.scale).toEqual({ dataset: "air-quality", entryType: "pm25" });
		await vi.advanceTimersByTimeAsync(HOUR);
		const keys = () => fakes.fillFetch.mock.calls.map((c) => c[0]);
		expect(keys().filter((k) => k === "fill:2026-11-10").length).toBeGreaterThan(1);
		expect(keys().filter((k) => k === "fill:2026-11-09")).toHaveLength(1);
		t.data.destroy();

		fakes.fillFetch.mockClear();
		fakes.fillFetch.mockImplementation(async () => ({
			features: { type: "FeatureCollection", features: [] },
			final: true
		}));
		const done = setup({ at: { day: "2026-11-08" }, fill: "zipcode" });
		await flush();
		await vi.advanceTimersByTimeAsync(HOUR);
		expect(fakes.fillFetch).toHaveBeenCalledTimes(1);
		done.data.destroy();
	});

	it("retryHms fetches smoke and fire again after a failure", async () => {
		fakes.hmsFetch.mockRejectedValueOnce(new Error("offline"));
		const t = setup({ at: { day: "2026-11-10" } });
		await flush();
		expect(t.data.hmsFailed).toBe(true);
		t.data.retryHms();
		await flush();
		expect(fakes.hmsFetch).toHaveBeenCalledTimes(2);
		expect(t.data.hmsFailed).toBe(false);
		expect(t.data.hmsState.status).toBe("ready");
		t.data.destroy();
	});

	it("notices follow the day and fetch the neighbours ahead", async () => {
		const keys = () => fakes.noticesFetch.mock.calls.map((c) => c[0]);
		const t = setup({
			at: { day: "2026-11-10" },
			ahead: ["2026-11-09", "2026-11-11"],
			widget: WITH_NOTICES
		});
		await flush();
		expect(t.data.notices).toBe(true);
		expect([...keys()].sort()).toEqual([
			"notices:2026-11-09",
			"notices:2026-11-10",
			"notices:2026-11-11"
		]);
		expect(t.data.noticesState.status).toBe("ready");
		expect(t.data.noticesSource.status).toEqual({ state: "ready" });
		expect(t.data.noticesSource.scale).toBeNull();
		// The saved commodity filter doesn't apply to notices: named, not dropped silently.
		expect(t.data.noticesSkipped).toEqual(["commodity"]);
		// A step to a day fetched ahead fetches nothing new for it.
		t.set({ at: { day: "2026-11-11" }, ahead: ["2026-11-10", "2026-11-12"] });
		await flush();
		expect(keys().filter((k) => k === "notices:2026-11-11")).toHaveLength(1);
		expect(keys().filter((k) => k === "notices:2026-11-12")).toHaveLength(1);
		t.data.destroy();
	});

	it("notices on now poll hourly; a settled day doesn't", async () => {
		const keys = () => fakes.noticesFetch.mock.calls.map((c) => c[0]);
		const now = setup({ at: "now", widget: WITH_NOTICES });
		await flush();
		await vi.advanceTimersByTimeAsync(HOUR);
		expect(keys().filter((k) => k === "notices:now").length).toBeGreaterThan(1);
		now.data.destroy();

		fakes.noticesFetch.mockClear();
		const settled = setup({ at: { day: "2026-11-01" }, widget: WITH_NOTICES });
		await flush();
		await vi.advanceTimersByTimeAsync(HOUR);
		expect(keys().filter((k) => k === "notices:2026-11-01")).toHaveLength(1);
		settled.data.destroy();
	});

	it("without the notices layer nothing loads", async () => {
		const t = setup({ at: "now" });
		await flush();
		expect(t.data.notices).toBe(false);
		expect(fakes.noticesFetch).not.toHaveBeenCalled();
		expect(t.data.noticesSkipped).toEqual([]);
		t.data.destroy();
	});

	it("a filter the server no longer has makes the notices unavailable", async () => {
		fakes.noticesUnavailable.value = true;
		const t = setup({ at: "now", widget: WITH_NOTICES });
		await flush();
		expect(t.data.noticesUnavailable).toBe("filter-gone");
		expect(fakes.noticesFetch).not.toHaveBeenCalled();
		t.data.destroy();
	});

	it("retryNotices fetches the notices again after a failure", async () => {
		fakes.noticesFetch.mockRejectedValueOnce(new Error("offline"));
		const t = setup({ at: { day: "2026-11-10" }, widget: WITH_NOTICES });
		await flush();
		expect(t.data.noticesFailed).toBe(true);
		t.data.retryNotices();
		await flush();
		expect(fakes.noticesFetch).toHaveBeenCalledTimes(2);
		expect(t.data.noticesFailed).toBe(false);
		t.data.destroy();
	});
});
