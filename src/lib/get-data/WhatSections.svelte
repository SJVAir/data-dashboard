<script lang="ts">
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import { Accordion } from "bits-ui";
	import type { CatalogEntry } from "$lib/data/metadata";
	import type { PesticideFilters, WidgetDataConfig } from "$lib/data/schema";
	import { layerKind } from "$lib/data/layer-kind";
	import { formatList, formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { mainLayer } from "$lib/widgets/shared/input";
	import {
		canAddLayer,
		canRemoveLayer,
		numberLayers,
		PESTICIDES,
		WEATHER,
		type EntryPick
	} from "./layers";
	import type { OfferedDataset } from "./offer";
	import PesticideLayers from "./PesticideLayers.svelte";
	import StationChoice from "./StationChoice.svelte";

	let {
		sections,
		data,
		catalog,
		places,
		maxOverlays,
		onpollutant,
		ontoggle,
		onaddpesticide,
		onremove,
		onfilters,
		onstation
	}: {
		/** The offered datasets, each with at least one entry type. */
		sections: OfferedDataset[];
		/** The draft's data (plain). */
		data: WidgetDataConfig;
		catalog: CatalogEntry[];
		/** How many places the widget has (the station choice shows for one). */
		places: number;
		maxOverlays: number;
		/** A pollutant, or `null` for None. */
		onpollutant: (pick: EntryPick | null) => void;
		/** A weather, smoke or forecast layer on or off. */
		ontoggle: (pick: EntryPick, on: boolean) => void;
		onaddpesticide: (entryType: string) => void;
		onremove: (index: number) => void;
		onfilters: (index: number, filters: PesticideFilters) => void;
		onstation: (station: string | undefined) => void;
	} = $props();

	const uid = $props.id();

	const main = $derived(mainLayer(data, catalog));
	const pollutantAt = $derived(data.layers.findIndex((l) => layerKind(l, catalog) === "pollutant"));
	const pollutant = $derived(pollutantAt >= 0 ? data.layers[pollutantAt] : undefined);

	// The main layer's section starts open (Air Quality).
	// svelte-ignore state_referenced_locally
	let open = $state<string[]>(
		main ? [main.dataset] : sections.slice(0, 1).map((s) => s.dataset.id)
	);

	const isOn = (p: EntryPick) =>
		data.layers.some((l) => l.dataset === p.dataset && l.entryType === p.entryType);
	const indexOf = (p: EntryPick) =>
		data.layers.findIndex((l) => l.dataset === p.dataset && l.entryType === p.entryType);
	const atCap = $derived(!canAddLayer(data, catalog));
	const limitText = $derived(
		m.get_data_overlay_limit({ count: formatNumber(maxOverlays), countValue: maxOverlays })
	);
	/** "None" would leave no number layer. */
	const noneBlocked = $derived(pollutant !== undefined && numberLayers(data, catalog) <= 1);

	const weatherLayers = $derived(data.layers.filter((l) => l.dataset === WEATHER));
	const station = $derived(weatherLayers.find((l) => l.station)?.station);
	const pesticideLayers = $derived(
		data.layers
			.map((layer, index) => ({ layer, index }))
			.filter(({ layer }) => layer.dataset === PESTICIDES && layer.entryType)
	);

	/**
	 * A section's checkboxes: its stand-alone and overlay choices, plus any already chosen (checked,
	 * so it can be removed), in catalog order.
	 */
	function checkboxesIn(section: OfferedDataset) {
		const id = section.dataset.id;
		return section.dataset.entryTypes.filter(
			(e) =>
				e.kind !== "pollutant" &&
				(section.layerTypes.includes(e) ||
					section.overlayTypes.includes(e) ||
					isOn({ dataset: id, entryType: e.id }))
		);
	}

	/** What's chosen in a section, for its heading (so a closed section still says). */
	function chosen(section: OfferedDataset): string {
		const id = section.dataset.id;
		const labels = data.layers
			.filter((l) => l.dataset === id)
			.map((l) => section.dataset.entryTypes.find((e) => e.id === l.entryType)?.label)
			.filter((label): label is string => label !== undefined);
		return formatList(labels);
	}
</script>

{#snippet reason(id: string, text: string)}
	<span {id} class="text-muted-foreground text-xs">{text}</span>
{/snippet}

<Accordion.Root type="multiple" bind:value={open} class="flex flex-col gap-2">
	{#each sections as section (section.dataset.id)}
		{@const id = section.dataset.id}
		{@const pollutants = section.entryTypes.filter((e) => e.kind === "pollutant")}
		{@const boxes = id === PESTICIDES ? [] : checkboxesIn(section)}
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
					{@const addBlocked = !pollutant && atCap}
					{@const addReasonId = `${uid}-${id}-pollutant-reason`}
					<fieldset class="flex flex-col gap-1">
						<legend class="sr-only">{section.dataset.label}</legend>
						<div class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
							<label class="flex items-center gap-2">
								<input
									type="radio"
									class="accent-primary size-4"
									name="{uid}-pollutant"
									value=""
									checked={!pollutant}
									disabled={noneBlocked}
									aria-describedby={noneBlocked ? `${uid}-none-reason` : undefined}
									onchange={() => onpollutant(null)}
								/>
								<span class={[noneBlocked && "text-muted-foreground"]}>{m.get_data_none()}</span>
							</label>
							{#if noneBlocked}
								{@render reason(`${uid}-none-reason`, m.get_data_keep_one())}
							{/if}
						</div>
						{#each pollutants as entry (entry.id)}
							{@const checked = pollutant?.dataset === id && pollutant.entryType === entry.id}
							<label class="flex min-h-6 items-center gap-2 text-sm">
								<input
									type="radio"
									class="accent-primary size-4"
									name="{uid}-pollutant"
									value={entry.id}
									{checked}
									disabled={addBlocked}
									aria-describedby={addBlocked ? addReasonId : undefined}
									onchange={() => onpollutant({ dataset: id, entryType: entry.id })}
								/>
								<span class={[addBlocked && "text-muted-foreground"]}>{entry.label}</span>
							</label>
						{/each}
						{#if addBlocked}
							{@render reason(addReasonId, limitText)}
						{/if}
					</fieldset>
				{/if}
				{#if boxes.length}
					<fieldset class="flex flex-col gap-1">
						<legend class={pollutants.length ? "text-muted-foreground text-xs" : "sr-only"}>
							{pollutants.length ? m.get_data_overlays() : section.dataset.label}
						</legend>
						{#each boxes as entry (entry.id)}
							{@const pick = { dataset: id, entryType: entry.id }}
							{@const on = isOn(pick)}
							{@const capped = !on && atCap}
							{@const kept = on && !canRemoveLayer(data, catalog, indexOf(pick))}
							{@const reasonId = `${uid}-${id}-${entry.id}-reason`}
							<div class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
								<label class="flex items-center gap-2">
									<input
										type="checkbox"
										class="accent-primary size-4"
										checked={on}
										disabled={capped || kept}
										aria-describedby={capped || kept ? reasonId : undefined}
										onchange={(e) => ontoggle(pick, e.currentTarget.checked)}
									/>
									<span class={[(capped || kept) && "text-muted-foreground"]}>{entry.label}</span>
								</label>
								{#if capped}
									{@render reason(reasonId, limitText)}
								{:else if kept}
									{@render reason(reasonId, m.get_data_keep_one())}
								{/if}
							</div>
						{/each}
					</fieldset>
				{/if}
				{#if id === WEATHER && weatherLayers.length > 0 && places === 1 && main}
					<StationChoice place={main} value={station} onchange={onstation} />
				{/if}
				{#if id === PESTICIDES}
					<PesticideLayers
						entryTypes={section.layerTypes}
						layers={pesticideLayers}
						blocked={atCap ? limitText : undefined}
						canRemove={(index) => canRemoveLayer(data, catalog, index)}
						onadd={onaddpesticide}
						{onremove}
						{onfilters}
					/>
				{/if}
			</Accordion.Content>
		</Accordion.Item>
	{/each}
</Accordion.Root>
