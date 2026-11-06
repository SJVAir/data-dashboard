<script lang="ts">
	import { ToggleGroup } from "bits-ui";
	import { formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import type { WidgetType } from "$lib/widgets/registry";
	import type { TypeBlock } from "./offer";

	let {
		types,
		value,
		onchange
	}: {
		/** Each data type with why it can't show the current data (`null` when it can). */
		types: { type: WidgetType; block: TypeBlock | null }[];
		value: string;
		onchange: (type: string) => void;
	} = $props();

	const uid = $props.id();

	function reason(type: WidgetType, block: TypeBlock): string {
		switch (block) {
			case "dataset":
				return m.get_data_block_dataset();
			case "places": {
				const max = type.accepts?.maxPlaces ?? 0;
				return m.get_data_block_places({ count: formatNumber(max), countValue: max });
			}
			case "span":
				return m.get_data_block_span();
			case "pollutants":
				return m.get_data_block_pollutants();
		}
	}

	const labelId = `${uid}-label`;
</script>

<div class="flex flex-col gap-1">
	<div class="flex flex-wrap items-center gap-2">
		<span id={labelId} class="text-sm font-medium">{m.get_data_show_as()}</span>
		<ToggleGroup.Root
			type="single"
			{value}
			onValueChange={(v) => v && onchange(v)}
			aria-labelledby={labelId}
			class="border-input inline-flex rounded-(--radius-control) border p-0.5"
		>
			{#each types as { type, block } (type.type)}
				<ToggleGroup.Item
					value={type.type}
					disabled={!!block}
					aria-describedby={block ? `${uid}-${type.type}-reason` : undefined}
					class="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground hover:not-data-[state=on]:bg-secondary data-disabled:text-muted-foreground flex h-7 min-w-6 items-center gap-1 rounded-(--radius-sm) px-2.5 text-sm font-medium data-disabled:cursor-not-allowed"
				>
					<type.icon class="size-4" aria-hidden="true" />
					{type.label()}
				</ToggleGroup.Item>
			{/each}
		</ToggleGroup.Root>
	</div>
	{#each types as { type, block } (type.type)}
		{#if block}
			<p id="{uid}-{type.type}-reason" class="text-muted-foreground text-xs">
				{m.get_data_type_blocked({ type: type.label(), reason: reason(type, block) })}
			</p>
		{/if}
	{/each}
</div>
