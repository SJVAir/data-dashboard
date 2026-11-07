<script lang="ts">
	import { untrack } from "svelte";
	import type { Level } from "$lib/data/metadata";
	import type { QueryData } from "$lib/data/types";
	import { formatList, formatPeriod } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { overlayLevelAt, type ChartOverlay } from "./day-bands";
	import LevelKey from "./LevelKey.svelte";
	import OverlayKey from "./OverlayKey.svelte";
	import Readout from "./Readout.svelte";
	import SeriesKey from "./SeriesKey.svelte";
	import { alignSeries, type XRange } from "./series";
	import { stripLayout, stripPointAt, type ChartStrip } from "./strips";
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
	 * its legend row and its level in the readout; `notes` say why an overlay isn't drawn. Number
	 * overlays draw as `strips` under the plot, each with its own value axis, legend row and readout
	 * line; a strip with a `message` shows it in the strip's place. The main layer draws as bars
	 * when `mainChart` says so. New data with the same number of places and strips updates the same
	 * chart, so the readout stays where it was.
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
		notes = [],
		strips = [],
		mainChart = "line"
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
		strips?: ChartStrip[];
		/** The main layer as bars or a line (the catalog's `display.chart`). */
		mainChart?: "line" | "bar";
	} = $props();

	/** Strips drawn as plots; the others show their message (or "No data") in their place. */
	const plotted = $derived(strips.filter((s) => !s.message && s.points.length > 0));
	/** Each strip's index among `plotted`, or -1 when it shows a message. */
	const plotIndex = $derived.by(() => {
		let k = 0;
		return strips.map((s) => (!s.message && s.points.length > 0 ? k++ : -1));
	});
	/** What a plot is built for: a change here builds the chart again. */
	const stripShape = $derived(plotted.map((s) => `${s.chart}:${s.wholePeriod}`).join(","));
	let areaHeight = $state(0);
	const layout = $derived(stripLayout(areaHeight, strips.length));
	/** Plot containers, one per plotted strip (set by `bind:this`). */
	const stripEls: HTMLDivElement[] = [];
	let stripBars = $state<number[]>([]);
	let drawnBars = $state(0);
	let group = $state<HTMLDivElement>()!;

	function axisLabel(strip: ChartStrip): string {
		return strip.unit ? m.chart_strip_axis({ label: strip.label, unit: strip.unit }) : strip.label;
	}

	/**
	 * The tag a coarser strip carries: "Monthly total" for a summed layer, "Monthly average" for an
	 * averaged one, none for a layer whose values never roll up (or a period with no tag).
	 */
	function wholeTag(strip: ChartStrip): string | null {
		if (!strip.wholePeriod || strip.aggregate === null) return null;
		const month = strip.resolution === "month";
		const year = strip.resolution === "year";
		if (strip.aggregate === "sum") {
			return month ? m.chart_strip_monthly_total() : year ? m.chart_strip_yearly_total() : null;
		}
		return month ? m.chart_series_month() : year ? m.chart_series_year() : null;
	}

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
		if (idx === null && document.activeElement === group) return;
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
		daily: data.resolution === "day",
		strips: plotted
	});
	/** What the chart shows, to skip a repeat and find the active point again in new data. */
	let shown: ChartData | undefined;

	// Built again only when the place count, levels, or unit change (deriveds, so an unchanged
	// value doesn't count as a change).
	const count = $derived(aligned.places.length);
	const chartLevels = $derived(levels);
	const chartUnit = $derived(unit);
	const chartKind = $derived(mainChart);
	$effect(() => {
		const fixed = { levels: chartLevels, unit: chartUnit, mainChart: chartKind };
		void count;
		void stripShape;
		const targets = untrack(() => stripEls.slice(0, plotted.length));
		const handle = untrack(() =>
			createTimeChart(
				plot,
				{ ...chartData, ...fixed },
				size(),
				{
					onCursor,
					onSticks: (n) => (drawnSticks = n),
					onDayBands: (n) => (drawnDays = n),
					onBars: (n) => (drawnBars = n),
					onStripBars: (i, n) => {
						if (stripBars[i] === n) return;
						const next = [...stripBars];
						next[i] = n;
						stripBars = next;
					}
				},
				targets
			)
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
			if (chart !== handle) return;
			u.setSize(size());
			handle.strips.forEach((s, i) =>
				s.setSize({
					width: Math.max(targets[i].clientWidth, 1),
					height: Math.max(targets[i].clientHeight, 1)
				})
			);
		});
		resize.observe(untrack(() => plot));
		for (const el of targets) resize.observe(el);

		// A theme switch changes the tokens; uPlot reads them again on redraw.
		const redraw = () => {
			u.redraw(false);
			for (const s of handle.strips) s.redraw(false);
		};
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
			for (const s of handle.strips) s.destroy();
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
	bind:this={group}
	role="group"
	tabindex="0"
	aria-label={m.chart_label({ places: formatList(names) })}
	aria-describedby={hintId}
	data-sticks={drawnSticks}
	data-day-bands={drawnDays}
	data-highlight={highlight}
	data-bars={drawnBars}
	class="flex h-full min-h-0 flex-col gap-1.5 rounded-sm"
	{onkeydown}
>
	<p id={hintId} class="sr-only">{m.chart_keyboard_hint()}</p>
	<!-- The main plot keeps at least half the height; each strip gets an equal share of the rest. -->
	<div class="relative min-h-0 flex-1" bind:clientHeight={areaHeight}>
		<div class="flex h-full flex-col" style:gap="{layout.gap}px">
			<div class="relative min-h-0 flex-1 overflow-hidden" bind:this={plot}></div>
			{#each strips as strip, i (i)}
				{@const k = plotIndex[i]}
				{@const tag = wholeTag(strip)}
				<div
					data-strip={strip.chart}
					data-bars={k === -1 ? undefined : (stripBars[k] ?? 0)}
					class="flex shrink-0 flex-col"
					style:height="{layout.strip}px"
				>
					<p class="text-muted-foreground flex items-center gap-2 text-xs leading-4">
						<span class="truncate">{axisLabel(strip)}</span>
						{#if tag}
							<span class="bg-muted shrink-0 rounded-(--radius-control) px-1">{tag}</span>
						{/if}
					</p>
					{#if k === -1}
						<p class="text-muted-foreground flex min-h-0 flex-1 items-center text-xs">
							{strip.message ?? m.chart_no_data()}
						</p>
					{:else}
						<div class="relative min-h-0 flex-1 overflow-hidden" bind:this={stripEls[k]}></div>
					{/if}
				</div>
			{/each}
		</div>
		<!-- Over the area, not just the main plot, so a tall readout can run over the strips. -->
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
						strips={plotted.map((s) => {
							const point = stripPointAt(s, aligned.xs[active!]);
							return {
								layer: s.label,
								unit: s.unit,
								precision: s.precision,
								point,
								whole:
									s.wholePeriod && s.aggregate === "sum" && point
										? m.chart_strip_whole_month({
												period: formatPeriod(new Date(point.t), s.resolution)
											})
										: null
							};
						})}
					/>
				</div>
			{/if}
		</div>
	</div>
	<!-- The series key and the level key share one compact wrapping flow under the plot. -->
	<div class="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs">
		<SeriesKey
			{names}
			resolution={data.resolution}
			sticks={sticks && drawnSticks > 0}
			chart={mainChart}
			strips={strips.map((s) => ({ name: s.name, chart: s.chart }))}
		/>
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
