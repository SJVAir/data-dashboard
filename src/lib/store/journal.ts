import { z } from "$lib/zod";
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

/**
 * The name a dashboard has in its newest readable journal record: the last `name` change in
 * it. `undefined` when that record changes no name (or none is readable). Lists show it
 * before the dashboard is opened and the record replayed.
 */
export function pendingName(records: Array<{ record: unknown }>): string | null | undefined {
	let newest: LooseJournalRecord | null = null;
	for (const { record } of records) {
		const parsed = LooseJournalRecordSchema.safeParse(record);
		if (parsed.success && (newest === null || parsed.data.writtenAt > newest.writtenAt)) {
			newest = parsed.data;
		}
	}
	if (!newest) return undefined;
	for (const change of newest.changes.toReversed()) {
		if (typeof change !== "object" || change === null) continue;
		const { op, target, to } = change as { op?: unknown; target?: unknown; to?: unknown };
		if (op !== "setField" || typeof target !== "object" || target === null) continue;
		const { path, widgetId } = target as { path?: unknown; widgetId?: unknown };
		if (path !== "name" || widgetId !== undefined) continue;
		if (typeof to === "string" || to === null) return to;
	}
	return undefined;
}
