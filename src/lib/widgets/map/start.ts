import { everyMonitorType } from "$lib/data/layer-kind";
import type { WidgetDataConfig } from "$lib/data/schema";
import type { Dashboard } from "$lib/documents/schema";
import { placesToReplace } from "$lib/places/replace";
import { DEFAULT_LAYER, DEFAULT_PLACE } from "../defaults";

/**
 * A new Map's data: one PM2.5 layer at the bar's place when a widget shows it (even closed), else the dashboard's most
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

/** How long a new Map waits for the catalog before it's added with no monitor types. */
export const CATALOG_WAIT_MS = 10_000;

/** No catalog answer in `CATALOG_WAIT_MS`. */
const LATE = Symbol("late");

/**
 * Every monitor type of the catalog (`everyMonitorType`), and whether the catalog failed. A
 * catalog that can't be loaded (it throws, which is reported, or the server has none to give) is
 * `failed`; one that isn't in `CATALOG_WAIT_MS` gives no types but isn't failed (a slower ask may
 * still get them). Either way there are no types: the Map then draws no monitors and says so
 * (never an invented list).
 */
export async function loadMonitorTypesResult(): Promise<{ types: string[]; failed: boolean }> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		// Loaded here, not at the top: this module is part of the Map's descriptor, in the initial
		// bundle, and the data layer stays out of it.
		const late = new Promise<typeof LATE>((resolve) => {
			timer = setTimeout(() => resolve(LATE), CATALOG_WAIT_MS);
		});
		const catalog = await Promise.race([
			import("$lib/data").then(({ getMetadata }) => getMetadata().catalog()),
			late
		]);
		if (catalog === LATE) return { types: [], failed: false };
		if (catalog === "unavailable") return { types: [], failed: true };
		return { types: everyMonitorType(catalog), failed: false };
	} catch (error) {
		const { report } = await import("$lib/safety/report");
		report(error);
		return { types: [], failed: true };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Every monitor type of the catalog; none when it can't be loaded or is late
 * (`loadMonitorTypesResult`).
 */
export async function loadMonitorTypes(): Promise<string[]> {
	return (await loadMonitorTypesResult()).types;
}

/** A new Map's data with every monitor type ticked (spec decision 8). */
export async function mapStartDataWithTypes(doc: Dashboard): Promise<WidgetDataConfig> {
	return mapStartData(doc, await loadMonitorTypes());
}
