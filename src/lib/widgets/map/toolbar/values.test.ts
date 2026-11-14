import { describe, expect, it } from "vitest";
import type { OptionValues } from "@sjvair/map-sdk";
import type { MonitorFeatureProperties } from "@sjvair/map-sdk/data";
import type { FeatureCollection, Point } from "geojson";
import {
	activeFilters,
	filterMonitors,
	placeMonitors,
	groupsShown,
	toOptions,
	toValues,
	withoutToolbar,
	type MapOffer
} from "./values";

const defaults: OptionValues = {
	basemap: "streets",
	clustered: true,
	inactive: false,
	inside: false,
	fireAndSmoke: false
};
const offer: MapOffer = {
	pollutants: ["pm25", "o3"],
	types: ["purpleair", "airnow"],
	hasInactive: true,
	hasInside: true,
	smokeAndFire: false
};
const rows = { types: true, inactive: true, inside: true };

describe("toOptions", () => {
	it("stores a value equal to its default as missing", () => {
		const out = toOptions({ basemap: "satellite" }, { ...defaults }, ["basemap"], defaults, "pm25");
		expect(out).not.toHaveProperty("basemap");
	});

	it("writes a changed value that differs from its default", () => {
		const out = toOptions({}, { ...defaults, basemap: "satellite" }, ["basemap"], defaults, "pm25");
		expect(out.basemap).toBe("satellite");
	});

	it("edits hiddenTypes from type:* changes", () => {
		const off = toOptions(
			{},
			{ ...defaults, "type:purpleair": false },
			["type:purpleair"],
			defaults,
			"pm25"
		);
		expect(off.hiddenTypes).toEqual(["purpleair"]);
		const on = toOptions(
			off,
			{ ...defaults, "type:purpleair": true },
			["type:purpleair"],
			defaults,
			"pm25"
		);
		expect(on).not.toHaveProperty("hiddenTypes");
	});

	it("saves a pollutant other than the first, drops the first", () => {
		const first = toOptions(
			{ showing: "o3" },
			{ ...defaults, pollutant: "pm25" },
			["pollutant"],
			defaults,
			"pm25"
		);
		expect(first).not.toHaveProperty("showing");
		const other = toOptions({}, { ...defaults, pollutant: "o3" }, ["pollutant"], defaults, "pm25");
		expect(other.showing).toBe("o3");
	});

	it("keeps marks through any change", () => {
		const out = toOptions(
			{ marks: ["a"] },
			{ ...defaults, clustered: false },
			["clustered"],
			defaults,
			"pm25"
		);
		expect(out).toEqual({ marks: ["a"], clustered: false });
	});
});

describe("toValues", () => {
	it("shows the drawn pollutant, not the saved one", () => {
		const v = toValues({ showing: "no2" }, offer, defaults, "o3");
		expect(v.pollutant).toBe("o3");
	});

	it("shows a type on unless hidden", () => {
		const v = toValues({ hiddenTypes: ["airnow"] }, offer, defaults, "pm25");
		expect(v["type:purpleair"]).toBe(true);
		expect(v["type:airnow"]).toBe(false);
	});

	it("takes other values from options, else defaults", () => {
		const v = toValues({ inactive: true }, offer, defaults, "pm25");
		expect(v.inactive).toBe(true);
		expect(v.inside).toBe(false);
		expect(v.basemap).toBe("streets");
	});
});

describe("activeFilters", () => {
	it("filters nothing by types when the row is not offered", () => {
		const f = activeFilters({ hiddenTypes: ["purpleair"] }, offer, { ...rows, types: false });
		expect(f.hiddenTypes.size).toBe(0);
	});

	it("hides inactive by default when the row is offered", () => {
		expect(activeFilters({}, offer, rows).hideInactive).toBe(true);
		expect(activeFilters({ inactive: true }, offer, rows).hideInactive).toBe(false);
	});

	it("does not filter by a row that is not offered", () => {
		const f = activeFilters({}, offer, { ...rows, inactive: false, inside: false });
		expect(f.hideInactive).toBe(false);
		expect(f.hideInside).toBe(false);
	});
});

