<script lang="ts">
	import { untrack } from "svelte";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import Plus from "@lucide/svelte/icons/plus";
	import XIcon from "@lucide/svelte/icons/x";
	import { Collapsible } from "bits-ui";
	import { buttonVariants } from "$lib/components/ui/button";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import { FilterGone, filterSummary } from "./sources";
	import type { EntryTypeMeta } from "$lib/data/metadata";
	import type { Layer, PesticideFilters as Filters } from "$lib/data/schema";
	import { m } from "$lib/paraglide/messages.js";
	import { cn } from "$lib/utils.js";
	import PesticideFilters from "./PesticideFilters.svelte";

	let {
		entryTypes,
		layers,
		blocked,
		canRemove,
		onadd,
		onremove,
		onfilters
	}: {
		/** The measures a layer can show (pounds applied, acres treated, applications). */
		entryTypes: EntryTypeMeta[];
		/** The widget's pesticide layers, with their index among all layers. */
		layers: { index: number; layer: Layer }[];
		/** Why no layer can be added (the overlay limit), if none can. */
		blocked: string | undefined;
		canRemove: (index: number) => boolean;
		onadd: (entryType: string) => void;
		onremove: (index: number) => void;
		onfilters: (index: number, filters: Filters) => void;
	} = $props();

	const uid = $props.id();

	const labelOf = (layer: Layer) =>
		entryTypes.find((e) => e.id === layer.entryType)?.label ?? layer.entryType ?? "";

	// Each layer's summary line ("Carcinogens · Grapes"), by its filters.
	let summaries = $state<Record<string, string>>({});
	$effect(() => {
		const controller = new AbortController();
		for (const { layer } of layers) {
			const key = JSON.stringify(layer.filters ?? {});
			if (untrack(() => key in summaries)) continue;
			filterSummary(layer.filters, controller.signal).then(
				(labels) => {
					summaries[key] =
						labels.length === 0
							? m.get_data_pesticide_all()
							: labels.reduce((line, label) => m.chart_strip_key({ layer: line, source: label }));
				},
				(error: unknown) => {
					if (error instanceof FilterGone) summaries[key] = m.data_unavailable_filter_gone();
				}
			);
		}
		return () => controller.abort();
	});
	const summaryOf = (layer: Layer) =>
		layer.filters ? summaries[JSON.stringify(layer.filters)] : m.get_data_pesticide_all();

	const blockedId = `${uid}-blocked`;
</script>

<div class="flex flex-col gap-2">
	{#if layers.length > 0}
		<ul class="flex flex-col gap-2" aria-label={m.get_data_pesticide_layers()}>
			{#each layers as { index, layer } (index)}
				{@const label = labelOf(layer)}
				{@const summary = summaryOf(layer) ?? ""}
				{@const removable = canRemove(index)}
				<li class="border-card-border flex flex-col gap-1 rounded-(--radius-control) border p-2">
					<div class="flex items-start gap-2">
						<span class="flex min-w-0 flex-1 flex-col text-sm">
							<span class="font-medium">{label}</span>
							<span class="text-muted-foreground text-xs" data-testid="pesticide-summary">
								{summary}
							</span>
						</span>
						<button
							type="button"
							class="text-muted-foreground hover:bg-secondary focus-visible:outline-ring inline-flex size-8 shrink-0 items-center justify-center rounded-(--radius-control) focus-visible:outline-2 disabled:opacity-50"
							aria-label={m.get_data_pesticide_remove({
								layer: summary ? m.chart_strip_key({ layer: label, source: summary }) : label
							})}
							disabled={!removable}
							aria-describedby={removable ? undefined : `${uid}-${index}-keep`}
							onclick={() => onremove(index)}
						>
							<XIcon class="size-4" aria-hidden="true" />
						</button>
					</div>
					{#if !removable}
						<span id="{uid}-{index}-keep" class="text-muted-foreground text-xs">
							{m.get_data_keep_one()}
						</span>
					{/if}
					<Collapsible.Root>
						<Collapsible.Trigger
							class="hover:bg-secondary flex min-h-8 items-center gap-1 rounded-(--radius-control) px-1 text-sm font-medium [&[data-state=open]>svg]:rotate-180"
						>
							{m.get_data_narrow_down()}
							<ChevronDownIcon
								class="text-muted-foreground duration-fast ease-standard size-4 transition-transform"
								aria-hidden="true"
							/>
						</Collapsible.Trigger>
						<Collapsible.Content class="pt-2">
							<PesticideFilters
								filters={layer.filters}
								onchange={(filters) => onfilters(index, filters)}
							/>
						</Collapsible.Content>
					</Collapsible.Root>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="flex flex-wrap items-center gap-x-2">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				class={cn(buttonVariants({ variant: "outline", size: "sm" }))}
				disabled={blocked !== undefined}
				aria-describedby={blocked ? blockedId : undefined}
			>
				<Plus aria-hidden="true" />
				{layers.length > 0 ? m.get_data_pesticide_add() : m.get_data_pesticide_add_first()}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="start" class="min-w-48">
				{#each entryTypes as entry (entry.id)}
					<DropdownMenu.Item onSelect={() => onadd(entry.id)}>{entry.label}</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		{#if blocked}
			<span id={blockedId} class="text-muted-foreground text-xs">{blocked}</span>
		{/if}
	</div>
</div>
