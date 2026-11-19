/**
 * Get data for the Map: its pollutants, smoke and fire, spray notices and pesticide use, and
 * converting a draft to and from it.
 */
import type { CatalogEntry, Level } from "$lib/data/metadata";
import type { DateRangeSpec, Layer, PesticideFilters, WidgetDataConfig } from "$lib/data/schema";
import { addDays, parseDateKey } from "$lib/format";
import { daysInMonth } from "$lib/format/calendar";
import { resolveRange } from "$lib/format/range";
import { fromLayer } from "$lib/places/selection";
import { mapType } from "$lib/widgets/map";
import {
	HMS_FIRE,
	HMS_SMOKE,
	MAP_MAX_STOPS,
	MAP_POLLUTANTS_MAX,
	MAP_TYPE,
	PESTICIDE_NOTICES,
	PESTICIDE_USE,
	drawableShowing,
	mapOptions,
	pollutantLayers,
	useFigureOf,
	type MapOptions
} from "$lib/widgets/map/options";
import { parsePeriod, periodKey, periodListed, type UsePeriod } from "$lib/widgets/map/use-period";
import { CHART_TYPE } from "$lib/widgets/chart";
import { getWidgetType, type WidgetType } from "$lib/widgets/registry";
import { mapLevel, type MapLevel } from "$lib/widgets/map/days";
import { mainLayer, widgetEffective, widgetPlaceKind } from "$lib/widgets/shared/input";
import { blockedBySpan } from "./date-presets";
import type { Draft } from "./draft.svelte";
import { keepingPlaces } from "./layers";
import {
	fromNowDraft,
	isDefaultRange,
	toNowDraft,
	type NowConversion,
	type NowDropped
} from "./now";

export { HMS_FIRE, HMS_SMOKE, MAP_POLLUTANTS_MAX } from "$lib/widgets/map/options";

const AIR_QUALITY = "air-quality";

/**
 * Adds or removes an air-quality layer of `entryType`. The places stay on the first pollutant
 * layer (they move on when it's removed); the last pollutant can't be removed and no more than
 * `MAP_POLLUTANTS_MAX` fit. Pollutants stay ahead of smoke and fire.
 */
export function setMapPollutant(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined,
	entryType: string,
	on: boolean
): void {
	const pollutants = pollutantLayers(data, catalog);
	const existing = pollutants.find((l) => l.entryType === entryType);
	if (on && !existing) {
		if (pollutants.length >= MAP_POLLUTANTS_MAX) return;
		const last = pollutants[pollutants.length - 1];
		const at = last ? data.layers.indexOf(last) + 1 : data.layers.length;
		keepingPlaces(data, catalog, () =>
			data.layers.splice(at, 0, { dataset: AIR_QUALITY, entryType })
		);
	} else if (!on && existing) {
		if (pollutants.length <= 1) return;
		keepingPlaces(data, catalog, () => data.layers.splice(data.layers.indexOf(existing), 1));
	}
}

/** Fills the Map's regions by `type` (a region type id), or with none (`undefined`). */
export function setMapFill(draft: Draft, type: string | undefined): void {
	const options = { ...mapOptions(draft) };
	if (type) options.fill = type;
	else delete options.fill;
	writeOptions(draft, options);
}

/** Whether `layer` is a smoke or fire layer (a Map's, or a Chart's smoke at a place). */
function isHms(layer: Layer): boolean {
	return layer.dataset === HMS_SMOKE || layer.dataset === HMS_FIRE;
}

/** Whether `data` has the smoke layer or the fire layer. */
export function hasSmokeAndFire(data: WidgetDataConfig): boolean {
	return data.layers.some(isHms);
}

