import { z } from "$lib/zod";
import { DashboardBodySchema, NAME_MAX, WidgetInstanceSchema } from "$lib/documents/schema";

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

export const ChangeSchema = z.discriminatedUnion("op", [
	AddWidgetSchema,
	RemoveWidgetSchema,
	SetFieldSchema,
	ReplaceDocumentSchema
]);
export type Change = z.infer<typeof ChangeSchema>;
