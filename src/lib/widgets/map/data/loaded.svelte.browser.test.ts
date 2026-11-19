import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@sjvair/sdk")>()),
	getPesticideTownships: vi.fn(),
	getPesticidesMeta: vi.fn(),
	getChemicalDetails: vi.fn()
}));

import { getChemicalDetails, getPesticideTownships, getPesticidesMeta } from "@sjvair/sdk";
import { resetPesticideMeta } from "$lib/data/pesticide-meta";
import type { PesticideFilters } from "$lib/data/schema";
import { SECTION_ZOOM } from "./use-geometry";
import { resetUseCaches, type UseQuery } from "./use";
import { createMemoryActivity } from "$lib/platform/memory";
import { createNowClient } from "$lib/data/now/client";
import type { Snapshot, SnapshotAt } from "$lib/data/snapshot";
import { m } from "$lib/paraglide/messages.js";
import type { WidgetInstance } from "$lib/documents/schema";
import type { FillData } from "./fill";
import type { HmsData } from "./hms";
import { MapData, type MapDataInput } from "./loaded.svelte";
import { NOTICES_SCALE } from "./notices";

const fakes = vi.hoisted(() => ({
	hmsFetch: vi.fn<(key: string) => Promise<unknown>>(async () => ({ smoke: [], fires: [] })),
	dayFinal: { value: false },
	fillFetch: vi.fn<(key: string) => Promise<unknown>>(async () => ({
		features: { type: "FeatureCollection", features: [] },
		final: true
	})),
	noticesFetch: vi.fn<(key: string) => Promise<unknown>>(async () => ({
		notices: [],
		value: null
	})),
	noticesUnavailable: { value: false },
	/** Whether the notices' fake key names the layer's filters (as the real key does). */
	noticesKeyFilters: { value: false },
	noticeFilterNames: vi.fn<() => Promise<string[]>>(async () => ["chemical_id", "category"])
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
				const filters = data.layers.find((l) => l.dataset === "pesticide-notices")?.filters;
				const named = fakes.noticesKeyFilters.value ? `|${JSON.stringify(filters ?? {})}` : "";
				const key = `notices:${at === "now" ? "now" : "day" in at ? at.day : `${at.resolution}:${at.start}`}${named}`;
				return { key, cadence: "hour", fetch: () => fakes.noticesFetch(key) };
			}
		},
		noticeFilterNames: () => fakes.noticeFilterNames()
	};
});

