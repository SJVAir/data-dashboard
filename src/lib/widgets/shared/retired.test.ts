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
		place: { kind: "region", type: "tract", code: "1" },
		layers: [{ dataset: "d" }, { dataset: "e" }]
	};
	const out = withReplacements(data, [
		retiredPlace("region:tract:1", { type: "tract", code: "2" })
	]);
	expect(out?.place).toEqual({ kind: "region", type: "tract", code: "2" });
	expect(out?.layers).toEqual(data.layers);
	expect(data.place).toEqual({ kind: "region", type: "tract", code: "1" });
});

test("swaps selection ids and drops duplicates", () => {
	const data: WidgetDataConfig = {
		selection: { kind: "regions", ids: ["tract:1", "tract:2", "tract:3"] },
		layers: [{ dataset: "d" }]
	};
	const out = withReplacements(data, [
		retiredPlace("region:tract:1", { type: "tract", code: "2" })
	]);
	expect(out?.selection?.ids).toEqual(["tract:2", "tract:3"]);
});

test("null when no retired place has a replacement", () => {
	const data: WidgetDataConfig = {
		place: { kind: "region", type: "tract", code: "1" },
		layers: [{ dataset: "d" }]
	};
	expect(withReplacements(data, [retiredPlace("region:tract:1", null)])).toBeNull();
	expect(withReplacements(data, [{ place: "region:tract:1", name: "x" }])).toBeNull();
	expect(
		withReplacements(data, [retiredPlace("region:tract:9", { type: "tract", code: "2" })])
	).toBeNull();
});

test("swaps a retired school for its replacement", () => {
	const data: WidgetDataConfig = {
		place: { kind: "location", source: "cde-public", code: "1" },
		layers: [{ dataset: "d" }]
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
	expect(out?.place).toEqual({ kind: "location", source: "cde-public", code: "2" });
	expect(data.place).toEqual({ kind: "location", source: "cde-public", code: "1" });
});

test("a retired school without a replacement swaps nothing", () => {
	const data: WidgetDataConfig = {
		place: { kind: "location", source: "cde-public", code: "1" },
		layers: [{ dataset: "d" }]
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
