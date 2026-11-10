/**
 * Get data for the "now" widget types (Current conditions, the Forecast strip, "Can we go
 * outside?"): converting a draft to and from their shape, one layer whose `place` holds the one
 * picked place (no dates, no overlays), and the pollutants and alert level they offer.
 *
 * Kept free of the SDK and adapters, so it can be unit-tested and stays out of the initial bundle.
 */
import type { CatalogEntry, EntryTypeMeta, Level } from "$lib/data/metadata";
import type { DateRangeSpec, Layer, TimeSubRange } from "$lib/data/schema";
import { fitsRange } from "$lib/calendars/selection";
import { isCalendarType } from "$lib/calendars/types";
import { resolveRange } from "$lib/format/range";
import { fromLayer } from "$lib/places/selection";
import { defaultThresholdLevel } from "$lib/thresholds/levels";
import type { Threshold } from "$lib/thresholds/schema";
import { DEFAULT_LAYER, DEFAULT_RANGE } from "$lib/widgets/defaults";
import { FORECAST_TYPE } from "$lib/widgets/forecast";
import { OUTSIDE_TYPE } from "$lib/widgets/outside";
import type { WidgetType } from "$lib/widgets/registry";
import { mainLayer, placesQueryLayer } from "$lib/widgets/shared/input";
import type { Draft } from "./draft.svelte";

