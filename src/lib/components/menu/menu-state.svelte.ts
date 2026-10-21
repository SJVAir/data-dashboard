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
