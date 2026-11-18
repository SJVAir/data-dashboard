<script lang="ts">
	import type { Scale } from "@sjvair/map-sdk/data";
	import { formatNumber, formatValue } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import type { UseProps } from "./data/use";
	import { useField } from "./data/use";
	import { labelPrecisionOf } from "./data/use-scale";
	import { classInWords, type UseFigure } from "./use-card";
	import { periodLabel, type UsePeriod } from "./use-period";

	// A township's or section's three use figures (the catalog's labels, units and precision),
	// the shown one first with its class in words, for the township and section cards.
	let {
		props,
		figure,
		figures,
		period,
		scale
	}: {
		props: UseProps;
		/** The figure the map shows. */
		figure: string;
		/** The catalog's figures the map draws, in its order. */
		figures: UseFigure[];
		period: UsePeriod;
		/** The shown figure's scale; null while it resolves. */
		scale: Scale | null;
	} = $props();

	const ordered = $derived([
		...figures.filter((f) => f.id === figure),
		...figures.filter((f) => f.id !== figure)
	]);

	function valueOf(f: UseFigure): number | null {
		const field = useField(f.id);
		return field ? props[field] : null;
	}

	/**
	 * A figure's fraction digits: the shown one's at least its scale's labels', so its value never
	 * reads lower than its own class.
	 */
	function precisionOf(f: UseFigure): number {
		const labels = f.id === figure && scale ? labelPrecisionOf(scale) : undefined;
		return labels === undefined ? f.precision : Math.max(f.precision, labels);
	}

	const shownClass = $derived.by(() => {
		const info = figures.find((f) => f.id === figure);
		const value = info ? valueOf(info) : null;
		const found = scale && value !== null ? classInWords(scale, value) : null;
		return found && info
			? m.map_use_card_class({
					tier: formatNumber(found.tier),
					count: formatNumber(found.count),
					range: found.label,
					units: info.units
				})
			: null;
	});
</script>

<div class="flex flex-col gap-0.5">
	<p class="text-muted-foreground text-xs">
		{m.map_use_card_figures({ period: periodLabel(period) })}
	</p>
	<dl class="flex flex-col gap-0.5">
		{#each ordered as f (f.id)}
			{@const value = valueOf(f)}
			{#if value !== null}
				<div data-use-figure={f.id} class="flex flex-wrap justify-between gap-x-2">
					<dt class={f.id === figure ? "font-medium" : "text-muted-foreground"}>{f.label}</dt>
					<dd class="tabular-nums">
						{m.map_use_card_value({ value: formatValue(value, precisionOf(f)), units: f.units })}
					</dd>
					{#if f.id === figure && shownClass}
						<dd class="text-muted-foreground w-full text-xs">{shownClass}</dd>
					{/if}
				</div>
			{/if}
		{/each}
	</dl>
</div>
