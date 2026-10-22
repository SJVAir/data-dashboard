import { WidgetDataConfigSchema, hasDefaultPlace } from "$lib/data/schema";
import { z } from "zod";

export const CURRENT_SCHEMA_VERSION = 1;
export const GRID_COLUMNS = 12;
export const NAME_MAX = 100;

export const RectSchema = z
	.object({
		x: z.number().int().min(0),
		y: z.number().int().min(0),
		w: z.number().int().min(1),
		h: z.number().int().min(1)
	})
	.refine((r) => r.x + r.w <= GRID_COLUMNS, { message: "Rect exceeds the grid width" });
export type Rect = z.infer<typeof RectSchema>;

export const WidgetInstanceSchema = z.object({
	id: z.string().min(1),
	type: z.string().min(1),
	title: z.string().max(NAME_MAX).nullable(),
	rect: RectSchema,
	minimized: z.object({ restoreRect: RectSchema }).optional(),
	data: WidgetDataConfigSchema,
	options: z.record(z.string(), z.unknown()).optional(),
	thresholds: z.array(z.unknown()).optional()
});
export type WidgetInstance = z.infer<typeof WidgetInstanceSchema>;

export const DashboardBodySchema = z
	.object({
		widgets: z.array(WidgetInstanceSchema),
		defaultCollectionId: z.string().optional()
	})
	.refine((b) => new Set(b.widgets.map((w) => w.id)).size === b.widgets.length, {
		message: "Widget ids must be unique"
	});
export type DashboardBody = z.infer<typeof DashboardBodySchema>;

function dashboardSchema(allowDefaultPlace: boolean) {
	return z.object({
		kind: z.literal("dashboard"),
		schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
		id: z.string().min(1).max(64),
		name: z.string().max(NAME_MAX).nullable(),
		copiedFrom: z.string().optional(),
		deletedAt: z.iso.datetime().optional(),
		version: z.number().int().min(0),
		createdAt: z.iso.datetime(),
		updatedAt: z.iso.datetime(),
		body: allowDefaultPlace
			? DashboardBodySchema
			: DashboardBodySchema.refine((b) => !b.widgets.some((w) => hasDefaultPlace(w.data)), {
					message: "default-place is only allowed in the built-in starter"
				})
	});
}

/** Every stored or incoming document: `default-place` is rejected. */
export const DashboardSchema = dashboardSchema(false);
/** The built-in starter, which may use `default-place`. */
export const StarterDashboardSchema = dashboardSchema(true);
export type Dashboard = z.infer<typeof DashboardSchema>;

/** Trim, cut to NAME_MAX, and map empty to null (a generated name). */
export function normalizeName(input: string): string | null {
	const name = input.trim().slice(0, NAME_MAX).trim();
	return name === "" ? null : name;
}
