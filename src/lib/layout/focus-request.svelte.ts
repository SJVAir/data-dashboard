/**
 * A pending request to focus an element that may not exist yet (for example after the starter
 * hands off to the user's copy and the page rebuilds). Module-level, so a remounted page sees it.
 */
export type FocusTarget = { kind: "title" | "taskbar"; id: string };

let pending = $state<FocusTarget | null>(null);

export function requestFocus(target: FocusTarget): void {
	pending = { ...target };
}

/** True (and clears the request) if it matches the target. */
export function takeFocus(target: FocusTarget): boolean {
	if (pending && pending.kind === target.kind && pending.id === target.id) {
		pending = null;
		return true;
	}
	return false;
}

/** Reactive read, for effects. */
export function pendingFocusTarget(): FocusTarget | null {
	return pending;
}
