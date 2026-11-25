import { AIR_QUALITY } from "$lib/data/layer-kind";
import type { CatalogEntry, LocationGroup } from "$lib/data/metadata";
import type { Layer } from "$lib/data/schema";
import { FORECAST_TYPE } from "$lib/widgets/forecast";
import {
	HMS_FIRE,
	HMS_SMOKE,
	MAP_TYPE,
	PESTICIDE_NOTICES,
	PESTICIDE_USE
} from "$lib/widgets/map/options";
import type { WidgetType } from "$lib/widgets/registry";
import type { OfferedDataset } from "./offer";

/** The datasets the Map has sections of its own for (smoke takes fire with it). */
const MAP_OWN = [HMS_SMOKE, PESTICIDE_USE, PESTICIDE_NOTICES];

/** One section of What: a dataset (its id), with its offer and catalog entry. */
export type WhatSection = {
	key: string;
	/** The catalog's entry, when it has one. */
	entry?: CatalogEntry;
	/** The offer (entry types to choose), for a dataset Get data offers. */
	offered?: OfferedDataset;
};

/**
 * The saved location types no group in `groups` lists, in saved order (the Map options' "No longer
 * offered" block).
 */
export function goneTypes(groups: LocationGroup[], saved: readonly string[]): string[] {
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
 * pesticide use). Air quality, and the Map's smoke and fire, show without a catalog entry; notices
 * and use only while on (their fallback headings). A dataset no type shows isn't listed. The Map's
 * settings (points of interest, the fill) are in its options panel, not What (2026-11-25).
 */
export function whatSections(
	catalog: CatalogEntry[],
	offered: OfferedDataset[],
	layers: Pick<Layer, "dataset">[]
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
	return out;
}

/**
 * The types that show section `key`, in `types`' order: those that accept its dataset, the Map for
 * its own sections, and the Forecast strip for Air quality
 * (its one monitor is searched there, spec decision 11). Any other type shows it greyed out.
 */
export function sectionTypes(key: string, types: WidgetType[]): WidgetType[] {
	return types.filter(
		(t) =>
			t.accepts?.datasets?.includes(key) ||
			(t.type === MAP_TYPE && MAP_OWN.includes(key)) ||
			(t.type === FORECAST_TYPE && key === AIR_QUALITY)
	);
}
