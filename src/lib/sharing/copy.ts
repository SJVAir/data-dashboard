import type { DashboardSummary } from "$lib/documents/names";
import { duplicateDashboard } from "$lib/starter/starter";
import type { AppContext } from "$lib/store/app.svelte";
import { copiesOf, rememberCopy } from "./fingerprints";
import type { Incoming } from "./incoming";

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

/** Stores the shared dashboard as a new one of this person's own; resolves its id. */
export async function saveCopy(
	app: AppContext,
	incoming: Extract<Incoming, { kind: "document" }>
): Promise<string> {
	const id = await app.index.createFrom(
		duplicateDashboard({ ...incoming.doc, id: incoming.sourceId }, new Date())
	);
	await rememberCopy(app.platform, app.space, incoming.fingerprint, id);
	return id;
}
