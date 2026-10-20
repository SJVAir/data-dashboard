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
	disabled?: boolean;
	children?: MenuItem[];
	run(ctx: MenuContext): void;
};

export type MenuProvider = (ctx: MenuContext) => MenuItem[];
