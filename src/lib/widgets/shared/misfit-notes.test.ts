import { expect, test } from "vitest";
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
		true
	);
	expect(notes).toEqual([
		"Pesticide use isn't shown: it isn't reported daily. Change the data resolution in the Data Portal."
	]);
});

test("raw says there are no individual measurements", () => {
	const smoke = layer("smoke");
	expect(misfitNotes([overlay(smoke, "Smoke")], effective("raw", [smoke]), true)).toEqual([
		"Smoke isn't shown: it has no individual measurements. Change the data resolution in the Data Portal."
	]);
});

test("no note while the catalog doesn't list the dataset, or without a resolution", () => {
	const smoke = layer("smoke");
	expect(misfitNotes([overlay(smoke, null)], effective("day", [smoke]), true)).toEqual([]);
	expect(misfitNotes([overlay(smoke, "Smoke")], undefined, true)).toEqual([]);
});

test("a read-only dashboard's notes don't point at Edit data", () => {
	const use = layer("pesticide-use");
	const smoke = layer("smoke");
	expect(misfitNotes([overlay(use, "Pesticide use")], effective("day", [use]), false)).toEqual([
		"Pesticide use isn't shown: it isn't reported daily."
	]);
	expect(misfitNotes([overlay(smoke, "Smoke")], effective("raw", [smoke]), false)).toEqual([
		"Smoke isn't shown: it has no individual measurements."
	]);
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
