import { beforeEach, describe, expect, it } from "vitest";
import { clearAllPreferences, getTabPreferences, setTabPreferences } from "./preferences";

function createMemoryStorage(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (key) => store.get(key) ?? null,
		setItem: (key, value) => {
			store.set(key, value);
		},
		removeItem: (key) => {
			store.delete(key);
		},
		clear: () => store.clear(),
		key: (index) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		}
	};
}

beforeEach(() => {
	globalThis.localStorage = createMemoryStorage();
});

describe("preferences", () => {
	it("returns an empty object for a tab with no stored preferences", () => {
		expect(getTabPreferences("monitors")).toEqual({});
	});

	it("persists and retrieves preferences for a tab", () => {
		setTabPreferences("monitors", { dateRange: { start: "2026-01-01", end: "2026-01-02" } });
		expect(getTabPreferences("monitors")).toEqual({
			dateRange: { start: "2026-01-01", end: "2026-01-02" }
		});
	});

	it("keeps preferences for different tabs independent", () => {
		setTabPreferences("monitors", { views: { map: true, chart: false, spreadsheet: false } });
		setTabPreferences("hms", { views: { map: false, chart: true, spreadsheet: true } });
		expect(getTabPreferences("monitors").views).toEqual({
			map: true,
			chart: false,
			spreadsheet: false
		});
		expect(getTabPreferences("hms").views).toEqual({ map: false, chart: true, spreadsheet: true });
	});

	it("merges partial updates instead of overwriting the whole tab", () => {
		setTabPreferences("monitors", { dateRange: { start: "2026-01-01", end: "2026-01-02" } });
		setTabPreferences("monitors", { views: { map: true, chart: true, spreadsheet: false } });
		expect(getTabPreferences("monitors")).toEqual({
			dateRange: { start: "2026-01-01", end: "2026-01-02" },
			views: { map: true, chart: true, spreadsheet: false }
		});
	});

	it("clearAllPreferences removes all stored data", () => {
		setTabPreferences("monitors", { dateRange: { start: "2026-01-01", end: "2026-01-02" } });
		clearAllPreferences();
		expect(getTabPreferences("monitors")).toEqual({});
	});

	it("recovers from corrupted JSON in storage instead of throwing", () => {
		localStorage.setItem("sjvair-dashboard-preferences", "{not json");
		expect(getTabPreferences("monitors")).toEqual({});
	});

	it("recovers from a stored tabs value that isn't an object", () => {
		localStorage.setItem("sjvair-dashboard-preferences", JSON.stringify({ tabs: null }));
		expect(getTabPreferences("monitors")).toEqual({});
	});

	it("behaves safely when localStorage itself is unavailable", () => {
		// @ts-expect-error - simulating an environment without localStorage
		delete globalThis.localStorage;

		expect(() => getTabPreferences("monitors")).not.toThrow();
		expect(getTabPreferences("monitors")).toEqual({});

		expect(() =>
			setTabPreferences("monitors", { dateRange: { start: "2026-01-01", end: "2026-01-02" } })
		).not.toThrow();
		expect(getTabPreferences("monitors")).toEqual({});

		expect(() => clearAllPreferences()).not.toThrow();
	});
});