vi.mock("./hms", async (original) => {
	const real = await original<typeof import("./hms")>();
	return {
		...real,
		hmsEntry: {
			...real.hmsEntry,
			source: async ({ at }: { at: SnapshotAt }) => {
				const key = `hms:${at === "now" ? "now" : "day" in at ? at.day : `${at.resolution}:${at.start}`}`;
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
				const key = `fill:${at === "now" ? "now" : "day" in at ? at.day : `${at.resolution}:${at.start}`}`;
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

const USE_CLASS = { breaks: [10], min: 1, colors: ["#111111"] };
const USE_RESPONSE = {
	type: "FeatureCollection",
	year: 2023,
	classes: { lbs_chemical: USE_CLASS, acres_treated: USE_CLASS, applications: USE_CLASS },
	features: []
};

/** A Map with spray notices and pesticide use, both narrowed by `filters`. */
const withPesticides = (filters: PesticideFilters): WidgetInstance =>
	({
		...WIDGET,
		data: {
			layers: [
				...WIDGET.data.layers,
				{ dataset: "pesticide-notices", filters },
				{ dataset: "pesticide-use", filters }
			]
		}
	}) as WidgetInstance;

const useQueryOf = (filters: PesticideFilters): UseQuery => ({
	figure: "pounds-applied",
	period: { year: 2023, month: null },
	filters,
	info: { label: "Pounds Applied", units: "lbs", precision: 0 }
});

function setup(first: {
	at: SnapshotAt;
	ahead?: string[];
	fill?: MapDataInput["fill"];
	widget?: WidgetInstance;
	useQuery?: UseQuery | null;
}) {
	const now = createNowClient({ activity: createMemoryActivity(), now: () => new Date() });
	let at = $state.raw<SnapshotAt>(first.at);
	let ahead = $state.raw<readonly string[]>(first.ahead ?? []);
	let widget = $state.raw<WidgetInstance>(first.widget ?? WIDGET);
	let useQuery = $state.raw<UseQuery | null>(first.useQuery ?? null);
	const input: MapDataInput = {
		get widget() {
			return widget;
		},
		get layer() {
			return widget.data.layers[0];
		},
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
		fill: first.fill ?? null,
		get useQuery() {
			return useQuery;
		},
		bounds: null,
		zoom: 0,
		sectionZoom: SECTION_ZOOM,
		lensCenter: null
	};
	const rating = { figure: vi.fn(), levels: vi.fn() } as never;
	const data = new MapData(() => input, { now, rating });
	return {
		data,
		set(next: { at: SnapshotAt; ahead?: string[] }) {
			at = next.at;
			ahead = next.ahead ?? [];
		},
		setWidget(next: WidgetInstance, nextQuery: UseQuery | null) {
			widget = next;
			useQuery = nextQuery;
			flushSync();
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
	fakes.noticesFetch.mockImplementation(async () => ({ notices: [], value: null }));
	fakes.noticesUnavailable.value = false;
	fakes.noticesKeyFilters.value = false;
	resetUseCaches();
	resetPesticideMeta();
	vi.mocked(getPesticidesMeta).mockReset();
	vi.mocked(getPesticidesMeta).mockResolvedValue({ years: [2023] } as never);
	vi.mocked(getChemicalDetails).mockReset();
	vi.mocked(getChemicalDetails).mockResolvedValue({ display_name: "Chem" } as never);
	vi.mocked(getPesticideTownships).mockReset();
	vi.mocked(getPesticideTownships).mockImplementation(async () => USE_RESPONSE as never);
	fakes.noticeFilterNames.mockReset();
	fakes.noticeFilterNames.mockImplementation(async () => ["chemical_id", "category"]);
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
		expect(t.data.noticesSource.scale).toBe(NOTICES_SCALE);
		expect(t.data.noticesSource.features?.features).toEqual([]);
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
		// map-sdk's legend says the layer is unavailable: never a silent empty layer.
		expect(t.data.noticesSource.status).toEqual({
			state: "unavailable",
			reason: "filter-gone",
			message: m.map_notices_filter_gone()
		});
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

	it("a failed meta load is retried when the notices load, so skipped filters are named", async () => {
		fakes.noticeFilterNames.mockRejectedValueOnce(new Error("offline"));
		let release!: () => void;
		fakes.noticesFetch.mockImplementationOnce(
			() =>
				new Promise<unknown>((resolve) => (release = () => resolve({ notices: [], value: null })))
		);
		const t = setup({ at: "now", widget: WITH_NOTICES });
		await flush();
		release();
		await flush();
		expect(t.data.noticesState.status).toBe("ready");
		expect(t.data.noticesSkipped).toEqual(["commodity"]);
		t.data.destroy();
	});

	it("changing the Map's filters refetches notices and use", async () => {
		fakes.noticesKeyFilters.value = true;
		const t = setup({
			at: "now",
			widget: withPesticides({ chemical: "c1" }),
			useQuery: useQueryOf({ chemical: "c1" })
		});
		await flush();
		expect(t.data.use).toBe(true);
		expect(fakes.noticesFetch).toHaveBeenCalledTimes(1);
		expect(getPesticideTownships).toHaveBeenCalledTimes(1);
		expect(t.data.useBlock.townshipsState).toBe("ready");

		t.setWidget(withPesticides({ chemical: "c2" }), useQueryOf({ chemical: "c2" }));
		await flush();
		expect(fakes.noticesFetch).toHaveBeenCalledTimes(2);
		expect(fakes.noticesFetch.mock.calls[1][0]).toContain("c2");
		expect(getPesticideTownships).toHaveBeenCalledTimes(2);
		expect(vi.mocked(getPesticideTownships).mock.calls[1][0]).toMatchObject({ chemical_id: "c2" });
		t.data.destroy();
	});

	it("without the use layer nothing loads, and a gone filter makes use unavailable", async () => {
		const plain = setup({ at: "now", useQuery: useQueryOf({}) });
		await flush();
		expect(plain.data.use).toBe(false);
		expect(getPesticideTownships).not.toHaveBeenCalled();
		plain.data.destroy();

		vi.mocked(getChemicalDetails).mockRejectedValue(
			new Error("Not found", { cause: { result: { status: 404 } } })
		);
		const gone = setup({
			at: "now",
			widget: withPesticides({ chemical: "gone" }),
			useQuery: useQueryOf({ chemical: "gone" })
		});
		await flush();
		expect(gone.data.useUnavailable).toBe("filter-gone");
		expect(gone.data.useBlock.townships.status).toEqual({
			state: "unavailable",
			reason: "filter-gone",
			message: m.map_use_filter_gone()
		});
		expect(getPesticideTownships).not.toHaveBeenCalled();
		gone.data.destroy();
	});
});
