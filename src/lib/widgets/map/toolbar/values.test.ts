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
	smokeAndFire: false,
	fill: false,
	notices: false,
	locations: [],
	use: null
};
const rows = { types: true, inactive: true, inside: true };

describe("toOptions", () => {
	it("stores a value equal to its default as missing", () => {
		const out = toOptions({ basemap: "satellite" }, { ...defaults }, ["basemap"], defaults);
		expect(out).not.toHaveProperty("basemap");
	});

	it("writes a changed value that differs from its default", () => {
		const out = toOptions({}, { ...defaults, basemap: "satellite" }, ["basemap"], defaults);
		expect(out.basemap).toBe("satellite");
	});

	it("edits hiddenTypes from type:* changes", () => {
		const off = toOptions(
			{},
			{ ...defaults, "type:purpleair": false },
			["type:purpleair"],
			defaults
		);
		expect(off.hiddenTypes).toEqual(["purpleair"]);
		const on = toOptions(
			off,
			{ ...defaults, "type:purpleair": true },
			["type:purpleair"],
			defaults
		);
		expect(on).not.toHaveProperty("hiddenTypes");
	});

	it("saves nothing for a pollutant change (a Map holds one)", () => {
		const out = toOptions(
			{ marks: ["a"] },
			{ ...defaults, pollutant: "o3" },
			["pollutant"],
			defaults
		);
		expect(out).toEqual({ marks: ["a"] });
	});

	it("keeps marks through any change", () => {
		const out = toOptions(
			{ marks: ["a"] },
			{ ...defaults, clustered: false },
			["clustered"],
			defaults
		);
		expect(out).toEqual({ marks: ["a"], clustered: false });
	});
});

