<script lang="ts">
	import type { Level } from "$lib/data/dataset-rules";
	import type { Layer } from "$lib/data/schema";
	import { m } from "$lib/paraglide/messages.js";
	import Toggletip from "$lib/components/Toggletip.svelte";
	import { LEVEL_LOWER } from "./level-phrases";
	import type { ResolutionChoice } from "./resolution-offer";

	let {
		choices,
		value,
		datasetLabel,
		note,
		onchange
	}: {
		choices: ResolutionChoice[];
		value: "auto" | Level;
		/** A layer's dataset name (the catalog's label), for a greyed level's reason. */
		datasetLabel: (layer: Layer) => string;
		/** Why Automatic moved above the range's level, when it did. */
		note?: string;
		onchange: (level: "auto" | Level) => void;
	} = $props();

	const uid = $props.id();

	const LABEL: Record<ResolutionChoice["level"], () => string> = {
		auto: () => m.get_data_resolution_auto(),
		raw: () => m.get_data_resolution_raw(),
		hour: () => m.get_data_resolution_hour(),
		day: () => m.get_data_resolution_day(),
		month: () => m.get_data_resolution_month(),
		year: () => m.get_data_resolution_year()
	};

	function reason(choice: ResolutionChoice): string {
		const blocked = choice.blocked;
		if (blocked === "too-many-points") return m.get_data_resolution_too_many();
		if (blocked && choice.level !== "auto") {
			const dataset = datasetLabel(blocked.notOffered);
			return choice.level === "raw"
				? m.get_data_resolution_not_offered_raw({ dataset })
				: m.get_data_resolution_not_offered({ dataset, level: LEVEL_LOWER[choice.level]() });
		}
		return "";
	}
</script>

<section class="flex flex-col gap-2" aria-labelledby="{uid}-heading">
	<!-- The help button sits beside the heading, outside the group's name. -->
	<div class="flex items-center gap-1">
		<h2 id="{uid}-heading" class="text-primary text-sm font-semibold">
			{m.get_data_resolution()}
		</h2>
		<Toggletip label={m.get_data_resolution_help_label()} text={m.get_data_resolution_help()} />
	</div>
	<fieldset class="flex flex-col gap-1 px-1" aria-labelledby="{uid}-heading">
		{#each choices as choice (choice.level)}
			{@const reasonId = `${uid}-${choice.level}-reason`}
			{@const checked = value === choice.level}
			<div class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
				<label class="flex items-center gap-2">
					<!-- A chosen level stays chosen (and focusable) when it's blocked: it never changes
					     by itself, and its reason says why it can't be used. -->
					<input
						type="radio"
						class="accent-primary size-4"
						name="{uid}-resolution"
						value={choice.level}
						{checked}
						disabled={!!choice.blocked && !checked}
						aria-describedby={choice.blocked ? reasonId : undefined}
						onchange={() => onchange(choice.level)}
					/>
					<span class={[choice.blocked && "text-muted-foreground"]}>
						{LABEL[choice.level]()}
					</span>
				</label>
				{#if choice.blocked}
					<span
						id={reasonId}
						class={["text-xs", checked ? "text-destructive" : "text-muted-foreground"]}
					>
						{reason(choice)}
					</span>
				{/if}
			</div>
		{/each}
	</fieldset>
	<!-- Always mounted, so a new note is announced. -->
	<p
		role="status"
		class={["text-muted-foreground text-xs", !note && "sr-only"]}
		data-testid="resolution-note"
	>
		{note ?? ""}
	</p>
</section>
