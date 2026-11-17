import {
	monitorsOptions,
	type MapContext,
	type OptionGroup,
	type OptionRow
} from "@sjvair/map-sdk";
import type { MetadataProvider } from "@sjvair/map-sdk/data";
import { describe, expect, it, vi } from "vitest";
import { mapMessages } from "../host/messages";
import { MapToolbar } from "./toolbar.svelte";
import type { MapOffer } from "./values";

vi.mock("@sjvair/map-sdk", async (original) => {
	const sdk = await original<typeof import("@sjvair/map-sdk")>();
	return { ...sdk, monitorsOptions: vi.fn(sdk.monitorsOptions) };
});

const GROUPS = { pm25: "reference", "sjvair-purple": "low-cost", "sjvair-inspire": "low-cost" };

function stubMap(): MapContext {
	const metadata = {
		scale: async () => "unavailable",
		entryType: async ({ entryType }: { entryType: string }) => ({
			label: entryType.toUpperCase(),
			units: ""
		}),
		monitorTypeLabel: async (type: string) => type,
		attribution: async () => "unavailable",
		monitorGroups: async () => [
			{ key: "reference", label: "Reference-grade", order: 1 },
			{ key: "low-cost", label: "Low-cost sensors", order: 2 }
		],
		monitorTypeGroup: async (type: string) => GROUPS[type as keyof typeof GROUPS] ?? "unavailable",
		monitorTypeReports: async () => true
	} as unknown as MetadataProvider;
	return {
		messages: mapMessages,
		metadata,
		basemap: {
			styles: [
				{ id: "streets-v4", basemap: "Streets", isDefault: true },
				{ id: "streets-v4-dark", basemap: "Streets" },
				{ id: "satellite", basemap: "Satellite" }
			],
			current: "streets-v4",
			defaultId: "streets-v4"
		}
	} as unknown as MapContext;
}

const offer = (over: Partial<MapOffer> = {}): MapOffer => ({
	pollutants: ["pm25"],
	types: ["sjvair-purple"],
	hasInactive: false,
	hasInside: false,
	smokeAndFire: false,
	fill: false,
	notices: false,
	use: null,
	...over
});

/** Lets the presets' metadata answers land. */
const settle = () => new Promise((r) => setTimeout(r, 0));
const ids = (groups: OptionGroup[]) => groups.map((g) => g.id);
const group = (groups: OptionGroup[], id: string) => groups.find((g) => g.id === id)!;
const kinds = (rows: OptionRow[]) => rows.map((r) => r.kind);

