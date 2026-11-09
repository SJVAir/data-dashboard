<script lang="ts">
	import type { Level } from "$lib/data/metadata";
	import type { DayState } from "$lib/calendars/day-state";
	import { m } from "$lib/paraglide/messages.js";
	import LevelChip from "../../shared/LevelChip.svelte";
	import { inkOf, tierPattern } from "./patterns";

	let {
		levels,
		states,
		threshold,
		patterns
	}: {
		levels: Level[];
		states: Map<string, DayState>;
		threshold: Level | null;
		/**
		 * The contribution calendar's "Show patterns" (its levels are drawn as its cells are: a
		 * swatch, with the tier pattern when on). Unset: each level is a labelled chip.
		 */
		patterns?: boolean;
	} = $props();

	/** The scale's levels up to one above the highest a colored day shows; none if none does. */
	const shownLevels = $derived.by(() => {
		let top = -1;
		for (const s of states.values()) {
			if (!s.level || (s.kind !== "rated" && s.kind !== "today")) continue;
			const i = levels.findIndex((l) => l.key === s.level!.key);
			if (i > top) top = i;
		}
		return top < 0 ? [] : levels.slice(0, top + 2);
	});
</script>

{#snippet swatch(kind: "thin" | "none", label: string)}
	<li class="flex items-center gap-1">
		<span
			aria-hidden="true"
			data-swatch={kind}
			class={["bg-muted inline-block size-3 rounded-sm", kind === "thin" && "calendar-thin"]}
			style:outline-style="solid"
			style:outline-width="var(--swatch-outline-width)"
			style:outline-color="var(--swatch-outline-color)"
			style:outline-offset="calc(var(--swatch-outline-width) * -1)"
		></span>
		<span>{label}</span>
	</li>
{/snippet}

<ul
	data-calendar-legend
	data-patterns={patterns ? "" : undefined}
	aria-label={m.calendar_key()}
	class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
>
	{#each shownLevels as level (level.key)}
		{#if patterns === undefined}
			<li><LevelChip {level} size="sm" /></li>
		{:else}
			{@const pattern =
				patterns && level.color ? tierPattern(level.tier, inkOf(level.color)) : null}
			<li class="flex items-center gap-1">
				<span
					aria-hidden="true"
					data-swatch={level.key}
					class={["inline-block size-3 rounded-sm", !level.color && "bg-muted"]}
					style:background={level.color
						? [pattern, level.color].filter(Boolean).join(", ")
						: undefined}
					style:outline-style="solid"
					style:outline-width="var(--swatch-outline-width)"
					style:outline-color="var(--swatch-outline-color)"
					style:outline-offset="calc(var(--swatch-outline-width) * -1)"
				></span>
				<span>{level.label}</span>
			</li>
		{/if}
	{/each}
	{@render swatch("thin", m.calendar_not_enough_data())}
	{@render swatch("none", m.calendar_no_data())}
	{#if threshold}
		<li data-legend-threshold class="flex items-center gap-1">
			<span aria-hidden="true" class="text-foreground">▲</span>
			<span>{m.calendar_legend_threshold({ level: threshold.label })}</span>
		</li>
	{/if}
</ul>

<style>
	/* Not enough data: grey stripes, as the cells draw them. */
	.calendar-thin {
		background-image: repeating-linear-gradient(
			45deg,
			var(--muted-foreground) 0 1px,
			transparent 1px 4px
		);
	}
</style>
