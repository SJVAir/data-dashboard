import { everyMonitorType } from "$lib/data/layer-kind";
import type { WidgetDataConfig } from "$lib/data/schema";
import type { Dashboard } from "$lib/documents/schema";
import { placesToReplace } from "$lib/places/replace";
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
 * A new Map's data with every monitor type ticked (`everyMonitorType`, from the catalog). A catalog
 * that can't be loaded ticks none: the Map then draws no monitors and says so (never an invented
 * list).
 */
export async function mapStartDataWithTypes(doc: Dashboard): Promise<WidgetDataConfig> {
	let types: string[] = [];
	try {
		// Loaded here, not at the top: this module is part of the Map's descriptor, in the initial
		// bundle, and the data layer stays out of it.
		const { getMetadata } = await import("$lib/data");
		const catalog = await getMetadata().catalog();
		if (catalog !== "unavailable") types = everyMonitorType(catalog);
	} catch (error) {
		const { report } = await import("$lib/safety/report");
		report(error);
	}
	return mapStartData(doc, types);
}