/** Adds or removes both place-less layers together (on adds whichever is missing). */
export function setSmokeAndFire(data: WidgetDataConfig, on: boolean): void {
	if (on) {
		for (const dataset of [HMS_SMOKE, HMS_FIRE]) {
			if (data.layers.some((l) => l.dataset === dataset)) continue;
			// Ahead of the notices and use, which stay last.
			const at = data.layers.findIndex(isMapPesticide);
			data.layers.splice(at < 0 ? data.layers.length : at, 0, { dataset });
		}
	} else {
		data.layers = data.layers.filter((l) => l.dataset !== HMS_SMOKE && l.dataset !== HMS_FIRE);
	}
}

/** Whether `data` has the spray notices layer. */
export function hasNotices(data: WidgetDataConfig): boolean {
	return data.layers.some((l) => l.dataset === PESTICIDE_NOTICES);
}

/**
 * A plain copy of `filters` (strings and string lists), safe to read from a reactive draft, which
 * `structuredClone` can't copy.
 */
function copyFilters(filters: PesticideFilters): PesticideFilters {
	return Object.fromEntries(
		Object.entries(filters).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])
	) as PesticideFilters;
}

/** Whether `layer` holds no places (a Map's pesticide layers never do). */
function placeLess(layer: Layer): boolean {
	return !layer.place && !layer.selection;
}

/** Whether `layer` is the Map's notices layer or its (place-less) use layer. */
function isMapPesticide(layer: Layer): boolean {
	return (
		layer.dataset === PESTICIDE_NOTICES || (layer.dataset === PESTICIDE_USE && placeLess(layer))
	);
}

/**
 * Adds the place-less spray notices layer after smoke and fire (ahead of the use), with the Map's
 * filter set (kept on the use layer while the notices were off), or removes it.
 */
export function setNotices(data: WidgetDataConfig, on: boolean): void {
	if (on) {
		if (hasNotices(data)) return;
		const filters = mapPesticideFilters(data);
		const at = data.layers.findIndex((l) => l.dataset === PESTICIDE_USE && placeLess(l));
		data.layers.splice(at < 0 ? data.layers.length : at, 0, {
			dataset: PESTICIDE_NOTICES,
			...(filters ? { filters: copyFilters(filters) } : {})
		});
	} else {
		data.layers = data.layers.filter((l) => l.dataset !== PESTICIDE_NOTICES);
	}
}

/** Whether `data` has the Map's pesticide use layer (place-less; a chart's never counts). */
export function hasUse(data: WidgetDataConfig): boolean {
	return data.layers.some((l) => l.dataset === PESTICIDE_USE && placeLess(l));
}

/** The use options, which go with the use layer. */
const USE_OPTIONS = ["usePeriod", "useFigure", "useShown"] as const;

/** Writes `options` to `draft`, or removes them when nothing is left. */
function writeOptions(draft: Draft, options: MapOptions): void {
	if (Object.keys(options).length) draft.options = options;
	else delete draft.options;
}

/**
 * Adds the place-less pesticide use layer last, with the Map's filter set, and a `usePeriod` of
 * the latest of `years` (the meta's, newest first) unless a listed one is saved; or removes it
 * with its options. With no years listed, nothing is added.
 */
export function setUse(draft: Draft, on: boolean, years: readonly number[]): void {
	const { data } = draft;
	const options = { ...mapOptions(draft) };
	if (on) {
		if (years.length === 0) return;
		if (!hasUse(data)) {
			const filters = mapPesticideFilters(data);
			data.layers.push({
				dataset: PESTICIDE_USE,
				...(filters ? { filters: copyFilters(filters) } : {})
			});
		}
		const saved = parsePeriod(options.usePeriod);
		if (!saved || !periodListed(saved, years)) options.usePeriod = String(years[0]);
	} else {
		data.layers = data.layers.filter((l) => !(l.dataset === PESTICIDE_USE && placeLess(l)));
		for (const key of USE_OPTIONS) delete options[key];
	}
	writeOptions(draft, options);
}

