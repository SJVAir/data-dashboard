<script lang="ts">
	import LevelSwatch from "$lib/components/data/LevelSwatch.svelte";
	import { levelFor, type Level } from "$lib/data/metadata";
	import type { SeriesPoint } from "$lib/data/types";
	import type { Resolution } from "$lib/data/schema";
	import { formatHourRange, formatPeriod, formatValue } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";

	/** The hovered or keyboard-selected period: its date, each place's value and level. */
	let {
		t,
		resolution,
		entries,
		levels,
		unit,
		precision = null
	}: {
		t: number;
		resolution: Resolution;
		/** One per place; `name` is null for a single place (the chart already names it). */
		entries: { name: string | null; point: SeriesPoint | null }[];
		levels: Level[];
		unit: string;
		/** Decimals for values (the catalog's display precision); null: the default format. */
		precision?: number | null;
	} = $props();

	const value = (v: number) => m.chart_value({ value: formatValue(v, precision), unit });
</script>

<p class="font-semibold">{formatPeriod(new Date(t), resolution)}</p>
{#each entries as { name, point }, i (i)}
	{@const level = point ? levelFor(levels, point.mean) : undefined}
	<div class="tabular-nums">
		<p>
			{#if point}
				{name === null
					? value(point.mean)
					: m.chart_place_value({ place: name, value: value(point.mean) })}
			{:else}
				{name === null
					? m.chart_no_data()
					: m.chart_place_value({ place: name, value: m.chart_no_data() })}
			{/if}
		</p>
		{#if level}
			<LevelSwatch color={level.color ?? "transparent"} label={level.label} />
		{/if}
		{#if point?.worstHour}
			<p class="text-muted-foreground">
				{m.chart_worst_hour({
					value: value(point.worstHour.value),
					hours: formatHourRange(
						new Date(point.worstHour.t),
						new Date(point.worstHour.t + 3_600_000)
					)
				})}
			</p>
		{/if}
		{#if point?.partial}
			<p class="text-muted-foreground">{m.chart_partial()}</p>
		{/if}
	</div>
{/each}
