<script lang="ts">
	import { onDestroy, type Snippet } from "svelte";
	import { resolveMenu } from "$lib/actions/resolve";
	import type { MenuContext, MenuItem } from "$lib/actions/types";
	import * as ContextMenu from "$lib/components/ui/context-menu";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import MenuItems from "./MenuItems.svelte";
	import { clearAfterMenuClose, dropdown, takeAfterMenuClose } from "./menu-state.svelte";

	let { children }: { children: Snippet } = $props();

	// A pending after-close action (e.g. Minimize) from a page that's gone mustn't run on the next.
	onDestroy(clearAfterMenuClose);

	let items = $state<MenuItem[]>([]);
	let ctx = $state<MenuContext | null>(null);

	// A touch long-press never opens the menu: on the dashboard it lifts a widget, and the ⋯
	// buttons are the touch path to the same items. bits-ui's trigger opens on a long-press
	// timer of its own and on the `contextmenu` Android raises, so it's disabled from a touch's
	// pointerdown until the next mouse or pen press, or a key press (Shift+F10, the Menu key).
	let touched = $state(false);

	function onPointerdown(event: PointerEvent) {
		touched = event.pointerType === "touch";
		// A pen long-press still opens it (no `contextmenu` event first), so resolve now.
		if (event.pointerType === "pen") resolveFor(event);
	}

	function onContextmenu(event: MouseEvent) {
		if (!touched) resolveFor(event);
	}

	// Resolved before bits-ui's trigger handles the same event, so the content is ready on open.
	function resolveFor(event: Event) {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const next: Omit<MenuContext, "target"> = { event, payload: {} };
		items = resolveMenu(target, next);
		ctx = { ...next, target };
	}

	// Shift+F10 / the Menu key normally raise `contextmenu` on the focused element. Where the
	// browser doesn't, raise it ourselves so the menu opens at the focused element.
	function onKeydown(event: KeyboardEvent) {
		touched = false;
		const isKey = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
		if (!isKey || !(event.target instanceof Element)) return;
		event.preventDefault();
		const rect = event.target.getBoundingClientRect();
		event.target.dispatchEvent(
			new MouseEvent("contextmenu", {
				bubbles: true,
				cancelable: true,
				clientX: rect.left + rect.width / 2,
				clientY: rect.top + rect.height / 2
			})
		);
	}

	const anchor = $derived(dropdown.ctx?.target as HTMLElement | undefined);

	// An item that moves focus itself (Minimize, Fullscreen) does so once its menu has closed.
	function onCloseAutoFocus(event: Event, fallback?: () => void) {
		const after = takeAfterMenuClose();
		if (after) {
			event.preventDefault();
			after();
		} else if (fallback) {
			event.preventDefault();
			fallback();
		}
	}
</script>

<ContextMenu.Root>
	<ContextMenu.Trigger
		class="contents"
		disabled={touched}
		oncontextmenucapture={onContextmenu}
		onpointerdowncapture={onPointerdown}
		onkeydowncapture={onKeydown}
	>
		{@render children()}
	</ContextMenu.Trigger>
	<ContextMenu.Content onCloseAutoFocus={(e) => onCloseAutoFocus(e)}>
		{#if ctx}
			<MenuItems {items} {ctx} kind="context" />
		{/if}
	</ContextMenu.Content>
</ContextMenu.Root>

<DropdownMenu.Root bind:open={dropdown.open}>
	<DropdownMenu.Content
		customAnchor={anchor ?? null}
		onCloseAutoFocus={(e) => onCloseAutoFocus(e, () => anchor?.focus())}
	>
		{#if dropdown.ctx}
			<MenuItems items={dropdown.items} ctx={dropdown.ctx} kind="dropdown" />
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
