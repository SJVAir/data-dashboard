import type { DocumentSession } from "$lib/store/document-session.svelte";

/**
 * Fullscreen is a view, not an edit: `?widget=<id>` on the dashboard's own URL. The route
 * component doesn't change, so the grid and the widget stay mounted.
 */
export const FULLSCREEN_PARAM = "widget";

/** The history state of an entry this page pushed to open fullscreen. */
export const FULLSCREEN_STATE = { fullscreen: true } as const;

/** The fullscreen widget's id from the URL's search, or null. */
export function fullscreenId(search: Record<string, string | number | boolean>): string | null {
	const value = search[FULLSCREEN_PARAM];
	// The router turns number-like values into numbers (and "true" into true).
	if (value === undefined || value === "") return null;
	return String(value);
}

/** `replace`: the same path without `widget`, in place of this entry. */
export type ExitPlan = { kind: "back" } | { kind: "replace" };

/** Back only from an entry we pushed; a page opened on the link replaces it instead. */
export function exitPlan(state: unknown): ExitPlan {
	const ours =
		typeof state === "object" &&
		state !== null &&
		(state as { fullscreen?: unknown }).fullscreen === FULLSCREEN_STATE.fullscreen;
	return ours ? { kind: "back" } : { kind: "replace" };
}

export type DeepLinkCheck = "wait" | "show" | "missing" | "read-only";

/**
 * What to do with `?widget=id`: wait until the dashboard has loaded, then show it (minimized or
 * not), or drop it (silently on a read-only page, whose widgets aren't rendered).
 */
export function checkDeepLink(
	session: Pick<DocumentSession, "doc" | "readOnly"> | null,
	loaded: boolean,
	id: string
): DeepLinkCheck {
	if (!loaded || !session) return "wait";
	if (session.readOnly) return "read-only";
	return session.doc.body.widgets.some((w) => w.id === id) ? "show" : "missing";
}
