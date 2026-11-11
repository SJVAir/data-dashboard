import { expect, test } from "vitest";
import type { WidgetDataConfig } from "$lib/data/schema";
import type { PlaceInfo } from "$lib/data/types";
import { withReplacements } from "./retired";

const retiredPlace = (place: string, to: { type: string; code: string } | null): PlaceInfo => ({
	place,
	name: "Old",
	retired: { since: "2024-01-01", replacedBy: to }
});

test("swaps a retired region place for its replacement", () => {
	const data: WidgetDataConfig = {
		layers: [
			{ dataset: "d", place: { kind: "region", type: "tract", code: "1" } },
			{ dataset: "d", place: { kind: "monitor", id: "m" } }
		]
	};
	const out = withReplacements(data, [
		retiredPlace("region:tract:1", { type: "tract", code: "2" })
	]);
	expect(out?.layers[0].place).toEqual({ kind: "region", type: "tract", code: "2" });
	expect(out?.layers[1]).toEqual(data.layers[1]);
	expect(data.layers[0].place).toEqual({ kind: "region", type: "tract", code: "1" });
});

test("swaps selection ids and drops duplicates", () => {
	const data: WidgetDataConfig = {
		layers: [
			{ dataset: "d", selection: { kind: "regions", ids: ["tract:1", "tract:2", "tract:3"] } }
		]
	};
	const out = withReplacements(data, [
		retiredPlace("region:tract:1", { type: "tract", code: "2" })
	]);
	expect(out?.layers[0].selection?.ids).toEqual(["tract:2", "tract:3"]);
});

test("null when no retired place has a replacement", () => {
	const data: WidgetDataConfig = {
		layers: [{ dataset: "d", place: { kind: "region", type: "tract", code: "1" } }]
	};
	expect(withReplacements(data, [retiredPlace("region:tract:1", null)])).toBeNull();
	expect(withReplacements(data, [{ place: "region:tract:1", name: "x" }])).toBeNull();
	expect(
		withReplacements(data, [retiredPlace("region:tract:9", { type: "tract", code: "2" })])
	).toBeNull();
});

test("swaps a retired school for its replacement", () => {
	const data: WidgetDataConfig = {
		layers: [{ dataset: "d", place: { kind: "location", source: "cde-public", code: "1" } }]
	};
	const out = withReplacements(data, [
		{
			place: "region:zipcode:93702",
			name: "93702",
			via: {
				kind: "location",
				source: "cde-public",
				code: "1",
				name: "Old School",
				retired: { since: "2024-01-01", replacedBy: { source: "cde-public", code: "2" } }
			}
		}
	]);
	expect(out?.layers[0].place).toEqual({ kind: "location", source: "cde-public", code: "2" });
	expect(data.layers[0].place).toEqual({ kind: "location", source: "cde-public", code: "1" });
});

test("a retired school without a replacement swaps nothing", () => {
	const data: WidgetDataConfig = {
		layers: [{ dataset: "d", place: { kind: "location", source: "cde-public", code: "1" } }]
	};
	expect(
		withReplacements(data, [
			{
				place: "region:zipcode:93702",
				name: "93702",
				via: {
					kind: "location",
					source: "cde-public",
					code: "1",
					name: "Old School",
					retired: { since: "2024-01-01", replacedBy: null }
				}
			}
		])
	).toBeNull();
});
