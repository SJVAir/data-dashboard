<script lang="ts">
	import { chartXRange } from "$lib/charts/series";
	import TimeChart from "$lib/charts/TimeChart.svelte";
	import type { QueryData } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { DataWidget } from "../shared/data-widget.svelte";
	import WidgetState from "../shared/WidgetState.svelte";
	import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
	import { placeLabel } from "../title";
	import { chartType } from "./index";

	let { widget }: { widget: WidgetInstance } = $props();

	const MAX_PLACES = chartType.accepts?.maxPlaces ?? 5;
	const w = new DataWidget(() => widget, MAX_PLACES);

	/** The widget's whole date range (and sub-range), up to when the data was fetched. */
	function xRange(data: QueryData) {
		const input = w.picked.input;
		if (!input) return undefined;
		return chartXRange(
			input.dateRange,
			input.timeSubRange,
			data.resolution,
			new Date(data.fetchedAt)
		);
	}
</script>

<div class="flex h-full flex-col">
	{#if w.picked.hidden > 0}
		<p class="bg-muted text-muted-foreground mb-2 rounded-(--radius-control) px-2 py-1 text-sm">
			{m.chart_hidden_places({ count: formatNumber(w.picked.hidden), countValue: w.picked.hidden })}
		</p>
	{/if}
	<div class="min-h-0 flex-1">
		<WidgetState
			state={w.shown}
			{widget}
			retired={w.retired}
			onretry={w.retry}
			onchoose={() => openPlacePicker({ widgetId: widget.id })}
		>
			{#snippet children(data)}
				<TimeChart
					{data}
					levels={w.levelList}
					unit={w.meta?.entryType.units ?? ""}
					placeNames={new Map(data.places.map((p) => [p.place, placeLabel(p, w.viewer)]))}
					xRange={xRange(data)}
					precision={w.meta?.entryType.precision ?? null}
					yMin={w.meta?.entryType.yMin ?? null}
				/>
			{/snippet}
		</WidgetState>
	</div>
</div>
