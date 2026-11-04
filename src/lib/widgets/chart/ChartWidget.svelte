<script lang="ts">
	import TimeChart from "$lib/charts/TimeChart.svelte";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { DataWidget } from "../shared/data-widget.svelte";
	import WidgetState from "../shared/WidgetState.svelte";
	import { chartType } from "./index";

	let { widget }: { widget: WidgetInstance } = $props();

	const MAX_PLACES = chartType.accepts?.maxPlaces ?? 5;
	const w = new DataWidget(() => widget, MAX_PLACES);
</script>

<div class="flex h-full flex-col">
	{#if w.picked.hidden > 0}
		<p class="bg-muted text-muted-foreground mb-2 rounded-(--radius-control) px-2 py-1 text-sm">
			{m.chart_hidden_places({ count: formatNumber(w.picked.hidden), countValue: w.picked.hidden })}
		</p>
	{/if}
	<div class="min-h-0 flex-1">
		<WidgetState state={w.shown} {widget} retired={w.retired} onretry={w.retry}>
			{#snippet children(data)}
				<TimeChart
					{data}
					levels={w.levelList}
					unit={w.meta?.entryType.units ?? ""}
					placeNames={new Map(data.places.map((p) => [p.place, p.name]))}
				/>
			{/snippet}
		</WidgetState>
	</div>
</div>
