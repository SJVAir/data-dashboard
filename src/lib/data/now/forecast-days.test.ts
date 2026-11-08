import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({
	getForecastForPlace: vi.fn(),
	getForecastsMeta: vi.fn()
}));

import { getForecastForPlace } from "@sjvair/sdk";
import type { AdapterContext } from "../adapters/registry";
import type { Layer } from "../schema";
import { fixtureMetadata } from "../testing/fixtures";
import { forecastRow, placeResponse } from "../testing/forecasts-fixtures";
import { forecastDaysSource, type ForecastDays } from "./forecast-days";

// 2026-11-08 10:00 Pacific; at 05:30Z on the 9th it is 21:30 Pacific on the 8th.
const NOW = new Date("2026-11-08T18:00:00Z");
const LATE = new Date("2026-11-09T05:30:00Z");

const ctx: AdapterContext = {
	metadata: fixtureMetadata({
		scaleSource: async (_d, entryType) =>
			entryType === "aqi-forecast" ? { name: "AirNow", url: "https://a.example" } : null
	}),
	regions: {
		resolve: async (type, code) =>
			type === "county" && code === "06019" ? { id: "sq1", name: "Fresno County" } : null
	},
	locations: { resolve: async () => null },
	points: { keys: async () => ["county:06019"] }
};

const county: Layer = {
	dataset: "forecasts",
	entryType: "aqi-forecast",
	place: { kind: "region", type: "county", code: "06019" }
} as Layer;

const get = vi.mocked(getForecastForPlace);

async function days(layer: Layer = county, now: Date = NOW): Promise<ForecastDays> {
	const source = await forecastDaysSource(layer, ctx, () => now);
	if ("unavailable" in source) throw new Error(`unavailable: ${source.unavailable}`);
	return source.fetch(new AbortController().signal);
}

beforeEach(() => {
	get.mockReset();
});

