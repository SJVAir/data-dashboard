/**
 * Get data for the Map: its pollutants, smoke and fire, and converting a draft to and from it.
 */
import type { CatalogEntry, Level } from "$lib/data/metadata";
import type { Layer, WidgetDataConfig } from "$lib/data/schema";
import { fromLayer } from "$lib/places/selection";
import { mapType } from "$lib/widgets/map";
import {
	HMS_FIRE,
	HMS_SMOKE,
	MAP_POLLUTANTS_MAX,
	MAP_TYPE,
	mapOptions,
	pollutantLayers,
	showingOf
} from "$lib/widgets/map/options";
import type { WidgetType } from "$lib/widgets/registry";
import { mainLayer } from "$lib/widgets/shared/input";
import type { Draft } from "./draft.svelte";
import { keepingPlaces } from "./layers";
import { fromNowDraft, toNowDraft, type NowConversion, type NowDropped } from "./now";

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
 * Whether `draft` already has the Map's shape, so opening it as a Map converts nothing: no dates;
 * one to `MAP_POLLUTANTS_MAX` air-quality layers first, the first holding at most `maxPlaces`
 * places and the others none; then only place-less smoke and fire layers.
 */
export function isMapShaped(draft: Draft): boolean {
	const { data } = draft;
	if (data.dateRange || data.timeSubRange) return false;
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
 * `draft` (any type) as a Map: the source's pollutant (or the first offered), its places (≤ 25),
 * smoke and fire on when the source had a smoke layer. A Map draft (one opened over its place
 * cap, say) keeps its other offered pollutants, its smoke and fire and its options.
 */
export function toMapDraft(
	draft: Draft,
	catalog: CatalogEntry[],
	allowed: string[]
): NowConversion {
	const converted = toNowDraft(draft, mapType, catalog, [], undefined, allowed);
	const data = converted.draft.data;
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
	const dropped = converted.dropped.filter((d) => d !== "overlays" || others);
	const options = fromMap ? mapOptions(draft) : {};
	return {
		...converted,
		draft: { ...converted.draft, ...(Object.keys(options).length ? { options } : {}) },
		dropped
	};
}

/**
 * A Map draft cut to one layer: its first pollutant layer (holding the places) as the pollutant
 * showing, with no options. `dropped` says when other pollutants or smoke and fire were left out
 * (`"overlays"`) and when marks were (`"marks"`).
 */
export function mapShowingOnly(
	draft: Draft,
	catalog: CatalogEntry[]
): { draft: Draft; dropped: NowDropped[] } {
	const options = mapOptions(draft);
	const pollutants = pollutantLayers(draft.data, catalog);
	const showing = showingOf(draft.data, options, catalog);
	const first = pollutants[0] ?? draft.data.layers[0];
	const layer: Layer = structuredClone({ ...first, ...(showing ? { entryType: showing } : {}) });
	const dropped: NowDropped[] = [];
	if (draft.data.layers.length > 1) dropped.push("overlays");
	if (options.marks?.length) dropped.push("marks");
	return {
		draft: {
			type: draft.type,
			data: { layers: first ? [layer] : [] },
			...(draft.thresholds ? { thresholds: structuredClone(draft.thresholds) } : {})
		},
		dropped
	};
}

/**
 * A Map draft as `type`: the pollutant showing at the places; smoke, fire and marks dropped with
 * notes. A now type then follows its own rules (`toNowDraft`, with `levels`: the alert level's
 * scale, or `"unavailable"` to leave the default owed); a range type takes its default range and
 * place cap (`fromNowDraft`).
 */
export function fromMapDraft(
	draft: Draft,
	type: WidgetType,
	catalog: CatalogEntry[],
	levels: Level[] | "unavailable" = "unavailable"
): NowConversion {
	const one = mapShowingOnly(draft, catalog);
	const converted =
		type.time === "now"
			? toNowDraft(one.draft, type, catalog, levels, mapType)
			: fromNowDraft(one.draft, type);
	return {
		...converted,
		dropped: [...new Set([...one.dropped, ...converted.dropped])]
	};
}
