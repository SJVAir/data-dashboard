import type { OptionValues } from "@sjvair/map-sdk";
import type { MonitorFeatureProperties } from "@sjvair/map-sdk/data";
import type { FeatureCollection, Point } from "geojson";
import { MAP_TOOLBAR_KEYS, type MapOptions } from "../options";

/** What the tile's data offers the toolbar. */
export type MapOffer = {
	/** Drawable pollutant layers, in order. */
	pollutants: string[];
	/** The loaded monitors' types. */
	types: string[];
	hasInactive: boolean;
	hasInside: boolean;
	smokeAndFire: boolean;
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
	drawn: string | undefined
): OptionValues {
	const values: OptionValues = { ...defaults };
	for (const key of FLAT_KEYS) {
		const saved = options[key];
		if (saved !== undefined) values[key] = saved;
	}
	if (drawn !== undefined) values.pollutant = drawn;
	const hidden = new Set(options.hiddenTypes);
	for (const type of offer.types) values[`${TYPE_PREFIX}${type}`] = !hidden.has(type);
	return values;
}

/** The options after the toolbar changed `changed` keys; a value equal to its default is removed. */
export function toOptions(
	current: MapOptions,
	next: OptionValues,
	changed: string[],
	defaults: OptionValues,
	firstPollutant: string | undefined
): MapOptions {
	const out: Record<string, unknown> = { ...current };
	const hidden = new Set(current.hiddenTypes);
	let typesChanged = false;
	for (const key of changed) {
		const value = next[key];
		if (key.startsWith(TYPE_PREFIX)) {
			const type = key.slice(TYPE_PREFIX.length);
			if (value === false) hidden.add(type);
			else hidden.delete(type);
			typesChanged = true;
		} else if (key === "pollutant") {
			if (typeof value !== "string" || value === firstPollutant) delete out.showing;
			else out.showing = value;
		} else if ((FLAT_KEYS as readonly string[]).includes(key)) {
			if (value === undefined || value === defaults[key]) delete out[key];
			else out[key] = value;
		}
	}
	if (typesChanged) {
		if (hidden.size === 0) delete out.hiddenTypes;
		else out.hiddenTypes = [...hidden];
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
	defaults: OptionValues = {}
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
): { pollutant: boolean; monitors: boolean; layers: boolean } {
	return {
		pollutant: offer.pollutants.length >= 2,
		monitors: monitorRowCount >= 2,
		layers: offer.smokeAndFire
	};
}

/** The monitors left after the filters (other fields kept; `null` stays `null`). */
export function filterMonitors<T extends FeatureCollection<Point, MonitorFeatureProperties>>(
	features: T | null,
	filters: MonitorFilters
): T | null {
	if (!features) return null;
	return {
		...features,
		features: features.features.filter((f) => {
			const p = f.properties;
			if (filters.hiddenTypes.has(p.type)) return false;
			if (filters.hideInactive && p.isActive === false) return false;
			if (filters.hideInside && p.location === "inside") return false;
			return true;
		})
	};
}
