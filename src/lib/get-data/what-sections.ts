import { AIR_QUALITY } from "$lib/data/layer-kind";
import type { CatalogEntry, LocationGroup } from "$lib/data/metadata";
import type { Layer } from "$lib/data/schema";
import { FORECAST_TYPE } from "$lib/widgets/forecast";
import {
	HMS_FIRE,
	HMS_SMOKE,
	LOCATIONS,
	MAP_TYPE,
	PESTICIDE_NOTICES,
	PESTICIDE_USE
} from "$lib/widgets/map/options";
import type { WidgetType } from "$lib/widgets/registry";
import type { OfferedDataset } from "./offer";

/** The Map's "Fill regions by" section (not a dataset: the Map's own option). */
export const FILL = "fill";

/** The Map's block of saved location types no meta group lists any more. */
export const LOCATIONS_GONE = "locations-gone";

/** The key of a location group's section (the Map's own). */
export function locationSectionKey(group: string): string {
	return `${LOCATIONS}:${group}`;
}

/** Whether `key` is a location group's section or the block of types no longer offered. */
const isLocationSection = (key: string) =>
	key === LOCATIONS_GONE || key.startsWith(`${LOCATIONS}:`);

/** The datasets the Map has sections of its own for (smoke takes fire with it). */
const MAP_OWN = [HMS_SMOKE, PESTICIDE_USE, PESTICIDE_NOTICES];

/** One section of What: a dataset (its id) or the Map's fill, with its offer and catalog entry. */
export type WhatSection = {
	key: string;
	/** The catalog's entry, when it has one. */
	entry?: CatalogEntry;
	/** The offer (entry types to choose), for a dataset Get data offers. */
	offered?: OfferedDataset;
	/** A location group's section: the group (its label and types, from the regions meta). */
	group?: LocationGroup;
	/** The block of types no longer offered: the saved types no group lists, in saved order. */
	gone?: string[];
};

/** The saved location types no group in `groups` lists, in saved order. */
function goneTypes(groups: LocationGroup[], saved: readonly string[]): string[] {
	const offered = new Set(groups.flatMap((g) => g.types.map((t) => t.type)));
	return saved.filter((t) => !offered.has(t));
}

/**
 * The locations layer's types after ticking (`on`) or unticking `type`: in the order of every
 * group's types, then any saved type no group lists, in saved order (spec 7c).
 */
export function toggledLocationTypes(
	groups: LocationGroup[],
	saved: readonly string[],
	type: string,
	on: boolean
): string[] {
	const ticked = new Set(saved);
	if (on) ticked.add(type);
	else ticked.delete(type);
	const order = [...groups.flatMap((g) => g.types.map((t) => t.type)), ...goneTypes(groups, saved)];
	if (!order.includes(type)) order.push(type);
	return order.filter((t) => ticked.has(t));
}

/**
 * What's sections for every widget type (spec decision 16), in catalog order: each offered dataset
 * (one some type accepts, with an adapter) and the Map's own (smoke and fire as one, spray notices,
 * pesticide use), then a section per location group (the Map's, in `groups`' order) and a block
 * of the saved location types no group lists, then "Fill regions by". Air quality, and the Map's
 * smoke and fire, show without a catalog entry; notices and use only while on (their fallback
 * headings). A dataset no type shows isn't listed. While the groups are unknown (`undefined`:
 * loading, or they couldn't be loaded) no location section is listed.
 */
export function whatSections(
	catalog: CatalogEntry[],
	offered: OfferedDataset[],
	layers: Pick<Layer, "dataset" | "locationTypes">[],
	groups?: LocationGroup[]
): WhatSection[] {
	const out: WhatSection[] = [];
	const has = (key: string) => out.some((s) => s.key === key);
	const add = (key: string, entry?: CatalogEntry) => {
		if (has(key)) return;
		const offer = offered.find((o) => o.dataset.id === key);
		out.push({ key, ...(entry ? { entry } : {}), ...(offer ? { offered: offer } : {}) });
	};
	for (const entry of catalog) {
		if (entry.id === HMS_FIRE) continue;
		if (offered.some((o) => o.dataset.id === entry.id) || MAP_OWN.includes(entry.id)) {
			add(entry.id, entry);
		}
	}
	if (!has(AIR_QUALITY)) out.unshift({ key: AIR_QUALITY });
	add(HMS_SMOKE);
	for (const key of [PESTICIDE_USE, PESTICIDE_NOTICES]) {
		if (layers.some((l) => l.dataset === key)) add(key);
	}
	if (groups) {
		for (const group of groups) out.push({ key: locationSectionKey(group.key), group });
		const saved = layers.find((l) => l.dataset === LOCATIONS)?.locationTypes ?? [];
		const gone = goneTypes(groups, saved);
		if (gone.length) out.push({ key: LOCATIONS_GONE, gone });
	}
	out.push({ key: FILL });
	return out;
}

/**
 * The types that show section `key`, in `types`' order: those that accept its dataset, the Map for
 * its own sections (the location sections among them), and the Forecast strip for Air quality (its one monitor is searched there,
 * spec decision 11). Any other type shows it greyed out.
 */
export function sectionTypes(key: string, types: WidgetType[]): WidgetType[] {
	return types.filter(
		(t) =>
			(key !== FILL && t.accepts?.datasets?.includes(key)) ||
			(t.type === MAP_TYPE && (key === FILL || MAP_OWN.includes(key) || isLocationSection(key))) ||
			(t.type === FORECAST_TYPE && key === AIR_QUALITY)
	);
}
