import type { CatalogEntry } from "$lib/data/metadata";
import { LIMITS, type WidgetDataConfig } from "$lib/data/schema";
import { pollutantLayers } from "$lib/widgets/map/options";
import { keepingPlaces } from "./layers";

/** The Map's smoke and fire layers: place-less, drawn over the whole map. */
export const HMS_SMOKE = "hms-smoke";
export const HMS_FIRE = "hms-fire";
/** The most pollutants a Map holds: the layer limit less the smoke and fire layers. */
export const MAP_POLLUTANTS_MAX = LIMITS.LAYERS_MAX - 2;

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

/** Whether `data` has the smoke layer or the fire layer. */
export function hasSmokeAndFire(data: WidgetDataConfig): boolean {
	return data.layers.some((l) => l.dataset === HMS_SMOKE || l.dataset === HMS_FIRE);
}

/** Adds or removes both place-less layers together. */
export function setSmokeAndFire(data: WidgetDataConfig, on: boolean): void {
	if (on) {
		if (hasSmokeAndFire(data)) return;
		data.layers.push({ dataset: HMS_SMOKE }, { dataset: HMS_FIRE });
	} else {
		data.layers = data.layers.filter((l) => l.dataset !== HMS_SMOKE && l.dataset !== HMS_FIRE);
	}
}
