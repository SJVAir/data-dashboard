/**
 * Whether a widget is shown fullscreen on the current page, for the shell around the dashboard
 * (the top bar stays on screen while one is). Counted, so a page swap's old grid letting go
 * after the new one takes hold can't clear it.
 */
import { untrack } from "svelte";

let holds = $state(0);

/** Mark a widget fullscreen until the returned release is called. */
export function holdFullscreen(): () => void {
	// Called from effects: the count isn't one of their dependencies.
	untrack(() => holds++);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		untrack(() => holds--);
	};
}

/** Reactive read. */
export function fullscreenOpen(): boolean {
	return holds > 0;
}
