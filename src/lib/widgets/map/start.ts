import type { WidgetDataConfig } from "$lib/data/schema";
import type { Dashboard } from "$lib/documents/schema";
import { placesToReplace } from "$lib/places/replace";
import { DEFAULT_LAYER } from "../defaults";

/**
 * A new Map's data: one layer at the bar's place when the bar shows, else the dashboard's most
 * common place, else the default place.
 */
export function mapStartData(doc: Dashboard): WidgetDataConfig {
	const place = placesToReplace(doc)[0] ?? DEFAULT_LAYER.place;
	return {
		layers: [
			{
				dataset: DEFAULT_LAYER.dataset,
				entryType: DEFAULT_LAYER.entryType,
				place: structuredClone(place)
			}
		]
	};
}
