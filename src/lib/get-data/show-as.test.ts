import { beforeAll, describe, expect, it } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import type { CatalogEntry } from "$lib/data/metadata";
import type { Layer } from "$lib/data/schema";
import { FIXTURE_CATALOG } from "$lib/data/testing/fixtures";
import { widgetOptionsValid } from "$lib/documents/schema";
import { contributionCalendarType } from "$lib/widgets/calendars/contribution";
import { monthCalendarType } from "$lib/widgets/calendars/month";
import { chartType } from "$lib/widgets/chart";
import { currentType } from "$lib/widgets/current";
import { forecastType } from "$lib/widgets/forecast";
import { mapType } from "$lib/widgets/map";
import { mapShowingOnly } from "$lib/get-data/map";
import { outsideType } from "$lib/widgets/outside";
import { registerWidgetType, type WidgetType } from "$lib/widgets/registry";
import { FORECASTS_ENTRY, PM25_LEVELS } from "$lib/widgets/shared/test-harness/fake-data";
import { dataTableType } from "$lib/widgets/table";
import { DraftSchema, type Draft } from "./draft.svelte";
import type { NowDropped } from "./now";
import { typeBlock } from "./offer";
import { firstPollutantOnly } from "$lib/widgets/current/pollutants";
import { showAsDraft, sourceType, type ShowAsContext } from "./show-as";

const TYPES = ["airnow", "purpleair", "airgradient"];
const TICKED = ["airnow", "purpleair"];
const CATALOG: CatalogEntry[] = [{ ...FIXTURE_CATALOG[0], monitorTypes: TYPES }, FORECASTS_ENTRY];
/** Noon Pacific, 2026-11-15. */
const NOW = new Date("2026-11-15T20:00:00Z");
const CTX: ShowAsContext = {
	catalog: CATALOG,
	allowed: ["pm25", "o3"],
	levels: PM25_LEVELS,
	now: NOW
};
const COUNTY = { kind: "region", type: "county", code: "06019" } as const;
const RANGE = { kind: "trailing", amount: 14, unit: "day" } as const;
const ALL: WidgetType[] = [
	mapType,
	chartType,
	dataTableType,
	currentType,
	outsideType,
	forecastType,
	monthCalendarType,
	contributionCalendarType
];
const MAP = mapType.type;
const CHART = chartType.type;
const TABLE = dataTableType.type;
const CURRENT = currentType.type;
const OUTSIDE = outsideType.type;
const FORECAST = forecastType.type;
const MONTH = monthCalendarType.type;
const CONTRIB = contributionCalendarType.type;
const CALENDARS = [MONTH, CONTRIB];
const MANY = [MAP, CHART, TABLE];

beforeAll(() => ALL.forEach(registerWidgetType));

/** A county, PM2.5, two ticked types and (unless `monitor` is false) one searched monitor. */
function rich(type: string, monitor = true): Draft {
	return {
		type,
		data: {
			dateRange: structuredClone(RANGE),
			place: structuredClone(COUNTY),
			layers: [
				{
					dataset: "air-quality",
					entryType: "pm25",
					monitorTypes: [...TICKED],
					...(monitor ? { monitors: ["m1"] } : {})
				}
			]
		}
	};
}

/** A calendar at the county with PM2.5 over its default range. */
function calendar(type: WidgetType): Draft {
	return {
		type: type.type,
		data: {
			dateRange: structuredClone(type.defaultRange!),
			place: structuredClone(COUNTY),
			layers: [{ dataset: "air-quality", entryType: "pm25" }]
		}
	};
}

/** Why `to` is greyed out for `draft` in Show as (as `GetDataView` checks it), or `null`. */
function block(draft: Draft, to: WidgetType) {
	if (to.type === MAP || to.time === "now") return null;
	const data = draft.type === MAP ? mapShowingOnly(draft, CATALOG).draft.data : draft.data;
	return typeBlock(to, data, CATALOG, NOW);
}
const blocked = (draft: Draft, to: WidgetType) => block(draft, to) !== null;

function aq(d: Draft): Layer | undefined {
	return d.data.layers.find((l) => l.dataset === "air-quality" || l.dataset === "forecasts");
}

const sorted = (d: NowDropped[]) => [...d].sort();

/** Converts and checks it parses with the current schemas. */
function convert(draft: Draft, to: WidgetType) {
	const c = showAsDraft(structuredClone(draft), to, CTX);
	expect(c.draft.type).toBe(to.type);
	expect(DraftSchema.safeParse(c.draft).success, JSON.stringify(c.draft)).toBe(true);
	expect(widgetOptionsValid(c.draft.type, c.draft.options)).toBe(true);
	return c;
}

