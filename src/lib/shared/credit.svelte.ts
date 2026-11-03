import type { RemoteDocuments } from "$lib/sync/remote";
import { STARTER_ID } from "$lib/starter/starter";
import type { AppContext } from "$lib/store/app.svelte";
import { sharedRemote } from "./remote";

export type BasedOn = { name: string | null; displayName: string | null };

/** Answers per source id for this page load (a refused or unreachable id is cached as `null`). */
// A plain cache, never read reactively.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const asked = new Map<string, Promise<BasedOn | null>>();

/** Tests only: forget what was asked. */
export function resetBasedOn(): void {
	asked.clear();
}

/**
 * The credit for a copy's source, or null: none, the starter, refused, or offline. Cached per id
 * for the page load. `remote` is for tests; production callers leave it out.
 */
export function basedOn(
	app: AppContext,
	copiedFrom: string | undefined,
	remote: () => Promise<RemoteDocuments> = sharedRemote
): Promise<BasedOn | null> {
	if (!copiedFrom || copiedFrom === STARTER_ID) return Promise.resolve(null);
	// Stored here and not deleted: its own name, no request (and not cached: it can be renamed).
	if (app.index.items.some((d) => d.id === copiedFrom)) {
		return Promise.resolve({ name: app.index.names.get(copiedFrom) ?? null, displayName: null });
	}
	let answer = asked.get(copiedFrom);
	if (!answer) {
		answer = remote()
			.then((r) => r.credit(copiedFrom))
			.then(({ name, displayName }) => ({ name, displayName }))
			// Private again, gone, unknown, or unreachable: nothing to show.
			.catch(() => null);
		asked.set(copiedFrom, answer);
	}
	return answer;
}