/** The layers that take the Map's pesticide filters: the notices and the place-less use. */
function pesticideLayers(data: WidgetDataConfig): Layer[] {
	return data.layers.filter(isMapPesticide);
}

/** The first pesticide layer's filters (the layers are kept in step). */
export function mapPesticideFilters(data: WidgetDataConfig): PesticideFilters | undefined {
	return pesticideLayers(data).find((l) => l.filters)?.filters;
}

/** Writes `filters` to every pesticide layer; nothing in them removes them. */
export function setMapPesticideFilters(
	data: WidgetDataConfig,
	filters: PesticideFilters | undefined
): void {
	const kept: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(filters ?? {})) {
		if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
		kept[key] = value;
	}
	for (const layer of pesticideLayers(data)) {
		if (Object.keys(kept).length > 0) layer.filters = structuredClone(kept) as PesticideFilters;
		else delete layer.filters;
	}
}

/**
 * Whether `draft` already has the Map's shape, so opening it as a Map converts nothing: no day
 * selection and no date range the Map's span rules out at its resolution (`mapLevelOf`, with
 * `catalog`; none is Now); one to
 * `MAP_POLLUTANTS_MAX` air-quality layers first, the first holding at most `maxPlaces` places and
 * the others none; then only place-less smoke and fire layers, then at most one spray notices
 * layer and, last, at most one use layer (each place-less, with no entry type, and optional
 * filters).
 */
export function isMapShaped(
	draft: Draft,
	now: Date = new Date(),
	catalog: CatalogEntry[] = []
): boolean {
	const { data } = draft;
	if (data.timeSubRange) return false;
	const range = data.dateRange;
	if (range && blockedBySpan(range, mapType.span, now, mapLevelOf(data, catalog, range, now))) {
		return false;
	}
	const count = data.layers.findIndex((l) => l.dataset !== AIR_QUALITY);
	const pollutants = count < 0 ? data.layers : data.layers.slice(0, count);
	const rest = count < 0 ? [] : data.layers.slice(count);
	if (pollutants.length < 1 || pollutants.length > MAP_POLLUTANTS_MAX) return false;
	if (pollutants.some((l) => !l.entryType)) return false;
	if (fromLayer(pollutants[0]).length > (mapType.accepts?.maxPlaces ?? 1)) return false;
	if (pollutants.slice(1).some((l) => fromLayer(l).length > 0)) return false;
	// Smoke and fire, then the notices, then the use, each a step that never goes back.
	const step = (l: Layer) =>
		isHms(l) ? 0 : l.dataset === PESTICIDE_NOTICES ? 1 : l.dataset === PESTICIDE_USE ? 2 : -1;
	let last = 0;
	for (const layer of rest) {
		const at = step(layer);
		if (at < last || (at > 0 && at === last)) return false;
		if (layer.entryType || !placeLess(layer) || fromLayer(layer).length > 0) return false;
		last = at;
	}
	return true;
}

/** The first and last days of `p`, as Pacific date keys. */
function periodDays(p: UsePeriod): { first: string; last: string } {
	const key = periodKey(p);
	if (p.month === null) return { first: `${key}-01-01`, last: `${key}-12-31` };
	const first = `${key}-01`;
	return { first, last: `${key}-${String(daysInMonth(first)).padStart(2, "0")}` };
}

/** Whether all of `p` falls inside `range`. */
function periodInRange(p: UsePeriod, range: DateRangeSpec, now: Date): boolean {
	const { firstDate, lastDate } = resolveRange(range, now);
	const { first, last } = periodDays(p);
	return first >= firstDate && last <= lastDate;
}

/** Whether any of `p` falls inside `range`. */
function periodOverlaps(p: UsePeriod, range: DateRangeSpec, now: Date): boolean {
	const { firstDate, lastDate } = resolveRange(range, now);
	const { first, last } = periodDays(p);
	return first <= lastDate && last >= firstDate;
}

