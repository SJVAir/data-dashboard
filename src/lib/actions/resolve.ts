import { providerFor } from "./scope";
import type { MenuContext, MenuItem } from "./types";

/**
 * Walks from `target` up through its ancestors, calling each scope's provider. The innermost
 * scope contributes all its items; outer scopes contribute only items marked `bubbles`.
 * Items merge most specific first; an outer item whose `id` an inner one already has is
 * dropped.
 */
export function resolveMenu(target: Element, ctx: Omit<MenuContext, "target">): MenuItem[] {
	const full: MenuContext = { ...ctx, target };
	const seen = new Set<string>();
	const items: MenuItem[] = [];
	let innermost = true;
	for (let el: Element | null = target; el; el = el.parentElement) {
		const provider = providerFor(el);
		if (!provider) continue;
		for (const item of provider(full)) {
			if (!innermost && !item.bubbles) continue;
			if (seen.has(item.id)) continue;
			seen.add(item.id);
			items.push(item);
		}
		innermost = false;
	}
	return items;
}

/** Splits items into sections by `group`, in order of first appearance. */
export function groupItems(items: MenuItem[]): MenuItem[][] {
	const groups = new Map<string, MenuItem[]>();
	for (const item of items) {
		const group = groups.get(item.group);
		if (group) group.push(item);
		else groups.set(item.group, [item]);
	}
	return [...groups.values()];
}
