<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import type { EntryTypeMeta, Level } from "$lib/data/metadata";
	import { m } from "$lib/paraglide/messages.js";
	import { resolveThreshold } from "$lib/thresholds/levels";
	import type { Threshold } from "$lib/thresholds/schema";

	let {
		pollutants,
		entryType,
		levels,
		thresholds,
		onpollutant,
		onthreshold,
		onretry
	}: {
		/** Current conditions' pollutant choices; `null` shows no pollutant control. */
		pollutants: EntryTypeMeta[] | null;
		entryType: string | undefined;
		/**
		 * The pollutant's scale for the alert level; `null` shows no alert level (a type without
		 * thresholds, a scale with no levels, or one still loading); `"unavailable"` when it couldn't
		 * be loaded (the saved alert level is kept meanwhile).
		 */
		levels: Level[] | "unavailable" | null;
		thresholds: Threshold[] | undefined;
		onpollutant: (entryType: string) => void;
		/** A level key, or `null` for Off. */
		onthreshold: (level: string | null) => void;
		/** Loads the scale again after it couldn't be. */
		onretry: () => void;
	} = $props();

	const uid = $props.id();

	const resolved = $derived(Array.isArray(levels) ? resolveThreshold(thresholds, levels) : null);
</script>

{#if pollutants}
	<fieldset class="flex flex-col gap-1">
		<legend class="mb-1 text-sm font-medium">{m.get_data_pollutant()}</legend>
		{#each pollutants as entry (entry.id)}
			<label class="flex min-h-6 items-center gap-2 text-sm">
				<input
					type="radio"
					class="accent-primary size-4"
					name="{uid}-pollutant"
					value={entry.id}
					checked={entry.id === entryType}
					onchange={() => onpollutant(entry.id)}
				/>
				<span>{entry.label}</span>
			</label>
		{/each}
	</fieldset>
{/if}

{#if levels === "unavailable"}
	<div class="flex flex-wrap items-center gap-2">
		<p role="status" class="text-sm">{m.get_data_levels_unavailable()}</p>
		<Button variant="outline" size="sm" onclick={onretry}>{m.get_data_retry()}</Button>
	</div>
{:else if levels && levels.length > 0}
	<div class="flex flex-col gap-1">
		<label for="{uid}-alert" class="text-sm font-medium">{m.get_data_alert_level()}</label>
		<select
			id="{uid}-alert"
			value={resolved?.level.key ?? ""}
			aria-describedby={resolved?.fellBack ? `${uid}-fell-back` : undefined}
			onchange={(e) => onthreshold(e.currentTarget.value || null)}
			class="border-input bg-card text-field h-8 max-w-full min-w-0 rounded-(--radius-control) border px-2 md:text-sm"
		>
			<option value="">{m.get_data_off()}</option>
			{#each levels as level (level.key)}
				<option value={level.key}
					>{m.get_data_tell_me_at_level_or_worse({ level: level.label })}</option
				>
			{/each}
		</select>
		{#if resolved?.fellBack}
			<p id="{uid}-fell-back" class="text-muted-foreground text-xs">
				{m.get_data_alert_level_replaced({ level: resolved.level.label })}
			</p>
		{/if}
	</div>
{/if}
