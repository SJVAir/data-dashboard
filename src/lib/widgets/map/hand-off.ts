/**
 * What "Show in a chart" / "Show in a table" puts in history state (`{ getData: HandOff }`) for
 * the Data Portal to read back. Kept apart from `show-in.ts` (the Map's chunk), so the Data
 * Portal reads it without the conversion code.
 */
import { LIMITS, TimeSubRangeSchema, type TimeSubRange } from "$lib/data/schema";
import { DraftSchema, type Draft } from "$lib/get-data/draft.svelte";
import type { NowDropped } from "$lib/get-data/now";
import { z } from "$lib/zod";

/**
 * The conversion's notes the Data Portal shows, as Show as shows them: never "marks" (the marks
 * are the places) or "places" (over the cap, the person chooses which to keep).
 */
export const HAND_OFF_DROPPED = [
	"dates",
	"overlays",
	"alert",
	"pollutant",
	"selection",
	"outside",
	"range-cut",
	"fill"
] as const satisfies readonly NowDropped[];

/** What `noteConversion` reads from the Map → Chart (or Table) conversion. */
export type HandOffNotes = {
	dropped: (typeof HAND_OFF_DROPPED)[number][];
	pollutant?: { from: { dataset: string; entryType: string }; to: string };
	cutAt?: "day" | "month" | "year";
	selection?: TimeSubRange;
};

/** What travels in history state: the starting draft and counts, never a layer kind. */
export type HandOff = {
	draft: Draft;
	/** The marks left out because they're hidden (the Data Portal's note). */
	leftOut: number;
	/** More places than the type takes: the Data Portal opens the keep dialog. */
	overCap: boolean;
	/** The Map's dashboard when it's read-only, so "Add to" never targets it. */
	skip?: string;
	/** What the conversion left out or changed (none for a section's Chart). */
	notes?: HandOffNotes;
};

const Id = z.string().min(1).max(LIMITS.ID_MAX);

/** Validates a hand-off read back from history state (any input; an invalid one is ignored). */
export const HandOffSchema: z.ZodType<HandOff> = z.object({
	draft: DraftSchema,
	leftOut: z.number().int().nonnegative(),
	overCap: z.boolean(),
	skip: z.string().max(200).optional(),
	notes: z
		.object({
			dropped: z.array(z.enum(HAND_OFF_DROPPED)).max(HAND_OFF_DROPPED.length),
			pollutant: z.object({ from: z.object({ dataset: Id, entryType: Id }), to: Id }).optional(),
			cutAt: z.enum(["day", "month", "year"]).optional(),
			selection: TimeSubRangeSchema.optional()
		})
		.optional()
});
