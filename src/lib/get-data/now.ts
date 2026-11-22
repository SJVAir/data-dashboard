/**
 * Get data for the "now" widget types (Current conditions, the Forecast strip, "Can we go
 * outside?", the Map): converting a draft to and from their shape, one layer holding up to the
 * type's `maxPlaces` picks (one for all but the Map; no dates, no overlays), and the pollutants
 * and alert level they offer.
 *
 * Kept free of the SDK and adapters, so it can be unit-tested and stays out of the initial bundle.
 */
import type { CatalogEntry, EntryTypeMeta, Level } from "$lib/data/metadata";
import type {
	ChosenPlace,
	DateRangeSpec,
	Layer,
	PlaceRef,
	SpatialSelection,
	TimeSubRange
} from "$lib/data/schema";
import { fitsRange } from "$lib/calendars/selection";
import { isCalendarType } from "$lib/calendars/types";
import { resolveRange } from "$lib/format/range";
import { areasOnly } from "$lib/places/replace";
import { fromWhere, toWhere } from "$lib/places/selection";
import { defaultThresholdLevel } from "$lib/thresholds/levels";
import type { Threshold } from "$lib/thresholds/schema";
import { DEFAULT_LAYER, DEFAULT_RANGE } from "$lib/widgets/defaults";
import { FORECAST_TYPE } from "$lib/widgets/forecast";
import { OUTSIDE_TYPE } from "$lib/widgets/outside";
import type { WidgetType } from "$lib/widgets/registry";
import { offersNow } from "$lib/widgets/time";
import { hasWhere, mainLayer, widgetMonitors, widgetWhere } from "$lib/widgets/shared/input";
import type { Draft } from "./draft.svelte";

/** What a conversion left out or changed, for the form's notes. */
export type NowDropped =
	| "dates"
	| "overlays"
	| "places"
	| "monitor-types"
	| "alert"
	| "pollutant"
	| "selection"
	| "outside"
	| "marks"
	| "range-cut"
	| "fill"
	| "area";

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

/** How many places `type` holds: its `maxPlaces`, else one. */
function placeCap(type: WidgetType): number {
	return type.accepts?.maxPlaces ?? 1;
}

/**
 * The pollutants a now type offers: `nowPollutants`, or with `allowed` only those it names, in
 * `allowed`'s order.
 */
export function offeredPollutants(catalog: CatalogEntry[], allowed?: string[]): EntryTypeMeta[] {
	const all = nowPollutants(catalog);
	if (!allowed) return all;
	return allowed.flatMap((id) => all.filter((e) => e.id === id));
}

/**
 * A single-place widget's Where and layers (spec decision 11): one place or one monitor, not both.
 * Ticked monitor types are left out (`"monitor-types"`); of the searched monitors only the first is
 * kept, and it wins over the Where, which is then left out (both `"places"`). An air-quality
 * layer kept with None (spec decision 31) that is left holding nothing goes. The layers are
 * copies; `where` and `layers` aren't changed.
 */
function onePlace(
	where: { place?: PlaceRef; selection?: SpatialSelection },
	layers: Layer[]
): {
	where: { place?: PlaceRef; selection?: SpatialSelection };
	layers: Layer[];
	dropped: NowDropped[];
} {
	const dropped = new Set<NowDropped>();
	let monitor = false;
	const out = layers.map((l) => {
		const { monitors, monitorTypes, ...rest } = l;
		const layer: Layer = { ...rest };
		if (monitorTypes?.length) dropped.add("monitor-types");
		if (monitors?.length) {
			layer.monitors = [monitors[0]];
			monitor = true;
			if (monitors.length > 1) dropped.add("places");
		}
		return layer;
	});
	// An air-quality layer kept with None only for its monitors goes once it holds none.
	const kept = out.filter((l) => l.dataset !== AIR_QUALITY || l.entryType || l.monitors?.length);
	const keptWhere = monitor ? {} : where;
	if (monitor && (where.place || where.selection)) dropped.add("places");
	return { where: keptWhere, layers: kept, dropped: [...dropped] };
}

/**
 * The monitors `data` holds, as saved: its air-quality layer's (one kept with None too, spec
 * decision 31), else a Forecast strip's one layer's. A conversion carries or notes them all,
 * where `widgetMonitors` reads only those that fetch.
 */
function savedMonitors(data: Draft["data"]): { monitors: string[]; types: string[] } {
	const strip = data.layers.length === 1 && isStrip(data.layers[0]) ? data.layers[0] : undefined;
	const layer = data.layers.find((l) => l.dataset === AIR_QUALITY) ?? strip;
	return { monitors: layer?.monitors ?? [], types: layer?.monitorTypes ?? [] };
}

/** Whether `layer` is a Forecast strip's (forecasts with no entry type). */
function isStrip(layer: Layer): boolean {
	return layer.dataset === FORECASTS && !layer.entryType;
}

