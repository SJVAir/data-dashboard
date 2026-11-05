import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Platform } from "$lib/platform/types";
import { registerWidgetType } from "$lib/widgets/registry";
import { chartType } from "$lib/widgets/chart";
import { dataTableType } from "$lib/widgets/table";
import { DRAFT_KEY, defaultDraft, flushDraft, loadDraft, saveDraft } from "./draft.svelte";

const SPACE = "anonymous" as const;

function fakePlatform(initial?: unknown) {
	const store = new Map<string, unknown>();
	if (initial !== undefined) store.set(DRAFT_KEY, initial);
	const platform = {
		preferences: {
			get: async (_space: string, key: string) => store.get(key),
			set: async (_space: string, key: string, value: unknown) => {
				store.set(key, value);
			}
		}
	} as unknown as Platform;
	return { platform, store };
}

beforeEach(() => {
	registerWidgetType(chartType);
	registerWidgetType(dataTableType);
});
afterEach(() => vi.useRealTimers());

describe("the Get data draft", () => {
	it("no stored draft → Fresno County PM2.5 last 30 days", async () => {
		const { platform } = fakePlatform();
		const draft = await loadDraft(platform, SPACE);
		expect(draft.type).toBe("chart");
		expect(draft.data.layers).toEqual([
			{
				dataset: "air-quality",
				entryType: "pm25",
				place: { kind: "region", type: "county", code: "06019" }
			}
		]);
		expect(draft.data.dateRange).toEqual({ kind: "trailing", amount: 30, unit: "day" });
	});

	it("a tampered draft (50 layers / lat 999 / unknown type) → default", async () => {
		const layer = { dataset: "air-quality", entryType: "pm25" };
		const bad = [
			{ type: "chart", data: { layers: Array.from({ length: 50 }, () => layer) } },
			{
				type: "chart",
				data: { layers: [{ dataset: "air-quality", place: { kind: "point", lat: 999, lon: 0 } }] }
			},
			{ type: "no-such-type", data: { layers: [layer] } },
			"nonsense"
		];
		for (const stored of bad) {
			const { platform } = fakePlatform(stored);
			expect(await loadDraft(platform, SPACE)).toEqual(defaultDraft());
		}
	});

	it("?type=data-table overrides the stored type", async () => {
		const { platform } = fakePlatform(defaultDraft("chart"));
		const draft = await loadDraft(platform, SPACE, "data-table");
		expect(draft.type).toBe("data-table");
		expect(draft.data).toEqual(defaultDraft().data);
	});

	it("an unknown ?type is ignored", async () => {
		const { platform } = fakePlatform();
		expect((await loadDraft(platform, SPACE, "bogus")).type).toBe("chart");
	});

	it("save then load round-trips, after 500 ms of quiet", async () => {
		vi.useFakeTimers();
		const { platform, store } = fakePlatform();
		const draft = defaultDraft("data-table");
		draft.data.layers[0].entryType = "o3";
		saveDraft(platform, SPACE, draft);
		await vi.advanceTimersByTimeAsync(499);
		expect(store.has(DRAFT_KEY)).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(await loadDraft(platform, SPACE)).toEqual(draft);
	});

	it("a failing write is swallowed", async () => {
		vi.useFakeTimers();
		const { platform } = fakePlatform();
		platform.preferences.set = () => Promise.reject(new Error("blocked"));
		saveDraft(platform, SPACE, defaultDraft());
		await vi.advanceTimersByTimeAsync(600);
	});

	it("flushDraft writes a pending save at once, and only once", async () => {
		vi.useFakeTimers();
		const { platform, store } = fakePlatform();
		const set = vi.spyOn(platform.preferences, "set");
		const draft = { ...defaultDraft(), type: "data-table" };
		saveDraft(platform, SPACE, draft);
		flushDraft();
		await vi.advanceTimersByTimeAsync(0);
		expect(store.get(DRAFT_KEY)).toEqual(draft);
		await vi.advanceTimersByTimeAsync(600);
		flushDraft();
		expect(set).toHaveBeenCalledTimes(1);
	});
});
