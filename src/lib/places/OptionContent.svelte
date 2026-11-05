<script lang="ts">
	import CheckIcon from "@lucide/svelte/icons/check";
	import { m } from "$lib/paraglide/messages.js";
	import type { Row } from "./picker-state.svelte";

	let { row, multiple }: { row: Row; multiple: boolean } = $props();

	const option = $derived(row.option);
</script>

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
