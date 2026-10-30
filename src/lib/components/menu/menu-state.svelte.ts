import { resolveMenu } from "$lib/actions/resolve";
import type { MenuContext, MenuItem } from "$lib/actions/types";

/** A fixed box for the dropdown to sit against (floating-ui's virtual element). */
export type MenuAnchor = { getBoundingClientRect: () => DOMRect };

/**
 * State for the ⋯ dropdown, driven by `openMenuFor` and rendered by `ContextMenuHost`. One per
 * page (a module singleton): only one dropdown is ever open, and any host can render it. The
 * items and context are raw: items carry live `disabled` functions, and nothing in them is
 * edited in place.
 */
class DropdownState {
	open = $state(false);
	ctx = $state.raw<MenuContext | null>(null);
	items = $state.raw<MenuItem[]>([]);
	/** Where the target was when it opened (see `openMenuFor`). */
	anchor = $state.raw<MenuAnchor | null>(null);
}

export const dropdown = new DropdownState();

/**
 * Opens the same menu a right-click on `target` would, in a dropdown anchored to it. The anchor
 * is where `target` was at open (until the window is resized), so the menu stays put if it
 * moves (Move ▸ Right moves the widget and its ⋯ button, and the next click must land on the
 * same item). Focus still returns to `target` itself.
 */
export function openMenuFor(target: Element, payload: Record<string, unknown> = {}): void {
	dropdown.items = resolveMenu(target, { payload });
	dropdown.ctx = { target, payload };
	dropdown.anchor = frozenAnchor(target);
	dropdown.open = true;
}

/**
 * `target`'s box as it was at open. A new window size re-captures it (the page reflows, and the
 * menu should stay beside its button); the floating layer re-reads the anchor on resize.
 */
function frozenAnchor(target: Element): MenuAnchor {
	let size = `${window.innerWidth}x${window.innerHeight}`;
	let rect = target.getBoundingClientRect();
	return {
		getBoundingClientRect: () => {
			const now = `${window.innerWidth}x${window.innerHeight}`;
			if (now !== size && target.isConnected) {
				size = now;
				rect = target.getBoundingClientRect();
			}
			return rect;
		}
	};
}

/** Context menu hosts' close functions (see `closeMenus`). A registry, not reactive state. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const closers = new Set<() => void>();

/** A context menu host registers how to close its menu; returns the unregister function. */
export function registerMenuCloser(close: () => void): () => void {
	closers.add(close);
	return () => closers.delete(close);
}

/** Close any open menu (the dropdown and every host's context menu). */
export function closeMenus(): void {
	dropdown.open = false;
	for (const close of closers) close();
}

/** Run once the open menu has closed, instead of its usual focus return. */
let afterClose: (() => void) | null = null;

/**
 * Run `fn` when the open menu closes, in place of returning focus to where it was (for an item
 * that moves focus itself, such as Minimize).
 */
export function afterMenuClose(fn: () => void): void {
	afterClose = fn;
}

/** For the menu host's close-focus handler: the callback to run instead, if any. */
export function takeAfterMenuClose(): (() => void) | null {
	const fn = afterClose;
	afterClose = null;
	return fn;
}

/** Drop a pending `afterMenuClose` callback (its host is going away, so it must not run later). */
export function clearAfterMenuClose(): void {
	afterClose = null;
}
