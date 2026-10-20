import { resolveMenu } from "$lib/actions/resolve";
import type { MenuItem } from "$lib/actions/types";

/** State for the ⋯ dropdown, driven by `openMenuFor` and rendered by `ContextMenuHost`. */
export const dropdown = $state<{ open: boolean; anchor: Element | null; items: MenuItem[] }>({
	open: false,
	anchor: null,
	items: []
});

/** Opens the same menu a right-click on `target` would, in a dropdown anchored to it. */
export function openMenuFor(target: Element, payload: Record<string, unknown> = {}): void {
	dropdown.items = resolveMenu(target, { payload });
	dropdown.anchor = target;
	dropdown.open = true;
}
