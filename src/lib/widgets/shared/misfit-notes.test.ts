import { expect, test } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import { FIXTURE_CATALOG } from "$lib/data/testing/fixtures";
import type { Effective } from "$lib/data/dataset-rules";
import type { Layer } from "$lib/data/schema";
import type { WidgetOverlay } from "./data-widget.svelte";
import { idleTypesNote, misfitNotes } from "./misfit-notes";

const layer = (dataset: string): Layer => ({ dataset, entryType: "x" });
const overlay = (l: Layer, label: string | null): WidgetOverlay =>
	({
		layer: l,
		meta: label ? { dataset: { label }, entryType: {} } : undefined,
		levels: [],
		state: { status: "idle" }
	}) as unknown as WidgetOverlay;
const effective = (resolution: Effective["resolution"], misfits: Layer[]): Effective =>
	({ resolution, automatic: false, misfits }) as Effective;

test("a note per misfit layer, naming its dataset and the level", () => {
	const use = layer("pesticide-use");
	const smoke = layer("smoke");
	const notes = misfitNotes(
		[overlay(use, "Pesticide use"), overlay(smoke, "Smoke")],
		effective("day", [use]),
		true,
		"monitors",
		FIXTURE_CATALOG
	);
	expect(notes).toEqual([
		"Pesticide use isn't shown: it isn't reported daily. Change the data resolution in the Data Portal."
	]);
});

test("raw says there are no individual measurements", () => {
	const smoke = layer("smoke");
	expect(
		misfitNotes(
			[overlay(smoke, "Smoke")],
			effective("raw", [smoke]),
			true,
			"monitors",
			FIXTURE_CATALOG
		)
	).toEqual([
		"Smoke isn't shown: it has no individual measurements. Change the data resolution in the Data Portal."
	]);
});

test("no note while the catalog doesn't list the dataset, or without a resolution", () => {
	const smoke = layer("smoke");
	expect(
		misfitNotes(
			[overlay(smoke, null)],
			effective("day", [smoke]),
			true,
			"monitors",
			FIXTURE_CATALOG
		)
	).toEqual([]);
	expect(
		misfitNotes([overlay(smoke, "Smoke")], undefined, true, "monitors", FIXTURE_CATALOG)
	).toEqual([]);
});

test("a read-only dashboard's notes don't point at Edit data", () => {
	const use = layer("pesticide-use");
	const smoke = layer("smoke");
	expect(
		misfitNotes(
			[overlay(use, "Pesticide use")],
			effective("day", [use]),
			false,
			"monitors",
			FIXTURE_CATALOG
		)
	).toEqual(["Pesticide use isn't shown: it isn't reported daily."]);
	expect(
		misfitNotes(
			[overlay(smoke, "Smoke")],
			effective("raw", [smoke]),
			false,
			"monitors",
			FIXTURE_CATALOG
		)
	).toEqual(["Smoke isn't shown: it has no individual measurements."]);
});

const ticked: Layer = {
	dataset: "air-quality",
	entryType: "pm25",
	monitors: ["m1"],
	monitorTypes: ["airnow"]
};

test("ticked types with no Where, beside a searched monitor, say to add a place", () => {
	expect(idleTypesNote({ layers: [ticked] }, undefined, true)).toBe(
		"Add a place to show ticked monitor types."
	);
	expect(idleTypesNote({ layers: [ticked] }, undefined, false)).toBe(
		"Ticked monitor types aren't shown: this has no place."
	);
});

test("no ticks note inside a Where, or when nothing is drawn (the empty message says it)", () => {
	const place = { kind: "region", type: "county", code: "06019" } as const;
	expect(idleTypesNote({ place, layers: [ticked] }, undefined, true)).toBeNull();
	const typesOnly: Layer = { ...ticked, monitors: [] };
	expect(idleTypesNote({ layers: [typesOnly] }, undefined, true)).toBeNull();
});

test("a raw misfit at an area names the area, in both forms", () => {
	const pm25: Layer = { dataset: "air-quality", entryType: "pm25" };
	const o = overlay(pm25, "Air Quality");
	const area = misfitNotes([o], effective("raw", [pm25]), true, "regions", FIXTURE_CATALOG);
	expect(area).toEqual([
		"Air Quality isn't shown: air quality for an area is summarized, with no individual measurements. Change the data resolution in the Data Portal."
	]);
	expect(
		misfitNotes([o], effective("raw", [pm25]), false, "monitor-types", FIXTURE_CATALOG)
	).toEqual([
		"Air Quality isn't shown: ticked monitor types are summarized, with no individual measurements."
	]);
	// Another dataset with no raw keeps the dataset's reason.
	const temp: Layer = { dataset: "weather", entryType: "temperature" };
	expect(
		misfitNotes(
			[overlay(temp, "Weather")],
			effective("raw", [temp]),
			false,
			"regions",
			FIXTURE_CATALOG
		)
	).toEqual([m.widget_layer_not_lined_up_raw_view({ dataset: "Weather" })]);
});
