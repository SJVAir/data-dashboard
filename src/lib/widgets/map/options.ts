import { isPollutantLayer } from "$lib/data/layer-kind";
import type { CatalogEntry } from "$lib/data/metadata";
import { SafeIdSchema, type Layer, type WidgetDataConfig } from "$lib/data/schema";
import type { WidgetInstance } from "$lib/documents/schema";
import { z } from "$lib/zod";
import { USE_FIELDS } from "./data/use-fields";

export const MAP_TYPE = "map";
export const MAP_MARKS_MAX = 25;
/** The Map's pollutants' dataset: each pollutant is an air-quality layer. */
export const AIR_QUALITY = "air-quality";
/** The Map's smoke and fire layers: place-less, drawn over the whole map. */
export const HMS_SMOKE = "hms-smoke";
export const HMS_FIRE = "hms-fire";
/** The Map's spray notices layer: place-less, drawn over the whole map. */
export const PESTICIDE_NOTICES = "pesticide-notices";
/** The Map's schools and child care layer (the dashboard's own id; no catalog entry). */
export const LOCATIONS = "locations";
/** The Map's pesticide use layer: place-less, drawn over the whole map. */
export const PESTICIDE_USE = "pesticide-use";
/**
 * The most stops a Map's date range has at its resolution (366 days at Daily, 366 months at
 * Monthly, and so on), counted on the range widened to whole periods.
 */
export const MAP_MAX_STOPS = 366;

/** Whether `data`'s air-quality layer has neither searched monitors nor ticked types. */
export function setsNoMonitors(data: WidgetDataConfig): boolean {
	const layer = data.layers.find((l) => l.dataset === AIR_QUALITY && l.entryType);
	return !layer?.monitors?.length && !layer?.monitorTypes?.length;
}

/**
 * `data`'s air-quality layer ticks `types` when it has neither searched monitors nor ticks (the
 * person set neither). Nothing is ticked when `types` is empty.
 */
export function tickTypesIfNone(data: WidgetDataConfig, types: readonly string[]): void {
	const layer = data.layers.find((l) => l.dataset === AIR_QUALITY && l.entryType);
	if (!layer || layer.monitors?.length || layer.monitorTypes?.length) return;
	if (types.length > 0) layer.monitorTypes = [...types];
}

export const MapOptionsSchema = z.strictObject({
	/** The monitors marked on the map. */
	marks: z
		.array(SafeIdSchema)
		.max(MAP_MARKS_MAX)
		.refine((ids) => new Set(ids).size === ids.length, { message: "Marks must be unique" })
		.optional(),
	/** The basemap's id (missing: the preset's default). */
	basemap: SafeIdSchema.optional(),
	/**
	 * The stop shown: the Pacific date key of its period's start (a day, a month's first day, a
	 * year's first day; missing: the last stop).
	 */
	at: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
	/** The region type filled (missing: no fill). */
	fill: SafeIdSchema.optional(),
	/** Only `false` is stored (missing: the fill is shown). */
	fillShown: z.literal(false).optional(),
	/** Only `false` is stored (missing: the spray notices are shown). */
	noticesShown: z.literal(false).optional(),
	/** The pesticide use figure drawn (a catalog entry type; missing: the first). */
	useFigure: SafeIdSchema.optional(),
	/** Only `false` is stored (missing: the pesticide use is shown). */
	useShown: z.literal(false).optional(),
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
		.optional(),
	/** Location groups switched off. */
	hiddenLocationGroups: z
		.array(SafeIdSchema)
		.max(32)
		.refine((ids) => new Set(ids).size === ids.length, { message: "Groups must be unique" })
		.optional()
});

export type MapOptions = z.infer<typeof MapOptionsSchema>;

/** The options the toolbar owns (everything but `marks`). */
export const MAP_TOOLBAR_KEYS = [
	"basemap",
	"clustered",
	"fireAndSmoke",
	"fillShown",
	"noticesShown",
	"useFigure",
	"useShown",
	"inactive",
	"inside",
	"hiddenTypes",
	"hiddenLocationGroups"
] as const;

/** A Map's options; invalid or missing options read as none (nothing marked). */
export function mapOptions(widget: Pick<WidgetInstance, "options">): MapOptions {
	const parsed = MapOptionsSchema.safeParse(widget.options);
	return parsed.success ? parsed.data : {};
}

/**
 * The Map's pollutant: its air-quality layer (one whose kind the catalog doesn't know counts), or
 * none. A Map holds one pollutant or none.
 */
export function pollutantLayer(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined
): Layer | undefined {
	return data.layers.find((l) => l.dataset === AIR_QUALITY && isPollutantLayer(l, catalog));
}

/**
 * The pesticide use figure to draw: the saved one when the catalog's `pesticide-use` lists it and
 * `USE_FIELDS` maps it, else the catalog's first mapped one. Never written.
 */
export function useFigureOf(
	options: MapOptions,
	catalog: CatalogEntry[] | undefined
): string | undefined {
	const mapped = (catalog?.find((c) => c.id === PESTICIDE_USE)?.entryTypes ?? [])
		.map((t) => t.id)
		.filter((id) => Object.hasOwn(USE_FIELDS, id));
	return options.useFigure && mapped.includes(options.useFigure) ? options.useFigure : mapped[0];
}
