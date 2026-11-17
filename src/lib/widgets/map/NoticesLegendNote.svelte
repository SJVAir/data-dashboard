<script lang="ts">
	import type { PesticidesMeta } from "@sjvair/sdk";
	import ExternalLinkCue from "$lib/components/shared/ExternalLinkCue.svelte";
	import { filterSummary, pesticideMeta } from "$lib/data/pesticide-meta";
	import type { PesticideFilters } from "$lib/data/schema";
	import { PESTICIDE_FILTER_NAMES } from "$lib/get-data/filter-names";
	import { m } from "$lib/paraglide/messages.js";
	import { webHref } from "./notice-links";

	// The foot of the spray notices' legend section: "none for this day" on a day stop with none,
	// the active filters (named as charts' legends name them), the filters that don't apply to
	// notices, and the explainer note from the pesticides meta (as text; its link only an href).
	let {
		filters,
		skipped,
		noneOnDay
	}: {
		/** The notices layer's saved filters. */
		filters: PesticideFilters | undefined;
		/** The saved filters the notice endpoints don't take. */
		skipped: readonly (keyof PesticideFilters)[];
		/** A day stop has loaded, with no notices. */
		noneOnDay: boolean;
	} = $props();

	let meta = $state.raw<PesticidesMeta | null>(null);
	$effect(() => {
		const controller = new AbortController();
		pesticideMeta(controller.signal).then(
			(value) => (meta = value),
			// Without the meta the note leaves out the explainer.
			() => {}
		);
		return () => controller.abort();
	});

	/**
	 * The filters that apply to notices (a skipped one has its own line), as a key, so an equal
	 * set saved again asks for nothing.
	 */
	const filtersKey = $derived(
		JSON.stringify(
			Object.fromEntries(
				Object.entries(filters ?? {}).filter(
					([key]) => !skipped.includes(key as keyof PesticideFilters)
				)
			)
		)
	);
	let named = $state.raw<string | null>(null);
	$effect(() => {
		const saved = JSON.parse(filtersKey) as PesticideFilters;
		named = null;
		const controller = new AbortController();
		filterSummary(saved, controller.signal).then(
			(labels) => {
				named =
					labels.length === 0
						? null
						: labels.reduce((all, label) => m.label_join({ first: all, second: label }));
			},
			// A gone filter is the map's own note; any other failure leaves the line out.
			() => {}
		);
		return () => controller.abort();
	});

	const explainer = $derived(meta?.notes.noi_meaning ?? null);
	const sourceHref = $derived(webHref(explainer?.source_url));
</script>

<div class="flex flex-col gap-1" data-notices-legend-note>
	{#if noneOnDay}
		<p class="text-foreground font-medium">{m.map_notices_none_day()}</p>
	{/if}
	{#if named}
		<p>{m.map_notices_legend_filters({ filters: named })}</p>
	{/if}
	{#each skipped as key (key)}
		<p class="text-muted-foreground" data-notices-skipped={key}>
			{m.getdata_map_notices_filter_skipped({ filter: PESTICIDE_FILTER_NAMES[key]() })}
		</p>
	{/each}
	{#if explainer}
		<div class="flex flex-col gap-0.5">
			{#if sourceHref}
				<a
					href={sourceHref}
					target="_blank"
					rel="noopener noreferrer"
					class="text-link font-medium underline underline-offset-4"
				>
					{explainer.title}
					<ExternalLinkCue class="inline size-3 align-baseline" />
				</a>
			{:else}
				<p class="font-medium">{explainer.title}</p>
			{/if}
			<p class="text-muted-foreground">{explainer.summary}</p>
		</div>
	{/if}
</div>
