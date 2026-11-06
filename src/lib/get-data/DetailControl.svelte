<script lang="ts">
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import { Collapsible } from "bits-ui";
	import type { Resolution } from "$lib/data/schema";
	import { m } from "$lib/paraglide/messages.js";
	import type { DetailChoice } from "./resolution-offer";

	let {
		choices,
		value,
		onchange
	}: {
		choices: DetailChoice[];
		value: "auto" | Resolution;
		onchange: (level: "auto" | Resolution) => void;
	} = $props();

	const uid = $props.id();

	const LABEL: Record<string, () => string> = {
		auto: () => m.get_data_detail_auto(),
		raw: () => m.get_data_detail_raw(),
		hour: () => m.get_data_detail_hour(),
		day: () => m.get_data_detail_day(),
		month: () => m.get_data_detail_month()
	};
	const REASON: Record<NonNullable<DetailChoice["blocked"]>, () => string> = {
		"too-many-points": () => m.get_data_detail_too_many()
	};
</script>

<!-- Collapsed by default: the teacher never needs it. -->
<Collapsible.Root class="flex flex-col gap-2">
	<h2>
		<Collapsible.Trigger
			class="hover:bg-secondary text-primary flex min-h-8 w-full items-center gap-2 rounded-(--radius-control) px-1 text-left text-sm font-semibold [&[data-state=open]>svg]:rotate-180"
		>
			<span class="flex-1">{m.get_data_more_options()}</span>
			<ChevronDownIcon
				class="text-muted-foreground duration-fast ease-standard size-4 transition-transform"
				aria-hidden="true"
			/>
		</Collapsible.Trigger>
	</h2>
	<Collapsible.Content>
		<fieldset class="flex flex-col gap-1 px-1">
			<legend class="mb-1 text-sm font-medium">{m.get_data_detail()}</legend>
			{#each choices as choice (choice.level)}
				{@const reasonId = `${uid}-${choice.level}-reason`}
				<div class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
					<label class="flex items-center gap-2">
						<input
							type="radio"
							class="accent-primary size-4"
							name="{uid}-detail"
							value={choice.level}
							checked={value === choice.level}
							disabled={!!choice.blocked}
							aria-describedby={choice.blocked ? reasonId : undefined}
							onchange={() => onchange(choice.level)}
						/>
						<span class={[choice.blocked && "text-muted-foreground"]}>
							{LABEL[choice.level]?.() ?? choice.level}
						</span>
					</label>
					{#if choice.blocked}
						<span id={reasonId} class="text-muted-foreground text-xs">
							{REASON[choice.blocked]()}
						</span>
					{/if}
				</div>
			{/each}
		</fieldset>
	</Collapsible.Content>
</Collapsible.Root>
