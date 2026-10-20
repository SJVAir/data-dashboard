import { z } from "zod";
import { ChangeSchema } from "$lib/changes/types";
import { CURRENT_SCHEMA_VERSION } from "$lib/documents/schema";

/**
 * A tab's unsaved changes, written synchronously on `pagehide` (`platform.journal`) and
 * replayed when the dashboard next opens. `baseVersion` is the stored version they apply on.
 * Only records of the current schema version are replayed (there is no change migration yet).
 */
export const JournalRecordSchema = z.object({
	baseVersion: z.number().int().nonnegative(),
	changes: z.array(ChangeSchema).min(1),
	schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
	writtenAt: z.string()
});

export type JournalRecord = z.infer<typeof JournalRecordSchema>;
