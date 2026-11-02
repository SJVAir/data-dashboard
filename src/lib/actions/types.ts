import type { Component } from "svelte";

export type MenuContext = {
	event?: Event;
	target: Element;
	payload: Record<string, unknown>;
};

export type MenuItem = {
	id: string;
	label: string;
	icon?: Component;
	shortcut?: string;
	group: string; // rendered as separated sections
	/** A function is read while the menu is open, so it can change (e.g. after a `keepOpen` item). */
	disabled?: boolean | (() => boolean);
	/** The menu stays open after it runs (e.g. Move ▸ Right, clicked a few times). */
	keepOpen?: boolean;
	/** Also show in menus of scopes nested inside this one. Off by default. */
	bubbles?: boolean;
	children?: MenuItem[];
	run(ctx: MenuContext): void;
};

/** Whether `item` is disabled now. */
export function isDisabled(item: MenuItem): boolean {
	return typeof item.disabled === "function" ? item.disabled() : !!item.disabled;
}

export type MenuProvider = (ctx: MenuContext) => MenuItem[];
