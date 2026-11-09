import type { DatasetAdapter } from "$lib/data/adapters/registry";
import { drawsAsBands } from "$lib/data/adapters/bands";
import type { CatalogEntry, EntryTypeMeta } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import type { Target } from "$lib/data/types";
import { fromLayer } from "$lib/places/selection";
import type { WidgetType } from "$lib/widgets/registry";
import { blockedBySpan } from "./date-presets";

export type OfferedDataset = {
	dataset: CatalogEntry;
	entryTypes: EntryTypeMeta[];
	/**
	 * The entry types that can stand alone (and be added as further layers): the number entry
	 * types of a dataset with no pollutants (weather, pesticide use).
	 */
	layerTypes: EntryTypeMeta[];
	/**
	 * The other non-pollutant entry types offered as overlays (their adapter says they fit): level
	 * layers such as burn status and smoke, which can't stand alone.
	 */
	overlayTypes: EntryTypeMeta[];
};

/** What the offer needs from each adapter. */
export type AdapterOffer = Pick<DatasetAdapter, "id" | "overlays"> &
	Partial<Pick<DatasetAdapter, "offered">>;

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
		// An entry type the adapter can fetch at no level (weather's raw-only wind direction) is left
		// out; the target is only a stand-in, as `offered` decides by the entry type's own levels.
		const stand: Target = { kind: "monitors", ids: [] };
		const entryTypes = dataset.entryTypes.filter(
			(e) =>
				!e.retired &&
				e.available !== false &&
				(adapter.offered?.(e.resolutions, stand).length ?? 1) > 0
		);
		const standAlone = !entryTypes.some((e) => e.kind === "pollutant") && !drawsAsBands(dataset.id);
		const layerTypes = standAlone ? entryTypes : [];
		const overlayTypes = entryTypes.filter(
			(e) => e.kind !== "pollutant" && !standAlone && (adapter.overlays?.(e) ?? false)
		);
		offered.push({ dataset, entryTypes, layerTypes, overlayTypes });
	}
	return offered;
}

/** Why a widget type can't show a data config (the first that applies). */
export type TypeBlock = "dataset" | "places" | "span" | "pollutants" | "pollutant";

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
	if (accepts.onlyPollutant) {
		const one =
			data.layers.length === 1 &&
			catalog
				.find((c) => c.id === data.layers[0].dataset)
				?.entryTypes.find((e) => e.id === data.layers[0].entryType)?.kind === "pollutant";
		if (!one) return "pollutant";
	}
	return null;
}