describe("groupsShown", () => {
	it("hides pollutant for one pollutant", () => {
		expect(groupsShown({ ...offer, pollutants: ["pm25"] }, 3).pollutant).toBe(false);
		expect(groupsShown(offer, 3).pollutant).toBe(true);
	});
	it("shows layers with smokeAndFire", () => {
		expect(groupsShown({ ...offer, smokeAndFire: true }, 3).layers).toBe(true);
		expect(groupsShown(offer, 3).layers).toBe(false);
	});
	it("hides monitors under two rows", () => {
		expect(groupsShown(offer, 1).monitors).toBe(false);
		expect(groupsShown(offer, 2).monitors).toBe(true);
	});
});

describe("withoutToolbar", () => {
	it("keeps marks and drops every toolbar key", () => {
		expect(
			withoutToolbar({
				marks: ["a"],
				showing: "o3",
				basemap: "x",
				clustered: false,
				fireAndSmoke: true,
				inactive: true,
				inside: true,
				hiddenTypes: ["t"]
			})
		).toEqual({ marks: ["a"] });
	});
});

describe("filterMonitors", () => {
	let n = 0;
	const feature = (
		type: string,
		isActive: boolean,
		location: "inside" | "outside",
		id = `m${n++}`
	) => ({
		type: "Feature" as const,
		geometry: { type: "Point" as const, coordinates: [0, 0] },
		properties: { type, isActive, location, refKey: `monitor:${id}` } as MonitorFeatureProperties
	});
	const fc: FeatureCollection<Point, MonitorFeatureProperties> = {
		type: "FeatureCollection",
		features: [
			feature("purpleair", true, "outside"),
			feature("airnow", false, "outside"),
			feature("airnow", true, "inside")
		]
	};
	it("returns null for null", () => {
		expect(
			filterMonitors(null, { hiddenTypes: new Set(), hideInactive: false, hideInside: false })
		).toBeNull();
	});
	it("drops by type, inactive and inside", () => {
		const out = filterMonitors(fc, {
			hiddenTypes: new Set(["purpleair"]),
			hideInactive: true,
			hideInside: true
		});
		expect(out?.features).toHaveLength(0);
		expect(
			filterMonitors(fc, { hiddenTypes: new Set(), hideInactive: true, hideInside: false })
				?.features
		).toHaveLength(2);
		expect(
			filterMonitors(fc, { hiddenTypes: new Set(), hideInactive: false, hideInside: false })
		).toEqual(fc);
	});
	it("never hides the tile's own monitors (inactive, inside or of a hidden type)", () => {
		const own: FeatureCollection<Point, MonitorFeatureProperties> = {
			type: "FeatureCollection",
			features: [
				feature("purpleair", true, "outside", "near"),
				feature("airnow", false, "outside", "old"),
				feature("airnow", true, "inside", "indoor"),
				feature("purpleair", true, "outside", "picked")
			]
		};
		const out = filterMonitors(
			own,
			{ hiddenTypes: new Set(["purpleair"]), hideInactive: true, hideInside: true },
			new Set(["old", "indoor", "picked"])
		);
		expect(out?.features.map((f) => f.properties.refKey)).toEqual([
			"monitor:old",
			"monitor:indoor",
			"monitor:picked"
		]);
	});
});

describe("placeMonitors", () => {
	it("is a monitor place's id, or a monitors selection's ids", () => {
		expect([...placeMonitors({ place: { kind: "monitor", id: "x" } })]).toEqual(["x"]);
		expect([...placeMonitors({ selection: { kind: "monitors", ids: ["a", "b"] } })]).toEqual([
			"a",
			"b"
		]);
	});
	it("is empty for regions, points and no places", () => {
		expect(placeMonitors(undefined).size).toBe(0);
		expect(placeMonitors({ place: { kind: "region", type: "county", code: "019" } }).size).toBe(0);
		expect(placeMonitors({ selection: { kind: "regions", ids: ["r019"] } }).size).toBe(0);
	});
});
