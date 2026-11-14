import { layerKind } from "$lib/data/layer-kind";
import type { CatalogEntry } from "$lib/data/metadata";
import { LIMITS, SafeIdSchema, type Layer, type WidgetDataConfig } from "$lib/data/schema";
import type { WidgetInstance } from "$lib/documents/schema";
import { z } from "$lib/zod";

export const MAP_TYPE = "map";
export const MAP_MARKS_MAX = 25;
/** The Map's smoke and fire layers: place-less, drawn over the whole map. */
export const HMS_SMOKE = "hms-smoke";
export const HMS_FIRE = "hms-fire";
/** The most pollutants a Map holds: the layer limit less the smoke and fire layers. */
export const MAP_POLLUTANTS_MAX = LIMITS.LAYERS_MAX - 2;

export const MapOptionsSchema = z.strictObject({
	/** The entry type drawn now (one of the pollutant layers'). */
	showing: SafeIdSchema.optional(),
	/** The monitors marked on the map. */
	marks: z
		.array(SafeIdSchema)
		.max(MAP_MARKS_MAX)
		.refine((ids) => new Set(ids).size === ids.length, { message: "Marks must be unique" })
		.optional(),
	/** The basemap's id (missing: the preset's default). */
	basemap: SafeIdSchema.optional(),
	clustered: z.boolean().optional(),
	fireAndSmoke: z.boolean().optional(),
	/** Show inactive monitors. */
	inactive: z.boolean().optional(),
	/** Show indoor monitors. */
	inside: z.boolean().optional(),
	/** Monitor types switched off. */
	hiddenTypes: z
		.array(SafeIdSchema)
		.max(32)
		.refine((ids) => new Set(ids).size === ids.length, { message: "Types must be unique" })
		.optional()
});
export type MapOptions = z.infer<typeof MapOptionsSchema>;

/** The options the toolbar owns (everything but `marks`). */
export const MAP_TOOLBAR_KEYS = [
	"showing",
	"basemap",
	"clustered",
	"fireAndSmoke",
	"inactive",
	"inside",
	"hiddenTypes"
] as const;

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

/**
 * The pollutant to draw: the one showing when the server's map draws it, else the first of the
 * layers' pollutants it does. With none drawable (or the list not known yet) it is `showingOf`,
 * so the caller reports it unavailable. Never saved: the owner's `showing` stays as chosen.
 */
export function drawableShowing(
	data: WidgetDataConfig,
	options: MapOptions,
	catalog: CatalogEntry[] | undefined,
	drawable: readonly string[] | undefined
): string | undefined {
	const showing = showingOf(data, options, catalog);
	if (!drawable || (showing && drawable.includes(showing))) return showing;
	const first = pollutantLayers(data, catalog).find(
		(l) => l.entryType && drawable.includes(l.entryType)
	);
	return first?.entryType ?? showing;
}
