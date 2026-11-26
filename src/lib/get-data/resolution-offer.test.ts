import { describe, expect, test } from "vitest";
import { mapDatasetCatalog } from "$lib/data/metadata";
import type { DateRangeSpec, Layer, WidgetDataConfig } from "$lib/data/schema";
import { MAP_LEVELS } from "$lib/data/dataset-rules";
import {
	PESTICIDE_USE_DATASET,
	SDK_DATASET_CATALOG,
	WEATHER_DATASET
} from "$lib/data/testing/dataset-catalog";
import { resolutionChoices, type ResolutionChoice } from "./resolution-offer";

const NOW = new Date("2026-11-05T20:00:00Z");

const catalog = mapDatasetCatalog({
	...SDK_DATASET_CATALOG,
	datasets: [...SDK_DATASET_CATALOG.datasets, WEATHER_DATASET, PESTICIDE_USE_DATASET]
});

const pm25: Layer = { dataset: "air-quality", entryType: "pm25" };
const use: Layer = { dataset: "pesticide-use", entryType: "pounds-applied" };
const temperature: Layer = { dataset: "weather", entryType: "temperature" };

/** A custom range of `days` whole Pacific days, ending 2026-11-01. */
function days(n: number): DateRangeSpec {
	const start = new Date(Date.UTC(2026, 10, 1) - (n - 1) * 86_400_000).toISOString().slice(0, 10);
	return { kind: "custom", start, end: "2026-11-01" };
}

function choices(
	layers: Layer[],
	range: DateRangeSpec,
	places = 1,
	extra: Partial<Parameters<typeof resolutionChoices>[0]> = {}
): ResolutionChoice[] | null {
	const data: WidgetDataConfig = {
		dateRange: range,
		// The place kind is given (`place`), so the data needs no Where or monitors.
		layers
	};
	return resolutionChoices({
		data,
		catalog,
		place: "monitors",
		range,
		places,
		pin: undefined,
		now: NOW,
		...extra
	});
}

const blocked = (list: ResolutionChoice[] | null, level: string) =>
	list?.find((c) => c.level === level)?.blocked;

describe("resolutionChoices", () => {
	test("Automatic first, then every level, finest first", () => {
		expect(choices([pm25], days(7))?.map((c) => c.level)).toEqual([
			"auto",
			"raw",
			"hour",
			"day",
			"month",
			"year"
		]);
	});

	test("a pinned type hides the control", () => {
		expect(choices([pm25], days(30), 1, { pin: "day" })).toBeNull();
	});

	test("PM2.5 with pesticide use: raw, hourly and daily are greyed naming the use layer", () => {
		const list = choices([pm25, use], days(400));
		for (const level of ["raw", "hour", "day"]) {
			expect(blocked(list, level)).toEqual({ notOffered: use });
		}
		expect(blocked(list, "month")).toBeNull();
		expect(blocked(list, "year")).toBeNull();
		expect(blocked(list, "auto")).toBeNull();
	});

	test("weather has no Every measurement: greyed, not hidden", () => {
		const list = choices([temperature], days(7));
		expect(list?.map((c) => c.level)).toContain("raw");
		expect(blocked(list, "raw")).toEqual({ notOffered: temperature });
		expect(blocked(list, "hour")).toBeNull();
	});

	test("regions have no Every measurement", () => {
		expect(blocked(choices([pm25], days(7), 1, { place: "regions" }), "raw")).toMatchObject({
			notOffered: pm25
		});
	});

	test("the Map offers Daily, Monthly and Yearly only", () => {
		expect(choices([pm25], days(30), 1, { within: MAP_LEVELS })?.map((c) => c.level)).toEqual([
			"auto",
			"day",
			"month",
			"year"
		]);
	});

	test("no level has a range cap of its own (requests are chunked): only the point budget", () => {
		// The researcher's case: hourly at six places, January to June, is about 26 000 points.
		const halfYear: DateRangeSpec = { kind: "custom", start: "2026-01-01", end: "2026-06-30" };
		expect(blocked(choices([pm25], halfYear, 6), "hour")).toBeNull();
		const long = choices([pm25], days(3650));
		expect(blocked(long, "day")).toBeNull();
		expect(blocked(long, "month")).toBeNull();
		expect(blocked(long, "auto")).toBeNull();
	});

	test("more than 50 000 points (places × periods) is too many", () => {
		// 31 days of hours is 744 periods: 67 places is 49 848 points, 68 is 50 592.
		expect(blocked(choices([pm25], days(31), 67), "hour")).toBeNull();
		expect(blocked(choices([pm25], days(31), 68), "hour")).toBe("too-many-points");
		// Raw counts a reading every two minutes: a month at three places is too many.
		expect(blocked(choices([pm25], days(31), 1), "raw")).toBeNull();
		expect(blocked(choices([pm25], days(31), 3), "raw")).toBe("too-many-points");
		// Ten years of days at ten places is fine.
		expect(blocked(choices([pm25], days(3650), 10), "day")).toBeNull();
	});

	test("an explicit Hourly over a range grown past the budget stays listed, blocked", () => {
		const data: WidgetDataConfig = { dateRange: days(31), layers: [pm25], resolution: "hour" };
		const list = resolutionChoices({
			data,
			catalog,
			place: "monitors",
			range: days(31),
			places: 68,
			pin: undefined,
			now: NOW
		});
		expect(blocked(list, "hour")).toBe("too-many-points");
		expect(data.resolution).toBe("hour");
	});

	test("rolling ranges are measured as they resolve now", () => {
		const last90: DateRangeSpec = { kind: "trailing", amount: 90, unit: "day" };
		// 90 days of raw readings at one place is 64 800 points.
		expect(blocked(choices([pm25], last90), "raw")).toBe("too-many-points");
		const last24: DateRangeSpec = { kind: "trailing", amount: 24, unit: "hour" };
		expect(blocked(choices([pm25], last24), "raw")).toBeNull();
	});
});

describe("raw greyed by the place", () => {
	test("names the area's cause and its finest level", () => {
		const got = choices([pm25], days(3), 1, { place: "regions" });
		expect(got?.find((c) => c.level === "raw")?.blocked).toEqual({
			notOffered: pm25,
			cause: "area",
			finest: "hour"
		});
		const types = choices([pm25], days(3), 1, { place: "monitor-types" });
		expect(types?.find((c) => c.level === "raw")?.blocked).toMatchObject({
			cause: "monitor-types"
		});
	});
	test("weather's raw names no place", () => {
		const got = choices([temperature], days(3), 1, { place: "regions" });
		expect(got?.find((c) => c.level === "raw")?.blocked).toEqual({ notOffered: temperature });
	});
});
