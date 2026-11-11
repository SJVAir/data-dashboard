/**
 * The starter's chosen place: a per-space preference (this device only), read before the starter
 * is built. Kept light: it's in the initial bundle.
 */
import { ChosenPlaceSchema, type ChosenPlace } from "$lib/data/schema";
import type { Platform, SpaceId } from "$lib/platform/types";
import { DEFAULT_LAYER } from "$lib/widgets/defaults";

export type { ChosenPlace };

/** Preference key (per space): the place the starter shows. */
export const STARTER_PLACE_KEY = "starterPlace";

/** Fresno County, as a new widget's place (`DEFAULT_LAYER`), as a fresh object. */
export function defaultStarterPlace(): ChosenPlace {
	return structuredClone(DEFAULT_LAYER.place) as ChosenPlace;
}

/** The space's chosen place; unset, unreadable or invalid (`default-place` too) is Fresno County. */
export async function readStarterPlace(
	p: Pick<Platform, "preferences">,
	space: SpaceId
): Promise<ChosenPlace> {
	try {
		const parsed = ChosenPlaceSchema.safeParse(await p.preferences.get(space, STARTER_PLACE_KEY));
		if (parsed.success) return parsed.data;
	} catch {
		// Storage blocked: the default.
	}
	return defaultStarterPlace();
}

/** Stores the space's chosen place (a point from "Use my location" stays on this device). */
export async function saveStarterPlace(
	p: Pick<Platform, "preferences">,
	space: SpaceId,
	place: ChosenPlace
): Promise<void> {
	await p.preferences.set(space, STARTER_PLACE_KEY, place);
}
