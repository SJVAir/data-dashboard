<script lang="ts">
	import { untrack } from "svelte";
	import type { Level } from "$lib/data/metadata";
	import type { QueryData } from "$lib/data/types";
	import { formatList } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { overlayLevelAt, type ChartOverlay } from "./day-bands";
	import LevelKey from "./LevelKey.svelte";
	import OverlayKey from "./OverlayKey.svelte";
	import Readout from "./Readout.svelte";
	import SeriesKey from "./SeriesKey.svelte";
	import { alignSeries, type XRange } from "./series";
	import {
		ancestorAnimationsSettled,
		createTimeChart,
		cursorTo,
		type ChartData,
		type TimeChart
	} from "./time-chart";

	/**
	 * The shared time chart: level bands, a line with dots per place (at most five), each day's
	 * worst hour as a stick (single place), the level key and series key, and a readout that
	 * follows the pointer or the arrow keys. Overlays draw as day bands behind the line, each with
	 * its legend row and its level in the readout; `notes` say why an overlay isn't drawn. New data
	 * with the same number of places updates the same chart, so the readout stays where it was.
	 */
	let {
		data,
		levels,
		unit,
		placeNames,
		xRange,
		precision = null,
		yMin = null,
		overlays = [],
		notes = []
	}: {
		data: QueryData;
		levels: Level[];
		unit: string;
		placeNames: Map<string, string>;
		/** The time axis's extent (the widget's date range); the data's own extent when not given. */
		xRange?: XRange;
		/** Decimals for values (the catalog's display precision). */
		precision?: number | null;
		/** Where the value axis starts (the catalog's `y_min`). */
		yMin?: number | null;
		/** `name` heads its legend row; `layer` names it in the readout. */
		overlays?: (ChartOverlay & { name: string; layer: string })[];
		notes?: string[];
	} = $props();

	// By value, so an equal range passed as a new object doesn't redraw the chart.
	const rangeMin = $derived(xRange?.min);
	const rangeMax = $derived(xRange?.max);
	const range = $derived(
		rangeMin === undefined || rangeMax === undefined ? undefined : { min: rangeMin, max: rangeMax }
	);
	const aligned = $derived(alignSeries(data, range));
	const names = $derived(aligned.places.map((p) => placeNames.get(p) ?? p));
	const sticks = $derived(
		aligned.places.length === 1 && aligned.points[0].some((p) => p?.worstHour !== undefined)
	);
	/** Indices with a point for at least one place: where the keyboard can stop. */
	const stops = $derived(
		aligned.xs.flatMap((_, i) => (aligned.points.some((row) => row[i]) ? [i] : []))
	);

	let plot = $state<HTMLDivElement>()!;
	let chart: TimeChart | undefined;
	let active = $state<number | null>(null);
	let readoutX = $state(0);
	let drawnSticks = $state(0);
	let drawnDays = $state(0);
	/** The overlay level whose key item is hovered or focused. */
	let highlight = $state<string | null>(null);
	const hintId = $props.id();

	function size() {
		return { width: Math.max(plot.clientWidth, 1), height: Math.max(plot.clientHeight, 1) };
	}

	function onCursor(idx: number | null) {
		if (idx === null && document.activeElement === plot.parentElement) return;
		active = idx;
		if (idx !== null && chart)
			readoutX = chart.u.valToPos(aligned.xs[idx], "x") + chart.u.over.offsetLeft;
	}

	const chartData = $derived<ChartData>({
		aligned,
		sticks,
		xRange: range,
		yMin,
		overlays,
		daily: data.resolution === "day"
	});
	/** What the chart shows, to skip a repeat and find the active point again in new data. */
	let shown: ChartData | undefined;

	// Built again only when the place count, levels, or unit change (deriveds, so an unchanged
	// value doesn't count as a change).
	const count = $derived(aligned.places.length);
	const chartLevels = $derived(levels);
	const chartUnit = $derived(unit);
	$effect(() => {
		const fixed = { levels: chartLevels, unit: chartUnit };
		void count;
		const handle = untrack(() =>
			createTimeChart(plot, { ...chartData, ...fixed }, size(), {
				onCursor,
				onSticks: (n) => (drawnSticks = n),
				onDayBands: (n) => (drawnDays = n)
			})
		);
		const u = handle.u;
		chart = handle;
		handle.highlight(untrack(() => highlight));
		shown = untrack(() => chartData);
		active = null;

		let waiting = false;
		const resize = new ResizeObserver(async () => {
			if (waiting) return;
			waiting = true;
			// Redraw once the frame's resize animation is over, not on every frame of it.
			await ancestorAnimationsSettled(plot);
			waiting = false;
			if (chart === handle) u.setSize(size());
		});
		resize.observe(untrack(() => plot));

		// A theme switch changes the tokens; uPlot reads them again on redraw.
		const redraw = () => u.redraw(false);
		const themeObserver = new MutationObserver(redraw);
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme", "class"]
		});
		const scheme = matchMedia("(prefers-color-scheme: dark)");
		scheme.addEventListener("change", redraw);

		return () => {
			resize.disconnect();
			themeObserver.disconnect();
			scheme.removeEventListener("change", redraw);
			chart = undefined;
			u.destroy();
		};
	});

	$effect(() => {
		const next = chartData;
		const handle = untrack(() => chart);
		if (!handle || !shown || next === shown) return;
		const before = shown;
		const x = untrack(() => (active === null ? null : before.aligned.xs[active]));
		shown = next;
		handle.update(next);
		// Keep the readout on the same period if it's still there.
		const idx = x === null ? -1 : next.aligned.xs.indexOf(x);
		if (idx === -1) {
			active = null;
			handle.u.setCursor({ left: -10, top: -10 });
			return;
		}
		const point = next.aligned.points.find((row) => row[idx])?.[idx];
		if (point) cursorTo(handle.u, idx, point.mean);
		onCursor(idx);
	});

	$effect(() => {
		const key = highlight;
		untrack(() => chart)?.highlight(key);
	});

	function onkeydown(event: KeyboardEvent) {
		if (!chart || stops.length === 0) return;
		const at = active;
		let idx: number;
		switch (event.key) {
			case "ArrowRight":
				idx = at === null ? stops[0] : (stops.find((i) => i > at) ?? stops.at(-1)!);
				break;
			case "ArrowLeft":
				idx = at === null ? stops.at(-1)! : (stops.findLast((i) => i < at) ?? stops[0]);
				break;
			case "Home":
				idx = stops[0];
				break;
			case "End":
				idx = stops.at(-1)!;
				break;
			default:
				return;
		}
		event.preventDefault();
		const point = aligned.points.find((row) => row[idx])![idx]!;
		cursorTo(chart.u, idx, point.mean);
		onCursor(idx);
	}
