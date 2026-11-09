<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import type { Level } from "$lib/data/metadata";
	import { m } from "$lib/paraglide/messages.js";
	import type { Threshold } from "$lib/thresholds/schema";

	let {
		levels,
		thresholds,
		onthreshold,
		onretry
	}: {
		/** The pollutant's scale; `"unavailable"` when it couldn't be loaded. */
		levels: Level[] | "unavailable";
		thresholds: Threshold[] | undefined;
		/** A level key, or `null` for Off. */
		onthreshold: (level: string | null) => void;
		onretry: () => void;
	} = $props();

	const uid = $props.id();

	const saved = $derived(thresholds?.[0]?.level);
	const onScale = $derived(
		Array.isArray(levels) && saved !== undefined && levels.some((l) => l.key === saved)
	);
	/** A saved level the scale no longer has: the Chart draws nothing, and this says why. */
	const missing = $derived(Array.isArray(levels) && saved !== undefined && !onScale);
</script>

{#if levels === "unavailable"}
	<div class="flex flex-wrap items-center gap-2">
		<p role="status" class="text-sm">{m.get_data_levels_unavailable()}</p>
		<Button variant="outline" size="sm" onclick={onretry}>{m.get_data_retry()}</Button>
	</div>
{:else if levels.length > 0}
	<div class="flex flex-col gap-1 px-1">
		<label for="{uid}-line" class="text-sm font-medium">{m.get_data_line_at_level()}</label>
		<select
			id="{uid}-line"
			value={onScale ? saved : ""}
			aria-describedby={missing ? `${uid}-missing` : undefined}
			onchange={(e) => onthreshold(e.currentTarget.value || null)}
			class="border-input bg-card text-field h-8 max-w-full min-w-0 rounded-(--radius-control) border px-2 md:text-sm"
		>
			<option value="">{m.get_data_off()}</option>
			{#each levels as level (level.key)}
				<option value={level.key}>{level.label}</option>
			{/each}
		</select>
		{#if missing}
			<p id="{uid}-missing" class="text-muted-foreground text-xs">
				{m.chart_level_line_missing()}
			</p>
		{/if}
	</div>
{/if}
