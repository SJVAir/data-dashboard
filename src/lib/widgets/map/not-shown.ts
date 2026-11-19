import type { Effective } from "$lib/data/dataset-rules";
import type { CatalogEntry } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import { m } from "$lib/paraglide/messages.js";
import { PESTICIDE_USE } from "./options";

/**
 * The place-less datasets a Map doesn't draw (only from untrusted input: Get data never builds
 * one): with a range, those whose layers don't offer the Map's resolution (`effective`'s misfits:
 * smoke, fire and spray notices away from Daily, pesticide use at Daily); on Now (no `effective`),
 * pesticide use, which needs a whole month or year. Each dataset once, in layer order. The
 * pollutants are never left out here: the first decides the resolution.
 */
export function mapNotShown(data: WidgetDataConfig, effective: Effective | null): string[] {
	const layers = effective
		? effective.misfits
		: data.layers.filter((l) => l.dataset === PESTICIDE_USE);
	const datasets = layers
		.filter((l) => l.dataset !== "air-quality" && !l.place && !l.selection)
		.map((l) => l.dataset);
	return datasets.filter((d, i) => datasets.indexOf(d) === i);
}

/**
 * One note per dataset not drawn (by its id), naming it by the catalog's label (one it doesn't
 * list yet gets none) and saying to change the resolution in Edit data.
 */
export function notShownNotes(
	datasets: readonly string[],
	catalog: CatalogEntry[] | undefined
): { id: string; message: string }[] {
	return datasets.flatMap((id) => {
		const dataset = catalog?.find((c) => c.id === id)?.label;
		return dataset ? [{ id, message: m.map_layer_not_lined_up({ dataset }) }] : [];
	});
}
