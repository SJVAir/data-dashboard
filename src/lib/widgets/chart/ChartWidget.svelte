<script lang="ts">
	import { chartXRange } from "$lib/charts/series";
	import TimeChart from "$lib/charts/TimeChart.svelte";
	import type { QueryData } from "$lib/data/types";
	import { fromLayer } from "$lib/places/selection";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { DataWidget, type WidgetOverlay } from "../shared/data-widget.svelte";
	import { overlayPlaceFor, sharedSource } from "../shared/overlays";
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

	/**
	 * What the Chart draws for each overlay: one place's days (the saved "Overlay for" place,
	 * or the first, when the places' overlays differ), or a note when it has none or failed.
	 * Overlays still loading, or whose dataset the catalog doesn't list, show nothing yet.
	 */
	function drawn(overlays: WidgetOverlay[]) {
		const bands = [];
		const notes: string[] = [];
		const input = w.picked.input;
		for (const o of overlays) {
			const layer = o.meta?.entryType.label;
			if (!layer || !input) continue;
			const s = o.state;
			if (s.status === "error" || s.status === "unavailable") {
				notes.push(m.chart_overlay_failed({ layer }));
				continue;
			}
			if (s.status !== "ready") continue;
			const { places, series } = s.data;
			const key = sharedSource(series)
				? (places[0]?.place ?? "")
				: overlayPlaceFor(widget.options, places, fromLayer(input.layer));
			const info = places.find((p) => p.place === key);
			if (!info) continue;
			const place = placeLabel(info, w.viewer);
			const points = series.find((x) => x.place === key)?.points ?? [];
			if (points.length === 0) {
				notes.push(m.chart_overlay_none({ layer, place }));
				continue;
			}
			bands.push({
				name: m.chart_overlay_key({ layer, place }),
				layer,
				levels: o.levels,
				points
			});
		}
		return { bands, notes };
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
				{@const overlays = drawn(w.overlays)}
				<TimeChart
					{data}
					levels={w.levelList}
					unit={w.meta?.entryType.units ?? ""}
					placeNames={new Map(data.places.map((p) => [p.place, placeLabel(p, w.viewer)]))}
					xRange={xRange(data)}
					precision={w.meta?.entryType.precision ?? null}
					yMin={w.meta?.entryType.yMin ?? null}
					overlays={overlays.bands}
					notes={overlays.notes}
				/>
			{/snippet}
		</WidgetState>
	</div>
</div>
