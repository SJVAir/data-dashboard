<script lang="ts">
	import { Accordion } from "bits-ui";
	import { Button } from "$lib/components/ui/button";
	import { noticeFiltersSkipped } from "$lib/data/adapters/pesticides";
	import Toggletip from "$lib/components/Toggletip.svelte";
	import type { CatalogEntry, EntryTypeMeta } from "$lib/data/metadata";
	import type { WidgetDataConfig } from "$lib/data/schema";
	import { formatList } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import type { RegionTypeInfo } from "$lib/places/types";
	import {
		AIR_QUALITY,
		PESTICIDE_NOTICES,
		PESTICIDE_USE,
		pollutantLayer
	} from "$lib/widgets/map/options";
	import { PESTICIDE_FILTER_NAMES } from "./filter-names";
	import type { EntryPick } from "./layers";
	import { hasNotices, hasSmokeAndFire, hasUse, mapPesticideFilters } from "./map";
	import { nowPollutants } from "./now";
	import type { PesticideFilters as Filters } from "$lib/data/schema";
	import PesticideFilters from "./PesticideFilters.svelte";
	import { pesticideMeta } from "./sources";
	import SectionTrigger from "./SectionTrigger.svelte";

	let {
		data,
		catalog,
		offered,
		onpollutant,
		onsmoke,
		onnotices,
		onfilters,
		years,
		onuse,
		onretryyears,
		fill,
		fillTypes,
		onfill,
		blocks = {}
	}: {
		/** The Map draft's data (plain). */
		data: WidgetDataConfig;
		catalog: CatalogEntry[];
		/** The pollutants the Map offers, in order (the monitors meta's `available_pollutants`). */
		offered: EntryTypeMeta[];
		/** A pollutant chosen, or `null` for None. */
		onpollutant: (pick: EntryPick | null) => void;
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
		 * Why smoke and fire, the notices or use can't be switched on at the Map's data resolution
		 * (or, for use, on Now); greyed with the reason, never hidden.
		 */
		blocks?: { smoke?: string; notices?: string; use?: string };
	} = $props();

	const uid = $props.id();
	const SMOKE_AND_FIRE = "smoke-and-fire";
	const NOTICES = "notices";
	const USE = "use";
	const FILL = "fill";

	const airQuality = $derived(catalog.find((c) => c.id === AIR_QUALITY));
	/** The Map's one pollutant (none: undefined). */
	const chosen = $derived(pollutantLayer(data, catalog)?.entryType);
	/** The offered pollutants, plus the chosen one when it isn't (checked, so it still shows). */
	const radios = $derived([
		...offered,
		...nowPollutants(catalog).filter((e) => e.id === chosen && !offered.some((o) => o.id === e.id))
	]);
	const summary = $derived(formatList(radios.filter((e) => e.id === chosen).map((e) => e.label)));
	const smoke = $derived(hasSmokeAndFire(data));
	const noticesEntry = $derived(catalog.find((c) => c.id === PESTICIDE_NOTICES));
	const notices = $derived(hasNotices(data));
	const useEntry = $derived(catalog.find((c) => c.id === PESTICIDE_USE));
	const use = $derived(hasUse(data));
	const listed = $derived(Array.isArray(years) ? years : []);
	/** Why use can't be switched on: the years are known not to allow it, or the resolution. */
	const blocked = $derived(
		years === "unavailable"
			? m.getdata_map_use_years_unavailable()
			: Array.isArray(years) && years.length === 0
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
		if (!notices || noticeFilters) return;
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
	const fillChoices = $derived(fillTypes ?? []);
	/** The saved fill, only while it's offered (else None shows; the saved value stays). */
	const fillShown = $derived(fillChoices.find((t) => t.type === fill));

	// The sections start open: there are only five, each short.
	let open = $state<string[]>([AIR_QUALITY, SMOKE_AND_FIRE, NOTICES, USE, FILL]);
</script>

{#snippet reason(id: string, text: string)}
	<span {id} class="text-muted-foreground text-xs">{text}</span>
{/snippet}

{#snippet filterSet()}
	<div role="group" aria-label={m.getdata_map_pesticide_filters()}>
		<PesticideFilters filters={noticeFiltersSaved} onchange={onfilters} />
		{#each noticesSkipped as key (key)}
			<p class="text-muted-foreground mt-2 text-xs" data-notices-skipped={key}>
				{m.getdata_map_notices_filter_skipped({ filter: PESTICIDE_FILTER_NAMES[key]() })}
			</p>
		{/each}
	</div>
{/snippet}

<Accordion.Root type="multiple" bind:value={open} class="flex flex-col gap-2">
	<Accordion.Item value={AIR_QUALITY} class="border-card-border rounded-(--radius-control) border">
		<SectionTrigger label={airQuality?.label ?? AIR_QUALITY} detail={summary} />
		<Accordion.Content class="flex flex-col gap-2 px-2 pb-2">
			{#if airQuality?.description}
				<p class="text-muted-foreground text-xs">{airQuality.description}</p>
			{/if}
			<fieldset class="flex flex-col gap-1">
				<legend class="sr-only">{airQuality?.label ?? AIR_QUALITY}</legend>
				<label class="flex min-h-6 items-center gap-2 text-sm">
					<input
						type="radio"
						class="accent-primary size-4"
						name="{uid}-pollutant"
						value=""
						checked={chosen === undefined}
						onchange={() => onpollutant(null)}
					/>
					<span>{m.get_data_none()}</span>
				</label>
				{#each radios as entry (entry.id)}
					<label class="flex min-h-6 items-center gap-2 text-sm">
						<input
							type="radio"
							class="accent-primary size-4"
							name="{uid}-pollutant"
							value={entry.id}
							checked={entry.id === chosen}
							onchange={() => onpollutant({ dataset: AIR_QUALITY, entryType: entry.id })}
						/>
						<span>{entry.label}</span>
					</label>
				{/each}
			</fieldset>
		</Accordion.Content>
	</Accordion.Item>
	<Accordion.Item
		value={SMOKE_AND_FIRE}
		class="border-card-border rounded-(--radius-control) border"
	>
		<SectionTrigger label={m.get_data_smoke_and_fire()} />
		<Accordion.Content class="flex flex-col gap-2 px-2 pb-2">
			<div class="flex min-h-6 items-center gap-2 text-sm">
				<label class="flex flex-1 items-center gap-2">
					<input
						type="checkbox"
						class="accent-primary size-4"
						checked={smoke}
						disabled={!!smokeBlocked}
						aria-describedby={smokeBlocked ? `${uid}-smoke-blocked` : undefined}
						onchange={(e) => onsmoke(e.currentTarget.checked)}
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
		</Accordion.Content>
	</Accordion.Item>
	{#if noticesEntry || notices}
		<Accordion.Item value={NOTICES} class="border-card-border rounded-(--radius-control) border">
			<SectionTrigger
				label={noticesEntry?.label ?? m.getdata_map_section_fallback({ section: "notices" })}
			/>
			<Accordion.Content class="flex flex-col gap-2 px-2 pb-2">
				{#if noticesEntry?.description}
					<p class="text-muted-foreground text-xs">{noticesEntry.description}</p>
				{/if}
				<div class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
					<label class="flex items-center gap-2">
						<input
							type="checkbox"
							role="switch"
							class="accent-primary size-4"
							checked={notices}
							disabled={!!noticesBlocked}
							aria-describedby={noticesBlocked ? `${uid}-notices-blocked` : undefined}
							onchange={(e) => onnotices(e.currentTarget.checked)}
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
			</Accordion.Content>
		</Accordion.Item>
	{/if}
	{#if useEntry || use}
		<Accordion.Item value={USE} class="border-card-border rounded-(--radius-control) border">
			<SectionTrigger
				label={useEntry?.label ?? m.getdata_map_section_fallback({ section: "use" })}
			/>
			<Accordion.Content class="flex flex-col gap-2 px-2 pb-2">
				{#if useEntry?.description}
					<p class="text-muted-foreground text-xs">{useEntry.description}</p>
				{/if}
				<div class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
					<label class="flex items-center gap-2">
						<input
							type="checkbox"
							role="switch"
							class="accent-primary size-4"
							checked={use}
							disabled={!use && (listed.length === 0 || !!blocks.use)}
							aria-describedby={!use && blocked ? `${uid}-use-blocked` : undefined}
							onchange={(e) => onuse(e.currentTarget.checked)}
						/>
						<span class={[!use && (listed.length === 0 || blocks.use) && "text-muted-foreground"]}
							>{m.getdata_map_use_switch()}</span
						>
					</label>
					{#if !use && blocked}
						{@render reason(`${uid}-use-blocked`, blocked)}
					{/if}
				</div>
				{#if years === "unavailable"}
					<div>
						<Button variant="outline" size="sm" onclick={onretryyears}>{m.get_data_retry()}</Button>
					</div>
				{/if}
				{#if use}
					{@render filterSet()}
				{/if}
			</Accordion.Content>
		</Accordion.Item>
	{/if}
	<Accordion.Item value={FILL} class="border-card-border rounded-(--radius-control) border">
		<SectionTrigger label={m.getdata_map_fill()} detail={fillShown?.plural} />
		<Accordion.Content class="flex flex-col gap-2 px-2 pb-2">
			<fieldset class="flex flex-col gap-1">
				<legend class="sr-only">{m.getdata_map_fill()}</legend>
				<label class="flex min-h-6 items-center gap-2 text-sm">
					<input
						type="radio"
						name="{uid}-fill"
						class="accent-primary size-4"
						checked={!fillShown}
						onchange={() => onfill(undefined)}
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
							onchange={() => onfill(choice.type)}
						/>
						<span>{choice.plural}</span>
					</label>
				{/each}
			</fieldset>
		</Accordion.Content>
	</Accordion.Item>
</Accordion.Root>
