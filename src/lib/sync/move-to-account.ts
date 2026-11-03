/**
 * "Add the dashboards made on this browser to your account?": asked once per account per
 * browser when the anonymous space has dashboards. Yes moves them into the account space with
 * the same ids (Recently deleted included) and uploads them; No leaves them for signed-out use.
 *
 * Only type imports from the rest of `src/lib/sync/`: the upload goes through `app.sync`.
 */
import type { Platform } from "$lib/platform/types";
import { moveCopies } from "$lib/sharing/fingerprints";
import type { AppContext } from "$lib/store/app.svelte";

/** Preference key (in the account space): the answer, `"yes"` or `"no"`. */
export const MOVE_OFFER_KEY = "moveOffer";

export type MoveOffer = { ids: string[]; shown: number };

/**
 * The anonymous dashboards to offer (Recently deleted included), or null when not to ask:
 * already answered, or none outside Recently deleted to count in the question. Ids the account
 * space already holds are left out, so the move never replaces anything.
 */
export async function moveOffer(
	platform: Platform,
	space: `account:${string}`
): Promise<MoveOffer | null> {
	if ((await platform.preferences.get(space, MOVE_OFFER_KEY)) !== undefined) return null;
	const taken = new Set(idsIn(await platform.documents.list(space)));
	const ids: string[] = [];
	let shown = 0;
	for (const raw of await platform.documents.list("anonymous")) {
		const id = idOf(raw);
		if (id === null || taken.has(id)) continue;
		ids.push(id);
		if (typeof (raw as { deletedAt?: unknown }).deletedAt !== "string") shown++;
	}
	return shown > 0 ? { ids, shown } : null;
}

/** Stores the answer; for yes, first moves the dashboards and uploads them. */
export async function answerMoveOffer(app: AppContext, answer: "yes" | "no"): Promise<void> {
	const { platform, space } = app;
	if (space === "anonymous") return;
	if (answer === "yes") {
		// Read again: another tab may have answered, or dashboards changed, since it was asked.
		const offer = await moveOffer(platform, space);
		if (!offer) return;
		await platform.spaces.move("anonymous", space, offer.ids);
		// Their "You already have a copy" entries go with them.
		await moveCopies(platform, "anonymous", space, offer.ids);
		const moved = new Set(offer.ids);
		const stranded = platform.journal.list("anonymous").filter((r) => moved.has(r.docId));
		if (stranded.length > 0) {
			// Their pending changes stay signed-out; the dashboards themselves moved.
			platform.errors.report(new Error("Journal records not moved to the account"), {
				operation: "move-to-account",
				count: stranded.length
			});
		}
		await platform.preferences.set(space, MOVE_OFFER_KEY, answer);
		// Other tabs in the account refresh their lists too.
		app.channel.post({ type: "sync", space, docId: null, tabId: app.tabId });
		await app.index.refresh();
		await app.sync?.syncAll();
		return;
	}
	await platform.preferences.set(space, MOVE_OFFER_KEY, answer);
}

function idOf(raw: unknown): string | null {
	const id = (raw as { id?: unknown } | null)?.id;
	return typeof id === "string" ? id : null;
}

const idsIn = (docs: unknown[]): string[] => docs.map(idOf).filter((id) => id !== null);
