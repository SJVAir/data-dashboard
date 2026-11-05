<script lang="ts">
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import { Accordion } from "bits-ui";
	import { formatList, formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import type { OfferedDataset } from "./offer";

	type EntryPick = { dataset: string; entryType: string };

	let {
		sections,
		main,
		overlays,
		maxOverlays,
		onmain,
		ontoggle
	}: {
		/** The offered datasets, each with at least one entry type. */
		sections: OfferedDataset[];
		/** The main (pollutant) layer's pick: a single required choice. */
		main: EntryPick | undefined;
		overlays: EntryPick[];
		maxOverlays: number;
		onmain: (pick: EntryPick) => void;
		ontoggle: (pick: EntryPick, on: boolean) => void;
	} = $props();

	const uid = $props.id();

	// The main layer's section starts open (Air Quality).
	// svelte-ignore state_referenced_locally
	let open = $state<string[]>(
		main ? [main.dataset] : sections.slice(0, 1).map((s) => s.dataset.id)
	);

	const isOverlay = (p: EntryPick) =>
		overlays.some((o) => o.dataset === p.dataset && o.entryType === p.entryType);
	const atCap = $derived(overlays.length >= maxOverlays);
	const limitText = $derived(
		m.get_data_overlay_limit({ count: formatNumber(maxOverlays), countValue: maxOverlays })
	);

	/** What's chosen in a section, for its heading (so a closed section still says). */
	function chosen(section: OfferedDataset): string {
		const id = section.dataset.id;
		const labels = section.entryTypes
			.filter(
				(e) =>
					(main?.dataset === id && main.entryType === e.id) ||
					isOverlay({ dataset: id, entryType: e.id })
			)
			.map((e) => e.label);
		return formatList(labels);
	}
</script>

<Accordion.Root type="multiple" bind:value={open} class="flex flex-col gap-2">
	{#each sections as section (section.dataset.id)}
		{@const id = section.dataset.id}
		{@const pollutants = section.entryTypes.filter((e) => e.kind === "pollutant")}
		{@const others = section.entryTypes.filter((e) => e.kind !== "pollutant")}
		{@const summary = chosen(section)}
		<Accordion.Item value={id} class="border-card-border rounded-(--radius-control) border">
			<Accordion.Header level={3}>
				<Accordion.Trigger
					class="hover:bg-secondary flex min-h-8 w-full items-center gap-2 rounded-(--radius-control) px-2 py-1 text-left text-sm font-medium [&[data-state=open]>svg]:rotate-180"
				>
					<span class="flex min-w-0 flex-1 flex-col">
						<span>{section.dataset.label}</span>
						{#if summary}
							<span class="text-muted-foreground text-xs font-normal">{summary}</span>
						{/if}
					</span>
					<ChevronDownIcon
						class="text-muted-foreground duration-fast ease-standard size-4 shrink-0 transition-transform"
						aria-hidden="true"
					/>
				</Accordion.Trigger>
			</Accordion.Header>
			<Accordion.Content class="flex flex-col gap-2 px-2 pb-2">
				{#if section.dataset.description}
					<p class="text-muted-foreground text-xs">{section.dataset.description}</p>
				{/if}
				{#if pollutants.length}
					<fieldset class="flex flex-col gap-1">
						<legend class="sr-only">{section.dataset.label}</legend>
						{#each pollutants as entry (entry.id)}
							<label class="flex min-h-6 items-center gap-2 text-sm">
								<input
									type="radio"
									class="accent-primary size-4"
									name="{uid}-main"
									value={entry.id}
									checked={main?.dataset === id && main.entryType === entry.id}
									onchange={() => onmain({ dataset: id, entryType: entry.id })}
								/>
								{entry.label}
							</label>
						{/each}
					</fieldset>
				{/if}
				{#if others.length}
					<fieldset class="flex flex-col gap-1">
						<legend class="text-muted-foreground text-xs">{m.get_data_overlays()}</legend>
						{#each others as entry (entry.id)}
							{@const pick = { dataset: id, entryType: entry.id }}
							{@const on = isOverlay(pick)}
							{@const blocked = !on && atCap}
							{@const reasonId = `${uid}-${id}-${entry.id}-reason`}
							<div class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
								<label class="flex items-center gap-2">
									<input
										type="checkbox"
										class="accent-primary size-4"
										checked={on}
										disabled={blocked}
										aria-describedby={blocked ? reasonId : undefined}
										onchange={(e) => ontoggle(pick, e.currentTarget.checked)}
									/>
									<span class={[blocked && "text-muted-foreground"]}>{entry.label}</span>
								</label>
								{#if blocked}
									<span id={reasonId} class="text-muted-foreground text-xs">{limitText}</span>
								{/if}
							</div>
						{/each}
					</fieldset>
				{/if}
			</Accordion.Content>
		</Accordion.Item>
	{/each}
</Accordion.Root>
