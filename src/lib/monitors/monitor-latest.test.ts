import { describe, expect, it } from "vitest";
import type { MonitorData } from "@sjvair/sdk";
import { buildMonitorsLatest } from "./monitor-latest";

function makeMonitor(id: string): MonitorData {
	// Cast: this fixture only needs the fields buildMonitorsLatest reads
	// (id, plus whatever it spreads through); it isn't validated against
	// the full MonitorData schema.
	return {
		county: "Fresno",
		data_source: { name: "SJVAir", url: "https://sjvair.com" },
		data_providers: [],
		device: "bam1022",
		grade: "fem",
		id,
		is_active: true,
		is_sjvair: true,
		last_active_limit: 3600,
		location: "outside",
		name: `Monitor ${id}`,
		position: { type: "Point", coordinates: [0, 0] },
		type: "bam1022"
	} as MonitorData;
}

describe("buildMonitorsLatest", () => {
	it("includes monitors with an average value", () => {
		const monitors = [makeMonitor("1")];
		const averages = new Map([["1", 12.5]]);
		const latest = buildMonitorsLatest(monitors, averages, "pm25", "2026-01-07");
		expect(latest.get("1")?.latest.value).toBe("12.5");
		expect(latest.get("1")?.latest.entry_type).toBe("pm25");
		expect(latest.get("1")?.id).toBe("1");
	});

	it("skips monitors with no average", () => {
		const monitors = [makeMonitor("1"), makeMonitor("2")];
		const averages = new Map([["1", 12.5]]);
		const latest = buildMonitorsLatest(monitors, averages, "pm25", "2026-01-07");
		expect(latest.has("2")).toBe(false);
		expect(latest.size).toBe(1);
	});
});
