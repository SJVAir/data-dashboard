import { loadDashboard, migrations, type Migration } from "$lib/documents/load";
import type { AppContext } from "$lib/store/app.svelte";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import type { KeptOriginal } from "$lib/platform/types";

/**
 * Replaces the dashboard's name and body with the kept original's, upgraded to the current
 * format, as one undoable change. Returns `false` (leaving the document as it was) when the
 * original can't be opened or the dashboard can't be edited.
 */
export async function restoreOriginal(
	app: AppContext,
	session: DocumentSession,
	chain: Migration[] = migrations
): Promise<boolean> {
	if (session.readOnly) return false;
	const original: KeptOriginal | undefined = await app.platform.originals.get(
		app.space,
		session.doc.id
	);
	if (!original) return false;
	const loaded = loadDashboard(original.raw, chain);
	if (loaded.status !== "ok") return false;
	session.apply({
		op: "replaceDocument",
		target: {},
		from: { name: session.doc.name, body: session.doc.body },
		to: { name: loaded.doc.name, body: loaded.doc.body }
	});
	return true;
}
