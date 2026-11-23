<script lang="ts">
	import { untrack } from "svelte";
	import { Accordion } from "bits-ui";
	import { Button } from "$lib/components/ui/button";
	import Toggletip from "$lib/components/Toggletip.svelte";
	import { noticeFiltersSkipped } from "$lib/data/adapters/pesticides";
	import { AIR_QUALITY, isPollutantLayer } from "$lib/data/layer-kind";
	import type { CatalogEntry, EntryTypeMeta, LocationGroup } from "$lib/data/metadata";
	import type { Layer, PesticideFilters as Filters, WidgetDataConfig } from "$lib/data/schema";
	import { formatList, formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import type { RegionTypeInfo } from "$lib/places/types";
	import { CURRENT_TYPE } from "$lib/widgets/current";
	import { OUTSIDE_TYPE } from "$lib/widgets/outside";
	import { FORECAST_TYPE } from "$lib/widgets/forecast";
	import {
		HMS_SMOKE,
		MAP_TYPE,
		PESTICIDE_NOTICES,
		PESTICIDE_USE,
		pollutantLayer
	} from "$lib/widgets/map/options";
	import type { WidgetType } from "$lib/widgets/registry";
	import { mainLayer } from "$lib/widgets/shared/input";
	import AirQualitySection from "./AirQualitySection.svelte";
	import { PESTICIDE_FILTER_NAMES } from "./filter-names";
	import { canAddLayer, WEATHER, type EntryPick } from "./layers";
	import { hasNotices, hasSmokeAndFire, hasUse, locationsLayer, mapPesticideFilters } from "./map";
	import { nowPollutants } from "./now";
	import type { OfferedDataset } from "./offer";
	import PesticideFilters from "./PesticideFilters.svelte";
	import PesticideLayers from "./PesticideLayers.svelte";
	import SectionTrigger from "./SectionTrigger.svelte";
	import { pesticideMeta } from "./sources";
	import StationChoice from "./StationChoice.svelte";
	import {
		FILL,
		LOCATIONS_GONE,
		sectionTypes,
		toggledLocationTypes,
		whatSections,
		type WhatSection
	} from "./what-sections";

	/**
	 * What, for every widget type (spec decision 16): one list of sections, in catalog order, the
	 * same for every type. A type shows the sections its `accepts.datasets` allow, and the Map its
	 * own (smoke and fire as one, spray notices, pesticide use, "Fill regions by"); any other is
	 * greyed out with the types that show it, never hidden. Each section keeps its type's own
	 * controls: the Map's notices and use share one filter set, a Chart's pesticide layers each have
	 * their own.
	 */
	let {
		type,
		types,
		sections,
		data,
		catalog,
		places,
		limit,
		maxOverlays,
		onpollutant,
		onnowpollutant,
		onnowpollutants,
		guidelines,
		onmonitortypes,
		onmonitors,
		ontoggle,
		onaddpesticide,
		onremove,
		onfilters,
		onstation,
		blocked,
		map
	}: {
		/** The draft's widget type. */
		type: WidgetType;
		/** Every type Get data offers (who shows a greyed section). */
		types: WidgetType[];
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
		/** "Can we go outside?"'s pollutant (its alert level follows it). */
		onnowpollutant: (entryType: string) => void;
		/** Current conditions' ticked pollutants, in the offered order (each has its alert level). */
		onnowpollutants: (entryTypes: string[]) => void;
		/** The ticked monitor types after a change (Air quality). */
		onmonitortypes: (types: string[]) => void;
		/** The searched monitors after a change (Air quality). */
		onmonitors: (ids: string[]) => void;
		/** A weather, smoke or forecast layer on or off. */
		ontoggle: (pick: EntryPick, on: boolean) => void;
		onaddpesticide: (entryType: string) => void;
		onremove: (index: number) => void;
		onfilters: (index: number, filters: Filters) => void;
		onstation: (station: string | undefined) => void;
		/**
		 * Why a dataset (its layers) can't be chosen at the data resolution, or undefined; `without`
		 * is the layer it would replace (the pollutant chosen now).
		 */
		blocked?: (candidate: Layer[], without?: Layer) => string | undefined;
		/**
		 * The pollutants with school guidelines, in the meta's order (what "Can we go outside?"
		 * offers); undefined while loading.
		 */
		guidelines?: EntryTypeMeta[];
		/** The Map's own sections' state and edits. */
		map: {
			/** The pollutants the Map offers, in order (the monitors meta's `available_pollutants`). */
			pollutants: EntryTypeMeta[];
			/** Smoke and fire on or off (both together). */
			onsmoke: (on: boolean) => void;
			/** Spray notices on or off. */
			onnotices: (on: boolean) => void;
			/** The pesticide filters chosen for the notices and use (the whole new set). */
			onfilters: (filters: Filters) => void;
			/**
			 * The years with use data (the pesticide meta's, newest first); undefined while loading,
			 * `"unavailable"` when they couldn't be loaded, empty when the server lists none.
			 */
			years: readonly number[] | "unavailable" | undefined;
			/** Pesticide use on or off. */
			onuse: (on: boolean) => void;
			/** Asks for the years again after they couldn't be loaded. */
			onretryyears: () => void;
			/** The region type saved as the fill (missing: none). */
			fill?: string;
			/** The types the directory offers; undefined while loading or when it failed (None only). */
			fillTypes?: RegionTypeInfo[];
			/** A fill chosen (a region type), or none (undefined). */
			onfill: (type: string | undefined) => void;
			/**
			 * The location groups (the regions meta's, by order), a section each; undefined while
			 * loading or when they couldn't be loaded (no location sections then).
			 */
			locationGroups?: LocationGroup[];
			/** The ticked location types after a change (in the meta's order; `[]`: none). */
			onlocations: (types: string[]) => void;
			/**
			 * Why smoke and fire, the notices or use can't be switched on at the Map's data resolution
			 * (or, for use, on Now); greyed with the reason, never hidden.
			 */
			blocks?: { smoke?: string; notices?: string; use?: string };
		};
	} = $props();

	const uid = $props.id();

	const isMap = $derived(type.type === MAP_TYPE);
	const list = $derived(whatSections(catalog, sections, data.layers, map.locationGroups));
	/** Why `key` is greyed out for this type: the types that show it; undefined when it shows. */
	function greyed(key: string): string | undefined {
		const showing = sectionTypes(key, types);
		if (showing.some((t) => t.type === type.type)) return undefined;
		return m.get_data_section_only_for({ types: formatList(showing.map((t) => t.label())) });
	}

	const main = $derived(mainLayer(data, catalog));
	// An air-quality layer the catalog doesn't know is still the pollutant (no radio, not None).
	const pollutantAt = $derived(data.layers.findIndex((l) => isPollutantLayer(l, catalog)));
	const pollutant = $derived(pollutantAt >= 0 ? data.layers[pollutantAt] : undefined);

	/** The sections a type starts with open: the Map's all (each short), else its main layer's. */
	function opened(of: WidgetType): string[] {
		const shown = list.filter((s) => !greyedFor(s.key, of)).map((s) => s.key);
		if (of.type === MAP_TYPE) return shown;
		if (of.type === FORECAST_TYPE) return [AIR_QUALITY];
		const first = main && shown.includes(main.dataset) ? main.dataset : shown[0];
		return first ? [first] : [];
	}
	const greyedFor = (key: string, of: WidgetType) =>
		!sectionTypes(key, types).some((t) => t.type === of.type);

	// svelte-ignore state_referenced_locally
	let open = $state<string[]>(opened(type));
	// Another type: its own sections open too; any it greys out close.
	let openFor = untrack(() => type.type);
	// A section listed later (the location groups load after the catalog) opens as it would have.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not rendered
	const seen = new Set(untrack(() => list.map((s) => s.key)));
	$effect(() => {
		const keys = list.map((s) => s.key);
		untrack(() => {
			const fresh = keys.filter((key) => !seen.has(key));
			if (!fresh.length) return;
			for (const key of fresh) seen.add(key);
			const opening = opened(type).filter((key) => fresh.includes(key) && !open.includes(key));
			if (opening.length) open = [...open, ...opening];
		});
	});
	$effect(() => {
		const next = type;
		if (next.type === openFor) return;
		openFor = next.type;
		untrack(() => {
			open = [...new Set([...open, ...opened(next)])].filter((key) => !greyedFor(key, next));
		});
	});

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
			.filter(({ layer }) => layer.dataset === PESTICIDE_USE && layer.entryType)
	);

	/** The pollutants this type offers (Current conditions' as checkboxes); `null` when none here. */
	const radios = $derived.by<EntryTypeMeta[] | null>(() => {
		if (isMap) {
			// The Map's offered pollutants, plus the chosen one when it isn't (checked, so it shows).
			const chosen = pollutantLayer(data, catalog)?.entryType;
			return [
				...map.pollutants,
				...nowPollutants(catalog).filter(
					(e) => e.id === chosen && !map.pollutants.some((o) => o.id === e.id)
				)
			];
		}
		if (type.type === CURRENT_TYPE) return nowPollutants(catalog);
		// "Can we go outside?" holds one pollutant with guidelines: radios from two up, none for one.
		if (type.type === OUTSIDE_TYPE) return guidelines && guidelines.length >= 2 ? guidelines : null;
		// The Forecast strip has no pollutant of its own.
		if (type.time === "now") return null;
		const offer = sections.find((s) => s.dataset.id === AIR_QUALITY);
		return offer?.entryTypes.filter((e) => e.kind === "pollutant") ?? [];
	});

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
	function chosen(section: WhatSection): string | undefined {
		if (section.key === FILL) return isMap ? fillShown?.plural : undefined;
		if (section.group) {
			const labels = section.group.types.filter((t) => ticked.includes(t.type)).map((t) => t.label);
			return formatList(labels) || undefined;
		}
		if (section.gone)
			return formatList(section.gone.filter((t) => ticked.includes(t))) || undefined;
		const entryTypes = section.entry?.entryTypes ?? [];
		const labels = data.layers
			.filter((l) => l.dataset === section.key)
			.map((l) => entryTypes.find((e) => e.id === l.entryType)?.label)
			.filter((label): label is string => label !== undefined);
		// Two pesticide layers of one measure (different filters) name it once.
		return formatList([...new Set(labels)]) || undefined;
	}

	/** A section's heading. */
	function labelOf(section: WhatSection): string {
		if (section.key === FILL) return m.getdata_map_fill();
		if (section.group) return section.group.label;
		if (section.key === LOCATIONS_GONE) return m.getdata_map_locations_gone();
		if (section.key === HMS_SMOKE && isMap) return m.get_data_smoke_and_fire();
		if (section.entry) return section.entry.label;
		if (section.key === HMS_SMOKE) return m.get_data_smoke_and_fire();
		if (section.key === PESTICIDE_NOTICES) {
			return m.getdata_map_section_fallback({ section: "notices" });
		}
		if (section.key === PESTICIDE_USE) return m.getdata_map_section_fallback({ section: "use" });
		return section.key;
	}

	// The Map's own sections.
	const smoke = $derived(hasSmokeAndFire(data));
	const notices = $derived(hasNotices(data));
	const use = $derived(hasUse(data));
	const listed = $derived(Array.isArray(map.years) ? map.years : []);
	const blocks = $derived(map.blocks ?? {});
	/** Why use can't be switched on: the years are known not to allow it, or the resolution. */
	const useBlocked = $derived(
		map.years === "unavailable"
			? m.getdata_map_use_years_unavailable()
			: Array.isArray(map.years) && map.years.length === 0
				? m.getdata_map_use_no_years()
				: blocks.use
	);
	const smokeBlocked = $derived(!smoke ? blocks.smoke : undefined);
	const noticesBlocked = $derived(!notices ? blocks.notices : undefined);
	/** The Map's one filter set, kept in step on both pesticide layers. */
	const noticeFiltersSaved = $derived(mapPesticideFilters(data));

	/** The filter params the notice endpoints take (the pesticides meta's); undefined until known. */
	let noticeFilters = $state.raw<readonly string[] | undefined>();
	$effect(() => {
		if (!isMap || !notices || noticeFilters) return;
		const controller = new AbortController();
		pesticideMeta(controller.signal).then(
			(meta) => (noticeFilters = meta.notice_filters),
			() => {
				// Unknown: nothing is named (the filters' own section says the meta didn't load).
			}
		);
		return () => controller.abort();
	});
	/** The saved filters the notices can't apply: still shown and kept, and named. */
	const noticesSkipped = $derived(
		notices && noticeFilters ? noticeFiltersSkipped(noticeFiltersSaved ?? {}, noticeFilters) : []
	);
	/** The locations layer's ticked types (saved order). */
	const ticked = $derived(locationsLayer(data)?.locationTypes ?? []);
	function tickLocation(locationType: string, on: boolean): void {
		map.onlocations(toggledLocationTypes(map.locationGroups ?? [], ticked, locationType, on));
	}
	const fillChoices = $derived(map.fillTypes ?? []);
	/** The saved fill, only while it's offered (else None shows; the saved value stays). */
	const fillShown = $derived(fillChoices.find((t) => t.type === map.fill));
