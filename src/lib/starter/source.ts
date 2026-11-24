import type { AppContext } from "$lib/store/app.svelte";
import type { DocumentSession } from "$lib/store/document-session.svelte";

/**
 * What an exit from the starter works on: the built-in starter (with the catalog's monitor
 * types), or the copy its first edit's hand-off made; `null` when that hand-off failed.
 */
export type StarterSource =
	{ kind: "starter"; types: readonly string[] } | { kind: "copy"; session: DocumentSession } | null;

/**
 * Waits for the catalog's monitor types, then gives what the starter is now: itself if unedited
 * (the types may have replaced the one shown, so the starter shown now is the one asked), else
 * its hand-off's copy, flushed (the index copies the stored document).
 */
export async function starterSource(
	app: AppContext,
	starter: DocumentSession
): Promise<StarterSource> {
	const types = await app.starterTypesReady();
	const shown = app.current.isStarter ? (app.current.session ?? starter) : starter;
	if (!shown.edited) return { kind: "starter", types };
	const copy = await shown.handoff;
	if (!copy) return null;
	await copy.flush();
	return { kind: "copy", session: copy };
}
