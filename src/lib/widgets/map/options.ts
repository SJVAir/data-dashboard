import { layerKind } from "$lib/data/layer-kind";
import type { CatalogEntry } from "$lib/data/metadata";
import { SafeIdSchema, type Layer, type WidgetDataConfig } from "$lib/data/schema";
import type { WidgetInstance } from "$lib/documents/schema";
import { z } from "$lib/zod";

export const MAP_TYPE = "map";
export const MAP_MARKS_MAX = 25;

export const MapOptionsSchema = z.strictObject({
	/** The entry type drawn now (one of the pollutant layers'). */
	showing: SafeIdSchema.optional(),
	/** The monitors marked on the map. */
	marks: z
		.array(SafeIdSchema)
		.max(MAP_MARKS_MAX)
		.refine((ids) => new Set(ids).size === ids.length, { message: "Marks must be unique" })
		.optional()
});
export type MapOptions = z.infer<typeof MapOptionsSchema>;

/** A Map's options; invalid or missing options read as none (nothing marked). */
export function mapOptions(widget: Pick<WidgetInstance, "options">): MapOptions {
	const parsed = MapOptionsSchema.safeParse(widget.options);
	return parsed.success ? parsed.data : {};
}

/** The air-quality layers, in order (the first holds the places). */
export function pollutantLayers(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined
): Layer[] {
	return data.layers.filter((l) => {
		if (l.dataset !== "air-quality") return false;
		const kind = layerKind(l, catalog);
		return kind === undefined || kind === "pollutant";
	});
}

/** The entry type drawn now: `options.showing` when a pollutant layer has it, else the first. */
export function showingOf(
	data: WidgetDataConfig,
	options: MapOptions,
	catalog: CatalogEntry[] | undefined
): string | undefined {
	const layers = pollutantLayers(data, catalog);
	const wanted = layers.find((l) => l.entryType && l.entryType === options.showing);
	return (wanted ?? layers[0])?.entryType;
}
