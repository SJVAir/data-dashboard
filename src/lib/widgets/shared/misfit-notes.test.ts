import { expect, test } from "vitest";
import type { Effective } from "$lib/data/dataset-rules";
import type { Layer } from "$lib/data/schema";
import type { WidgetOverlay } from "./data-widget.svelte";
import { misfitNotes } from "./misfit-notes";

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
		"Pesticide use isn't shown: it isn't reported daily. Change the data resolution in Edit data."
	]);
});

test("raw says there are no individual measurements", () => {
	const smoke = layer("smoke");
	expect(misfitNotes([overlay(smoke, "Smoke")], effective("raw", [smoke]), true)).toEqual([
		"Smoke isn't shown: it has no individual measurements. Change the data resolution in Edit data."
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