describe("forecastDaysSource", () => {
	it("keys by the resolved place, never coordinates, on the hour cadence", async () => {
		const layer = { ...county, place: { kind: "point", lat: 36.7, lon: -119.8 } } as Layer;
		const source = await forecastDaysSource(layer, ctx, () => NOW);
		if ("unavailable" in source) throw new Error("unavailable");
		expect(source.key).toContain("county:06019");
		expect(source.key).not.toMatch(/36\.7|119\.8/);
		expect(source.cadence).toBe("hour");
	});

	it("keeps the latest issue for each date", async () => {
		get.mockResolvedValue(
			placeResponse([
				forecastRow("2026-11-08", "2026-11-07", 40, "Discouraged"),
				forecastRow("2026-11-08", "2026-11-08", 60, "Discouraged"),
				forecastRow("2026-11-09", "2026-11-08", 70, "Registered")
			]) as never
		);
		const d = await days();
		expect(d.days.map((x) => [x.date, x.aqi])).toEqual([
			["2026-11-08", 60],
			["2026-11-09", 70]
		]);
		expect(d.days[0].pollutant).toBe("PM2.5");
		expect(d.days[0].aqiLevel?.key).toBe("moderate");
		expect(d.zone).toEqual({ name: "Fresno County", nearest: false });
		expect(d.sources.aqi).toEqual({ name: "AirNow", url: "https://a.example" });
		expect(d.sources.burn).toBeNull();
		expect(d.publishedAt).toBe("2026-11-08T21:45:28Z");
	});

	it("drops days outside today and tomorrow, by Pacific date", async () => {
		const rows = [
			forecastRow("2026-11-07", "2026-11-07", 40, "Discouraged"),
			forecastRow("2026-11-08", "2026-11-08", 50, "Discouraged"),
			forecastRow("2026-11-09", "2026-11-08", 60, "Discouraged"),
			forecastRow("2026-11-10", "2026-11-08", 70, "Discouraged")
		];
		get.mockResolvedValue(placeResponse(rows) as never);
		expect((await days()).days.map((x) => x.date)).toEqual(["2026-11-08", "2026-11-09"]);
		// 21:30 Pacific on the 8th is already the 9th in UTC (and New York).
		expect((await days(county, LATE)).days.map((x) => x.date)).toEqual([
			"2026-11-08",
			"2026-11-09"
		]);
	});

	it("reads a burn status as its level, or the feed's text when unknown", async () => {
		get.mockResolvedValue(
			placeResponse([
				forecastRow("2026-11-08", "2026-11-08", 50, "Registered"),
				forecastRow("2026-11-09", "2026-11-08", 50, "Prohibited")
			]) as never
		);
		const [today, tomorrow] = (await days()).days;
		expect(today.burn).toMatchObject({ level: { key: "registered" } });
		expect(tomorrow.burn).toEqual({ text: "Prohibited: text" });
	});

	it("declares an Air Alert that overlaps today or tomorrow", async () => {
		const alert = {
			...forecastRow("2026-11-09", "2026-11-08", 160, "Discouraged"),
			air_alert: true,
			air_alert_start: "2026-11-09T08:00:00Z",
			air_alert_end: "2026-11-10T08:00:00Z"
		};
		get.mockResolvedValue(
			placeResponse([forecastRow("2026-11-08", "2026-11-08", 50, "Discouraged"), alert]) as never
		);
		expect((await days()).airAlert).toEqual({
			start: "2026-11-09T08:00:00Z",
			end: "2026-11-10T08:00:00Z"
		});
	});

	it("uses the forecast day when an Air Alert has no dates", async () => {
		const alert = {
			...forecastRow("2026-11-09", "2026-11-08", 160, "Discouraged"),
			air_alert: true
		};
		get.mockResolvedValue(placeResponse([alert]) as never);
		expect((await days()).airAlert).toEqual({ start: "2026-11-09", end: "2026-11-09" });
	});

	it("ignores an Air Alert that ended yesterday", async () => {
		const alert = {
			...forecastRow("2026-11-08", "2026-11-08", 160, "Discouraged"),
			air_alert: true,
			air_alert_start: "2026-11-06",
			air_alert_end: "2026-11-07"
		};
		get.mockResolvedValue(placeResponse([alert]) as never);
		expect((await days()).airAlert).toBeNull();
	});

	it("marks a center-matched zone as nearest", async () => {
		get.mockResolvedValue({ ...placeResponse([]), rule: "center" } as never);
		expect((await days()).zone).toEqual({ name: "Fresno County", nearest: true });
	});

	it("has no zone and no days when the place has no forecast", async () => {
		get.mockResolvedValue({ ...placeResponse([]), zone: null, rule: null } as never);
		const d = await days();
		expect(d).toMatchObject({ days: [], zone: null, airAlert: null, publishedAt: null });
	});

	it("tries the next fallback key after a 404", async () => {
		const notFound = new Error("x", { cause: { result: { status: 404 } } });
		get
			.mockRejectedValueOnce(notFound)
			.mockResolvedValueOnce(
				placeResponse([forecastRow("2026-11-08", "2026-11-08", 50, "Discouraged")]) as never
			);
		const multi: AdapterContext = {
			...ctx,
			points: { keys: async () => ["zipcode:93721", "county:06019"] },
			regions: { resolve: async (_t, c) => ({ id: c, name: c }) }
		};
		const layer = { ...county, place: { kind: "point", lat: 1, lon: 2 } } as Layer;
		const source = await forecastDaysSource(layer, multi, () => NOW);
		if ("unavailable" in source) throw new Error("unavailable");
		const d = await source.fetch(new AbortController().signal);
		expect(get).toHaveBeenCalledTimes(2);
		expect(d.days).toHaveLength(1);
		expect(d.place?.name).toBe("06019");
	});

	it("is unavailable for the reasons a layer target gives", async () => {
		const gone = { ...county, place: { kind: "region", type: "county", code: "nope" } } as Layer;
		expect(await forecastDaysSource(gone, ctx, () => NOW)).toEqual({
			unavailable: "region-unresolved"
		});
		const all = { dataset: "forecasts", entryType: "aqi-forecast" } as Layer;
		expect(await forecastDaysSource(all, ctx, () => NOW)).toEqual({
			unavailable: "place-unsupported"
		});
	});
});
