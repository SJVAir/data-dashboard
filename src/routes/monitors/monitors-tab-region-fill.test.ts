import { describe, expect, it, vi } from "vitest";
import * as sdk from "@sjvair/sdk";
import { monitorsTabManager } from "./monitors-tab.svelte";

vi.mock("@sjvair/sdk", async () => {
	const actual = await vi.importActual<typeof import("@sjvair/sdk")>("@sjvair/sdk");
	return {
		...actual,
		getRegionSummariesBulkMonthly: vi.fn()
	};
});

describe("MonitorsTabManager.refreshRegionFill", () => {
	it("clears the fill and skips the bulk fetch when the active type's selection is empty", async () => {
		monitorsTabManager.pollutant = "pm25";
		monitorsTabManager.dateRange = { start: "2026-01-01", end: "2026-01-31" };
		monitorsTabManager.activeRegions = [];
		monitorsTabManager.regionFillColors = new Map([["placeholder", "#fff"]]);

		await monitorsTabManager.refreshRegionFill();

		expect(monitorsTabManager.regionFillColors).toBeNull();
		expect(sdk.getRegionSummariesBulkMonthly).not.toHaveBeenCalled();
	});
});
