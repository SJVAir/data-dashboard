import { parseDateKey } from "$lib/format";
import { z } from "$lib/zod";

export const LIMITS = {
	ID_MAX: 64,
	CODE_MAX: 64,
	LABEL_MAX: 200,
	LAYERS_MAX: 8,
	CATEGORIES_MAX: 10
} as const;

export const ResolutionSchema = z.enum([
	"raw",
	"hour",
	"day",
	"month",
	"quarter",
	"season",
	"year"
]);
export type Resolution = z.infer<typeof ResolutionSchema>;

/** A real `YYYY-MM-DD` calendar date. */
const DateKeySchema = z.string().refine(
	(s) => {
		try {
			parseDateKey(s);
			return true;
		} catch {
			return false;
		}
	},
	{ message: "Not a real YYYY-MM-DD date" }
);

export const DateRangeSpecSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("set"),
		unit: z.enum(["year", "month", "week", "day"]),
		start: DateKeySchema
	}),
	z.object({ kind: z.literal("to-date"), unit: z.enum(["year", "month", "week"]) }),
	z.object({
		kind: z.literal("trailing"),
		amount: z.number().int().min(1).max(3650),
		unit: z.enum(["hour", "day", "month"])
	}),
	z
		.object({ kind: z.literal("custom"), start: DateKeySchema, end: DateKeySchema })
		.refine((r) => r.start <= r.end, { message: "Range ends before it starts", path: ["end"] })
]);
export type DateRangeSpec = z.infer<typeof DateRangeSpecSchema>;

const IdSchema = z.string().min(1).max(LIMITS.ID_MAX);
export const CodeSchema = z.string().min(1).max(LIMITS.CODE_MAX);
/** Monitor ids and entry types go into API paths, so they keep to a safe character set. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
export const SafeIdSchema = IdSchema.regex(SAFE_ID);
/** A region type, also the part of a selection's `type:code` id before the colon. */
const REGION_TYPE = /^[a-z0-9_]+$/;

/**
 * A monitor picked by the Monitors search (the air-quality layer's `monitors`, a Chart's
 * "Overlay for", a recent pick). Never a Where place: Where holds areas, schools and points.
 */
export const MonitorRefSchema = z.object({ kind: z.literal("monitor"), id: SafeIdSchema });
export type MonitorRef = z.infer<typeof MonitorRefSchema>;

const CHOSEN_PLACES = [
	z.object({ kind: z.literal("region"), type: CodeSchema.regex(REGION_TYPE), code: CodeSchema }),
	z.object({ kind: z.literal("location"), source: CodeSchema, code: CodeSchema }),
	z.object({
		kind: z.literal("point"),
		lat: z.number().min(-90).max(90),
		lon: z.number().min(-180).max(180),
		label: z.string().max(LIMITS.LABEL_MAX).optional()
	})
] as const;

export const PlaceRefSchema = z.discriminatedUnion("kind", [
	...CHOSEN_PLACES,
	z.object({ kind: z.literal("default-place") })
]);
export type PlaceRef = z.infer<typeof PlaceRefSchema>;

/** A place someone chose (the starter's place, its bar's): any place but `default-place`. */
export const ChosenPlaceSchema = z.discriminatedUnion("kind", [...CHOSEN_PLACES]);
export type ChosenPlace = Exclude<PlaceRef, { kind: "default-place" }>;

const REGION_ID = /^[a-z0-9_]+:[^:]+$/;

/** Several areas (region ids `type:code`); monitors are never a Where selection. */
export const SpatialSelectionSchema = z
	.object({
		kind: z.literal("regions"),
		ids: z.array(IdSchema).min(1),
		// A GeoJSON geometry the selection was drawn from; its size is bounded by the document
		// size limit.
		source: z.looseObject({ type: z.string() }).optional()
	})
	.superRefine((s, ctx) => {
		if (new Set(s.ids).size !== s.ids.length) {
			ctx.addIssue({ code: "custom", path: ["ids"], message: "Selection ids must be unique" });
		}
		if (!s.ids.every((id) => REGION_ID.test(id))) {
			ctx.addIssue({
				code: "custom",
				path: ["ids"],
				message: "Region ids must look like type:code"
			});
		}
	});
export type SpatialSelection = z.infer<typeof SpatialSelectionSchema>;

const DateTimeSchema = z.iso.datetime({ offset: true });

