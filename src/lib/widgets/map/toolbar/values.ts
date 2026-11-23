import type { OptionValues } from "@sjvair/map-sdk";
import { decodeRef, type MonitorFeatureProperties } from "@sjvair/map-sdk/data";
import type { FeatureCollection, Geometry } from "geojson";
import type { Layer } from "$lib/data/schema";
import { MAP_TOOLBAR_KEYS, type MapOptions } from "../options";

/** The toolbar value key of the spray notices row. */
export const NOTICES_KEY = "notices";

/** The prefix of a location group row's value key (`location:<group key>`). */
export const LOCATION_PREFIX = "location:";

/** The toolbar value keys of the pesticide use rows (the Layers row, the figure). */
export const USE_KEY = "use";
export const USE_FIGURE_KEY = "useFigure";

/** What the tile's data offers the toolbar. */
export type MapOffer = {
	/** The Map's pollutant when the server's map draws it, else none (never more than one). */
	pollutants: string[];
	/** The loaded monitors' types. */
	types: string[];
	hasInactive: boolean;
	hasInside: boolean;
	smokeAndFire: boolean;
	/** The tile has a drawable fill. */
	fill: boolean;
	/** The tile has a drawable spray notices layer. */
	notices: boolean;
	/** The location groups the tile draws (a type of theirs ticked), in order: a row each. */
	locations: { key: string; label: string }[];
	/** The tile has a drawable pesticide use layer: its figures. */
	use: { figures: string[] } | null;
};

export type MonitorFilters = {
	hiddenTypes: Set<string>;
	hideInactive: boolean;
	hideInside: boolean;
};

const TYPE_PREFIX = "type:";
const FLAT_KEYS = ["basemap", "clustered", "fireAndSmoke", "inactive", "inside"] as const;

/** The toolbar's values: saved options over the defaults; the pollutant is the one drawn. */
export function toValues(
	options: MapOptions,
	offer: MapOffer,
	defaults: OptionValues,
	drawn: string | undefined,
	drawnFigure?: string
): OptionValues {
	const values: OptionValues = { ...defaults };
	for (const key of FLAT_KEYS) {
		const saved = options[key];
		if (saved !== undefined) values[key] = saved;
	}
	values.regions = options.fillShown !== false;
	values[NOTICES_KEY] = options.noticesShown !== false;
	values[USE_KEY] = options.useShown !== false;
	if (drawnFigure !== undefined) values[USE_FIGURE_KEY] = drawnFigure;
	if (drawn !== undefined) values.pollutant = drawn;
	const hidden = new Set(options.hiddenTypes);
	for (const type of offer.types) values[`${TYPE_PREFIX}${type}`] = !hidden.has(type);
	const hiddenGroups = new Set(options.hiddenLocationGroups);
	for (const { key } of offer.locations)
		values[`${LOCATION_PREFIX}${key}`] = !hiddenGroups.has(key);
	return values;
}

