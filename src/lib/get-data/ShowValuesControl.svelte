<script lang="ts">
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import { Collapsible } from "bits-ui";
	import type { Snippet } from "svelte";
	import type { Resolution } from "$lib/data/schema";
	import { m } from "$lib/paraglide/messages.js";
	import Toggletip from "$lib/components/Toggletip.svelte";
	import type { DetailChoice } from "./resolution-offer";

	let {
		choices,
		value,
		onchange,
		children
	}: {
		choices: DetailChoice[];
		value: "auto" | Resolution;
		onchange: (level: "auto" | Resolution) => void;
		/** More options that follow Show values (a Chart's threshold line). */
		children?: Snippet;
	} = $props();

	const uid = $props.id();

	const LABEL: Record<string, () => string> = {
		auto: () => m.get_data_show_values_auto(),
		raw: () => m.get_data_show_values_raw(),
		hour: () => m.get_data_show_values_hour(),
		day: () => m.get_data_show_values_day(),
		month: () => m.get_data_show_values_month(),
		year: () => m.get_data_show_values_year()
	};
	const REASON: Record<NonNullable<DetailChoice["blocked"]>, () => string> = {
		"too-many-points": () => m.get_data_show_values_too_many()
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
	<Collapsible.Content class="flex flex-col gap-3">
		<!-- Named by its heading text alone: the help button sits beside it, outside the name. -->
		<fieldset class="flex flex-col gap-1 px-1" aria-labelledby="{uid}-detail-label">
			<div class="mb-1 flex items-center gap-1 text-sm font-medium">
				<span id="{uid}-detail-label">{m.get_data_show_values()}</span>
				<Toggletip
					label={m.get_data_show_values_help_label()}
					text={m.get_data_show_values_help()}
				/>
			</div>
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
		{@render children?.()}
	</Collapsible.Content>
</Collapsible.Root>
