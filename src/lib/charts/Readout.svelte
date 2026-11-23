<script lang="ts">
	import LevelSwatch from "$lib/components/data/LevelSwatch.svelte";
	import { levelFor, type Level } from "$lib/data/metadata";
	import { notEnoughData } from "$lib/data/figure-values";
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
		precision = null,
		overlays = [],
		strips = []
	}: {
		t: number;
		resolution: Resolution;
		/** One per place; `name` is null for a single place (the chart already names it). */
		entries: { name: string | null; point: SeriesPoint | null }[];
		levels: Level[];
		unit: string;
		/** Decimals for values (the catalog's display precision); null: the default format. */
		precision?: number | null;
		/** Each overlay's level on this day, if it has one. */
		overlays?: { layer: string; level: Level | null }[];
		/** Each strip's value for this period. */
		strips?: {
			layer: string;
			unit: string;
			precision: number | null;
			point: SeriesPoint | null;
		}[];
	} = $props();

	const value = (v: number) => m.chart_value({ value: formatValue(v, precision), unit });
	const stripValue = (v: number, s: { unit: string; precision: number | null }) =>
		s.unit
			? m.chart_value({ value: formatValue(v, s.precision), unit: s.unit })
			: formatValue(v, s.precision);
</script>

<p class="font-semibold">{formatPeriod(new Date(t), resolution)}</p>
{#each entries as { name, point }, i (i)}
	{@const level = point ? levelFor(levels, point.mean) : undefined}
	<!-- A figure the server had too little data for: the period is there, its value isn't. -->
	{@const shown = !point
		? m.chart_no_data()
		: notEnoughData(point)
			? m.data_not_enough()
			: value(point.mean)}
	<div class="tabular-nums">
		<p>{name === null ? shown : m.chart_place_value({ place: name, value: shown })}</p>
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
{#each overlays as { layer, level }, i (i)}
	{#if level}
		<p>{m.chart_overlay_value({ layer, level: level.label })}</p>
	{/if}
{/each}
{#each strips as strip, i (i)}
	<div class="tabular-nums">
		<p>
			{m.chart_strip_value({
				layer: strip.layer,
				value: strip.point ? stripValue(strip.point.mean, strip) : m.chart_no_data()
			})}
		</p>
		{#if strip.point?.partial}
			<p class="text-muted-foreground">{m.chart_partial()}</p>
		{/if}
	</div>
{/each}
