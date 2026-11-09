/**
 * Get data for the "now" widget types (Current conditions, the Forecast strip, "Can we go
 * outside?"): converting a draft to and from their shape, one layer whose `place` holds the one
 * picked place (no dates, no overlays), and the pollutants and alert level they offer.
 *
 * Kept free of the SDK and adapters, so it can be unit-tested and stays out of the initial bundle.
 */
import type { CatalogEntry, EntryTypeMeta, Level } from "$lib/data/metadata";
import type { Layer } from "$lib/data/schema";
import { fromLayer } from "$lib/places/selection";
import { defaultThresholdLevel } from "$lib/thresholds/levels";
import type { Threshold } from "$lib/thresholds/schema";
import { DEFAULT_LAYER, DEFAULT_RANGE } from "$lib/widgets/defaults";
import { FORECAST_TYPE } from "$lib/widgets/forecast";
import { OUTSIDE_TYPE } from "$lib/widgets/outside";
import type { WidgetType } from "$lib/widgets/registry";
import { mainLayer } from "$lib/widgets/shared/input";
import type { Draft } from "./draft.svelte";

/** What a conversion to a now type left out, for the form's note. */
export type NowDropped = "dates" | "overlays" | "places";

const AIR_QUALITY = "air-quality";
const FORECASTS = "forecasts";
/** "Can we go outside?" is always PM2.5, as the card reads it (`asPm25`). */
const OUTSIDE_POLLUTANT = "pm25";

/** The pollutants Current conditions offers: the air-quality ones that are available. */
export function nowPollutants(catalog: CatalogEntry[]): EntryTypeMeta[] {
	const dataset = catalog.find((c) => c.id === AIR_QUALITY);
	return (dataset?.entryTypes ?? []).filter(
		(e) => e.kind === "pollutant" && !e.retired && e.available !== false
	);
}

/** The layer holding the draft's places: its main layer, or a Forecast strip's one layer. */
function placesLayer(draft: Draft, catalog: CatalogEntry[] | undefined): Layer | undefined {
	return mainLayer(draft.data, catalog) ?? draft.data.layers[0];
}

/**
 * The pollutant `draft` has once it's `type`: none for the Forecast strip, PM2.5 for "Can we go
 * outside?", else the main layer's when it's an offered pollutant, or the first offered one.
 */
export function nowPollutant(
	draft: Draft,
	type: WidgetType,
	catalog: CatalogEntry[]
): string | undefined {
	if (type.type === FORECAST_TYPE) return undefined;
	if (type.type === OUTSIDE_TYPE) return OUTSIDE_POLLUTANT;
	const offered = nowPollutants(catalog);
	const main = mainLayer(draft.data, catalog);
	if (main?.dataset === AIR_QUALITY && offered.some((e) => e.id === main.entryType)) {
		return main.entryType;
	}
	return offered[0]?.id ?? DEFAULT_LAYER.entryType;
}

/**
 * The alert level after a pollutant change or a conversion: the saved key when `levels` has it,
 * else the scale's default (none when the scale has no tier-2 level). Off stays Off unless
 * `defaultWhenOff`.
 */
export function keptThreshold(
	saved: Threshold[] | undefined,
	levels: Level[],
	defaultWhenOff: boolean
): Threshold[] | undefined {
	const key = saved?.[0]?.level;
	if (key === undefined && !defaultWhenOff) return undefined;
	if (key !== undefined && levels.some((l) => l.key === key)) return [{ level: key }];
	const fallback = defaultThresholdLevel(levels);
	return fallback ? [{ level: fallback }] : undefined;
}

/**
 * `draft` as `type` (a now type): the main layer's first place and its pollutant
 * (`nowPollutant`) on one layer, with no dates, overlays or options. A threshold type gets the
 * alert level `keptThreshold` gives with `levels` (the new pollutant's scale), the default when
 * it had none. `dropped` lists what was left out.
 */
export function toNowDraft(
	draft: Draft,
	type: WidgetType,
	catalog: CatalogEntry[],
	levels: Level[]
): { draft: Draft; dropped: NowDropped[] } {
	const from = placesLayer(draft, catalog);
	const picks = from ? fromLayer(from) : [];
	// A starter's `default-place` reads as no picks, but it's kept as the one place.
	const place = from?.place ?? picks[0];
	const entryType = nowPollutant(draft, type, catalog);
	const layer: Layer = {
		dataset: entryType === undefined ? FORECASTS : AIR_QUALITY,
		...(entryType === undefined ? {} : { entryType }),
		...(place ? { place } : {})
	};
	const dropped: NowDropped[] = [];
	if (draft.data.dateRange || draft.data.timeSubRange) dropped.push("dates");
	if (draft.data.layers.some((l) => l !== from)) dropped.push("overlays");
	if (picks.length > 1) dropped.push("places");
	const thresholds = type.thresholds ? keptThreshold(draft.thresholds, levels, true) : undefined;
	return {
		draft: { type: type.type, data: { layers: [layer] }, ...(thresholds ? { thresholds } : {}) },
		dropped
	};
}

/**
 * A now draft as `type` (a range type): its layer over the default range (a Forecast strip's
 * place on a PM2.5 layer, as a new widget's), keeping the alert level only when `type` has
 * thresholds. Nothing is left out.
 */
export function fromNowDraft(draft: Draft, type: WidgetType): Draft {
	const layers = draft.data.layers.map((l) =>
		l.dataset === FORECASTS && !l.entryType
			? { dataset: DEFAULT_LAYER.dataset, entryType: DEFAULT_LAYER.entryType, ...placeOf(l) }
			: structuredClone(l)
	);
	const thresholds = type.thresholds && draft.thresholds ? draft.thresholds : undefined;
	return {
		type: type.type,
		data: { dateRange: structuredClone(DEFAULT_RANGE), layers },
		...(thresholds ? { thresholds: structuredClone(thresholds) } : {})
	};
}

const placeOf = (layer: Layer) => (layer.place ? { place: structuredClone(layer.place) } : {});

/**
 * Whether `draft` already has `type`'s now shape (one layer of its dataset, at most one place,
 * no dates), so opening it as `type` converts nothing. The alert level isn't part of the shape:
 * none is Off.
 */
export function isNowShaped(draft: Draft, type: WidgetType): boolean {
	const { data } = draft;
	if (data.dateRange || data.timeSubRange || data.layers.length !== 1) return false;
	const layer = data.layers[0];
	if (fromLayer(layer).length > 1) return false;
	return type.type === FORECAST_TYPE
		? layer.dataset === FORECASTS && !layer.entryType
		: layer.dataset === AIR_QUALITY && !!layer.entryType;
}
