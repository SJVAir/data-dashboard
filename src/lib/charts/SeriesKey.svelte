<script lang="ts">
	import { m } from "$lib/paraglide/messages.js";
	import type { Resolution } from "$lib/data/schema";
	import { seriesShape } from "./series";

	/**
	 * What the marks are: the average (one place) or one entry per place, plus the worst hour, each
	 * as a line or a bar (`chart`); then each strip with its mark's shape and an outlined swatch.
	 */
	let {
		names,
		resolution,
		sticks,
		chart = "line",
		strips = []
	}: {
		names: string[];
		resolution: Resolution;
		sticks: boolean;
		chart?: "line" | "bar";
		strips?: { name: string; chart: "line" | "bar" }[];
	} = $props();

	const average = $derived(
		{
			raw: m.chart_series_raw,
			hour: m.chart_series_hour,
			day: m.chart_series_day,
			month: m.chart_series_month,
			quarter: m.chart_series_quarter,
			season: m.chart_series_season,
			year: m.chart_series_year
		}[resolution]()
	);
	const entries = $derived(names.length === 1 ? [average] : names);
</script>

<!-- Its items join the parent's wrapping flow (`display: contents`), next to the level key. -->
<ul role="list" aria-label={m.chart_series_key()} class="contents">
	{#each entries as name, i (i)}
		{@const style = seriesShape(i)}
		<li class="text-muted-foreground inline-flex items-center gap-1">
			<svg
				data-series-sample
				data-shape={chart}
				data-marker={style.marker}
				data-dash={style.dash.join(" ")}
				aria-hidden="true"
				width="24"
				height="10"
				viewBox="0 0 24 10"
				style:color="var(--chart-{i + 1})"
			>
				{#if chart === "bar"}
					{@render bar(style.dash.join(" "))}
				{:else}
					<line
						x1="0"
						y1="5"
						x2="24"
						y2="5"
						stroke="currentColor"
						stroke-width="2"
						stroke-dasharray={style.dash.join(" ") || undefined}
					/>
					{#if style.marker === "circle"}
						<circle cx="12" cy="5" r="3" fill="currentColor" />
					{:else if style.marker === "square"}
						<rect x="9.5" y="2.5" width="5" height="5" fill="currentColor" />
					{:else if style.marker === "triangle"}
						<path d="M12 1.5 L15.5 7.5 L8.5 7.5 Z" fill="currentColor" />
					{:else if style.marker === "diamond"}
						<path d="M12 1 L16 5 L12 9 L8 5 Z" fill="currentColor" />
					{:else}
						<path d="M9 2 L15 8 M15 2 L9 8" stroke="currentColor" stroke-width="1.5" />
					{/if}
				{/if}
			</svg>
			<span class="text-foreground">{name}</span>
		</li>
	{/each}
	{#if sticks}
		<li class="text-muted-foreground inline-flex items-center gap-1">
			<svg aria-hidden="true" width="8" height="12" viewBox="0 0 8 12" style:color="var(--chart-1)">
				<line
					x1="4"
					y1="1.5"
					x2="4"
					y2="10.5"
					stroke="currentColor"
					stroke-width="3"
					stroke-linecap="round"
					style:opacity="var(--chart-stick-opacity)"
				/>
			</svg>
			<span class="text-foreground">{m.chart_series_worst_hour()}</span>
		</li>
	{/if}
	{#each strips as strip, i (i)}
		<li class="text-muted-foreground inline-flex items-center gap-1">
			<svg
				data-strip-sample
				data-shape={strip.chart}
				aria-hidden="true"
				width="24"
				height="10"
				viewBox="0 0 24 10"
			>
				{#if strip.chart === "bar"}
					{@render bar("")}
				{:else}
					<line x1="0" y1="5" x2="24" y2="5" stroke="currentColor" stroke-width="2" />
					<circle cx="12" cy="5" r="2.5" fill="currentColor" />
				{/if}
			</svg>
			<span class="text-foreground">{strip.name}</span>
		</li>
	{/each}
</ul>

<!-- A bar sample: a light fill with a solid (or dashed) outline, as the chart draws bars. -->
{#snippet bar(dash: string)}
	<rect
		x="7"
		y="1"
		width="10"
		height="8"
		fill="currentColor"
		style:fill-opacity="var(--chart-bar-opacity)"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-dasharray={dash || undefined}
	/>
{/snippet}
