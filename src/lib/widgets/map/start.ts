import { getMetadata } from "$lib/data";
import type { WidgetDataConfig } from "$lib/data/schema";
import type { Dashboard } from "$lib/documents/schema";
import { placesToReplace } from "$lib/places/replace";
import { report } from "$lib/safety/report";
import { DEFAULT_LAYER, DEFAULT_PLACE } from "../defaults";

/**
 * A new Map's data: one PM2.5 layer at the bar's place when the bar shows, else the dashboard's most
 * common place, else the default place, with every monitor type in `types` ticked (spec decision
 * 8: a new Map draws every monitor in its Where, as a Map did before).
 */
export function mapStartData(doc: Dashboard, types: string[] = []): WidgetDataConfig {
	const place = placesToReplace(doc)[0] ?? DEFAULT_PLACE;
	return {
		place: structuredClone(place),
		layers: [
			{
				dataset: DEFAULT_LAYER.dataset,
				entryType: DEFAULT_LAYER.entryType,
				...(types.length > 0 ? { monitorTypes: [...types] } : {})
			}
		]
	};
}

/**
 * A new Map's data with every monitor type the monitors meta lists ticked. A failed lookup ticks
 * none (the Map then draws no monitors, and its Air quality section can tick them).
 */
export async function mapStartDataWithTypes(doc: Dashboard): Promise<WidgetDataConfig> {
	let types: string[] = [];
	try {
		types = (await getMetadata().monitorTypes()).map((t) => t.type);
	} catch (error) {
		report(error);
	}
	return mapStartData(doc, types);
}
