import { describe, expect, it } from "vitest";
import type { MonitorGroup } from "@sjvair/sdk";
import type { MonitorSummary, MonitorTypeInfo } from "$lib/data/metadata";
import { m } from "$lib/paraglide/messages.js";
import { monitorGroups, monitorRows, OTHER_GROUP } from "./monitor-choices";

const GROUPS: MonitorGroup[] = [
	{ key: "low-cost", label: "Low-cost sensors", order: 1 },
	{ key: "reference", label: "Reference-grade", order: 0 }
];

function info(type: string, label: string, group: string | null, entryTypes = ["pm25"]) {
	return { type, label, group, entryTypes, published: entryTypes } satisfies MonitorTypeInfo;
}

const TYPES: MonitorTypeInfo[] = [
	info("airnow", "AirNow", "reference", ["pm25", "o3"]),
	info("purpleair", "PurpleAir", "low-cost", ["pm25", "pm100"]),
	info("aqlite", "AQ Lite", "reference"),
	info("airgradient", "AirGradient", "low-cost"),
	info("aqview", "AQview", "reference", ["pm25", "o3"]),
	info("vozbox", "VozBox", "low-cost"),
	info("bam1022", "BAM 1022", "reference")
];

/** The groups as `[key, label, [type, label, blocked?][]]`, for short assertions. */
function shape(groups: ReturnType<typeof monitorGroups>) {
	return groups.map((g) => [g.key, g.label, g.types.map((t) => [t.type, t.label, t.blocked])]);
}

describe("monitorGroups", () => {
	it("monitor choices: groups in meta order with their types", () => {
		expect(shape(monitorGroups(GROUPS, TYPES, "pm25"))).toEqual([
			[
				"reference",
				"Reference-grade",
				[
					["airnow", "AirNow", undefined],
					["aqlite", "AQ Lite", undefined],
					["aqview", "AQview", undefined],
					["bam1022", "BAM 1022", undefined]
				]
			],
			[
				"low-cost",
				"Low-cost sensors",
				[
					["purpleair", "PurpleAir", undefined],
					["airgradient", "AirGradient", undefined],
					["vozbox", "VozBox", undefined]
				]
			]
		]);
	});

	it("monitor choices: a type with no group goes last, in its own group", () => {
		const types = [info("loner", "Loner", null), ...TYPES, info("lost", "Lost", "gone-group")];
		const groups = monitorGroups(GROUPS, types, "pm25");
		expect(groups.map((g) => g.key)).toEqual(["reference", "low-cost", OTHER_GROUP]);
		expect(groups.at(-1)).toEqual({
			key: OTHER_GROUP,
			label: m.get_data_monitor_group_other(),
			types: [
				{ type: "loner", label: "Loner" },
				{ type: "lost", label: "Lost" }
			]
		});
		// No groups in the meta at all: every type in the one group.
		expect(shape(monitorGroups(null, types.slice(0, 2), "pm25"))).toEqual([
			[
				OTHER_GROUP,
				m.get_data_monitor_group_other(),
				[
					["loner", "Loner", undefined],
					["airnow", "AirNow", undefined]
				]
			]
		]);
	});

	it('monitor choices: with None every type is blocked "no-pollutant"', () => {
		const groups = monitorGroups(GROUPS, TYPES, undefined);
		expect(groups.flatMap((g) => g.types.map((t) => t.blocked))).toEqual(
			TYPES.map(() => "no-pollutant")
		);
	});

	it('monitor choices: a type that doesn\'t supply ozone is blocked "not-supplied" and stays ticked', () => {
		const groups = monitorGroups(GROUPS, TYPES, "o3");
		const blocked = Object.fromEntries(
			groups.flatMap((g) => g.types.map((t) => [t.type, t.blocked]))
		);
		expect(blocked).toEqual({
			airnow: undefined,
			aqview: undefined,
			aqlite: "not-supplied",
			bam1022: "not-supplied",
			purpleair: "not-supplied",
			airgradient: "not-supplied",
			vozbox: "not-supplied"
		});
	});

	it("offers the catalog's types: one the meta lacks is labelled by its id, in the other group", () => {
		const groups = monitorGroups(GROUPS, TYPES, "o3", ["purpleair", "newtype", "airnow"]);
		expect(shape(groups)).toEqual([
			["reference", "Reference-grade", [["airnow", "AirNow", undefined]]],
			["low-cost", "Low-cost sensors", [["purpleair", "PurpleAir", "not-supplied"]]],
			// Unknown, not "not supplied": the meta doesn't say what it measures.
			[OTHER_GROUP, m.get_data_monitor_group_other(), [["newtype", "newtype", undefined]]]
		]);
	});
});

describe("monitorRows", () => {
	const LIST: MonitorSummary[] = [
		{ id: "m1", name: "Hwy 41", type: "airnow", county: "Fresno", active: true, inside: false },
		{ id: "m2", name: "Backyard", type: "purpleair", county: "Fresno", active: true, inside: false }
	];

	it("names each searched monitor with its network, greyed like its type", () => {
		expect(monitorRows(["m2", "m1", "gone"], LIST, TYPES, "o3")).toEqual([
			{ id: "m2", name: "Backyard", network: "PurpleAir", blocked: "not-supplied" },
			{ id: "m1", name: "Hwy 41", network: "AirNow" },
			// No longer listed: its id, as nothing else names it.
			{ id: "gone", name: "gone", network: null }
		]);
		expect(monitorRows(["m1"], LIST, TYPES, undefined)).toEqual([
			{ id: "m1", name: "Hwy 41", network: "AirNow", blocked: "no-pollutant" }
		]);
	});
});