/**
 * The use period a chart's range gives the Map: its last full year that `years` lists, else the
 * latest listed year. `range` is the chart's own, read before the Map's 366-day cut (the spec's
 * "the chart's range").
 */
function periodFromRange(
	range: DateRangeSpec | undefined,
	years: readonly number[],
	now: Date
): string {
	if (range) {
		for (const year of [...years].sort((a, b) => b - a)) {
			if (periodInRange({ year, month: null }, range, now)) return String(year);
		}
	}
	return String(years[0]);
}

/** The Map's own use layer: the place-less one. */
function mapUseLayer(data: WidgetDataConfig): Layer | undefined {
	return data.layers.find((l) => l.dataset === PESTICIDE_USE && placeLess(l));
}

/**
 * The range the person chose for `draft`: a Map's own, else one that isn't still its type's
 * default (`isDefaultRange`, the rule `switchRange` follows). An untouched default isn't a
 * choice, so a new Map is Now.
 */
function chosenRange(draft: Draft): DateRangeSpec | undefined {
	const range = draft.data.dateRange;
	if (draft.type === MAP_TYPE) return range;
	return isDefaultRange(range, getWidgetType(draft.type)) ? undefined : range;
}

/** The level a Map of `data` steps by over `range`: its effective resolution (Automatic too). */
export function mapLevelOf(
	data: WidgetDataConfig,
	catalog: CatalogEntry[],
	range: DateRangeSpec,
	now: Date
): MapLevel {
	const place = widgetPlaceKind(data, catalog);
	return mapLevel(widgetEffective({ type: MAP_TYPE, data }, catalog, place, range, now).resolution);
}

/** The first day of the period `back` periods before the one holding `date`. */
function periodsBack(date: string, level: MapLevel, back: number): string {
	if (level === "day") return addDays(date, -back);
	const { y, m } = parseDateKey(date);
	if (level === "year") return `${String(y - back).padStart(4, "0")}-01-01`;
	const months = y * 12 + (m - 1) - back;
	const year = Math.floor(months / 12);
	return `${String(year).padStart(4, "0")}-${String((months % 12) + 1).padStart(2, "0")}-01`;
}

/**
 * `range` as the Map takes it at `level`: as it is within the Map's span; a longer one cut to its
 * last `MAP_MAX_STOPS` stops at the level (`cut`: a rolling one as the trailing days or months up
 * to today, so it keeps rolling); none for one shorter than a day (a few trailing hours), which
 * the Map can't step through.
 */
function mapRange(
	range: DateRangeSpec,
	now: Date,
	level: MapLevel
): { range?: DateRangeSpec; cut?: true } {
	const block = blockedBySpan(range, mapType.span, now, level);
	if (!block) return { range: structuredClone(range) };
	if (block === "too-short") return {};
	if (range.kind === "trailing" && level !== "year") {
		return { range: { kind: "trailing", amount: MAP_MAX_STOPS, unit: level }, cut: true };
	}
	const { lastDate } = resolveRange(range, now, level);
	return {
		range: {
			kind: "custom",
			start: periodsBack(lastDate, level, MAP_MAX_STOPS - 1),
			end: lastDate
		},
		cut: true
	};
}

/**
 * `draft` (any type) as a Map: the source's pollutant (or the first offered), its places (≤ 25),
 * smoke and fire on when the source had a smoke layer, and the range the person chose
 * (`chosenRange`, then `mapRange`: cut to the Map's 366 stops at its resolution with a
 * `"range-cut"` note and `cutAt`, the level; none,
 * or a default range, is Now). A day selection is dropped with
 * a `"selection"` note. A Map draft (one opened over its place cap, say) keeps its other offered
 * pollutants, its smoke and fire, its notices and use, and its options.
 *
 * From another type, the first pesticide use layer becomes the Map's use: its filters are the
 * Map's filter set, its entry type the `useFigure` (unless it's the catalog's first, the
 * default), and the `usePeriod` the range's last full year that `years` (the pesticide meta's,
 * newest first) lists, else the latest. Other use layers are left out (`"overlays"`), as is the
 * use with no years known. A chart of pesticide use only gets the first offered pollutant,
 * holding its places.
 */
