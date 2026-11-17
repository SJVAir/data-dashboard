<script lang="ts">
	import type { Scale } from "@sjvair/map-sdk/data";
	import { formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import type { UseProps } from "./data/use";
	import type { UseFigure } from "./use-card";
	import UseCardFigures from "./UseCardFigures.svelte";
	import type { UsePeriod } from "./use-period";

	// A township's card: its id, the active filters, its three figures (the shown one with its
	// class in words) and how many square miles it holds. Pinned or focused, it offers "Show
	// square miles" (the lens) and "Zoom in" (to the section zoom). On hover (map-sdk's
	// non-interactive tooltip) it is the same summary with nothing focusable. Esc and the lens
	// are map-sdk's.
	let {
		props,
		figure,
		figures,
		period,
		scale,
		filtersLine,
		interactive,
		onshow,
		onzoom
	}: {
		props: UseProps;
		figure: string;
		figures: UseFigure[];
		period: UsePeriod;
		scale: Scale | null;
		/** The active filters' names, or null with none. */
		filtersLine: string | null;
		/** The pinned or focused card; false for the hover tooltip's static form. */
		interactive: boolean;
		/** "Show square miles": pin the lens on this township. */
		onshow: () => void;
		/** "Zoom in": to the township at the section zoom. */
		onzoom: () => void;
	} = $props();

	const button =
		"border-border hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring rounded-sm border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none";

	/** The interactive card takes focus (map-sdk moves it there); the hover form takes none. */
	const focusTarget = $derived(interactive ? { tabindex: -1 } : {});
</script>

<div
	{...focusTarget}
	class={[
		"flex flex-col gap-2",
		interactive &&
			"focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
	]}
	data-use-card={interactive ? "township" : "township-hover"}
>
	<h3 class="font-semibold">{props.name}</h3>
	{#if filtersLine}
		<p class="text-muted-foreground text-xs">
			{m.map_use_legend_filters({ filters: filtersLine })}
		</p>
	{/if}
	<UseCardFigures {props} {figure} {figures} {period} {scale} />
	{#if props.sections !== undefined}
		<p class="text-muted-foreground text-xs">
			{m.map_use_card_sections({
				count: formatNumber(props.sections),
				countValue: props.sections
			})}
		</p>
	{/if}
	{#if interactive}
		<div class="flex flex-wrap gap-1">
			<button type="button" class={button} onclick={onshow}>
				{m.map_use_card_show_sections()}
			</button>
			<button type="button" class={button} onclick={onzoom}>{m.map_use_card_zoom_in()}</button>
		</div>
	{/if}
</div>
