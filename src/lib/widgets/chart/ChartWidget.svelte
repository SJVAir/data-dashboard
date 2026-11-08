<script lang="ts">
	import { chartXRange } from "$lib/charts/series";
	import type { ChartStrip } from "$lib/charts/strips";
	import TimeChart from "$lib/charts/TimeChart.svelte";
	import { layerKind } from "$lib/data/layer-kind";
	import { unavailableMessage } from "$lib/data/messages";
	import type { QueryData } from "$lib/data/types";
	import { fromLayer } from "$lib/places/selection";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { DataWidget, type WidgetOverlay } from "../shared/data-widget.svelte";
	import { overlayPlaceFor, sharedSource } from "../shared/overlays";
	import { sourceLabel } from "../shared/source-label";
	import WidgetState from "../shared/WidgetState.svelte";
	import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
	import { placeLabel } from "../title";
	import { chartType } from "./index";

	let { widget }: { widget: WidgetInstance } = $props();

	const MAX_PLACES = chartType.accepts?.maxPlaces ?? 5;
	const w = new DataWidget(() => widget, MAX_PLACES);

	/** The pesticide-use dataset: its empty range has its own wording (nothing was reported). */
	const PESTICIDE_USE = "pesticide-use";
	const pesticideMain = $derived(w.picked.layer?.dataset === PESTICIDE_USE);

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
	 * What the Chart draws for each overlay: a level overlay as one place's day bands, a number
	 * overlay as one place's strip (the saved "Overlay for" place, or the first, when the places'
	 * overlays differ). A level overlay with none or that failed gets a note; a number overlay
	 * shows why in its strip's place, so the main chart is never affected. Overlays still loading,
	 * or whose dataset the catalog doesn't list, show nothing yet.
	 */
	function drawn(overlays: WidgetOverlay[], main: QueryData) {
		const bands = [];
		const strips: ChartStrip[] = [];
		const notes: string[] = [];
		const input = w.picked.input;
		for (const o of overlays) {
			const meta = o.meta?.entryType;
			const layer = meta?.label;
			if (!meta || !layer || !input) continue;
			const s = o.state;
			const number = layerKind(o.layer, w.catalog) === "number";
			const strip = (extra: Partial<ChartStrip>): ChartStrip => ({
				name: layer,
				label: layer,
				unit: meta.units,
				chart: meta.chart === "bar" ? "bar" : "line",
				precision: meta.precision,
				yMin: meta.yMin,
				points: [],
				resolution: main.resolution,
				wholePeriod: false,
				aggregate: meta.aggregate,
				...extra
			});
			if (s.status === "error" || s.status === "unavailable") {
				if (number) {
					const message =
						s.status === "error" ? m.chart_overlay_failed({ layer }) : unavailableMessage(s.reason);
					strips.push(strip({ message }));
				} else notes.push(m.chart_overlay_failed({ layer }));
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
			if (number) {
				const name = sourceLabel(layer, info, place);
				if (points.length === 0) {
					const message =
						o.layer.dataset === PESTICIDE_USE
							? m.data_none_pesticides()
							: m.chart_overlay_none({ layer, place });
					strips.push(strip({ name, message }));
					continue;
				}
				strips.push(
					strip({
						name,
						points,
						resolution: s.data.resolution,
						// Pinned to the main's resolution, an overlay comes back coarser only when its
						// dataset has nothing finer (pesticide use is monthly).
						wholePeriod: s.data.resolution !== main.resolution
					})
				);
				continue;
			}
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
		return { bands, strips, notes };
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
			emptyText={pesticideMain ? m.data_none_pesticides() : undefined}
		>
			{#snippet children(data)}
				{@const overlays = drawn(w.overlays, data)}
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
					strips={overlays.strips}
					mainChart={w.meta?.entryType.chart === "bar" ? "bar" : "line"}
					aggregate={w.meta ? w.meta.entryType.aggregate : "mean"}
					entryLabel={w.meta?.entryType.label ?? ""}
					source={(name, place) =>
						sourceLabel(
							name,
							data.places.find((p) => p.place === place)
						)}
				/>
			{/snippet}
		</WidgetState>
	</div>
</div>
