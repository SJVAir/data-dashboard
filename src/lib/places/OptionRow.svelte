<script lang="ts">
	import CheckIcon from "@lucide/svelte/icons/check";
	import type { HTMLAttributes } from "svelte/elements";
	import { m } from "$lib/paraglide/messages.js";
	import type { Row } from "./picker-state.svelte";

	let {
		row,
		multiple,
		selected,
		active = false,
		tag = "li",
		onpick,
		...rest
	}: {
		row: Row;
		multiple: boolean;
		/** The `aria-selected` state. */
		selected: boolean;
		/** Drawn as the active (or focused) row. */
		active?: boolean;
		tag?: "li" | "div";
		onpick: () => void;
	} & Omit<HTMLAttributes<HTMLElement>, "onclick" | "id" | "role"> = $props();

	const option = $derived(row.option);
</script>

<!-- The search combobox keeps focus (aria-activedescendant); Browse moves focus onto the row. -->
<svelte:element
	this={tag}
	{...rest}
	id={row.id}
	role="option"
	aria-selected={selected ? "true" : "false"}
	aria-disabled={row.reason ? "true" : undefined}
	aria-describedby={row.reason ? `${row.id}-reason` : undefined}
	data-active={active ? "true" : undefined}
	class="data-[active=true]:bg-accent data-[active=true]:text-accent-foreground data-[active=true]:outline-ring hover:bg-secondary focus-visible:outline-ring flex min-w-0 flex-1 cursor-default items-start gap-2 rounded-(--radius-control) px-2 py-1.5 text-sm focus-visible:outline-2 aria-disabled:cursor-not-allowed data-[active=true]:outline-2"
	onclick={onpick}
>
	{#if multiple}
		<span
			aria-hidden="true"
			class="border-input mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-(--radius-sm) border {row.selected
				? 'bg-primary text-primary-foreground border-primary'
				: ''}"
		>
			{#if row.selected}<CheckIcon class="size-3" />{/if}
		</span>
	{/if}
	<span class="flex min-w-0 flex-1 flex-col {row.reason ? 'text-muted-foreground' : ''}">
		<span class="block font-medium break-words">{option.name}</span>
		{#if option.kind === "location"}
			<span class="text-muted-foreground block text-xs">
				{m.place_picker_location_where({ city: option.city, zip: option.zip })}
			</span>
			{#if option.address}
				<span class="text-muted-foreground block text-xs">{option.address}</span>
			{/if}
		{:else if option.kind === "region"}
			{#if option.county}
				<span class="text-muted-foreground block text-xs">{option.county}</span>
			{/if}
		{:else}
			<span class="text-muted-foreground block text-xs">{option.county}</span>
		{/if}
		{#if row.reason}
			<span id="{row.id}-reason" aria-hidden="true" class="block text-xs italic">
				{row.reason}
			</span>
		{/if}
	</span>
	<span class="flex shrink-0 flex-col items-end gap-1 text-right">
		<span class="text-muted-foreground block text-xs">
			{option.kind === "monitor" ? option.network : option.typeLabel}
		</span>
		{#if option.kind === "monitor" && !option.active}
			<span
				class="border-border text-muted-foreground block rounded-(--radius-sm) border px-1 text-xs"
			>
				{m.place_picker_not_reporting()}
			</span>
		{/if}
	</span>
</svelte:element>
