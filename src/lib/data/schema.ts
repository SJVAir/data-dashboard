import { parseDateKey } from "$lib/format";
import { z } from "zod";

export const LIMITS = {
	ID_MAX: 64,
	CODE_MAX: 64,
	LABEL_MAX: 200,
	LAYERS_MAX: 8,
	SELECTION_MAX: 500
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
const CodeSchema = z.string().min(1).max(LIMITS.CODE_MAX);
/** Monitor ids and entry types go into API paths, so they keep to a safe character set. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const SafeIdSchema = IdSchema.regex(SAFE_ID);
/** A region type, also the part of a selection's `type:code` id before the colon. */
const REGION_TYPE = /^[a-z0-9_]+$/;

export const PlaceRefSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("monitor"), id: SafeIdSchema }),
	z.object({ kind: z.literal("region"), type: CodeSchema.regex(REGION_TYPE), code: CodeSchema }),
	z.object({ kind: z.literal("location"), source: CodeSchema, code: CodeSchema }),
	z.object({
		kind: z.literal("point"),
		lat: z.number().min(-90).max(90),
		lon: z.number().min(-180).max(180),
		label: z.string().max(LIMITS.LABEL_MAX).optional()
	}),
	z.object({ kind: z.literal("default-place") })
]);
export type PlaceRef = z.infer<typeof PlaceRefSchema>;

const REGION_ID = /^[a-z0-9_]+:[^:]+$/;

export const SpatialSelectionSchema = z
	.object({
		kind: z.enum(["monitors", "regions"]),
		ids: z.array(IdSchema).min(1).max(LIMITS.SELECTION_MAX),
		// A GeoJSON geometry the selection was drawn from; its size is bounded by the document
		// size limit.
		source: z.looseObject({ type: z.string() }).optional()
	})
	.superRefine((s, ctx) => {
		if (new Set(s.ids).size !== s.ids.length) {
			ctx.addIssue({ code: "custom", path: ["ids"], message: "Selection ids must be unique" });
		}
		if (s.kind === "regions" && !s.ids.every((id) => REGION_ID.test(id))) {
			ctx.addIssue({
				code: "custom",
				path: ["ids"],
				message: "Region ids must look like type:code"
			});
		}
		if (s.kind === "monitors" && !s.ids.every((id) => SAFE_ID.test(id))) {
			ctx.addIssue({
				code: "custom",
				path: ["ids"],
				message: "Monitor ids may use only letters, digits, _ and -"
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

export const LayerSchema = z
	.object({
		dataset: z.string().min(1).max(LIMITS.ID_MAX),
		entryType: SafeIdSchema.optional(),
		place: PlaceRefSchema.optional(),
		selection: SpatialSelectionSchema.optional(),
		resolution: z.union([z.literal("auto"), ResolutionSchema]).optional()
	})
	.refine((l) => !(l.place && l.selection), {
		message: "A layer has a place or a selection, not both",
		path: ["selection"]
	});
export type Layer = z.infer<typeof LayerSchema>;

export const WidgetDataConfigSchema = z.object({
	dateRange: DateRangeSpecSchema.optional(),
	timeSubRange: TimeSubRangeSchema.optional(),
	layers: z.array(LayerSchema).max(LIMITS.LAYERS_MAX)
});
export type WidgetDataConfig = z.infer<typeof WidgetDataConfigSchema>;

/** Whether any layer's place is the starter-only `default-place`. */
export function hasDefaultPlace(config: WidgetDataConfig): boolean {
	return config.layers.some((l) => l.place?.kind === "default-place");
}