</script>

<!-- Focusable so the arrow keys can step the readout through the points (the hint says how). -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	role="group"
	tabindex="0"
	aria-label={m.chart_label({ places: formatList(names) })}
	aria-describedby={hintId}
	data-sticks={drawnSticks}
	data-day-bands={drawnDays}
	data-highlight={highlight}
	class="flex h-full min-h-0 flex-col gap-1.5 rounded-sm"
	{onkeydown}
>
	<p id={hintId} class="sr-only">{m.chart_keyboard_hint()}</p>
	<div class="relative min-h-0 flex-1 overflow-hidden" bind:this={plot}>
		<div
			aria-live="polite"
			class="pointer-events-none absolute top-1 z-10"
			style:left="{readoutX}px"
			style:translate={readoutX > plot?.clientWidth / 2 ? "calc(-100% - 8px)" : "8px"}
		>
			{#if active !== null}
				<div
					class="bg-popover text-popover-foreground shadow-card w-max max-w-56 rounded-md border p-2 text-xs"
				>
					<Readout
						t={aligned.xs[active]}
						resolution={data.resolution}
						entries={aligned.points.map((row, i) => ({
							name: aligned.places.length === 1 ? null : names[i],
							point: row[active!]
						}))}
						{levels}
						{unit}
						{precision}
						overlays={overlays.map((o) => ({
							layer: o.layer,
							level: overlayLevelAt(o, aligned.xs[active!]) ?? null
						}))}
					/>
				</div>
			{/if}
		</div>
	</div>
	<!-- The series key and the level key share one compact wrapping flow under the plot. -->
	<div class="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs">
		<SeriesKey {names} resolution={data.resolution} sticks={sticks && drawnSticks > 0} />
		<LevelKey {levels} />
	</div>
	{#each overlays as overlay, i (i)}
		<div class="text-xs">
			<OverlayKey
				name={overlay.name}
				levels={overlay.levels}
				onhighlight={(k) => (highlight = k)}
			/>
		</div>
	{/each}
	{#each notes as note, i (i)}
		<p class="text-muted-foreground text-xs">{note}</p>
	{/each}
</div>
