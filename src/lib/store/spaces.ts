/**
 * Account spaces kept in this browser. An expired session, another account, or "Sign out
 * anyway" hides the space (never deletes it); signing back in as the same person unhides it.
 * Hidden spaces are removed after `RETENTION_MS`, or sooner once a deliberate sign-out left
 * nothing unsynced.
 *
 * Only type imports from `$lib/sync`: this runs in the initial bundle.
 */
import { spaceFor } from "$lib/account/identity";
import type { Platform, SpaceId } from "$lib/platform/types";
import { RETENTION_MS } from "$lib/safety/purge";
import type { SyncRecord } from "$lib/sync/types";

export { spaceFor };

/** Preference key (in the hidden space itself): why and when it was hidden. */
export const HIDDEN_KEY = "hidden";

export type Hidden = { at: string; reason: "signed-out" | "expired" | "switched" };

/** The sync worker's tab id for server changes; `SYNC_TAB` in src/lib/sync/types.ts. */
const SYNC_TAB = "sync";

const REASONS: ReadonlySet<string> = new Set(["signed-out", "expired", "switched"]);

async function readHidden(platform: Platform, space: SpaceId): Promise<Hidden | null> {
	const value = await platform.preferences.get<unknown>(space, HIDDEN_KEY);
	if (typeof value !== "object" || value === null) return null;
	const { at, reason } = value as Record<string, unknown>;
	if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return null;
	if (typeof reason !== "string" || !REASONS.has(reason)) return null;
	return { at, reason: reason as Hidden["reason"] };
}

/** Hides `space` from this browser's next person; one already hidden keeps its reason and time. */
export async function hideSpace(
	platform: Platform,
	space: SpaceId,
	reason: Hidden["reason"],
	now: Date
): Promise<void> {
	if (await readHidden(platform, space)) return;
	const hidden: Hidden = { at: now.toISOString(), reason };
	await platform.preferences.set(space, HIDDEN_KEY, hidden);
}

/** Its person is back: the space is in use again. */
export async function unhideSpace(platform: Platform, space: SpaceId): Promise<void> {
	if ((await platform.preferences.get(space, HIDDEN_KEY)) === undefined) return;
	await platform.preferences.set(space, HIDDEN_KEY, null);
}

/** Removes hidden spaces older than RETENTION_MS, and signed-out ones with nothing unsynced. */
export async function tidySpaces(platform: Platform, current: SpaceId, now: Date): Promise<void> {
	for (const space of await platform.spaces.list()) {
		if (space === current || space === "anonymous") continue;
		const hidden = await readHidden(platform, space);
		if (!hidden) continue;
		const old = now.getTime() - Date.parse(hidden.at) > RETENTION_MS;
		if (old || (hidden.reason === "signed-out" && !(await hasUnsynced(platform, space)))) {
			await platform.spaces.remove(space);
		}
	}
}

/**
 * Whether anything in `space` isn't on the server, from local storage alone: a journal record,
 * a document never uploaded, a hold other than `moved`, or this browser's log entries after
 * the record's `syncedThrough` (after the move, for a moved one).
 */
export async function hasUnsynced(platform: Platform, space: SpaceId): Promise<boolean> {
	if (platform.journal.list(space).length > 0) return true;
	for (const raw of await platform.documents.list(space)) {
		const id = (raw as { id?: unknown } | null)?.id;
		if (typeof id !== "string") continue;
		const record: SyncRecord | undefined = await platform.sync.get(space, id);
		if (!record || record.serverVersion === null) return true;
		const hold = record.hold;
		if (hold && hold.kind !== "moved") return true;
		const after =
			hold?.kind === "moved" ? Math.max(hold.through, record.syncedThrough) : record.syncedThrough;
		const log = await platform.documents.readLog(space, id, after);
		if (log === "trimmed") return true;
		if (log.some((entry) => entry.tabId !== SYNC_TAB)) return true;
	}
	return false;
}
