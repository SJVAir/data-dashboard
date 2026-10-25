import { z } from "zod";
import { ChangeSchema } from "$lib/changes/types";
import { CURRENT_SCHEMA_VERSION } from "$lib/documents/schema";

/**
 * A tab's unsaved changes, written synchronously on `pagehide` (`platform.journal`) and
 * replayed when the dashboard next opens. `baseVersion` is the stored version they apply on.
 * Older records are read with `LooseJournalRecordSchema` and migrated before replay.
 */
export const JournalRecordSchema = z.object({
	baseVersion: z.number().int().nonnegative(),
	changes: z.array(ChangeSchema).min(1),
	schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
	writtenAt: z.string()
});

export type JournalRecord = z.infer<typeof JournalRecordSchema>;

/**
 * Like `JournalRecordSchema`, but accepts any older schema version with its changes
 * unvalidated, so they can be migrated (`upgradeChanges`) and then validated.
 */
export const LooseJournalRecordSchema = z.object({
	baseVersion: z.number().int().nonnegative(),
	changes: z.array(z.unknown()).min(1),
	schemaVersion: z.number().int().max(CURRENT_SCHEMA_VERSION),
	writtenAt: z.string()
});

export type LooseJournalRecord = z.infer<typeof LooseJournalRecordSchema>;
