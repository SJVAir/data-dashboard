/**
 * A pending request to focus an element that may not exist yet (for example after the starter
 * hands off to the user's copy and the page rebuilds). Module-level, so a remounted page sees it.
 * "added" is a widget just added from Get data: its title is focused and it's briefly highlighted.
 */
export type FocusTarget = { kind: "title" | "taskbar" | "sign-in" | "added"; id: string };

/** How long a widget added from Get data stays highlighted (its `data-added` attribute). */
export const ADDED_HIGHLIGHT_MS = 2000;

/** The account menu's Sign in link, after this tab signs out (the app remounts in between). */
export const SIGN_IN_FOCUS: FocusTarget = { kind: "sign-in", id: "account" };

let pending = $state<FocusTarget | null>(null);

export function requestFocus(target: FocusTarget): void {
	pending = { ...target };
	listen();
}

// The user's next press or key, a screen reader's activation (a trusted click with no pointer
// behind it, `detail` 0, which comes with neither), or a browser Back or Forward, means they took over: an
// unconsumed request is dropped, so it can't pull focus later. Installed only while a request is
// pending.
let listening = false;

function drop(): void {
	pending = null;
	unlisten();
}

/**
 * A screen reader's activation: a click with no pointer behind it (`detail` 0), and trusted (the
 * app's own `.click()` on a download link or a file input is untrusted, and isn't the person's).
 */
export function isAssistiveActivation(event: Pick<MouseEvent, "isTrusted" | "detail">): boolean {
	return event.isTrusted && event.detail === 0;
}

function dropOnActivation(event: MouseEvent): void {
	if (isAssistiveActivation(event)) drop();
}

function listen(): void {
	if (listening || typeof window === "undefined") return;
	listening = true;
	window.addEventListener("pointerdown", drop, true);
	window.addEventListener("keydown", drop, true);
	window.addEventListener("click", dropOnActivation, true);
	window.addEventListener("popstate", drop);
}

function unlisten(): void {
	if (!listening) return;
	listening = false;
	window.removeEventListener("pointerdown", drop, true);
	window.removeEventListener("keydown", drop, true);
	window.removeEventListener("click", dropOnActivation, true);
	window.removeEventListener("popstate", drop);
}

/** True (and clears the request) if it matches the target. */
export function takeFocus(target: FocusTarget): boolean {
	if (pending && pending.kind === target.kind && pending.id === target.id) {
		pending = null;
		unlisten();
		return true;
	}
	return false;
}

/** Reactive read, for effects. */
export function pendingFocusTarget(): FocusTarget | null {
	return pending;
}
