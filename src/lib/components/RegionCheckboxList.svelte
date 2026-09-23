<script lang="ts">
	import type { RegionData } from "@sjvair/sdk";
	import { Checkbox } from "$lib/components/ui/checkbox";

	interface Props {
		regions: Array<RegionData>;
		selected: Set<string>;
		onToggle: (id: string) => void;
	}

	let { regions, selected, onToggle }: Props = $props();

	let filterText = $state("");

	let filteredRegions = $derived(
		filterText.trim()
			? regions.filter((region) =>
					region.name.toLowerCase().includes(filterText.trim().toLowerCase())
				)
			: regions
	);
</script>

<div class="flex flex-col gap-2">
	{#if regions.length > 10}
		<input
			type="text"
			placeholder="Filter regions..."
			bind:value={filterText}
			class="border-input rounded border px-2 py-1 text-sm"
		/>
	{/if}

	<div class="flex max-h-64 flex-col gap-1 overflow-y-auto">
		{#each filteredRegions as region (region.id)}
			<label class="flex items-center gap-2 text-sm">
				<Checkbox checked={selected.has(region.id)} onCheckedChange={() => onToggle(region.id)} />
				{region.name}
			</label>
		{/each}
	</div>
</div>
