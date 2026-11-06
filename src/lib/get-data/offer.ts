import type { DatasetAdapter } from "$lib/data/adapters/registry";
import type { CatalogEntry, EntryTypeMeta } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import { fromLayer } from "$lib/places/selection";
import type { WidgetType } from "$lib/widgets/registry";
import { blockedBySpan } from "./date-presets";

export type OfferedDataset = {
	dataset: CatalogEntry;
	entryTypes: EntryTypeMeta[];
	/** The non-pollutant entry types offered as overlays (their adapter says they fit). */
	overlayTypes: EntryTypeMeta[];
};

/** What the offer needs from each adapter. */
export type AdapterOffer = Pick<DatasetAdapter, "id" | "overlays">;

/**
 * The catalog datasets Get data offers, in catalog order: those with an adapter that at least
 * one of `types` accepts. Retired and unavailable entry types aren't offered for new picks.
 */
export function offeredDatasets(
	catalog: CatalogEntry[],
	adapters: AdapterOffer[],
	types: WidgetType[]
): OfferedDataset[] {
	const offered: OfferedDataset[] = [];
	for (const dataset of catalog) {
		const adapter = adapters.find((a) => a.id === dataset.id);
		if (!adapter || !types.some((t) => t.accepts?.datasets?.includes(dataset.id))) continue;
		const entryTypes = dataset.entryTypes.filter((e) => !e.retired && e.available !== false);
		const overlayTypes = entryTypes.filter(
			(e) => e.kind !== "pollutant" && (adapter.overlays?.(e) ?? false)
		);
		offered.push({ dataset, entryTypes, overlayTypes });
	}
	return offered;
}

/** Why a widget type can't show a data config (the first that applies). */
export type TypeBlock = "dataset" | "places" | "span" | "pollutants";

/** Why `type` can't show `data` as it stands, or `null` when it can. */
export function typeBlock(
	type: WidgetType,
	data: WidgetDataConfig,
	catalog: CatalogEntry[],
	now: Date
): TypeBlock | null {
	const accepts = type.accepts ?? {};
	const accepted = accepts.datasets ?? [];
	if (data.layers.some((l) => !accepted.includes(l.dataset))) return "dataset";
	if (accepts.maxPlaces !== undefined) {
		const places = Math.max(0, ...data.layers.map((l) => fromLayer(l).length));
		if (places > accepts.maxPlaces) return "places";
	}
	if (data.dateRange && blockedBySpan(data.dateRange, type.span, now)) return "span";
	if (accepts.maxPollutantLayers !== undefined) {
		const kindOf = (dataset: string, id: string | undefined) =>
			catalog.find((c) => c.id === dataset)?.entryTypes.find((e) => e.id === id)?.kind;
		const pollutants = data.layers.filter((l) => kindOf(l.dataset, l.entryType) === "pollutant");
		if (pollutants.length > accepts.maxPollutantLayers) return "pollutants";
	}
	return null;
}