describe("toValues", () => {
	it("shows the drawn pollutant", () => {
		const v = toValues({}, offer, defaults, "o3");
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
		const f = activeFilters({ hiddenTypes: ["purpleair"] }, offer, { ...rows, types: false }, {});
		expect(f.hiddenTypes.size).toBe(0);
	});

	it("hides inactive by default when the row is offered", () => {
		expect(activeFilters({}, offer, rows, {}).hideInactive).toBe(true);
		expect(activeFilters({ inactive: true }, offer, rows, {}).hideInactive).toBe(false);
	});

	it("does not filter by a row that is not offered", () => {
		const f = activeFilters({}, offer, { ...rows, inactive: false, inside: false }, {});
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

describe("fillShown", () => {
	it("toOptions: regions true removes fillShown, false stores false", () => {
		const on = toOptions(
			{ fillShown: false },
			{ ...defaults, regions: true },
			["regions"],
			defaults
		);
		expect(on).not.toHaveProperty("fillShown");
		const off = toOptions({}, { ...defaults, regions: false }, ["regions"], defaults);
		expect(off.fillShown).toBe(false);
	});

	it("toValues gives regions true with no saved value, false when saved false", () => {
		expect(toValues({}, offer, defaults, "pm25").regions).toBe(true);
		expect(toValues({ fillShown: false }, offer, defaults, "pm25").regions).toBe(false);
	});

	it("shows the layers group with a fill and no smoke and fire", () => {
		expect(groupsShown({ ...offer, fill: true }, 3).layers).toBe(true);
	});
});

describe("withoutToolbar", () => {
	it("keeps marks and drops every toolbar key", () => {
		expect(
			withoutToolbar({
				marks: ["a"],
				basemap: "x",
				clustered: false,
				fireAndSmoke: true,
				inactive: true,
				inside: true,
				hiddenTypes: ["t"]
			})
		).toEqual({ marks: ["a"] });
	});

	it("clears fillShown and keeps day and fill", () => {
		expect(withoutToolbar({ at: "2026-11-14", fill: "city", fillShown: false })).toEqual({
			at: "2026-11-14",
			fill: "city"
		});
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
	it("is the air-quality layer's searched monitors", () => {
		expect([...placeMonitors({ monitors: ["x"] })]).toEqual(["x"]);
		expect([...placeMonitors({ monitors: ["a", "b"] })]).toEqual(["a", "b"]);
	});
	it("is empty with no searched monitors (ticked types aren't exempt)", () => {
		expect(placeMonitors(undefined).size).toBe(0);
		expect(placeMonitors({}).size).toBe(0);
		expect(placeMonitors({ monitors: [] }).size).toBe(0);
	});
});

describe("notices", () => {
	it("the notices row maps to noticesShown and back, and on is never written", () => {
		const on = toOptions(
			{ noticesShown: false },
			{ ...defaults, notices: true },
			["notices"],
			defaults
		);
		expect(on).not.toHaveProperty("noticesShown");
		const off = toOptions({}, { ...defaults, notices: false }, ["notices"], defaults);
		expect(off.noticesShown).toBe(false);
		expect(toValues({}, offer, defaults, "pm25").notices).toBe(true);
		expect(toValues({ noticesShown: false }, offer, defaults, "pm25").notices).toBe(false);
	});
	it("Layers shows for notices alone", () => {
		expect(groupsShown({ ...offer, notices: true }, 3).layers).toBe(true);
	});
	it("Reset removes noticesShown", () => {
		expect(withoutToolbar({ noticesShown: false, at: "2026-11-14" })).toEqual({
			at: "2026-11-14"
		});
	});
});

describe("pesticide use rows", () => {
	const useOffer = { ...offer, use: { figures: ["pounds-applied"] } };
	it("the use rows have no period: the period is the Map's stop", () => {
		const shown = toValues({}, useOffer, defaults, "pm25", "pounds-applied");
		expect(Object.keys(shown).filter((k) => /^use(Year|Month)$/.test(k))).toEqual([]);
		expect(shown.use).toBe(true);
		expect(shown.useFigure).toBe("pounds-applied");
	});
	it("the use row and figure map to useShown and useFigure", () => {
		expect(toOptions({}, { use: false }, ["use"], defaults)).toEqual({
			useShown: false
		});
		expect(toOptions({ useShown: false }, { use: true }, ["use"], defaults)).toEqual({});
		expect(
			toOptions({}, { useFigure: "acres-treated" }, ["useFigure"], defaults, "pounds-applied")
		).toEqual({ useFigure: "acres-treated" });
		expect(
			toOptions(
				{ useFigure: "acres-treated" },
				{ useFigure: "pounds-applied" },
				["useFigure"],
				defaults,
				"pounds-applied"
			)
		).toEqual({});
	});
	it("groupsShown counts the use layer", () => {
		expect(groupsShown(useOffer, 1)).toMatchObject({ layers: true, use: true });
		expect(groupsShown(offer, 1).use).toBe(false);
	});
	it("Reset removes useFigure and useShown but keeps the stop", () => {
		expect(
			withoutToolbar({ useFigure: "acres-treated", useShown: false, at: "2022-01-01" })
		).toEqual({ at: "2022-01-01" });
	});
});

describe("location group rows", () => {
	const groups = [
		{ key: "school", label: "Schools" },
		{ key: "child_care", label: "Child care" }
	];
	const withGroups = { ...offer, locations: groups };
	it("each group's row shows unless hidden", () => {
		const shown = toValues({ hiddenLocationGroups: ["school"] }, withGroups, defaults, "pm25");
		expect(shown["location:school"]).toBe(false);
		expect(shown["location:child_care"]).toBe(true);
	});
	it("the rows map to hiddenLocationGroups, and none hidden is never written", () => {
		const off = toOptions(
			{},
			{ ...defaults, "location:school": false },
			["location:school"],
			defaults
		);
		expect(off).toEqual({ hiddenLocationGroups: ["school"] });
		const on = toOptions(
			off,
			{ ...defaults, "location:school": true },
			["location:school"],
			defaults
		);
		expect(on).toEqual({});
	});
	it("Layers shows for location groups alone", () => {
		expect(groupsShown(withGroups, 1).layers).toBe(true);
	});
	it("Reset removes hiddenLocationGroups", () => {
		expect(withoutToolbar({ hiddenLocationGroups: ["school"] })).toEqual({});
	});
});
