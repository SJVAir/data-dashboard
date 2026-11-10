/**
 * What the "Change place" bar says. Loaded lazily by the bar, so the place directory and the
 * resolvers stay out of the initial bundle.
 */
import { getMetadata, getResolvers } from "$lib/data";
import type { ChosenPlace } from "$lib/data/schema";
import { m } from "$lib/paraglide/messages.js";
import { DEFAULT_LAYER } from "$lib/widgets/defaults";
import type { PlaceViewer } from "$lib/widgets/shared/viewer";
import { directoryFor } from "./host";

/** The place's name as the picker shows it; `null` when it doesn't resolve (gone, or unknown). */
export async function placeName(place: ChosenPlace, signal: AbortSignal): Promise<string | null> {
	const resolvers = getResolvers();
	const directory = () => directoryFor(getMetadata(), resolvers.regions);
	switch (place.kind) {
		case "region": {
			const found = await resolvers.regions.resolve(place.type, place.code, signal);
			if (!found || found === "unsupported") return null;
			const name = await directory()
				.regionNamer(signal)
				.catch(() => null);
			return name ? name({ type: place.type, name: found.name }) : found.name;
		}
		case "location": {
			const found = await resolvers.locations.resolve(place.source, place.code, signal);
			return found?.name ?? null;
		}
		case "monitor": {
			// The bar is about PM2.5, as a new widget is.
			const entryType = DEFAULT_LAYER.entryType as string;
			const monitors = await directory().monitors(entryType, { activeOnly: false }, signal);
			return monitors.find((o) => o.id === place.id)?.name ?? null;
		}
		default:
			return null;
	}
}

/**
 * "Showing Fresno County"; "Showing your location" for the owner's point and "Showing a shared
 * location" for someone else's; the generic "Showing this dashboard's place" when the place
 * can't be named (gone, or its lookup failed). Rejects only when `signal` aborts.
 */
export async function placeBarText(
	place: ChosenPlace,
	viewer: PlaceViewer,
	signal: AbortSignal
): Promise<string> {
	const name = await placeName(place, signal).catch(() => null);
	if (signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
	if (name) return m.place_bar_showing({ place: name });
	if (place.kind === "point") {
		return viewer === "owner"
			? m.place_bar_showing_your_location()
			: m.place_bar_showing_shared_location();
	}
	return m.place_bar_showing_this_dashboards_place();
}
