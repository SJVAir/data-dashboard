<script lang="ts">
	import DataBox from "$lib/components/DataBox.svelte";
	import { monitorsTabManager as manager } from "./monitors-tab.svelte";

	interface RegionTooltipProps {
		regionId: string;
		regionName: string;
	}

	const { regionId, regionName }: RegionTooltipProps = $props();

	const data = $derived.by(() => {
		if (!manager.meta || !manager.pollutant) return null;

		const mean = manager.regionFillMeans?.get(regionId);
		const color = manager.regionFillColors?.get(regionId);
		if (mean === undefined || !color) return null;

		return {
			color,
			header: manager.meta.entryType(manager.pollutant).label,
			value: Math.round(mean).toString()
		};
	});
</script>

<div class="flex items-center gap-2">
	{#if data}
		<DataBox
			color={data.color}
			header={data.header}
			subheading="(monthly avg)"
			value={data.value}
		/>
	{/if}
	<div class="flex flex-col">
		<h1 class="text-lg font-bold underline">{regionName}</h1>
		{#if !data}
			<p class="text-sm text-gray-500">No data for this month</p>
		{/if}
	</div>
</div>