export const TimeSubRangeSchema = z
	.object({ start: z.string(), end: z.string() })
	.superRefine((r, ctx) => {
		const dates =
			DateKeySchema.safeParse(r.start).success && DateKeySchema.safeParse(r.end).success;
		const times =
			DateTimeSchema.safeParse(r.start).success && DateTimeSchema.safeParse(r.end).success;
		if (!dates && !times) {
			ctx.addIssue({
				code: "custom",
				message: "Both ends must be YYYY-MM-DD dates or both ISO date-times with an offset"
			});
			return;
		}
		const before = dates ? r.start <= r.end : Date.parse(r.start) <= Date.parse(r.end);
		if (!before) {
			ctx.addIssue({ code: "custom", path: ["end"], message: "Range ends before it starts" });
		}
	});
export type TimeSubRange = z.infer<typeof TimeSubRangeSchema>;

/** A pesticide layer's saved filters: ids from the server's search, codes from its meta. */
export const PesticideFiltersSchema = z.object({
	chemical: IdSchema.optional(),
	commodity: IdSchema.optional(),
	product: IdSchema.optional(),
	category: z.array(CodeSchema).min(1).max(LIMITS.CATEGORIES_MAX).optional(),
	iarcGroup: CodeSchema.optional(),
	method: CodeSchema.optional(),
	narrow: CodeSchema.optional()
});
export type PesticideFilters = z.infer<typeof PesticideFiltersSchema>;

/** A list of distinct safe ids (monitor ids, monitor type keys). */
function uniqueIds(message: string) {
	return z.array(SafeIdSchema).refine((ids) => new Set(ids).size === ids.length, { message });
}

/**
 * A layer: what data it is (Where is on the widget's data, `WidgetDataConfig`). An earlier
 * document's layer `place` or `selection` is dropped on read, as any unknown key (nothing was
 * live, so there is no migration: the widget opens with no Where).
 */
export const LayerSchema = z.object({
	dataset: z.string().min(1).max(LIMITS.ID_MAX),
	entryType: SafeIdSchema.optional(),
	/** A weather layer's station (the catalog's station id). */
	station: SafeIdSchema.optional(),
	/** A pesticide layer's filters. */
	filters: PesticideFiltersSchema.optional(),
	/**
	 * Monitors picked by search (ids), counted wherever they are: on the air-quality layer, or a
	 * single-place widget's one layer when it has no air-quality layer (the Forecast strip).
	 */
	monitors: uniqueIds("Monitor ids must be unique").optional(),
	/**
	 * The air-quality layer's ticked monitor types (the monitors meta's type keys): every monitor of
	 * them inside the widget's Where, or everywhere with no Where. Meaningful only on the
	 * air-quality layer.
	 */
	monitorTypes: uniqueIds("Monitor types must be unique").optional()
});
export type Layer = z.infer<typeof LayerSchema>;

/** Whether `value` is an object whose `kind` is `kind`. */
function hasKind(value: unknown, kind: string): boolean {
	return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === kind;
}

/**
 * An earlier document's monitor Where (a `monitor` place or a `monitors` selection), dropped
 * so the document still opens with no Where (nothing was live, so there is no migration).
 */
function dropMonitorWhere(value: unknown): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
	const data = { ...(value as Record<string, unknown>) };
	if (hasKind(data.place, "monitor")) delete data.place;
	if (hasKind(data.selection, "monitors")) delete data.selection;
	return data;
}

const WidgetDataObjectSchema = z
	.object({
		dateRange: DateRangeSpecSchema.optional(),
		timeSubRange: TimeSubRangeSchema.optional(),
		/**
		 * The one resolution every layer is fetched at (the dataset rules); missing means Automatic,
		 * which is never stored. An earlier document's per-layer `resolution` is dropped by
		 * `LayerSchema` (it opens as Automatic).
		 */
		resolution: ResolutionSchema.optional(),
		/** Where: one place, or several (`selection`); neither is everywhere. */
		place: PlaceRefSchema.optional(),
		selection: SpatialSelectionSchema.optional(),
		layers: z.array(LayerSchema).max(LIMITS.LAYERS_MAX)
	})
	.refine((d) => !(d.place && d.selection), {
		message: "A widget has a place or a selection, not both",
		path: ["selection"]
	});
export const WidgetDataConfigSchema = z.preprocess(dropMonitorWhere, WidgetDataObjectSchema);
export type WidgetDataConfig = z.infer<typeof WidgetDataObjectSchema>;

/** Whether a widget's place is the starter-only `default-place`. */
export function hasDefaultPlace(config: WidgetDataConfig): boolean {
	return config.place?.kind === "default-place";
}
