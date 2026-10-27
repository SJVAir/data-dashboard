import { askExistingCopy } from "$lib/components/dialogs/ExistingCopyDialog.svelte";
import type { DashboardSummary } from "$lib/documents/names";
import type { AppContext } from "$lib/store/app.svelte";
import { findExistingCopy, saveCopy } from "./copy";
import type { Incoming } from "./incoming";

/**
 * Settles an incoming document, from a link or a file: saves it as a new dashboard, or, when a
 * copy of it already exists, asks. `onAsk` runs as the question opens (so a page can keep both
 * choices if the question is dismissed). Resolves `null` when the question gets no answer.
 */
export async function settleDocument(
	app: AppContext,
	incoming: Extract<Incoming, { kind: "document" }>,
	onAsk?: (existing: DashboardSummary) => void
): Promise<{ id: string; saved: boolean } | null> {
	const existing = await findExistingCopy(app, incoming.fingerprint);
	if (existing) {
		onAsk?.(existing);
		const choice = await askExistingCopy(existing);
		if (choice === "open") return { id: existing.id, saved: false };
		if (choice !== "new") return null;
	}
	return { id: await saveCopy(app, incoming), saved: true };
}