/** The layer a now draft is made from: its main layer, or a Forecast strip's one layer. */
function sourceLayer(draft: Draft, catalog: CatalogEntry[] | undefined): Layer | undefined {
	return mainLayer(draft.data, catalog) ?? draft.data.layers[0];
}

/**
 * The pollutant `draft` has once it's `type`: none for the Forecast strip, PM2.5 for "Can we go
 * outside?", else the main layer's when it's an offered pollutant, or the first offered one.
 * With `allowed` (the Map's: the monitors meta's `available_pollutants`), only those are offered,
 * in `allowed`'s order.
 */
export function nowPollutant(
	draft: Draft,
	type: WidgetType,
	catalog: CatalogEntry[],
	allowed?: string[]
): string | undefined {
	if (type.type === FORECAST_TYPE) return undefined;
	if (type.type === OUTSIDE_TYPE) return OUTSIDE_POLLUTANT;
	const offered = offeredPollutants(catalog, allowed);
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
	/** With `"range-cut"` in `dropped`: the level the Map's range was cut at (its stops). */
	cutAt?: "day" | "month" | "year";
};

/**
 * `draft` (a `fromType` draft) as `type` (a now type): its Where's first `maxPlaces` places
 * (one, but for the Map) and its pollutant (`nowPollutant`, with `allowed`) on one layer, with no
 * dates, overlays or options. Its monitors go with the layer: a Map keeps them all and its ticked
 * types; a single-place type keeps one place or one monitor (`onePlace`). A threshold type
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
	fromType?: WidgetType,
	allowed?: string[]
): NowConversion {
	const from = sourceLayer(draft, catalog);
	const picks = fromWhere(draft.data);
	const cap = placeCap(type);
	// A starter's `default-place` reads as no picks, but it's kept as the one place.
	const { place } = draft.data;
	let where = place ? widgetWhere(draft.data) : toWhere(picks.slice(0, cap));
	const entryType = nowPollutant(draft, type, catalog, allowed);
	let layer: Layer = {
		dataset: entryType === undefined ? FORECASTS : AIR_QUALITY,
		...(entryType === undefined ? {} : { entryType })
	};
	// The monitors go with the layer (a Forecast strip's on its forecasts layer): a one-place type
	// takes one place or one monitor (`onePlace`); a Map takes them all, with its ticked types.
	const { monitors: searched, types: ticked } = savedMonitors(draft.data);
	if (searched.length > 0) layer.monitors = [...searched];
	if (ticked.length > 0) layer.monitorTypes = [...ticked];
	const one = cap === 1 ? onePlace(where, [layer]) : undefined;
	if (one) {
		where = one.where;
		layer = one.layers[0];
	} else if (entryType === undefined) {
		delete layer.monitors;
		delete layer.monitorTypes;
	}
	const dropped: NowDropped[] = [];
	if (draft.data.dateRange || draft.data.timeSubRange) dropped.push("dates");
	if (draft.data.layers.some((l) => l !== from)) dropped.push("overlays");
	if (picks.length > cap || one?.dropped.includes("places")) dropped.push("places");
	if (one?.dropped.includes("monitor-types")) dropped.push("monitor-types");
	const changed =
		entryType !== undefined && from?.entryType !== undefined && from.entryType !== entryType;
	if (changed) dropped.push("pollutant");
	// From a Chart, its line's level carries over as the alert level (the level the person chose
	// as notable; `keptThreshold` keeps it when the new scale has it). A Chart with its line Off
	// still gets the default.
	const defaultWhenOff = !(fromType && offersNow(fromType) && fromType.thresholds);
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
			data: { ...where, layers: [layer] },
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
 * forecasts layer as a PM2.5 one, as a new widget's, keeping its monitor), its Where cut to
 * `type`'s `maxPlaces` (a Map's selection to a calendar's one, say; `dropped` then says so; a
 * Chart or Table takes every place), a single-place type taking one place or one monitor
 * (`onePlace`). The alert level is kept only when `type` has thresholds; otherwise `dropped` says
 * it was left out.
 */
export function fromNowDraft(draft: Draft, type: WidgetType): NowConversion {
	const cap = type.accepts?.maxPlaces;
	// A Forecast strip's layer becomes PM2.5, keeping its monitor.
	let layers = draft.data.layers.map((l) =>
		!isStrip(l)
			? structuredClone(l)
			: {
					dataset: DEFAULT_LAYER.dataset,
					entryType: DEFAULT_LAYER.entryType,
					...(l.monitors?.length ? { monitors: [...l.monitors] } : {})
				}
	);
	const picks = fromWhere(draft.data);
	let cut = cap !== undefined && picks.length > cap;
	let where = cut ? toWhere(picks.slice(0, cap)) : widgetWhere(draft.data);
	const one = cap === 1 ? onePlace(where, layers) : undefined;
	if (one) {
		({ where, layers } = one);
		if (one.dropped.includes("places")) cut = true;
	}
	// A Chart's line is its own opt-in, so a tile's alert level isn't carried to it; a calendar's
	// threshold is the same alert level, so it is.
	const thresholds =
		(offersNow(type) || isCalendarType(type.type)) && type.thresholds && draft.thresholds
			? draft.thresholds
			: undefined;
	return {
		draft: {
			type: type.type,
			data: { dateRange: structuredClone(type.defaultRange ?? DEFAULT_RANGE), ...where, layers },
			...(thresholds ? { thresholds: structuredClone(thresholds) } : {})
		},
		dropped: [
			...(cut ? (["places"] as const) : []),
			...(one?.dropped.includes("monitor-types") ? (["monitor-types"] as const) : []),
			...(!thresholds && draft.thresholds?.length ? (["alert"] as const) : [])
		]
	};
}

