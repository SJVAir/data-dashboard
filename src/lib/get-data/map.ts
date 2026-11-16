/**
 * Get data for the Map: its pollutants, smoke and fire, and converting a draft to and from it.
 */
import type { CatalogEntry, Level } from "$lib/data/metadata";
import type { DateRangeSpec, Layer, WidgetDataConfig } from "$lib/data/schema";
import { addDays } from "$lib/format";
import { resolveRange } from "$lib/format/range";
import { fromLayer } from "$lib/places/selection";
import { mapType } from "$lib/widgets/map";
import {
	HMS_FIRE,
	HMS_SMOKE,
	MAP_MAX_DAYS,
	MAP_POLLUTANTS_MAX,
	MAP_TYPE,
	drawableShowing,
	mapOptions,
	pollutantLayers
} from "$lib/widgets/map/options";
import { getWidgetType, type WidgetType } from "$lib/widgets/registry";
import { mainLayer } from "$lib/widgets/shared/input";
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
			if (!data.layers.some((l) => l.dataset === dataset)) data.layers.push({ dataset });
		}
	} else {
		data.layers = data.layers.filter((l) => l.dataset !== HMS_SMOKE && l.dataset !== HMS_FIRE);
	}
}

/**
 * Whether `draft` already has the Map's shape, so opening it as a Map converts nothing: no day
 * selection and no date range the Map's span rules out (none is Now); one to
 * `MAP_POLLUTANTS_MAX` air-quality layers first, the first holding at most `maxPlaces` places and
 * the others none; then only place-less smoke and fire layers.
 */
export function isMapShaped(draft: Draft, now: Date = new Date()): boolean {
	const { data } = draft;
	if (data.timeSubRange) return false;
	if (data.dateRange && blockedBySpan(data.dateRange, mapType.span, now)) return false;
	const count = data.layers.findIndex((l) => l.dataset !== AIR_QUALITY);
	const pollutants = count < 0 ? data.layers : data.layers.slice(0, count);
	const rest = count < 0 ? [] : data.layers.slice(count);
	if (pollutants.length < 1 || pollutants.length > MAP_POLLUTANTS_MAX) return false;
	if (pollutants.some((l) => !l.entryType)) return false;
	if (fromLayer(pollutants[0]).length > (mapType.accepts?.maxPlaces ?? 1)) return false;
	if (pollutants.slice(1).some((l) => fromLayer(l).length > 0)) return false;
	return rest.every((l) => isHms(l) && !l.entryType && fromLayer(l).length === 0);
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

/**
 * `range` as the Map takes it: as it is within the Map's span; a longer one cut to its last
 * `MAP_MAX_DAYS` days (`cut`: a rolling one as the trailing days up to today, so it keeps
 * rolling); none for one shorter than a day (a few trailing hours), which the Map can't step
 * through.
 */
function mapRange(range: DateRangeSpec, now: Date): { range?: DateRangeSpec; cut?: true } {
	const block = blockedBySpan(range, mapType.span, now);
	if (!block) return { range: structuredClone(range) };
	if (block === "too-short") return {};
	if (range.kind === "trailing") {
		return { range: { kind: "trailing", amount: MAP_MAX_DAYS, unit: "day" }, cut: true };
	}
	const { lastDate } = resolveRange(range, now);
	return {
		range: { kind: "custom", start: addDays(lastDate, -(MAP_MAX_DAYS - 1)), end: lastDate },
		cut: true
	};
}

/**
 * `draft` (any type) as a Map: the source's pollutant (or the first offered), its places (≤ 25),
 * smoke and fire on when the source had a smoke layer, and the range the person chose
 * (`chosenRange`, then `mapRange`: cut to the Map's 366 days with a `"range-cut"` note; none,
 * or a default range, is Now). A day selection is dropped with
 * a `"selection"` note. A Map draft (one opened over its place cap, say) keeps its other offered
 * pollutants, its smoke and fire and its options.
 */
export function toMapDraft(
	draft: Draft,
	catalog: CatalogEntry[],
	allowed: string[],
	now: Date = new Date()
): NowConversion {
	const converted = toNowDraft(draft, mapType, catalog, [], undefined, allowed);
	const data = converted.draft.data;
	const shown = chosenRange(draft);
	const range = shown ? mapRange(shown, now) : {};
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
	// The places' layer, the pollutants kept and smoke (carried over as smoke and fire) aren't
	// left out.
	const source = mainLayer(draft.data, catalog) ?? draft.data.layers[0];
	const others = draft.data.layers.some((l) => l !== source && !kept.has(l) && !isHms(l));
	const dropped: NowDropped[] = converted.dropped.filter(
		(d) => d !== "dates" && (d !== "overlays" || others)
	);
	if (shown && !range.range) dropped.push("dates");
	if (range.cut) dropped.push("range-cut");
	if (selection) dropped.push("selection");
	const options = fromMap ? mapOptions(draft) : {};
	return {
		...converted,
		draft: { ...converted.draft, ...(Object.keys(options).length ? { options } : {}) },
		dropped,
		...(selection ? { selection: structuredClone(selection) } : {})
	};
}

/**
 * A Map draft cut to one layer: its first pollutant layer (holding the places) as the pollutant
 * showing, over its range (if it has one), with no options. `dropped` says when other pollutants
 * or smoke and fire were left out (`"overlays"`) and when marks were (`"marks"`).
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
	return {
		...converted,
		dropped: [...new Set([...one.dropped, ...converted.dropped])]
	};
}