describe("Show as, every pair, from a county, PM2.5, two ticked types and one monitor", () => {
	const ranged = [MAP, CHART, TABLE];
	/** Single-place sources as the Data Portal makes them: converted from the Chart first. */
	const derived = (type: WidgetType): Draft =>
		CALENDARS.includes(type.type) ? calendar(type) : convert(rich(CHART), type).draft;

	/** What each pair leaves out (`from>to`); a pair not listed is blocked or drops nothing. */
	const DROPS: Record<string, NowDropped[]> = {};
	for (const from of ranged) {
		for (const to of [CURRENT, OUTSIDE, FORECAST])
			DROPS[`${from}>${to}`] = ["dates", "places", "monitor-types"];
	}
	for (const from of [CURRENT, OUTSIDE]) {
		for (const to of [MAP, CHART, TABLE, FORECAST]) DROPS[`${from}>${to}`] = ["alert"];
	}
	for (const from of CALENDARS) {
		for (const to of [CURRENT, OUTSIDE, FORECAST]) DROPS[`${from}>${to}`] = ["dates"];
	}
	// The forecast has no pollutant of its own: a range type shows PM2.5, with a note.
	for (const to of [CHART, TABLE, ...CALENDARS]) DROPS[`${FORECAST}>${to}`] = ["forecast"];

	for (const fromType of ALL) {
		for (const toType of ALL) {
			if (fromType === toType) continue;
			const from = fromType.type;
			const to = toType.type;
			it(`${from} → ${to}`, () => {
				const source = ranged.includes(from) ? rich(from) : derived(fromType);
				if (ranged.includes(from) && CALENDARS.includes(to)) {
					// A county and a monitor are two places: greyed out (decision 11).
					expect(block(source, toType)).toBe("places");
					return;
				}
				if (from === FORECAST && CALENDARS.includes(to)) {
					// A calendar takes air quality only, so a forecasts layer is greyed out (as before 7a).
					expect(block(source, toType)).toBe("dataset");
					return;
				}
				expect(blocked(source, toType)).toBe(false);
				const c = convert(source, toType);
				expect(sorted(c.dropped)).toEqual(sorted(DROPS[`${from}>${to}`] ?? []));
				const layer = aq(c.draft);
				const sourceMonitor = !!aq(source)?.monitors?.length;
				if (sourceMonitor) {
					// The monitor goes along; a single-place type's monitor wins over the Where.
					expect(layer?.monitors).toEqual(["m1"]);
					if (MANY.includes(to) && ranged.includes(from))
						expect(c.draft.data.place).toEqual(COUNTY);
					else expect(c.draft.data.place).toBeUndefined();
				} else {
					expect(c.draft.data.place).toEqual(COUNTY);
				}
				// Ticks are kept between the Map, Chart and Table (decision 8); a new Map from a draft
				// with neither ticks nor monitors ticks every type; single-place types have none.
				if (MANY.includes(to) && ranged.includes(from)) expect(layer?.monitorTypes).toEqual(TICKED);
				else if (to === MAP && !sourceMonitor) expect(layer?.monitorTypes).toEqual(TYPES);
				else expect(layer?.monitorTypes).toBeUndefined();
				// The pollutant is kept (the Forecast strip has none of its own).
				if (to === FORECAST)
					expect(layer).toEqual({
						dataset: "forecasts",
						...(layer?.monitors ? { monitors: ["m1"] } : {})
					});
				else expect(layer?.entryType).toBe("pm25");
			});
		}
	}
});

describe("Show as to a calendar from a county and two ticked types (no monitor)", () => {
	for (const from of [MAP, CHART, TABLE]) {
		for (const toType of [monthCalendarType, contributionCalendarType]) {
			it(`${from} → ${toType.type} drops the ticks with a note, keeps the county`, () => {
				const source = rich(from, false);
				expect(blocked(source, toType)).toBe(false);
				const c = convert(source, toType);
				expect(c.dropped).toEqual(["monitor-types"]);
				expect(c.draft.data.place).toEqual(COUNTY);
				expect(c.draft.data.layers).toEqual([{ dataset: "air-quality", entryType: "pm25" }]);
			});
		}
	}
});

describe("Show as from a Map with schools and child care", () => {
	it("notes them as left out, with copy", () => {
		const draft: Draft = {
			type: MAP,
			data: {
				place: structuredClone(COUNTY),
				layers: [
					{ dataset: "air-quality", entryType: "pm25" },
					{ dataset: "locations", locationTypes: ["x"] }
				]
			}
		};
		const c = convert(draft, chartType);
		expect(c.dropped).toContain("locations");
		expect(c.dropped).not.toContain("overlays");
		expect(c.draft.data.layers.some((l) => l.dataset === "locations")).toBe(false);
		// The ticked types go with the conversion, so its note can name their groups.
		expect(c.locationTypes).toEqual(["x"]);
	});
});

