import { resolveMenu } from "$lib/actions/resolve";
import type { MenuContext, MenuItem } from "$lib/actions/types";

/** State for the ⋯ dropdown, driven by `openMenuFor` and rendered by `ContextMenuHost`. */
export const dropdown = $state<{ open: boolean; ctx: MenuContext | null; items: MenuItem[] }>({
	open: false,
	ctx: null,
	items: []
});

/** Opens the same menu a right-click on `target` would, in a dropdown anchored to it. */
export function openMenuFor(target: Element, payload: Record<string, unknown> = {}): void {
	dropdown.items = resolveMenu(target, { payload });
	dropdown.ctx = { target, payload };
	dropdown.open = true;
}

/** Run once the open menu has closed, instead of its usual focus return. */
let afterClose: (() => void) | null = null;

/**
 * Run `fn` when the open menu closes, in place of returning focus to where it was (for an item
 * that moves focus itself, such as Move…).
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