/**
 * Whether `draft` already has `type`'s now shape (one layer of its dataset, at most `maxPlaces`
 * places, for a single-place type one place or one monitor, no dates), so opening it as `type` converts nothing. The alert level isn't part of the shape:
 * none is Off.
 */
export function isNowShaped(draft: Draft, type: WidgetType): boolean {
	const { data } = draft;
	if (data.dateRange || data.timeSubRange || data.layers.length !== 1) return false;
	const layer = data.layers[0];
	if (fromWhere(data).length > placeCap(type)) return false;
	if (placeCap(type) === 1) {
		// One place or one monitor, not both (`onePlace`).
		const { monitors, types } = widgetMonitors(data);
		if (types.length > 0 || monitors.length > 1) return false;
		if (monitors.length === 1 && hasWhere(data)) return false;
	}
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
 * Whether `range` is no range the person chose: none, or still `from`'s default range (its
 * `defaultRange`, else `DEFAULT_RANGE`) or `DEFAULT_RANGE`.
 */
export function isDefaultRange(
	range: DateRangeSpec | undefined,
	from: WidgetType | undefined
): boolean {
	const same = (a: DateRangeSpec, b: DateRangeSpec) => JSON.stringify(a) === JSON.stringify(b);
	return !range || same(range, from?.defaultRange ?? DEFAULT_RANGE) || same(range, DEFAULT_RANGE);
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
	const wasDefault = isDefaultRange(data.dateRange, from);
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

/**
 * A range draft (a `from` draft) as range type `to`: its range and day selection as `switchRange`
 * moves them (`"selection"`, `"outside"`), its alert level left out when `to` has none
 * (`"alert"`). A single-place type (a calendar) takes one place or one monitor and no ticked
 * types (`onePlace`: `"places"`, `"monitor-types"`). Everything else is kept: its Where, layers,
 * ticks, searched monitors and options (decision 8).
 */
export function fromRangeDraft(
	draft: Draft,
	from: WidgetType | undefined,
	to: WidgetType,
	now: Date
): NowConversion {
	const moved = switchRange(draft.data, from, to, now);
	const data = structuredClone(draft.data);
	if (moved.dateRange) data.dateRange = structuredClone(moved.dateRange);
	if (!moved.timeSubRange) delete data.timeSubRange;
	const dropped: NowDropped[] = moved.left ? ["selection"] : moved.outside ? ["outside"] : [];
	const keepLine = to.thresholds && draft.thresholds;
	if (!to.thresholds && draft.thresholds) dropped.push("alert");
	// A single-place type takes one place or one monitor, and no ticks (`onePlace`).
	if (to.accepts?.maxPlaces === 1) {
		const one = onePlace(widgetWhere(data), data.layers);
		delete data.place;
		delete data.selection;
		Object.assign(data, one.where);
		data.layers = one.layers;
		dropped.push(...one.dropped);
	}
	const days = moved.left ?? moved.outside;
	return {
		draft: {
			type: to.type,
			data,
			...(draft.options ? { options: structuredClone(draft.options) } : {}),
			...(keepLine ? { thresholds: structuredClone(draft.thresholds) } : {})
		},
		dropped,
		...(days ? { selection: structuredClone(days) } : {})
	};
}

/**
 * The school or point a draft's Where holds that `type` can't show (a Chart or Table holds areas
 * only, decision 2), which the caller looks up as its area (`starterAreaOf`: ZIP, then city, then
 * county) before converting; `null` when there's nothing to look up.
 */
export function areaToLookUp(draft: Draft, type: string): ChosenPlace | null {
	const place = draft.data.place;
	if (!areasOnly(type) || !place) return null;
	return place.kind === "location" || place.kind === "point" ? place : null;
}

/**
 * `converted` with its school or point Where (`areaToLookUp`) swapped for `area`, the area the
 * caller looked up; with no area (the lookup failed, or the place has none) the Where is left out
 * (`"area"`). Any other conversion is returned as it is.
 */
export function withArea(converted: NowConversion, area: ChosenPlace | null): NowConversion {
	if (!areaToLookUp(converted.draft, converted.draft.type)) return converted;
	const data = structuredClone(converted.draft.data);
	delete data.place;
	if (area) data.place = structuredClone(area);
	return {
		...converted,
		draft: { ...converted.draft, data },
		dropped: area ? converted.dropped : [...new Set([...converted.dropped, "area" as const])]
	};
}