/** The options after the toolbar changed `changed` keys; a value equal to its default is removed. */
export function toOptions(
	current: MapOptions,
	next: OptionValues,
	changed: string[],
	defaults: OptionValues,
	firstFigure?: string
): MapOptions {
	const out: Record<string, unknown> = { ...current };
	const hidden = new Set(current.hiddenTypes);
	let typesChanged = false;
	const hiddenGroups = new Set(current.hiddenLocationGroups);
	let groupsChanged = false;
	for (const key of changed) {
		const value = next[key];
		if (key.startsWith(LOCATION_PREFIX)) {
			const group = key.slice(LOCATION_PREFIX.length);
			if (value === false) hiddenGroups.add(group);
			else hiddenGroups.delete(group);
			groupsChanged = true;
		} else if (key.startsWith(TYPE_PREFIX)) {
			const type = key.slice(TYPE_PREFIX.length);
			if (value === false) hidden.add(type);
			else hidden.delete(type);
			typesChanged = true;
		} else if (key === "regions") {
			if (value === false) out.fillShown = false;
			else delete out.fillShown;
		} else if (key === NOTICES_KEY) {
			if (value === false) out.noticesShown = false;
			else delete out.noticesShown;
		} else if (key === USE_KEY) {
			if (value === false) out.useShown = false;
			else delete out.useShown;
		} else if (key === USE_FIGURE_KEY) {
			if (typeof value !== "string" || value === firstFigure) delete out.useFigure;
			else out.useFigure = value;
		} else if ((FLAT_KEYS as readonly string[]).includes(key)) {
			if (value === undefined || value === defaults[key]) delete out[key];
			else out[key] = value;
		}
	}
	if (typesChanged) {
		if (hidden.size === 0) delete out.hiddenTypes;
		else out.hiddenTypes = [...hidden];
	}
	if (groupsChanged) {
		if (hiddenGroups.size === 0) delete out.hiddenLocationGroups;
		else out.hiddenLocationGroups = [...hiddenGroups];
	}
	return out as MapOptions;
}

/** The options without the toolbar's keys (the owner's Reset). */
export function withoutToolbar(options: MapOptions): MapOptions {
	const out: Record<string, unknown> = { ...options };
	for (const key of MAP_TOOLBAR_KEYS) delete out[key];
	return out as MapOptions;
}

/** What the monitors are filtered by; a row that is not offered filters nothing. */
export function activeFilters(
	options: MapOptions,
	_offer: MapOffer,
	rows: { types: boolean; inactive: boolean; inside: boolean },
	defaults: OptionValues
): MonitorFilters {
	return {
		hiddenTypes: rows.types ? new Set(options.hiddenTypes) : new Set(),
		hideInactive: rows.inactive && !(options.inactive ?? defaults.inactive === true),
		hideInside: rows.inside && !(options.inside ?? defaults.inside === true)
	};
}

/** Which toolbar groups have something to show. */
export function groupsShown(
	offer: MapOffer,
	monitorRowCount: number
): { pollutant: boolean; monitors: boolean; layers: boolean; use: boolean } {
	return {
		pollutant: offer.pollutants.length >= 2,
		monitors: monitorRowCount >= 2,
		layers:
			offer.smokeAndFire ||
			offer.fill ||
			offer.notices ||
			offer.locations.length > 0 ||
			offer.use !== null,
		use: offer.use !== null
	};
}

/**
 * The monitors that are the tile's own places: its air-quality layer's searched monitors. The
 * toolbar's filters never hide them (ruling, 2026-11-13).
 */
export function placeMonitors(layer: Pick<Layer, "monitors"> | undefined): ReadonlySet<string> {
	return new Set(layer?.monitors ?? []);
}

/**
 * Whether the monitor `refKey` names is one of the tile's own (`exempt`): never filtered, and
 * the toolbar offers no filter rows for it.
 */
export function isExempt(refKey: string, exempt: ReadonlySet<string>): boolean {
	if (exempt.size === 0) return false;
	const ref = decodeRef(refKey);
	return ref?.kind === "monitor" && exempt.has(ref.id);
}

/**
 * The monitors left after the filters (other fields kept; `null` stays `null`). The `exempt`
 * monitors (the tile's own places) are always kept: the filters hide incidental monitors around
 * a place, never one the owner chose.
 */
export function filterMonitors<T extends FeatureCollection<Geometry, MonitorFeatureProperties>>(
	features: T | null,
	filters: MonitorFilters,
	exempt: ReadonlySet<string> = new Set()
): T | null {
	if (!features) return null;
	return {
		...features,
		features: features.features.filter((f) => {
			const p = f.properties;
			if (isExempt(p.refKey, exempt)) return true;
			if (filters.hiddenTypes.has(p.type)) return false;
			if (filters.hideInactive && p.isActive === false) return false;
			if (filters.hideInside && p.location === "inside") return false;
			return true;
		})
	};
}
