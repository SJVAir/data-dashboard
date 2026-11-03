/**
 * A pending request to focus an element that may not exist yet (for example after the starter
 * hands off to the user's copy and the page rebuilds). Module-level, so a remounted page sees it.
 */
export type FocusTarget = { kind: "title" | "taskbar" | "sign-in"; id: string };

/** The account menu's Sign in link, after this tab signs out (the app remounts in between). */
export const SIGN_IN_FOCUS: FocusTarget = { kind: "sign-in", id: "account" };

let pending = $state<FocusTarget | null>(null);

export function requestFocus(target: FocusTarget): void {
	pending = { ...target };
	listen();
}

// The user's next press or key means they took over: an unconsumed request is dropped, so it
// can't pull focus later. Installed only while a request is pending.
let listening = false;

function drop(): void {
	pending = null;
	unlisten();
}

function listen(): void {
	if (listening || typeof window === "undefined") return;
	listening = true;
	window.addEventListener("pointerdown", drop, true);
	window.addEventListener("keydown", drop, true);
}

function unlisten(): void {
	if (!listening) return;
	listening = false;
	window.removeEventListener("pointerdown", drop, true);
	window.removeEventListener("keydown", drop, true);
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
