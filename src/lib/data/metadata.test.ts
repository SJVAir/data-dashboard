import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({
	getMonitorsMeta: vi.fn(),
	getMonitorsList: vi.fn()
}));

import { getMonitorsList, getMonitorsMeta } from "@sjvair/sdk";
import { createWebMetadata, withCatalog, type CatalogEntry } from "./metadata";

const META = {
	monitors: {
		purpleair: { entries: { pm25: { default_calibration: "PM25_EPA_Calibration" } } },
		bam1022: { entries: { pm25: { default_calibration: "" } } }
	},
	entries: {
		pm25: {
			levels: {
				MODERATE: { name: "moderate", label: "Moderate", color: "#ffff00", range: [9.1, 35.4] },
				GOOD: { name: "good", label: "Good", color: "#00e400", range: [0, 9] }
			}
		},
		humidity: { levels: null }
	}
};

const LIST = [
	{ id: "m-pa", name: "PA One", type: "purpleair", device: "PA-II" },
	{ id: "m-bam", name: "BAM One", type: "bam1022" }
];

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(getMonitorsMeta).mockResolvedValue(META as never);
	vi.mocked(getMonitorsList).mockResolvedValue(LIST as never);
});

describe("createWebMetadata", () => {
	it("reports the catalog as unavailable", async () => {
		expect(await createWebMetadata().catalog()).toBe("unavailable");
	});

	it("fetches the meta once across several calls", async () => {
		const md = createWebMetadata();
		await md.levels("pm25");
		await md.levels("pm25");
		await md.levels("humidity");
		expect(getMonitorsMeta).toHaveBeenCalledTimes(1);
	});

	it("orders levels by range start and maps null levels to []", async () => {
		const md = createWebMetadata();
		const levels = await md.levels("pm25");
		expect(levels.map((l) => l.name)).toEqual(["good", "moderate"]);
		expect(levels[0]).toEqual({ name: "good", label: "Good", color: "#00e400", range: [0, 9] });
		expect(await md.levels("humidity")).toEqual([]);
		expect(await md.levels("nope")).toEqual([]);
	});

	it("returns the default calibration, mapping empty and unknown to null", async () => {
		const md = createWebMetadata();
		expect(await md.defaultProcessor("purpleair", "pm25")).toBe("PM25_EPA_Calibration");
		expect(await md.defaultProcessor("bam1022", "pm25")).toBeNull();
		expect(await md.defaultProcessor("purpleair", "o3")).toBeNull();
		expect(await md.defaultProcessor("nope", "pm25")).toBeNull();
	});

	it("looks up monitor types and lists monitors from one fetch", async () => {
		const md = createWebMetadata();
		expect(await md.monitorType("m-pa")).toBe("purpleair");
		expect(await md.monitorType("unknown")).toBeNull();
		expect(await md.monitors()).toEqual([
			{ id: "m-pa", name: "PA One", type: "purpleair" },
			{ id: "m-bam", name: "BAM One", type: "bam1022" }
		]);
		expect(getMonitorsList).toHaveBeenCalledTimes(1);
	});

	it("does not cache a failed fetch", async () => {
		vi.mocked(getMonitorsMeta).mockRejectedValueOnce(new Error("boom"));
		const md = createWebMetadata();
		await expect(md.levels("pm25")).rejects.toThrow("boom");
		expect((await md.levels("pm25")).length).toBe(2);
		expect(getMonitorsMeta).toHaveBeenCalledTimes(2);
	});

	it("rejects an aborted caller without poisoning the memo for others", async () => {
		let release!: () => void;
		vi.mocked(getMonitorsMeta).mockImplementationOnce(
			() => new Promise((resolve) => (release = () => resolve(META as never)))
		);
		const md = createWebMetadata();
		const ctrl = new AbortController();
		const aborted = md.levels("pm25", ctrl.signal);
		const other = md.levels("pm25");
		ctrl.abort();
		await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
		release();
		expect((await other).length).toBe(2);
		expect(getMonitorsMeta).toHaveBeenCalledTimes(1);
	});

	it("rejects immediately for an already-aborted signal", async () => {
		const ctrl = new AbortController();
		ctrl.abort();
		await expect(createWebMetadata().levels("pm25", ctrl.signal)).rejects.toMatchObject({
			name: "AbortError"
		});
	});
});

describe("withCatalog", () => {
	const catalog: CatalogEntry[] = [
		{ id: "air-quality", label: "Air quality", entryTypes: [], geographies: ["monitor"] }
	];

	it("returns the given catalog and delegates the rest", async () => {
		const md = withCatalog(createWebMetadata(), catalog);
		expect(await md.catalog()).toBe(catalog);
		expect((await md.levels("pm25")).length).toBe(2);
		expect(await md.defaultProcessor("purpleair", "pm25")).toBe("PM25_EPA_Calibration");
		expect(await md.monitorType("m-bam")).toBe("bam1022");
		expect((await md.monitors()).length).toBe(2);
	});
});
