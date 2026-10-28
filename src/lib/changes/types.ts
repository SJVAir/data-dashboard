import { z } from "$lib/zod";
import {
	DashboardBodySchema,
	NAME_MAX,
	RectSchema,
	WidgetInstanceSchema
} from "$lib/documents/schema";

function sameWidgetId(change: { target: { widgetId: string }; widget: { id: string } }) {
	return change.target.widgetId === change.widget.id;
}
const sameWidgetIdIssue = {
	path: ["target", "widgetId"],
	message: "target.widgetId must match widget.id"
};

const AddWidgetSchema = z
	.object({
		op: z.literal("addWidget"),
		target: z.object({ widgetId: z.string().min(1) }),
		widget: WidgetInstanceSchema,
		index: z.number().int().min(0)
	})
	.refine(sameWidgetId, sameWidgetIdIssue);

const RemoveWidgetSchema = z
	.object({
		op: z.literal("removeWidget"),
		target: z.object({ widgetId: z.string().min(1) }),
		widget: WidgetInstanceSchema,
		index: z.number().int().min(0)
	})
	.refine(sameWidgetId, sameWidgetIdIssue);

const FieldValue = z.string().nullable();

const SetFieldSchema = z
	.object({
		op: z.literal("setField"),
		target: z.object({
			widgetId: z.string().min(1).optional(),
			path: z.enum(["title", "name", "deletedAt"])
		}),
		from: FieldValue,
		to: FieldValue
	})
	.superRefine((change, ctx) => {
		const { widgetId, path } = change.target;
		if ((path === "title") !== (widgetId !== undefined)) {
			ctx.addIssue({
				code: "custom",
				path: ["target", "widgetId"],
				message: "widgetId is required for, and only for, the title path"
			});
		}
		for (const key of ["from", "to"] as const) {
			const value = change[key];
			if (value === null) continue;
			const valid =
				path === "deletedAt" ? z.iso.datetime().safeParse(value).success : value.length <= NAME_MAX;
			if (!valid) ctx.addIssue({ code: "custom", path: [key], message: `Invalid ${path} value` });
		}
	});

const DocContentSchema = z.object({
	name: z.string().max(NAME_MAX).nullable(),
	body: DashboardBodySchema
});
export type DocContent = z.infer<typeof DocContentSchema>;

const ReplaceDocumentSchema = z.object({
	op: z.literal("replaceDocument"),
	target: z.object({}),
	from: DocContentSchema,
	to: DocContentSchema
});

export const PlacementSchema = z.object({
	rect: RectSchema,
	minimized: z.object({ order: z.number().int().min(0) }).nullable()
});
export type Placement = z.infer<typeof PlacementSchema>;

const SetLayoutSchema = z
	.object({
		op: z.literal("setLayout"),
		target: z.object({ widgetIds: z.array(z.string().min(1)).min(1) }),
		from: z.record(z.string(), PlacementSchema),
		to: z.record(z.string(), PlacementSchema)
	})
	.superRefine((change, ctx) => {
		const ids = change.target.widgetIds;
		if (new Set(ids).size !== ids.length) {
			ctx.addIssue({
				code: "custom",
				path: ["target", "widgetIds"],
				message: "Ids must be unique"
			});
		}
		for (const key of ["from", "to"] as const) {
			const keys = Object.keys(change[key]);
			if (keys.length !== ids.length || !ids.every((id) => id in change[key])) {
				ctx.addIssue({
					code: "custom",
					path: [key],
					message: `${key} keys must equal target.widgetIds`
				});
			}
		}
	});

export const ChangeSchema = z.discriminatedUnion("op", [
	AddWidgetSchema,
	RemoveWidgetSchema,
	SetFieldSchema,
	SetLayoutSchema,
	ReplaceDocumentSchema
]);
export type Change = z.infer<typeof ChangeSchema>;
