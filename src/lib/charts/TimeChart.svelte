<script lang="ts">
	import type uPlot from "uplot";
	import type { Level } from "$lib/data/metadata";
	import type { QueryData } from "$lib/data/types";
	import { formatList } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import LevelKey from "./LevelKey.svelte";
	import Readout from "./Readout.svelte";
	import SeriesKey from "./SeriesKey.svelte";
	import { alignSeries } from "./series";
	import { ancestorAnimationsSettled, createTimeChart, cursorTo } from "./time-chart";

	/**
	 * The shared time chart: level bands, a line with dots per place (at most five), each day's
	 * worst hour as a stick (single place), the level key and series key, and a readout that
	 * follows the pointer or the arrow keys.
	 */
	let {
		data,
		levels,
		unit,
		placeNames
	}: { data: QueryData; levels: Level[]; unit: string; placeNames: Map<string, string> } = $props();

	const aligned = $derived(alignSeries(data));
	const names = $derived(aligned.places.map((p) => placeNames.get(p) ?? p));
	const sticks = $derived(
		aligned.places.length === 1 && aligned.points[0].some((p) => p?.worstHour !== undefined)
	);
	/** Indices with a point for at least one place: where the keyboard can stop. */
	const stops = $derived(
		aligned.xs.flatMap((_, i) => (aligned.points.some((row) => row[i]) ? [i] : []))
	);

	let plot = $state<HTMLDivElement>()!;
	let chart: uPlot | undefined;
	let active = $state<number | null>(null);
	let readoutX = $state(0);
	let drawnSticks = $state(0);
	const hintId = $props.id();

	function size() {
		return { width: Math.max(plot.clientWidth, 1), height: Math.max(plot.clientHeight, 1) };
	}

	function onCursor(idx: number | null) {
		if (idx === null && document.activeElement === plot.parentElement) return;
		active = idx;
		if (idx !== null && chart)
			readoutX = chart.valToPos(aligned.xs[idx], "x") + chart.over.offsetLeft;
	}

	$effect(() => {
		const u = createTimeChart(plot, { aligned, levels, unit, sticks }, size(), {
			onCursor,
			onSticks: (n) => (drawnSticks = n)
		});
		chart = u;
		active = null;

		let waiting = false;
		const resize = new ResizeObserver(async () => {
			if (waiting) return;
			waiting = true;
			// Redraw once the frame's resize animation is over, not on every frame of it.
			await ancestorAnimationsSettled(plot);
			waiting = false;
			if (chart === u) u.setSize(size());
		});
		resize.observe(plot);

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
		cursorTo(chart, idx, point.mean);
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
</div>
