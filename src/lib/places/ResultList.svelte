<script lang="ts">
	import CheckIcon from "@lucide/svelte/icons/check";
	import { m } from "$lib/paraglide/messages.js";
	import type { PickerState, Row } from "./picker-state.svelte";

	let {
		picker,
		id,
		label,
		multiple
	}: { picker: PickerState; id: string; label: string; multiple: boolean } = $props();

	// Keep the active row in view as the arrow keys move it.
	$effect(() => {
		const active = picker.active;
		if (active) document.getElementById(active.id)?.scrollIntoView?.({ block: "nearest" });
	});

	function selected(row: Row): boolean {
		return multiple ? row.selected : picker.active?.id === row.id;
	}
</script>

{#snippet details(row: Row)}
	{@const option = row.option}
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
{/snippet}

<div
	{id}
	role="listbox"
	aria-label={label}
	aria-multiselectable={multiple ? "true" : undefined}
	hidden={picker.rows.length === 0}
	class="flex flex-col gap-2"
>
	{#each picker.sections as section (section.key)}
		<ul role="group" aria-labelledby="{id}-{section.key}" class="flex flex-col">
			<li
				role="presentation"
				id="{id}-{section.key}"
				class="text-muted-foreground px-2 pt-1 pb-0.5 text-xs font-medium tracking-wide uppercase"
			>
				{section.label}
			</li>
			{#each section.rows as row (row.id)}
				{@const option = row.option}
				<!-- The combobox keeps focus (aria-activedescendant); the mouse picks without moving it. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id={row.id}
					role="option"
					aria-selected={selected(row) ? "true" : "false"}
					aria-disabled={row.reason ? "true" : undefined}
					aria-describedby={row.reason ? `${row.id}-reason` : undefined}
					data-active={picker.active?.id === row.id ? "true" : undefined}
					class="data-[active=true]:bg-accent data-[active=true]:text-accent-foreground data-[active=true]:outline-ring hover:bg-secondary flex cursor-default items-start gap-2 rounded-(--radius-control) px-2 py-1.5 text-sm aria-disabled:cursor-not-allowed data-[active=true]:outline-2"
					onmousedown={(e) => e.preventDefault()}
					onclick={() => picker.pick(row)}
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
						{@render details(row)}
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
				</li>
			{/each}
		</ul>
	{/each}
</div>