describe("MapToolbar", () => {
	it("calls monitorsOptions once, in the constructor", () => {
		vi.mocked(monitorsOptions).mockClear();
		const toolbar = new MapToolbar(stubMap());
		toolbar.build({ offer: offer(), drawn: "pm25", options: {} });
		toolbar.build({ offer: offer(), drawn: "pm25", options: {} });
		expect(monitorsOptions).toHaveBeenCalledTimes(1);
	});

	it("one pollutant, one type and no smoke: only Settings", () => {
		const { groups, rows } = new MapToolbar(stubMap()).build({
			offer: offer(),
			drawn: "pm25",
			options: {}
		});
		expect(ids(groups)).toEqual(["settings"]);
		expect(rows).toEqual({ types: false, inactive: false, inside: false });
	});

	it("two pollutants: a Pollutant group choosing the one drawn", () => {
		const { groups, values } = new MapToolbar(stubMap()).build({
			offer: offer({ pollutants: ["pm25", "o3"] }),
			drawn: "o3",
			options: { showing: "pm100" }
		});
		expect(ids(groups)).toEqual(["pollutant", "settings"]);
		const radio = group(groups, "pollutant").rows[0];
		expect(radio.kind).toBe("radio");
		expect(radio.id).toBe("pollutant");
		expect(values.pollutant).toBe("o3");
	});

	it("types spanning both groups get headings; one group is flat", async () => {
		const toolbar = new MapToolbar(stubMap());
		const both = offer({ types: ["pm25", "sjvair-purple", "sjvair-inspire"] });
		const one = offer({ types: ["sjvair-purple", "sjvair-inspire"] });
		toolbar.build({ offer: both, drawn: "pm25", options: {} });
		toolbar.build({ offer: one, drawn: "pm25", options: {} });
		await settle();

		const spanning = toolbar.build({ offer: both, drawn: "pm25", options: {} });
		expect(kinds(group(spanning.groups, "monitors").rows)).toEqual(["group", "group"]);
		expect(spanning.rows.types).toBe(true);
		expect(spanning.values).toMatchObject({
			"type:pm25": true,
			"type:sjvair-purple": true,
			"type:sjvair-inspire": true
		});

		const flat = toolbar.build({ offer: one, drawn: "pm25", options: {} });
		expect(kinds(group(flat.groups, "monitors").rows)).toEqual(["checkbox", "checkbox"]);
		expect(ids(flat.groups)).toEqual(["monitors", "settings"]);
	});

	it("one type with Inactive and Inside: the Monitors group shows all three rows", () => {
		const { groups, rows, defaults } = new MapToolbar(stubMap()).build({
			offer: offer({ hasInactive: true, hasInside: true }),
			drawn: "pm25",
			options: { hiddenTypes: ["sjvair-purple"] }
		});
		expect(ids(groups)).toEqual(["monitors", "settings"]);
		expect(rows).toEqual({ types: true, inactive: true, inside: true });
		expect(defaults).toMatchObject({ inactive: false, inside: false, clustered: true });
	});

	it("on a day stop the Inactive row isn't offered; Inside and the types still are", () => {
		const { groups, rows } = new MapToolbar(stubMap()).build({
			offer: offer({ hasInactive: true, hasInside: true }),
			drawn: "pm25",
			options: { inactive: true },
			day: true
		});
		expect(rows).toEqual({ types: true, inactive: false, inside: true });
		const monitors = group(groups, "monitors").rows.map((r) => r.id);
		expect(monitors).not.toContain("inactive");
		expect(monitors).toContain("inside");
	});

	it("smoke and fire: a Layers group with one Fire & Smoke checkbox", () => {
		const { groups, defaults, values } = new MapToolbar(stubMap()).build({
			offer: offer({ smokeAndFire: true }),
			drawn: "pm25",
			options: { fireAndSmoke: false }
		});
		expect(ids(groups)).toEqual(["layers", "settings"]);
		const layers = group(groups, "layers");
		expect(layers.label).toBe(mapMessages("mapsdk_options_layers"));
		expect(layers.icon).toBeTypeOf("function");
		expect(layers.rows).toHaveLength(1);
		expect(layers.rows[0]).toMatchObject({ kind: "checkbox", id: "fireAndSmoke" });
		expect(defaults.fireAndSmoke).toBe(true);
		expect(values.fireAndSmoke).toBe(false);
	});

	it("a fill alone: a Layers group with its row, named by the region type, on by default", () => {
		const { groups, defaults, values } = new MapToolbar(stubMap()).build({
			offer: offer({ fill: true }),
			drawn: "pm25",
			options: { fillShown: false },
			fillLabel: "ZIP Codes"
		});
		expect(ids(groups)).toEqual(["layers", "settings"]);
		const layers = group(groups, "layers");
		expect(layers.rows).toHaveLength(1);
		expect(layers.rows[0]).toMatchObject({ kind: "checkbox", id: "regions", label: "ZIP Codes" });
		expect((layers.rows[0] as { icon?: unknown }).icon).toBeTypeOf("function");
		expect(defaults.regions).toBe(true);
		expect(values.regions).toBe(false);
	});

	it("smoke and fire and a fill: one Layers group, Fire & Smoke then the fill", () => {
		const { groups } = new MapToolbar(stubMap()).build({
			offer: offer({ smokeAndFire: true, fill: true }),
			drawn: "pm25",
			options: {},
			fillLabel: "ZIP Codes"
		});
		expect(group(groups, "layers").rows.map((r) => r.id)).toEqual(["fireAndSmoke", "regions"]);
	});

	it("notices: a Layers row after Fire & Smoke and the fill, named by the catalog, on by default", () => {
		const { groups, defaults, values } = new MapToolbar(stubMap()).build({
			offer: offer({ smokeAndFire: true, fill: true, notices: true }),
			drawn: "pm25",
			options: { noticesShown: false },
			fillLabel: "ZIP Codes",
			noticesLabel: "Spray Notices"
		});
		const rows = group(groups, "layers").rows;
		expect(rows.map((r) => r.id)).toEqual(["fireAndSmoke", "regions", "notices"]);
		expect(rows[2]).toMatchObject({ kind: "checkbox", id: "notices", label: "Spray Notices" });
		expect((rows[2] as { icon?: unknown }).icon).toBeTypeOf("function");
		expect(defaults.notices).toBe(true);
		expect(values.notices).toBe(false);
	});

	it("notices alone show the Layers group; without them, no row and no default", () => {
		const alone = new MapToolbar(stubMap()).build({
			offer: offer({ notices: true }),
			drawn: "pm25",
			options: {},
			noticesLabel: "Spray Notices"
		});
		expect(ids(alone.groups)).toEqual(["layers", "settings"]);
		const without = new MapToolbar(stubMap()).build({
			offer: offer({ notices: false }),
			drawn: "pm25",
			options: {},
			noticesLabel: "Spray Notices"
		});
		expect(ids(without.groups)).toEqual(["settings"]);
		expect(without.defaults).not.toHaveProperty("notices");
	});

	it("no fill row without a fill, and the defaults leave regions out", () => {
		const { groups, defaults } = new MapToolbar(stubMap()).build({
			offer: offer({ fill: false }),
			drawn: "pm25",
			options: {},
			fillLabel: "ZIP Codes"
		});
		expect(ids(groups)).toEqual(["settings"]);
		expect(defaults).not.toHaveProperty("regions");
	});

	it("without smoke and fire, defaults leave fireAndSmoke out", () => {
		const { defaults } = new MapToolbar(stubMap()).build({
			offer: offer(),
			drawn: "pm25",
			options: {}
		});
		expect(defaults).toEqual({
			pollutant: "pm25",
			"type:sjvair-purple": true,
			clustered: true,
			basemap: "streets-v4"
		});
	});

	it("a viewer's defaults are the owner's values; the values are the options over the presets", () => {
		const ownerValues = { pollutant: "pm25", clustered: false, basemap: "satellite" };
		const { defaults, values } = new MapToolbar(stubMap()).build({
			offer: offer(),
			drawn: "pm25",
			options: { basemap: "satellite" },
			ownerValues
		});
		expect(defaults).toEqual(ownerValues);
		// `clustered` is missing (held as missing, say): the preset's default, as the map draws it.
		expect(values).toMatchObject({ clustered: true, basemap: "satellite" });
	});

	it("gives every group and row an icon snippet where the spec names one", () => {
		const { groups } = new MapToolbar(stubMap()).build({
			offer: offer({ types: ["pm25", "sjvair-purple"], smokeAndFire: true }),
			drawn: "pm25",
			options: {}
		});
		for (const id of ["monitors", "layers", "settings"]) {
			expect(group(groups, id).icon, id).toBeTypeOf("function");
		}
		const settings = group(groups, "settings").rows;
		const clusters = settings.find((r) => r.id === "clustered");
		expect(clusters?.kind === "checkbox" && clusters.icon).toBeTypeOf("function");
		for (const row of settings.filter((r) => r.id === "basemap")) {
			expect(row.kind === "separator" ? null : row.icon, row.kind).toBeTypeOf("function");
		}
		const fire = group(groups, "layers").rows[0];
		expect(fire.kind === "separator" ? null : fire.icon).toBeTypeOf("function");
	});

	it("ids are single tokens", () => {
		const { groups } = new MapToolbar(stubMap()).build({
			offer: offer({ pollutants: ["pm25", "o3"], types: ["pm25", "sjvair-purple"] }),
			drawn: "pm25",
			options: {}
		});
		const all = groups.flatMap((g) => [
			g.id,
			...g.rows.flatMap((r) => [r.id, ...(r.kind === "group" ? r.children.map((c) => c.id) : [])])
		]);
		for (const id of all) expect(id).not.toMatch(/\s/);
	});
});
