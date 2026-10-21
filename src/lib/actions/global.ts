import Redo2 from "@lucide/svelte/icons/redo-2";
import Undo2 from "@lucide/svelte/icons/undo-2";
import { m } from "$lib/paraglide/messages.js";
import type { AppContext } from "$lib/store/app.svelte";
import type { MenuProvider } from "./types";

/** Undo and Redo for the current dashboard; part of the dashboard's own menu, not its widgets'. */
export function historyActions(app: AppContext): MenuProvider {
	return () => {
		const session = app.current.session;
		return [
			{
				id: "undo",
				label: m.undo(),
				icon: Undo2,
				shortcut: m.shortcut_undo(),
				group: "history",
				disabled: !session?.canUndo,
				// Read at run time: the starter hands off to its copy on the first edit.
				run: () => app.current.session?.undo()
			},
			{
				id: "redo",
				label: m.redo(),
				icon: Redo2,
				shortcut: m.shortcut_redo(),
				group: "history",
				disabled: !session?.canRedo,
				run: () => app.current.session?.redo()
			}
		];
	};
}

const TEXT_ENTRY = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/** Text fields keep their own undo, so the shortcuts leave them alone. */
function isTextEntry(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(TEXT_ENTRY) !== null;
}

/** Ctrl+Z / Ctrl+Shift+Z (⌘ on macOS) for the window's `keydown`. */
export function handleUndoShortcut(app: AppContext, event: KeyboardEvent): void {
	if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return;
	if (event.key.toLowerCase() !== "z" || isTextEntry(event.target)) return;
	const session = app.current.session;
	if (!session) return;
	event.preventDefault();
	if (event.shiftKey) session.redo();
	else session.undo();
}