export function toMapDraft(
	draft: Draft,
	catalog: CatalogEntry[],
	allowed: string[],
	now: Date = new Date(),
	years: readonly number[] = []
): NowConversion {
	const converted = toNowDraft(draft, mapType, catalog, [], undefined, allowed);
	const data = converted.draft.data;
	const shown = chosenRange(draft);
	const level = shown ? mapLevelOf(data, catalog, shown, now) : "day";
	const range = shown ? mapRange(shown, now, level) : {};
	if (range.range) data.dateRange = range.range;
	const selection = draft.data.timeSubRange;
	const first = data.layers[0];
	const fromMap = draft.type === MAP_TYPE;
	const kept = new Set<Layer>();
	if (fromMap) {
		const sources = pollutantLayers(draft.data, catalog);
		// The first is the converted layer's source (its places and pollutant).
		if (sources[0]) kept.add(sources[0]);
		for (const layer of sources.slice(1)) {
			const entryType = layer.entryType;
			if (!entryType || !allowed.includes(entryType) || entryType === first?.entryType) continue;
			if (data.layers.length >= MAP_POLLUTANTS_MAX) break;
			data.layers.push({ dataset: AIR_QUALITY, entryType });
			kept.add(layer);
		}
	}
	if (draft.data.layers.some(isHms)) setSmokeAndFire(data, true);
	const notices = fromMap
		? draft.data.layers.find((l) => l.dataset === PESTICIDE_NOTICES)
		: undefined;
	if (notices) data.layers.push(structuredClone(notices));
	const useOptions: MapOptions = {};
	let use: Layer | undefined;
	if (fromMap) {
		use = mapUseLayer(draft.data);
		if (use) data.layers.push(structuredClone(use));
	} else if (years.length > 0) {
		use = draft.data.layers.find((l) => l.dataset === PESTICIDE_USE);
		if (use) {
			data.layers.push({
				dataset: PESTICIDE_USE,
				...(use.filters ? { filters: copyFilters(use.filters) } : {})
			});
			if (use.entryType && use.entryType !== useFigureOf({}, catalog)) {
				useOptions.useFigure = use.entryType;
			}
			useOptions.usePeriod = periodFromRange(draft.data.dateRange, years, now);
		}
	}
	// The places' layer, the pollutants kept, smoke (carried over as smoke and fire) and the use
	// taken aren't left out.
	const source = mainLayer(draft.data, catalog) ?? draft.data.layers[0];
	const others = draft.data.layers.some(
		(l) => l !== source && !kept.has(l) && !isHms(l) && l !== notices && l !== use
	);
	// A use-only chart's use is kept as the Map's: the pollutant it gets replaces nothing.
	const replaced = !(use && source === use);
	const dropped: NowDropped[] = converted.dropped.filter(
		(d) => d !== "dates" && (d !== "overlays" || others) && (d !== "pollutant" || replaced)
	);
	if (shown && !range.range) dropped.push("dates");
	if (range.cut) dropped.push("range-cut");
	if (selection) dropped.push("selection");
	const options = fromMap ? mapOptions(draft) : useOptions;
	const { pollutant, ...rest } = converted;
	return {
		...rest,
		...(pollutant && replaced ? { pollutant } : {}),
		draft: { ...converted.draft, ...(Object.keys(options).length ? { options } : {}) },
		dropped,
		...(selection ? { selection: structuredClone(selection) } : {}),
		...(range.cut ? { cutAt: level } : {})
	};
}

/**
 * A Map draft cut to one layer: its first pollutant layer (holding the places) as the pollutant
 * showing, over its range (if it has one), with no options. `dropped` says when other pollutants
 * or smoke and fire were left out (`"overlays"`), when marks were (`"marks"`) and when a
 * region fill was (`"fill"`).
 */
