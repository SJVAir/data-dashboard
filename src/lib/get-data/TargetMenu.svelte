<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Plus from "@lucide/svelte/icons/plus";
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import { m } from "$lib/paraglide/messages.js";
	import { cn } from "$lib/utils.js";
	import { NEW_DASHBOARD, type AddTarget } from "./add";

	let {
		selected,
		others,
		busy,
		describedby,
		onadd
	}: {
		/** The button's dashboard. */
		selected: AddTarget;
		/** The menu's other dashboards. */
		others: AddTarget[];
		/** An add is running: no second one. */
		busy: boolean;
		/** The id of why it's disabled, when it is for a reason. */
		describedby?: string;
		/** A dashboard's id, or `NEW_DASHBOARD`. */
		onadd: (targetId: string) => void;
	} = $props();
</script>

<!-- A split button: "Add to {name}" adds there; the arrow lists the other dashboards. -->
<div class="flex min-w-0">
	<Button
		class="min-w-0 rounded-r-none"
		disabled={busy}
		aria-describedby={describedby}
		onclick={() => onadd(selected.id)}
	>
		<span class="truncate">{m.get_data_add_to({ name: selected.name })}</span>
	</Button>
	<DropdownMenu.Root>
		<DropdownMenu.Trigger
			class={cn(buttonVariants({ size: "icon" }), "border-l-primary-foreground/30 rounded-l-none")}
			aria-label={m.get_data_add_other()}
			disabled={busy}
			aria-describedby={describedby}
		>
			<ChevronDown aria-hidden="true" />
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="max-w-80 min-w-48">
			<DropdownMenu.Label>{m.get_data_add_other()}</DropdownMenu.Label>
			{#each others as target (target.id)}
				<DropdownMenu.Item onSelect={() => onadd(target.id)}>
					<span class="truncate">{target.name}</span>
				</DropdownMenu.Item>
			{/each}
			{#if others.length > 0}
				<DropdownMenu.Separator />
			{/if}
			<DropdownMenu.Item onSelect={() => onadd(NEW_DASHBOARD)}>
				<Plus aria-hidden="true" />
				{m.get_data_add_new()}
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
