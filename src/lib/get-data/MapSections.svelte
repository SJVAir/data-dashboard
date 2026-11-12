<script lang="ts">
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import { Accordion } from "bits-ui";
	import Toggletip from "$lib/components/Toggletip.svelte";
	import type { CatalogEntry, EntryTypeMeta } from "$lib/data/metadata";
	import type { WidgetDataConfig } from "$lib/data/schema";
	import { formatList, formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { pollutantLayers } from "$lib/widgets/map/options";
	import { hasSmokeAndFire, MAP_POLLUTANTS_MAX } from "./map";
	import { nowPollutants } from "./now";

	let {
		data,
		catalog,
		offered,
		onpollutant,
		onsmoke
	}: {
		/** The Map draft's data (plain). */
		data: WidgetDataConfig;
		catalog: CatalogEntry[];
		/** The pollutants the Map offers, in order (the monitors meta's `available_pollutants`). */
		offered: EntryTypeMeta[];
		/** A pollutant on or off. */
		onpollutant: (entryType: string, on: boolean) => void;
		/** Smoke and fire on or off (both together). */
		onsmoke: (on: boolean) => void;
	} = $props();

	const uid = $props.id();
	const AIR_QUALITY = "air-quality";
	const SMOKE_AND_FIRE = "smoke-and-fire";

	const airQuality = $derived(catalog.find((c) => c.id === AIR_QUALITY));
	const chosen = $derived(
		pollutantLayers(data, catalog)
			.map((l) => l.entryType)
			.filter((e): e is string => e !== undefined)
	);
	/** The offered pollutants, plus any chosen that aren't (checked, so they can be removed). */
	const boxes = $derived([
		...offered,
		...nowPollutants(catalog).filter(
			(e) => chosen.includes(e.id) && !offered.some((o) => o.id === e.id)
		)
	]);
	const summary = $derived(
		formatList(boxes.filter((e) => chosen.includes(e.id)).map((e) => e.label))
	);
	const atCap = $derived(chosen.length >= MAP_POLLUTANTS_MAX);
	const smoke = $derived(hasSmokeAndFire(data));

	// Both sections start open: there are only two, each short.
	let open = $state<string[]>([AIR_QUALITY, SMOKE_AND_FIRE]);
</script>

{#snippet reason(id: string, text: string)}
	<span {id} class="text-muted-foreground text-xs">{text}</span>
{/snippet}

{#snippet trigger(label: string, detail: string)}
	<Accordion.Header level={3}>
		<Accordion.Trigger
			class="hover:bg-secondary flex min-h-8 w-full items-center gap-2 rounded-(--radius-control) px-2 py-1 text-left text-sm font-medium [&[data-state=open]>svg]:rotate-180"
		>
			<span class="flex min-w-0 flex-1 flex-col">
				<span>{label}</span>
				{#if detail}
					<span class="text-muted-foreground text-xs font-normal">{detail}</span>
				{/if}
			</span>
			<ChevronDownIcon
				class="text-muted-foreground duration-fast ease-standard size-4 shrink-0 transition-transform"
				aria-hidden="true"
			/>
		</Accordion.Trigger>
	</Accordion.Header>
{/snippet}

<Accordion.Root type="multiple" bind:value={open} class="flex flex-col gap-2">
	<Accordion.Item value={AIR_QUALITY} class="border-card-border rounded-(--radius-control) border">
		{@render trigger(airQuality?.label ?? AIR_QUALITY, summary)}
		<Accordion.Content class="flex flex-col gap-2 px-2 pb-2">
			{#if airQuality?.description}
				<p class="text-muted-foreground text-xs">{airQuality.description}</p>
			{/if}
			<fieldset class="flex flex-col gap-1">
				<legend class="sr-only">{airQuality?.label ?? AIR_QUALITY}</legend>
				{#each boxes as entry (entry.id)}
					{@const on = chosen.includes(entry.id)}
					{@const kept = on && chosen.length <= 1}
					{@const capped = !on && atCap}
					{@const reasonId = `${uid}-${entry.id}-reason`}
					<div class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
						<label class="flex items-center gap-2">
							<input
								type="checkbox"
								class="accent-primary size-4"
								checked={on}
								disabled={kept || capped}
								aria-describedby={kept || capped ? reasonId : undefined}
								onchange={(e) => onpollutant(entry.id, e.currentTarget.checked)}
							/>
							<span class={[(kept || capped) && "text-muted-foreground"]}>{entry.label}</span>
						</label>
						{#if kept}
							{@render reason(reasonId, m.get_data_map_keep_one())}
						{:else if capped}
							{@render reason(
								reasonId,
								m.get_data_map_pollutant_limit({
									count: formatNumber(MAP_POLLUTANTS_MAX),
									countValue: MAP_POLLUTANTS_MAX
								})
							)}
						{/if}
					</div>
				{/each}
			</fieldset>
		</Accordion.Content>
	</Accordion.Item>
	<Accordion.Item
		value={SMOKE_AND_FIRE}
		class="border-card-border rounded-(--radius-control) border"
	>
		{@render trigger(m.get_data_smoke_and_fire(), "")}
		<Accordion.Content class="flex flex-col gap-2 px-2 pb-2">
			<div class="flex min-h-6 items-center gap-2 text-sm">
				<label class="flex flex-1 items-center gap-2">
					<input
						type="checkbox"
						class="accent-primary size-4"
						checked={smoke}
						onchange={(e) => onsmoke(e.currentTarget.checked)}
					/>
					<span>{m.get_data_smoke_and_fire()}</span>
				</label>
				<Toggletip label={m.get_data_map_smoke_help_label()} text={m.get_data_map_smoke_help()} />
			</div>
		</Accordion.Content>
	</Accordion.Item>
</Accordion.Root>
