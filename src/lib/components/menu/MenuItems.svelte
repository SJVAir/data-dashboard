<script lang="ts">
	import { tick } from "svelte";
	import { groupItems } from "$lib/actions/resolve";
	import { isDisabled, type MenuContext, type MenuItem } from "$lib/actions/types";
	import * as ContextMenu from "$lib/components/ui/context-menu";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import MenuItems from "./MenuItems.svelte";

	let { items, ctx, kind }: { items: MenuItem[]; ctx: MenuContext; kind: "context" | "dropdown" } =
		$props();

	const M = $derived(kind === "context" ? ContextMenu : DropdownMenu);
	const groups = $derived(groupItems(items));

	function select(item: MenuItem): void {
		const at = document.activeElement;
		item.run(ctx);
		if (item.keepOpen && at instanceof HTMLElement) void moveOffIfDisabled(item, at);
	}

	/**
	 * A menu that stays open: if the item just used turned disabled (Right at the grid's edge),
	 * focus moves to the next enabled item in its menu (else the one before), so it isn't left
	 * on a dead item where the arrow keys would restart from the top.
	 */
	async function moveOffIfDisabled(item: MenuItem, el: HTMLElement): Promise<void> {
		await tick();
		if (!isDisabled(item) || document.activeElement !== el) return;
		const menu = el.closest("[role=menu]");
		if (!menu) return;
		const all = [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")].filter(
			(other) => other.closest("[role=menu]") === menu
		);
		const enabled = (other: HTMLElement) => !other.hasAttribute("data-disabled");
		const index = all.indexOf(el);
		const next = all.slice(index + 1).find(enabled) ?? all.slice(0, index).reverse().find(enabled);
		next?.focus();
	}
</script>

{#each groups as group, i (group[0].group)}
	{#if i > 0}
		<M.Separator />
	{/if}
	{#each group as item (item.id)}
		{#if item.children?.length}
			<M.Sub>
				<M.SubTrigger disabled={isDisabled(item)}>
					{#if item.icon}<item.icon />{/if}
					{item.label}
				</M.SubTrigger>
				<M.SubContent>
					<MenuItems items={item.children} {ctx} {kind} />
				</M.SubContent>
			</M.Sub>
		{:else}
			<M.Item
				disabled={isDisabled(item)}
				closeOnSelect={!item.keepOpen}
				onSelect={() => select(item)}
			>
				{#if item.icon}<item.icon />{/if}
				{item.label}
				{#if item.shortcut}<M.Shortcut>{item.shortcut}</M.Shortcut>{/if}
			</M.Item>
		{/if}
	{/each}
{/each}
