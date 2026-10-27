<script lang="ts">
	import { groupItems } from "$lib/actions/resolve";
	import type { MenuContext, MenuItem } from "$lib/actions/types";
	import * as ContextMenu from "$lib/components/ui/context-menu";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import MenuItems from "./MenuItems.svelte";

	let { items, ctx, kind }: { items: MenuItem[]; ctx: MenuContext; kind: "context" | "dropdown" } =
		$props();

	const M = $derived(kind === "context" ? ContextMenu : DropdownMenu);
	const groups = $derived(groupItems(items));
</script>

{#each groups as group, i (group[0].group)}
	{#if i > 0}
		<M.Separator />
	{/if}
	{#each group as item (item.id)}
		{#if item.children?.length}
			<M.Sub>
				<M.SubTrigger disabled={item.disabled}>
					{#if item.icon}<item.icon />{/if}
					{item.label}
				</M.SubTrigger>
				<M.SubContent>
					<MenuItems items={item.children} {ctx} {kind} />
				</M.SubContent>
			</M.Sub>
		{:else}
			<M.Item disabled={item.disabled} onSelect={() => item.run(ctx)}>
				{#if item.icon}<item.icon />{/if}
				{item.label}
				{#if item.shortcut}<M.Shortcut>{item.shortcut}</M.Shortcut>{/if}
			</M.Item>
		{/if}
	{/each}
{/each}
