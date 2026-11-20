/**
 * What "Show in a chart" / "Show in a table" puts in history state (`{ getData: HandOff }`) for
 * the Data Portal to read back. Kept apart from `show-in.ts` (the Map's chunk), so the Data
 * Portal reads it without the conversion code.
 */
import { DraftSchema, type Draft } from "$lib/get-data/draft.svelte";
import { z } from "$lib/zod";

/** What travels in history state: the starting draft and counts, never a layer kind. */
export type HandOff = {
	draft: Draft;
	/** The marks left out because they're hidden (the Data Portal's note). */
	leftOut: number;
	/** More places than the type takes: the Data Portal opens the keep dialog. */
	overCap: boolean;
	/** The Map's dashboard when it's read-only, so "Add to" never targets it. */
	skip?: string;
};

/** Validates a hand-off read back from history state (any input; an invalid one is ignored). */
export const HandOffSchema: z.ZodType<HandOff> = z.object({
	draft: DraftSchema,
	leftOut: z.number().int().nonnegative(),
	overCap: z.boolean(),
	skip: z.string().max(200).optional()
});
