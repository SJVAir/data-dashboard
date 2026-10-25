<script lang="ts">
	import Check from "@lucide/svelte/icons/check";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { dashboardActions } from "$lib/actions/dashboard";
	import type { MenuContext } from "$lib/actions/types";
	import MenuItems from "$lib/components/menu/MenuItems.svelte";
	import { buttonVariants } from "$lib/components/ui/button";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import { m } from "$lib/paraglide/messages.js";
	import { cn } from "$lib/utils";
	import { currentDashboardName, useApp } from "$lib/store/app.svelte";
	import { p } from "../../../router";

	const app = useApp();

	const currentId = $derived(app.current.isStarter ? null : (app.current.session?.doc.id ?? null));
	const currentName = $derived(currentDashboardName(app));

	const actions = dashboardActions(app);
	let trigger = $state<HTMLElement | null>(null);
	const ctx = $derived<MenuContext | null>(trigger ? { target: trigger, payload: {} } : null);
	// The registered dashboard actions, less "Add widget" (that belongs on the dashboard).
	const items = $derived(
		ctx
			? actions(ctx).filter(
					(item) => item.group === "create" || item.group === "manage" || item.group === "share"
				)
			: []
	);
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		bind:ref={trigger}
		class={cn(buttonVariants({ variant: "ghost" }), "max-w-full min-w-0")}
	>
		<span class="truncate">{currentName ?? m.picker_choose()}</span>
		<ChevronDown aria-hidden="true" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="start" class="max-w-sm min-w-56">
		{#each app.index.items as item (item.id)}
			{@const current = item.id === currentId}
			<DropdownMenu.Item>
				{#snippet child({ props })}
					<a
						{...props}
						href={p("/dashboards/:id", { params: { id: item.id } })}
						aria-current={current ? "page" : undefined}
					>
						<Check aria-hidden="true" class={current ? undefined : "invisible"} />
						<span class="truncate">{current ? currentName : app.index.names.get(item.id)}</span>
					</a>
				{/snippet}
			</DropdownMenu.Item>
		{/each}
		{#if app.index.items.length > 0}
			<DropdownMenu.Separator />
		{/if}
		{#if ctx}
			<MenuItems {items} {ctx} kind="dropdown" />
			<DropdownMenu.Separator />
		{/if}
		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a {...props} href={p("/dashboards")}>{m.all_dashboards()}</a>
			{/snippet}
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
