import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({
	getDatasetCatalog: vi.fn(),
	getMonitorsMeta: vi.fn(),
	getHMSMeta: vi.fn()
}));

import { getDatasetCatalog, getHMSMeta, getMonitorsMeta } from "@sjvair/sdk";
import type { MetadataSource } from "$lib/data/metadata";
import { fixtureMetadata } from "$lib/data/testing/fixtures";
import { mapMetadata } from "./metadata";

const PM25_SCALE = { label: "PM2.5", levels: [{ key: "good" }] };
const SMOKE_SCALE = { label: "Smoke", levels: [{ key: "light" }] };
const FIRE_SCALE = { label: "Fire", levels: [{ key: "fire" }] };

function stub(overrides: Partial<MetadataSource> = {}): MetadataSource {
	return fixtureMetadata({
		serverScale: async (dataset, entryType) =>
			dataset === "air-quality" && entryType === "pm25"
				? PM25_SCALE
				: dataset === "hms-smoke" && entryType === "smoke"
					? SMOKE_SCALE
					: dataset === "hms-fire" && entryType === "fire"
						? FIRE_SCALE
						: null,
		catalog: async () => [
			{
				id: "air-quality",
				label: "Air quality",
				source: "SJVAir",
				geographies: [],
				entryTypes: [
					{
						id: "pm25",
						label: "PM2.5",
						units: "µg/m³",
						kind: "pollutant",
						resolutions: [],
						precision: 1,
						yMin: null,
						chart: null,
						aggregate: null
					}
				]
			}
		],
		...overrides
	});
}

describe("mapMetadata", () => {
	beforeEach(() => vi.clearAllMocks());

	it("gives map-sdk the server's PM2.5 scale and its label and units", async () => {
		const md = mapMetadata(stub());
		const ref = { dataset: "air-quality", entryType: "pm25" };
		expect(await md.scale(ref)).toBe(PM25_SCALE);
		expect(await md.entryType(ref)).toEqual({ label: "PM2.5", units: "µg/m³", precision: 1 });
		expect(await md.attribution("air-quality")).toBe("SJVAir");
		expect(await md.monitorTypeLabel("purpleair")).toBe("PurpleAir");
		expect(await md.monitorTypeInterval?.("purpleair")).toBe("2 min");
	});

	it("gives the HMS smoke and fire scales", async () => {
		const md = mapMetadata(stub());
		expect(await md.scale({ dataset: "hms-smoke", entryType: "smoke" })).toBe(SMOKE_SCALE);
		expect(await md.scale({ dataset: "hms-fire", entryType: "fire" })).toBe(FIRE_SCALE);
	});

	it("resolves unavailable for an unknown type or a failed fetch, and rejects on abort", async () => {
		const md = mapMetadata(
			stub({
				catalog: async () => "unavailable",
				monitorTypeInterval: async () => {
					throw new Error("offline");
				}
			})
		);
		expect(await md.scale({ dataset: "air-quality", entryType: "nope" })).toBe("unavailable");
		expect(await md.entryType({ dataset: "air-quality", entryType: "pm25" })).toBe("unavailable");
		expect(await md.attribution("air-quality")).toBe("unavailable");
		expect(await md.monitorTypeLabel("nope")).toBe("unavailable");
		expect(await md.monitorTypeInterval?.("purpleair")).toBe("unavailable");

		const controller = new AbortController();
		const aborting = mapMetadata(
			stub({
				serverScale: async () => {
					controller.abort();
					throw new DOMException("aborted", "AbortError");
				}
			})
		);
		await expect(
			aborting.scale({ dataset: "air-quality", entryType: "pm25" }, controller.signal)
		).rejects.toThrow();
	});

	it("rejects on abort from every read, and resolves unavailable when only the read failed", async () => {
		const abortThrow = (controller: AbortController) => async () => {
			controller.abort();
			throw new DOMException("aborted", "AbortError");
		};
		const ref = { dataset: "air-quality", entryType: "pm25" };
		const reads: [
			string,
			(md: ReturnType<typeof mapMetadata>, s: AbortSignal) => Promise<unknown>
		][] = [
			["entryType", (md, s) => md.entryType(ref, s)],
			["attribution", (md, s) => md.attribution("air-quality", s)],
			["monitorTypeLabel", (md, s) => md.monitorTypeLabel("purpleair", s)],
			["monitorTypeInterval", (md, s) => md.monitorTypeInterval!("purpleair", s)]
		];
		for (const [name, read] of reads) {
			const controller = new AbortController();
			const thrower = abortThrow(controller);
			const md = mapMetadata(
				stub({
					catalog: thrower,
					monitorTypes: thrower,
					monitorTypeInterval: thrower
				})
			);
			await expect(read(md, controller.signal), name).rejects.toThrow();
			// The same failure with no abort reads as unavailable.
			const quiet = mapMetadata(
				stub({
					catalog: async () => {
						throw new Error("offline");
					},
					monitorTypes: async () => {
						throw new Error("offline");
					}
				})
			);
			expect(await read(quiet, new AbortController().signal)).toBe(
				name === "monitorTypeInterval" ? "2 min" : "unavailable"
			);
		}
	});

	it("is one provider per source", () => {
		const source = stub();
		expect(mapMetadata(source)).toBe(mapMetadata(source));
	});

	it("never fetches through map-sdk", async () => {
		const md = mapMetadata(stub());
		await md.scale({ dataset: "air-quality", entryType: "pm25" });
		await md.entryType({ dataset: "air-quality", entryType: "pm25" });
		await md.attribution("air-quality");
		await md.monitorTypeLabel("purpleair");
		expect(getMonitorsMeta).not.toHaveBeenCalled();
		expect(getDatasetCatalog).not.toHaveBeenCalled();
		expect(getHMSMeta).not.toHaveBeenCalled();
	});
});