/** What a conversion left out or changed, for the form's notes. */
export type NowDropped =
	"dates" | "overlays" | "places" | "alert" | "pollutant" | "selection" | "outside";

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
function sourceLayer(draft: Draft, catalog: CatalogEntry[] | undefined): Layer | undefined {
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

/** What `toNowDraft` and `fromNowDraft` give: the new draft, and what it left out or changed. */
export type NowConversion = {
	draft: Draft;
	dropped: NowDropped[];
	/** With `"pollutant"` in `dropped`: the entry type it had, and the one it has now. */
	pollutant?: { from: { dataset: string; entryType: string }; to: string };
	/**
	 * The new pollutant's scale couldn't be loaded, so a default alert level is still owed: set it
	 * (`keptThreshold(undefined, levels, true)`) once the scale loads, unless the person chose one.
	 */
	defaultOwed?: boolean;
	/**
	 * The alert level came from a Chart's line at a level below tier 2 (Good, say): named in a
	 * note, so a very low alert level isn't a surprise.
	 */
	fromLine?: Level;
	/** With `"selection"` or `"outside"` in `dropped`: the days that were selected. */
	selection?: TimeSubRange;
};

/**
 * `draft` (a `fromType` draft) as `type` (a now type): the main layer's first place and its
 * pollutant (`nowPollutant`) on one layer, with no dates, overlays or options. A threshold type
 * keeps the alert level `keptThreshold` gives with `levels` (the new pollutant's scale); a draft
 * from a type without thresholds (a range type, the Forecast strip) gets the default, and one
 * from a threshold type keeps Off. With `levels` unavailable the alert level is kept as it is.
 * `dropped` lists what was left out or changed.
 */
export function toNowDraft(
	draft: Draft,
	type: WidgetType,
	catalog: CatalogEntry[],
	levels: Level[] | "unavailable",
	fromType?: WidgetType
): NowConversion {
	const from = sourceLayer(draft, catalog);
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
	const changed =
		entryType !== undefined && from?.entryType !== undefined && from.entryType !== entryType;
	if (changed) dropped.push("pollutant");
	// From a Chart, its line's level carries over as the alert level (the level the person chose
	// as notable; `keptThreshold` keeps it when the new scale has it). A Chart with its line Off
	// still gets the default.
	const defaultWhenOff = !(fromType?.time === "now" && fromType.thresholds);
	let thresholds: Threshold[] | undefined;
	let defaultOwed = false;
	if (!type.thresholds) {
		if (draft.thresholds?.length) dropped.push("alert");
	} else if (levels === "unavailable") {
		thresholds = draft.thresholds;
		defaultOwed = defaultWhenOff && !thresholds;
	} else {
		thresholds = keptThreshold(draft.thresholds, levels, defaultWhenOff);
	}
	const lineKey = defaultWhenOff ? draft.thresholds?.[0]?.level : undefined;
	const kept = lineKey !== undefined && thresholds?.[0]?.level === lineKey;
	const fromLine =
		kept && levels !== "unavailable" ? levels.find((l) => l.key === lineKey) : undefined;
	return {
		draft: {
			type: type.type,
			data: { layers: [layer] },
			...(thresholds ? { thresholds: structuredClone(thresholds) } : {})
		},
		dropped,
		...(changed
			? {
					pollutant: { from: { dataset: from.dataset, entryType: from.entryType! }, to: entryType }
				}
			: {}),
		...(defaultOwed ? { defaultOwed } : {}),
		...(fromLine?.tier != null && fromLine.tier < 2 ? { fromLine } : {})
	};
}

/**
 * A now draft as `type` (a range type): its layer over the default range (a Forecast strip's
 * place on a PM2.5 layer, as a new widget's). The alert level is kept only when `type` has
 * thresholds; otherwise `dropped` says it was left out.
 */
export function fromNowDraft(draft: Draft, type: WidgetType): NowConversion {
	const layers = draft.data.layers.map((l) => structuredClone(placesQueryLayer(l)));
	// A Chart's line is its own opt-in, so a tile's alert level isn't carried to it; a calendar's
	// threshold is the same alert level, so it is.
	const thresholds =
		(type.time === "now" || isCalendarType(type.type)) && type.thresholds && draft.thresholds
			? draft.thresholds
			: undefined;
	return {
		draft: {
			type: type.type,
			data: { dateRange: structuredClone(type.defaultRange ?? DEFAULT_RANGE), layers },
			...(thresholds ? { thresholds: structuredClone(thresholds) } : {})
		},
		dropped: !thresholds && draft.thresholds?.length ? ["alert"] : []
	};
}

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

/** Whether a stored day selection lies inside the Pacific dates `range` resolves to. */
export function selectionFits(sel: TimeSubRange, range: DateRangeSpec, now: Date): boolean {
	const r = resolveRange(range, now);
	return fitsRange(sel, r.firstDate, r.lastDate);
}

/**
 * The date range and day selection a range draft has once it's `to`, from `from`: a draft still
 * on `from`'s default range gets `to`'s default (a calendar's default gives way to the Chart's);
 * the selection is dropped when `to` isn't a calendar (`left`) or when it no longer fits the new
 * range (`outside`).
 */
export function switchRange(
	data: { dateRange?: DateRangeSpec; timeSubRange?: TimeSubRange },
	from: WidgetType | undefined,
	to: WidgetType,
	now: Date
): {
	dateRange?: DateRangeSpec;
	timeSubRange?: TimeSubRange;
	left?: TimeSubRange;
	outside?: TimeSubRange;
} {
	const same = (a: DateRangeSpec | undefined, b: DateRangeSpec) =>
		JSON.stringify(a) === JSON.stringify(b);
	const wasDefault =
		!data.dateRange ||
		same(data.dateRange, from?.defaultRange ?? DEFAULT_RANGE) ||
		same(data.dateRange, DEFAULT_RANGE);
	let dateRange = data.dateRange;
	if (wasDefault && to.defaultRange) dateRange = structuredClone(to.defaultRange);
	else if (wasDefault && from && isCalendarType(from.type)) {
		dateRange = structuredClone(DEFAULT_RANGE);
	}
	let timeSubRange = data.timeSubRange;
	let left: TimeSubRange | undefined;
	let outside: TimeSubRange | undefined;
	if (timeSubRange && !isCalendarType(to.type)) {
		left = timeSubRange;
		timeSubRange = undefined;
	} else if (timeSubRange && !selectionFits(timeSubRange, dateRange ?? DEFAULT_RANGE, now)) {
		outside = timeSubRange;
		timeSubRange = undefined;
	}
	return {
		...(dateRange ? { dateRange } : {}),
		...(timeSubRange ? { timeSubRange } : {}),
		...(left ? { left } : {}),
		...(outside ? { outside } : {})
	};
}
