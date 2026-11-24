<script lang="ts">
	import type { Level } from "$lib/data/dataset-rules";
	import type { Layer } from "$lib/data/schema";
	import { Accordion } from "bits-ui";
	import { m } from "$lib/paraglide/messages.js";
	import Toggletip from "$lib/components/Toggletip.svelte";
	import SectionTrigger from "./SectionTrigger.svelte";
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

	const checkedChoice = $derived(choices.find((c) => c.level === value));

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

<div class="flex flex-col gap-2">
	<Accordion.Root type="multiple" class="flex flex-col">
		<Accordion.Item value="resolution" class="flex flex-col gap-1">
			<!-- The help button sits beside the header, outside the trigger. -->
			<div class="flex items-center gap-1">
				<div class="[&_h2]:text-primary min-w-0 flex-1 [&_h2]:font-semibold">
					<SectionTrigger
						level={2}
						label={m.get_data_resolution()}
						detail={LABEL[value]?.()}
						warning={checkedChoice?.blocked ? reason(checkedChoice) : undefined}
					/>
				</div>
				<Toggletip label={m.get_data_resolution_help_label()} text={m.get_data_resolution_help()} />
			</div>
			<Accordion.Content>
				<fieldset class="flex flex-col gap-1 px-1" aria-label={m.get_data_resolution()}>
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
			</Accordion.Content>
		</Accordion.Item>
	</Accordion.Root>
	<!-- Always mounted, so a new note is announced. -->
	<p
		role="status"
		class={["text-muted-foreground text-xs", !note && "sr-only"]}
		data-testid="resolution-note"
	>
		{note ?? ""}
	</p>
</div>
