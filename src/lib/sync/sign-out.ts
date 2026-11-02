/**
 * Signing out from the account menu, which never removes a dashboard with unsynced changes.
 * Every path hides the space as "signed-out" before signing out; the switch that follows
 * (`watchSpace`, then `tidySpaces` as the anonymous space opens) removes it only when nothing
 * in it is unsynced, so edits not yet on the server, even a late one from another tab, are kept
 * for 30 days and uploaded when the same person signs back in.
 *
 * Only type imports from the rest of `src/lib/sync/`: the account menu imports this statically
 * (signing out must work when a lazily loaded file can't be fetched), and the sync worker is
 * reached through `app.sync`.
 */
import { SIGN_IN_FOCUS, takeFocus } from "$lib/layout/focus-request.svelte";
import type { AppContext } from "$lib/store/app.svelte";
import { hideSpace, unhideSpace } from "$lib/store/spaces";

/**
 * Flushes every session; signs out at once when nothing is unsynced, else returns the count for
 * the dialog.
 */
export async function beginSignOut(
	app: AppContext
): Promise<{ done: true } | { unsynced: number }> {
	await flushAll(app);
	const unsynced = app.space === "anonymous" ? 0 : ((await app.sync?.unsyncedCount()) ?? 0);
	if (unsynced > 0) return { unsynced };
	await signOutNow(app);
	return { done: true };
}

/**
 * "Finish saving, then sign out": uploads everything first. Resolves false when something is
 * still unsynced (offline, or refused): still signed in, for the dialog to say so. A sign-out
 * the server didn't take is told by `app.account` and resolves true.
 */
export async function finishThenSignOut(app: AppContext): Promise<boolean> {
	await flushAll(app);
	if (app.sync && (await app.sync.syncAll()) > 0) return false;
	await signOutNow(app);
	return true;
}

/**
 * Why `finishThenSignOut` left some unsynced: this version may not save (`blocked`), every one
 * left waits on something a connection won't fix (a refusal or another hold, shown in the
 * dashboards list: `held`), or some couldn't reach the server (`offline`).
 */
export function unsyncedReason(app: AppContext): "blocked" | "held" | "offline" {
	const sync = app.sync;
	if (sync?.blocked) return "blocked";
	const left = Object.values(sync?.states ?? {}).filter((s) => s.state !== "synced");
	return left.length > 0 && left.every((s) => s.state === "held") ? "held" : "offline";
}

/** "Sign out anyway": the space is hidden from the next person and kept for 30 days. */
export async function signOutAnyway(app: AppContext): Promise<void> {
	await flushAll(app);
	await signOutNow(app);
}

async function flushAll(app: AppContext): Promise<void> {
	await Promise.all(app.openSessions().map((session) => session.flush()));
}

async function signOutNow(app: AppContext): Promise<void> {
	const { platform, space } = app;
	if (space === "anonymous") {
		await app.account.signOut();
		return;
	}
	await hideSpace(platform, space, "signed-out", new Date());
	let ok = false;
	try {
		ok = await app.account.signOut();
	} finally {
		// Still signed in: the space is in use, not hidden.
		if (!ok) await unhideSpace(platform, space);
	}
}

/**
 * After a sign-out attempt that left this tab signed in (asked first, or refused): drops the
 * request for the next app's Sign in link to take focus.
 */
export function keepFocusOnlyIfSignedOut(app: AppContext): void {
	if (app.platform.identity.current().state !== "signed-out") takeFocus(SIGN_IN_FOCUS);
}
