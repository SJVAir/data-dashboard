<script lang="ts">
	import { Accordion } from "bits-ui";
	import type { CatalogEntry } from "$lib/data/metadata";
	import type { Layer, PesticideFilters, WidgetDataConfig } from "$lib/data/schema";
	import Toggletip from "$lib/components/Toggletip.svelte";
	import { AIR_QUALITY, isPollutantLayer } from "$lib/data/layer-kind";
	import { formatList, formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { mainLayer } from "$lib/widgets/shared/input";
	import AirQualitySection from "./AirQualitySection.svelte";
	import { canAddLayer, PESTICIDES, WEATHER, type EntryPick } from "./layers";
	import type { OfferedDataset } from "./offer";
	import PesticideLayers from "./PesticideLayers.svelte";
	import SectionTrigger from "./SectionTrigger.svelte";
	import StationChoice from "./StationChoice.svelte";

	const SMOKE = "hms-smoke";

	let {
		sections,
		data,
		catalog,
		places,
		limit,
		maxOverlays,
		onpollutant,
		onmonitortypes,
		onmonitors,
		ontoggle,
		onaddpesticide,
		onremove,
		onfilters,
		onstation,
		blocked
	}: {
		/** The offered datasets, each with at least one entry type. */
		sections: OfferedDataset[];
		/** The draft's data (plain). */
		data: WidgetDataConfig;
		catalog: CatalogEntry[];
		/** How many places the widget has (the station choice shows for one). */
		places: number;
		/** How many places the widget type takes (`placeLimit`): 1 offers one monitor, no types. */
		limit: number;
		maxOverlays: number;
		/** A pollutant, or `null` for None. */
		onpollutant: (pick: EntryPick | null) => void;
		/** The ticked monitor types after a change (Air quality). */
		onmonitortypes: (types: string[]) => void;
		/** The searched monitors after a change (Air quality). */
		onmonitors: (ids: string[]) => void;
		/** A weather, smoke or forecast layer on or off. */
		ontoggle: (pick: EntryPick, on: boolean) => void;
		onaddpesticide: (entryType: string) => void;
		onremove: (index: number) => void;
		onfilters: (index: number, filters: PesticideFilters) => void;
		onstation: (station: string | undefined) => void;
		/**
		 * Why a dataset (its layers) can't be chosen at the data resolution, or undefined; `without`
		 * is the layer it would replace (the pollutant chosen now).
		 */
		blocked?: (candidate: Layer[], without?: Layer) => string | undefined;
	} = $props();

	const uid = $props.id();

	const main = $derived(mainLayer(data, catalog));
	// An air-quality layer the catalog doesn't know is still the pollutant (no radio, not None).
	const pollutantAt = $derived(data.layers.findIndex((l) => isPollutantLayer(l, catalog)));
	const pollutant = $derived(pollutantAt >= 0 ? data.layers[pollutantAt] : undefined);

	// The main layer's section starts open (Air Quality).
	// svelte-ignore state_referenced_locally
	let open = $state<string[]>(
		main ? [main.dataset] : sections.slice(0, 1).map((s) => s.dataset.id)
	);

	const isOn = (p: EntryPick) =>
		data.layers.some((l) => l.dataset === p.dataset && l.entryType === p.entryType);
	const atCap = $derived(!canAddLayer(data, catalog));
	const limitText = $derived(
		m.get_data_overlay_limit({ count: formatNumber(maxOverlays), countValue: maxOverlays })
	);

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
		// Two pesticide layers of one measure (different filters) name it once.
		return formatList([...new Set(labels)]);
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
			<SectionTrigger label={section.dataset.label} detail={summary} />
			<Accordion.Content class="flex flex-col gap-2 px-2 pb-2">
				{#if section.dataset.description || id === SMOKE || id === PESTICIDES}
					<div class="flex items-start gap-1">
						{#if section.dataset.description}
							<p class="text-muted-foreground flex-1 text-xs">{section.dataset.description}</p>
						{:else}
							<span class="flex-1"></span>
						{/if}
						{#if id === SMOKE}
							<Toggletip label={m.get_data_smoke_help_label()} text={m.get_data_smoke_help()} />
						{:else if id === PESTICIDES}
							<Toggletip
								label={m.get_data_pesticide_help_label()}
								text={m.get_data_pesticide_help()}
							/>
						{/if}
					</div>
				{/if}
				{#if id === AIR_QUALITY}
					<AirQualitySection
						{data}
						{catalog}
						{limit}
						{pollutants}
						pollutantReason={(entry) =>
							blocked?.([{ dataset: id, entryType: entry.id }], pollutant)}
						capText={atCap ? limitText : undefined}
						{onpollutant}
						ontypes={onmonitortypes}
						{onmonitors}
					/>
				{:else if pollutants.length}
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
									onchange={() => onpollutant(null)}
								/>
								<span>{m.get_data_none()}</span>
							</label>
						</div>
						{#each pollutants as entry (entry.id)}
							{@const checked = pollutant?.dataset === id && pollutant.entryType === entry.id}
							{@const why =
								checked || addBlocked
									? undefined
									: blocked?.([{ dataset: id, entryType: entry.id }], pollutant)}
							{@const whyId = `${uid}-${id}-${entry.id}-reason`}
							<div class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
								<label class="flex items-center gap-2">
									<input
										type="radio"
										class="accent-primary size-4"
										name="{uid}-pollutant"
										value={entry.id}
										{checked}
										disabled={addBlocked || !!why}
										aria-describedby={addBlocked ? addReasonId : why ? whyId : undefined}
										onchange={() => onpollutant({ dataset: id, entryType: entry.id })}
									/>
									<span class={[(addBlocked || why) && "text-muted-foreground"]}>{entry.label}</span
									>
								</label>
								{#if why}
									{@render reason(whyId, why)}
								{/if}
							</div>
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
							{@const why = on || capped ? undefined : blocked?.([pick])}
							{@const reasonId = `${uid}-${id}-${entry.id}-reason`}
							<div class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
								<label class="flex items-center gap-2">
									<input
										type="checkbox"
										class="accent-primary size-4"
										checked={on}
										disabled={capped || !!why}
										aria-describedby={capped || why ? reasonId : undefined}
										onchange={(e) => ontoggle(pick, e.currentTarget.checked)}
									/>
									<span class={[(capped || why) && "text-muted-foreground"]}>{entry.label}</span>
								</label>
								{#if capped}
									{@render reason(reasonId, limitText)}
								{:else if why}
									{@render reason(reasonId, why)}
								{/if}
							</div>
						{/each}
					</fieldset>
				{/if}
				{#if id === WEATHER && weatherLayers.length > 0 && places === 1 && main}
					<StationChoice where={data} value={station} onchange={onstation} />
				{/if}
				{#if id === PESTICIDES}
					<PesticideLayers
						entryTypes={section.layerTypes}
						layers={pesticideLayers}
						blocked={atCap
							? limitText
							: blocked?.(
									section.layerTypes.slice(0, 1).map((e) => ({ dataset: id, entryType: e.id }))
								)}
						onadd={onaddpesticide}
						{onremove}
						{onfilters}
					/>
				{/if}
			</Accordion.Content>
		</Accordion.Item>
	{/each}
</Accordion.Root>