describe("Show as from a Map with None, smoke and a fill", () => {
	const none = (ticks: boolean): Draft => ({
		type: MAP,
		data: {
			place: structuredClone(COUNTY),
			layers: [
				...(ticks ? [{ dataset: "air-quality", monitorTypes: [...TICKED] }] : []),
				{ dataset: "hms-smoke" },
				{ dataset: "hms-fire" }
			]
		},
		options: { fill: "county" }
	});

	for (const toType of ALL.filter((t) => t !== mapType)) {
		const to = toType.type;
		it(`Map → ${to}: smoke and the fill left out, no pollutant added to a range type`, () => {
			const c = convert(none(false), toType);
			expect(sorted(c.dropped)).toEqual(sorted(["overlays", "fill"]));
			expect(c.draft.data.place).toEqual(COUNTY);
			expect(c.draft.options).toBeUndefined();
			if (toType.time === "now") {
				// A now type shows a pollutant (the Forecast strip its forecasts).
				expect(c.draft.data.layers).toHaveLength(1);
			} else {
				expect(c.draft.data.layers).toEqual([]);
			}
		});

		it(`Map → ${to}: ticks kept under None stay on Chart and Table, else left out with a note`, () => {
			const c = convert(none(true), toType);
			const single = !MANY.includes(to);
			expect(sorted(c.dropped)).toEqual(
				sorted(["overlays", "fill", ...(single ? (["monitor-types"] as const) : [])])
			);
			expect(c.draft.data.place).toEqual(COUNTY);
			if (single) {
				expect(c.draft.data.layers.some((l) => l.monitorTypes)).toBe(false);
				if (toType.time !== "now") expect(c.draft.data.layers).toEqual([]);
			} else {
				expect(c.draft.data.layers).toEqual([{ dataset: "air-quality", monitorTypes: TICKED }]);
			}
		});
	}

	it("back to a Map from the Chart: no pollutant added, nothing noted (decision 6)", () => {
		const chart = convert(none(false), chartType).draft;
		chart.data.layers = [{ dataset: "hms-smoke" }];
		const c = convert(chart, mapType);
		expect(c.dropped).toEqual([]);
		expect(c.pollutant).toBeUndefined();
		expect(c.draft.data.layers).toEqual([{ dataset: "hms-smoke" }, { dataset: "hms-fire" }]);
		expect(c.draft.data.place).toEqual(COUNTY);
	});

	it("a Chart with None and ticks becomes a Map with None and the same ticks", () => {
		const chart = convert(none(true), chartType).draft;
		const c = convert(chart, mapType);
		expect(c.dropped).toEqual([]);
		expect(c.draft.data.layers).toEqual([{ dataset: "air-quality", monitorTypes: TICKED }]);
	});
});

it("a single-place type's greyed reason counts a monitor too (decision 11)", () => {
	expect(m.get_data_block_places({ count: "1", countValue: 1 })).toBe("Shows 1 place or monitor");
	expect(m.get_data_block_places({ count: "12", countValue: 12 })).toBe("Shows up to 12 places");
});

describe("Show as from Current conditions with PM2.5 and ozone", () => {
	/** A county, PM2.5 and ozone, with an alert level for each. */
	const two = (): Draft => ({
		type: CURRENT,
		data: {
			place: structuredClone(COUNTY),
			layers: [
				{ dataset: "air-quality", entryType: "pm25" },
				{ dataset: "air-quality", entryType: "o3" }
			]
		},
		thresholds: [
			{ level: "unhealthy_sensitive", entryType: "pm25" },
			{ level: "moderate", entryType: "o3" }
		]
	});

	for (const toType of [chartType, dataTableType, mapType, monthCalendarType, outsideType]) {
		it(`→ ${toType.type}: one PM2.5 layer, ozone left out with a note`, () => {
			const c = convert(two(), toType);
			expect(c.draft.data.layers.filter((l) => l.dataset === "air-quality")).toEqual([
				expect.objectContaining({ entryType: "pm25" })
			]);
			expect(c.draft.data.layers.some((l) => l.entryType === "o3")).toBe(false);
			expect(c.dropped).toContain("pollutants");
			expect(c.dropped).not.toContain("overlays");
			expect(c.leftOut).toEqual([{ dataset: "air-quality", entryType: "o3" }]);
			// A type with an alert level keeps PM2.5's (a Chart's line is its own opt-in).
			if (toType.thresholds && toType !== chartType) {
				expect(c.draft.thresholds).toEqual([{ level: "unhealthy_sensitive" }]);
			} else {
				expect(c.draft.thresholds).toBeUndefined();
			}
		});
	}

	it("→ the Forecast strip: no pollutant, so none noted as left out", () => {
		const c = convert(two(), forecastType);
		expect(c.draft.data.layers.some((l) => l.entryType)).toBe(false);
		expect(c.dropped).not.toContain("pollutants");
		expect(c.leftOut).toBeUndefined();
	});

	it("isn't greyed out for the Chart once cut to its first pollutant", () => {
		expect(typeBlock(chartType, firstPollutantOnly(two()).data, CATALOG, NOW)).toBeNull();
	});

	it("stays a Current conditions source with no pollutant ticked (R4)", () => {
		const none: Draft = {
			type: CURRENT,
			data: { layers: [{ dataset: "air-quality", monitors: ["m1"] }] }
		};
		expect(sourceType(none, CTX)).toBe(currentType);
	});
});
