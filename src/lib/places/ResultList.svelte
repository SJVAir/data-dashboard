<script lang="ts">
	import OptionRow from "./OptionRow.svelte";
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
				<OptionRow
					{row}
					{multiple}
					selected={selected(row)}
					active={picker.active?.id === row.id}
					onmousedown={(e) => e.preventDefault()}
					onpick={() => picker.pick(row)}
				/>
			{/each}
		</ul>
	{/each}
</div>
