<script module lang="ts">
	import type { Level } from "$lib/data/metadata";
	import type { Threshold } from "$lib/thresholds/schema";

	/** One pollutant's alert level. */
	export type NowAlert = {
		entryType: string;
		/** The pollutant's name (the catalog's). */
		label: string;
		/**
		 * The pollutant's scale; `null` shows no alert level (a scale with no levels, or one still
		 * loading); `"unavailable"` when it couldn't be loaded (the saved alert level is kept
		 * meanwhile).
		 */
		levels: Level[] | "unavailable" | null;
		/** The pollutant's saved alert level; undefined for Off. */
		threshold: Threshold | undefined;
	};
</script>

<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { m } from "$lib/paraglide/messages.js";
	import { resolveThreshold } from "$lib/thresholds/levels";

	/**
	 * A now type's alert levels, one per pollutant (its pollutants are chosen in What's Air quality
	 * section). One pollutant reads "Alert level"; several name each pollutant.
	 */
	let {
		alerts,
		onthreshold,
		onretry
	}: {
		alerts: NowAlert[];
		/** A pollutant's level key, or `null` for Off. */
		onthreshold: (entryType: string, level: string | null) => void;
		/** Loads a pollutant's scale again after it couldn't be. */
		onretry: (entryType: string) => void;
	} = $props();

	const uid = $props.id();

	const named = $derived(alerts.length > 1);
	const rows = $derived(
		alerts.map((alert) => ({
			...alert,
			resolved: Array.isArray(alert.levels)
				? resolveThreshold(alert.threshold ? [alert.threshold] : undefined, alert.levels)
				: null
		}))
	);
</script>

{#each rows as alert (alert.entryType)}
	{@const id = `${uid}-${alert.entryType}`}
	{@const label = named
		? m.get_data_alert_level_for({ pollutant: alert.label })
		: m.get_data_alert_level()}
	{#if alert.levels === "unavailable"}
		<div class="flex flex-col gap-1" role="group" aria-labelledby="{id}-label">
			<!-- One pollutant reads as before (no heading); its label still names the group. -->
			<p id="{id}-label" class={["text-sm font-medium", !named && "sr-only"]}>{label}</p>
			<div class="flex flex-wrap items-center gap-2">
				<p role="status" class="text-sm">{m.get_data_levels_unavailable()}</p>
				<Button variant="outline" size="sm" onclick={() => onretry(alert.entryType)}>
					{m.get_data_retry()}
				</Button>
			</div>
		</div>
	{:else if alert.levels && alert.levels.length > 0}
		<div class="flex flex-col gap-1">
			<label for="{id}-alert" class="text-sm font-medium">{label}</label>
			<select
				id="{id}-alert"
				value={alert.resolved?.level.key ?? ""}
				aria-describedby={alert.resolved?.fellBack ? `${id}-fell-back` : undefined}
				onchange={(e) => onthreshold(alert.entryType, e.currentTarget.value || null)}
				class="border-input bg-card text-field h-8 max-w-full min-w-0 rounded-(--radius-control) border px-2 md:text-sm"
			>
				<option value="">{m.get_data_off()}</option>
				{#each alert.levels as level (level.key)}
					<option value={level.key}
						>{m.get_data_tell_me_at_level_or_worse({ level: level.label })}</option
					>
				{/each}
			</select>
			{#if alert.resolved?.fellBack}
				{@const shown = alert.resolved.level}
				<div class="flex flex-wrap items-center gap-2">
					<p id="{id}-fell-back" class="text-muted-foreground text-xs">
						{m.get_data_alert_level_replaced({ level: shown.label })}
					</p>
					<!-- Keeps the level shown: saves it, so the note goes. -->
					<Button
						variant="outline"
						size="sm"
						onclick={() => onthreshold(alert.entryType, shown.key)}
					>
						{m.get_data_alert_level_use({ level: shown.label })}
					</Button>
				</div>
			{/if}
		</div>
	{/if}
{/each}
