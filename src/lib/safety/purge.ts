import { forgetDocument } from "$lib/sharing/fingerprints";
import type { Platform, SpaceId } from "$lib/platform/types";
import { STARTER_ID } from "$lib/starter/starter";

/** How long Recently deleted dashboards, kept originals, and unreplayed journal records last. */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether `iso` is a time more than `RETENTION_MS` before `now`. */
function expired(iso: unknown, now: Date): boolean {
	if (typeof iso !== "string") return false;
	const at = Date.parse(iso);
	return !Number.isNaN(at) && now.getTime() - at > RETENTION_MS;
}

/**
 * Removes what has outlived its retention, when the app opens: dashboards deleted more than 30
 * days ago (with their log, original, journal records, and fingerprints), originals kept that
 * long, and journal records that are that old or whose dashboard isn't stored. The starter's
 * journal records (a hand-off cut short) are kept until they're that old.
 */
export async function purgeExpired(platform: Platform, space: SpaceId, now: Date): Promise<void> {
	const stored = new Set<string>();
	for (const raw of await platform.documents.list(space)) {
		if (!isRecord(raw) || typeof raw.id !== "string") continue;
		if (expired(raw.deletedAt, now)) {
			await platform.documents.remove(space, raw.id);
			await forgetDocument(platform, space, raw.id);
			// Their journal records are cleared below, as the dashboard is no longer stored.
		} else stored.add(raw.id);
	}

	for (const original of await platform.originals.list(space)) {
		if (expired(original.keptAt, now)) await platform.originals.remove(space, original.id);
	}

	for (const { docId, tabId, record } of platform.journal.list(space)) {
		const writtenAt = isRecord(record) ? record.writtenAt : undefined;
		if ((docId !== STARTER_ID && !stored.has(docId)) || expired(writtenAt, now)) {
			platform.journal.clear(space, docId, tabId);
		}
	}
}