</script>

{#snippet reason(id: string, text: string)}
	<span {id} class="text-muted-foreground text-xs">{text}</span>
{/snippet}

{#snippet description(text: string | undefined, help?: { label: string; text: string })}
	{#if text || help}
		<div class="flex items-start gap-1">
			{#if text}
				<p class="text-muted-foreground flex-1 text-xs">{text}</p>
			{:else}
				<span class="flex-1"></span>
			{/if}
			{#if help}
				<Toggletip label={help.label} text={help.text} />
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet checkboxes(section: OfferedDataset, legend: string, labelled: boolean)}
	{@const id = section.dataset.id}
	{@const boxes = checkboxesIn(section)}
	{#if boxes.length}
		<fieldset class="flex flex-col gap-1">
			<legend class={labelled ? "text-muted-foreground text-xs" : "sr-only"}>{legend}</legend>
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
{/snippet}

{#snippet filterSet()}
	<div role="group" aria-label={m.getdata_map_pesticide_filters()}>
		<PesticideFilters filters={noticeFiltersSaved} onchange={map.onfilters} />
		{#each noticesSkipped as key (key)}
			<p class="text-muted-foreground mt-2 text-xs" data-notices-skipped={key}>
				{m.getdata_map_notices_filter_skipped({ filter: PESTICIDE_FILTER_NAMES[key]() })}
			</p>
		{/each}
	</div>
{/snippet}

{#snippet airQuality(section: WhatSection)}
	{@render description(section.entry?.description)}
	{#if type.type === FORECAST_TYPE}
		<!-- A Forecast strip: one monitor, on its own forecasts layer (decision 11, R11). -->
		<AirQualitySection
			{data}
			{catalog}
			{limit}
			pollutants={null}
			strip
			{onpollutant}
			ontypes={onmonitortypes}
			{onmonitors}
		/>
	{:else if type.type === CURRENT_TYPE}
		<!-- Current conditions: a checkbox per pollutant, none greyed out (unticking the last is
		     allowed; the preview and Save then ask for one). -->
		<AirQualitySection
			{data}
			{catalog}
			{limit}
			pollutants={radios}
			multiple
			onpollutants={onnowpollutants}
			ontypes={onmonitortypes}
			{onmonitors}
		/>
	{:else if type.time !== "now" || main}
		<!-- A single-place type shows only the search: one monitor or one place (decision 33). -->
		<AirQualitySection
			{data}
			{catalog}
			{limit}
			pollutants={radios}
			none={type.type !== OUTSIDE_TYPE}
			pollutantReason={isMap
				? undefined
				: (entry) => blocked?.([{ dataset: AIR_QUALITY, entryType: entry.id }], pollutant)}
			capText={!isMap && atCap ? limitText : undefined}
			onpollutant={type.type === OUTSIDE_TYPE
				? (pick) => pick && onnowpollutant(pick.entryType)
				: onpollutant}
			ontypes={onmonitortypes}
			{onmonitors}
		/>
	{/if}
	{#if type.type === OUTSIDE_TYPE && guidelines?.length === 0}
		<!-- No pollutant has school guidelines: nothing to pick, and the widget says so too. -->
		<p class="text-muted-foreground text-sm" data-no-guidelines>
			{m.outside_no_guideline_pollutants()}
		</p>
	{/if}
	{#if section.offered && !isMap && type.time !== "now"}
		<!-- Air quality's other entry types (humidity), as overlays. -->
		{@render checkboxes(section.offered, m.get_data_overlays(), true)}
	{/if}
{/snippet}

{#snippet smokeSection(section: WhatSection)}
	{#if isMap}
		<div class="flex min-h-6 items-center gap-2 text-sm">
			<label class="flex flex-1 items-center gap-2">
				<input
					type="checkbox"
					class="accent-primary size-4"
					checked={smoke}
					disabled={!!smokeBlocked}
					aria-describedby={smokeBlocked ? `${uid}-smoke-blocked` : undefined}
					onchange={(e) => map.onsmoke(e.currentTarget.checked)}
				/>
				<span class={[smokeBlocked && "text-muted-foreground"]}>
					{m.get_data_smoke_and_fire()}
				</span>
			</label>
			<Toggletip label={m.get_data_map_smoke_help_label()} text={m.get_data_map_smoke_help()} />
		</div>
		{#if smokeBlocked}
			{@render reason(`${uid}-smoke-blocked`, smokeBlocked)}
		{/if}
	{:else if section.offered}
		{@render description(section.entry?.description, {
			label: m.get_data_smoke_help_label(),
			text: m.get_data_smoke_help()
		})}
		{@render checkboxes(section.offered, section.offered.dataset.label, false)}
	{/if}
{/snippet}

{#snippet noticesSection(section: WhatSection)}
	{@render description(section.entry?.description)}
	<div class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
		<label class="flex items-center gap-2">
			<input
				type="checkbox"
				role="switch"
				class="accent-primary size-4"
				checked={notices}
				disabled={!!noticesBlocked}
				aria-describedby={noticesBlocked ? `${uid}-notices-blocked` : undefined}
				onchange={(e) => map.onnotices(e.currentTarget.checked)}
			/>
			<span class={[noticesBlocked && "text-muted-foreground"]}>
				{m.getdata_map_notices_switch()}
			</span>
		</label>
		{#if noticesBlocked}
			{@render reason(`${uid}-notices-blocked`, noticesBlocked)}
		{/if}
	</div>
	<!-- With use on, the one filter set shows in its section. -->
	{#if notices && !use}
		{@render filterSet()}
	{/if}
{/snippet}

{#snippet useSection(section: WhatSection)}
	{#if isMap}
		{@render description(section.entry?.description)}
		<div class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					role="switch"
					class="accent-primary size-4"
					checked={use}
					disabled={!use && (listed.length === 0 || !!blocks.use)}
					aria-describedby={!use && useBlocked ? `${uid}-use-blocked` : undefined}
					onchange={(e) => map.onuse(e.currentTarget.checked)}
				/>
				<span class={[!use && (listed.length === 0 || blocks.use) && "text-muted-foreground"]}
					>{m.getdata_map_use_switch()}</span
				>
			</label>
			{#if !use && useBlocked}
				{@render reason(`${uid}-use-blocked`, useBlocked)}
			{/if}
		</div>
		{#if map.years === "unavailable"}
			<div>
				<Button variant="outline" size="sm" onclick={map.onretryyears}>{m.get_data_retry()}</Button>
			</div>
		{/if}
		{#if use}
			{@render filterSet()}
		{/if}
	{:else if section.offered}
		{@render description(section.entry?.description, {
			label: m.get_data_pesticide_help_label(),
			text: m.get_data_pesticide_help()
		})}
		<PesticideLayers
			entryTypes={section.offered.layerTypes}
			layers={pesticideLayers}
			blocked={atCap
				? limitText
				: blocked?.(
						section.offered.layerTypes
							.slice(0, 1)
							.map((e) => ({ dataset: PESTICIDE_USE, entryType: e.id }))
					)}
			onadd={onaddpesticide}
			{onremove}
			{onfilters}
		/>
	{/if}
{/snippet}

{#snippet locationsSection(section: WhatSection)}
	<fieldset class="flex flex-col gap-1">
		<legend class="sr-only">{labelOf(section)}</legend>
		{#each section.group?.types ?? [] as locationType (locationType.type)}
			<label class="flex min-h-6 items-center gap-2 text-sm">
				<input
					type="checkbox"
					class="accent-primary size-4"
					checked={ticked.includes(locationType.type)}
					onchange={(e) => tickLocation(locationType.type, e.currentTarget.checked)}
				/>
				<span>{locationType.label}</span>
			</label>
		{/each}
		{#each section.gone ?? [] as id (id)}
			{@const reasonId = `${uid}-location-gone-${id}`}
			<!-- Saved, but no meta group lists it any more: greyed with why, still untickable. -->
			<div class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
				<label class="flex items-center gap-2">
					<input
						type="checkbox"
						class="accent-primary size-4"
						checked={ticked.includes(id)}
						aria-describedby={reasonId}
						onchange={(e) => tickLocation(id, e.currentTarget.checked)}
					/>
					<span class="text-muted-foreground">{id}</span>
				</label>
				{@render reason(reasonId, m.getdata_map_location_type_gone())}
			</div>
		{/each}
	</fieldset>
{/snippet}

{#snippet fillSection()}
	<fieldset class="flex flex-col gap-1">
		<legend class="sr-only">{m.getdata_map_fill()}</legend>
		<label class="flex min-h-6 items-center gap-2 text-sm">
			<input
				type="radio"
				name="{uid}-fill"
				class="accent-primary size-4"
				checked={!fillShown}
				onchange={() => map.onfill(undefined)}
			/>
			<span>{m.getdata_map_fill_none()}</span>
		</label>
		{#each fillChoices as choice (choice.type)}
			<label class="flex min-h-6 items-center gap-2 text-sm">
				<input
					type="radio"
					name="{uid}-fill"
					class="accent-primary size-4"
					checked={fillShown?.type === choice.type}
					onchange={() => map.onfill(choice.type)}
				/>
				<span>{choice.plural}</span>
			</label>
		{/each}
	</fieldset>
{/snippet}

<Accordion.Root type="multiple" bind:value={open} class="flex flex-col gap-2" data-what-sections>
	{#each list as section (section.key)}
		{@const why = greyed(section.key)}
		{@const reasonId = `${uid}-${section.key}-greyed`}
		<Accordion.Item
			value={section.key}
			disabled={!!why}
			data-what-section={section.key}
			class="border-card-border rounded-(--radius-control) border"
		>
			<SectionTrigger
				label={labelOf(section)}
				detail={why ? undefined : chosen(section)}
				reasonId={why ? reasonId : undefined}
			/>
			{#if why}
				<p id={reasonId} class="text-muted-foreground px-2 pb-2 text-xs">{why}</p>
			{:else}
				<Accordion.Content class="flex flex-col gap-2 px-2 pb-2">
					{#if section.key === AIR_QUALITY}
						{@render airQuality(section)}
					{:else if section.key === HMS_SMOKE}
						{@render smokeSection(section)}
					{:else if section.key === PESTICIDE_NOTICES}
						{@render noticesSection(section)}
					{:else if section.key === PESTICIDE_USE}
						{@render useSection(section)}
					{:else if section.key === FILL}
						{@render fillSection()}
					{:else if section.group || section.gone}
						{@render locationsSection(section)}
					{:else if section.offered}
						{@render description(section.entry?.description)}
						{#if type.type === FORECAST_TYPE}
							<!-- The strip's forecasts are its whole content: nothing to choose. -->
							<p class="text-muted-foreground text-xs">{m.get_data_section_always_shown()}</p>
						{:else}
							{@const pollutants = section.offered.entryTypes.some((e) => e.kind === "pollutant")}
							{@render checkboxes(
								section.offered,
								pollutants ? m.get_data_overlays() : section.offered.dataset.label,
								pollutants
							)}
							{#if section.key === WEATHER && weatherLayers.length > 0 && places === 1 && main}
								<StationChoice where={data} value={station} onchange={onstation} />
							{/if}
						{/if}
					{/if}
				</Accordion.Content>
			{/if}
		</Accordion.Item>
	{/each}
</Accordion.Root>