export function mapShowingOnly(
	draft: Draft,
	catalog: CatalogEntry[],
	drawable: readonly string[] | undefined
): { draft: Draft; dropped: NowDropped[] } {
	const options = mapOptions(draft);
	const pollutants = pollutantLayers(draft.data, catalog);
	const showing = drawableShowing(draft.data, options, catalog, drawable);
	const first = pollutants[0] ?? draft.data.layers[0];
	const layer: Layer = structuredClone({ ...first, ...(showing ? { entryType: showing } : {}) });
	const dropped: NowDropped[] = [];
	if (draft.data.layers.length > 1) dropped.push("overlays");
	if (options.marks?.length) dropped.push("marks");
	if (options.fill) dropped.push("fill");
	return {
		draft: {
			type: draft.type,
			data: {
				...(draft.data.dateRange ? { dateRange: structuredClone(draft.data.dateRange) } : {}),
				layers: first ? [layer] : []
			},
			...(draft.thresholds ? { thresholds: structuredClone(draft.thresholds) } : {})
		},
		dropped
	};
}

/**
 * A Map draft as `type`: the pollutant showing at the places; smoke, fire and marks dropped with
 * notes. A now type then follows its own rules (`toNowDraft`, with `levels`: the alert level's
 * scale, or `"unavailable"` to leave the default owed; a range is left out with a note); a range
 * type takes the Map's range when it fits the type's span (else, and for a Map on Now, the
 * type's default range) and its place cap (`fromNowDraft`).
 *
 * A Chart also takes the use, as a pesticide layer of the figure drawn (`useFigureOf`) with the
 * Map's filters, when any of its period falls inside the Chart's range; otherwise the use is left
 * out with a `"use-period"` note naming the period (`usePeriod`). Any other type leaves it out
 * (`"overlays"`).
 */
export function fromMapDraft(
	draft: Draft,
	type: WidgetType,
	catalog: CatalogEntry[],
	levels: Level[] | "unavailable" = "unavailable",
	drawable?: readonly string[],
	now: Date = new Date()
): NowConversion {
	const one = mapShowingOnly(draft, catalog, drawable);
	// `type` is never the Map (Map to Map goes through `toMapDraft`), so a now type here is one.
	const converted =
		type.time === "now"
			? toNowDraft(one.draft, type, catalog, levels, mapType)
			: fromNowDraft(one.draft, type);
	const range = one.draft.data.dateRange;
	if (type.time !== "now" && range && !blockedBySpan(range, type.span, now)) {
		converted.draft.data.dateRange = structuredClone(range);
	}
	const use = mapUseLayer(draft.data);
	const options = mapOptions(draft);
	const period = parsePeriod(options.usePeriod);
	const figure = useFigureOf(options, catalog);
	const chartRange = converted.draft.data.dateRange;
	let dropped = [...one.dropped];
	let usePeriod: string | undefined;
	if (use && type.type === CHART_TYPE && period && figure && chartRange) {
		// The use has its own outcome, so "overlays" stays only for the other layers left out.
		const first = pollutantLayers(draft.data, catalog)[0] ?? draft.data.layers[0];
		const others = draft.data.layers.some((l) => l !== first && l !== use);
		if (!others) dropped = dropped.filter((d) => d !== "overlays");
		if (periodOverlaps(period, chartRange, now)) {
			converted.draft.data.layers.push({
				dataset: PESTICIDE_USE,
				entryType: figure,
				...(use.filters ? { filters: copyFilters(use.filters) } : {})
			});
		} else {
			dropped.push("use-period");
			usePeriod = periodKey(period);
		}
	}
	return {
		...converted,
		dropped: [...new Set([...dropped, ...converted.dropped])],
		...(usePeriod ? { usePeriod } : {})
	};
}
