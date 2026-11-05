import type { DashboardSummary } from "$lib/documents/names";
import { duplicateDashboard } from "$lib/starter/starter";
import type { AppContext } from "$lib/store/app.svelte";
import { copiesOf, rememberCopy } from "./fingerprints";
import type { Incoming } from "./incoming";
import { pointSwaps, withSwaps } from "./points";

/** The live copy of this shared content that changed most recently, if there is one. */
export async function findExistingCopy(
	app: AppContext,
	fingerprint: string
): Promise<DashboardSummary | null> {
	const ids = new Set(await copiesOf(app.platform, app.space, fingerprint));
	if (ids.size === 0) return null;
	await app.index.refresh();
	// The index holds live dashboards only, newest change first.
	return app.index.items.find((d) => ids.has(d.id)) ?? null;
}

/** The live dashboard copied from `sourceId` that changed most recently, if any. */
export async function findCopyOf(
	app: AppContext,
	sourceId: string
): Promise<DashboardSummary | null> {
	await app.index.refresh();
	// The index holds live dashboards only, newest change first.
	return app.index.items.find((d) => d.copiedFrom === sourceId) ?? null;
}

/**
 * Stores the shared dashboard as a new one of this person's own; resolves its id. Someone else's
 * exact location is always stored as the region its widget shows (cleared when it has none);
 * rejects, saving nothing, when a region can't be looked up.
 */
export async function saveCopy(
	app: AppContext,
	incoming: Extract<Incoming, { kind: "document" }>
): Promise<string> {
	const doc = withSwaps(incoming.doc, await pointSwaps(incoming.doc));
	const id = await app.index.createFrom(
		duplicateDashboard({ ...doc, id: incoming.sourceId }, new Date())
	);
	await rememberCopy(app.platform, app.space, incoming.fingerprint, id);
	return id;
}
