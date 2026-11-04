<script lang="ts">
	import { onDestroy, untrack } from "svelte";
	import TimeChart from "$lib/charts/TimeChart.svelte";
	import { getMetadata, getQueryClient } from "$lib/data";
	import { LiveQuery } from "$lib/data/live-query.svelte";
	import type { CatalogEntry, Level } from "$lib/data/metadata";
	import type { QueryState } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { DEFAULT_RANGE } from "../defaults";
	import WidgetState from "../shared/WidgetState.svelte";
	import { dataTitle } from "../title";
	import { setGeneratedTitle } from "../titles.svelte";
	import { chartType } from "./index";
	import { chartInput, entryMeta } from "./input";

	let { widget }: { widget: WidgetInstance } = $props();

	const MAX_PLACES = chartType.accepts?.maxPlaces ?? 5;
	const metadata = getMetadata();

	let catalog = $state.raw<CatalogEntry[] | undefined>();
	// Never rejects (an unreachable catalog is "unavailable", which the query reports itself).
	void metadata.catalog().then((c) => {
		if (c !== "unavailable") catalog = c;
	});

	const picked = $derived(chartInput(widget.data, catalog, MAX_PLACES));
	const meta = $derived(entryMeta(catalog, picked.layer));
	const entryTypeId = $derived(picked.layer?.entryType);

	const query = new LiveQuery(
		getQueryClient(),
		untrack(() => picked.input)
	);
	$effect(() => query.set(picked.input));
	$effect(() => query.setPolling(!widget.minimized));
	onDestroy(() => query.destroy());

	/** The entry type's levels; `undefined` until loaded, an error if they couldn't be. */
	let levels = $state.raw<Level[] | { error: unknown } | undefined>();
	let levelsTry = $state(0);
	$effect(() => {
		const id = entryTypeId;
		void levelsTry;
		if (!id) return;
		const abort = new AbortController();
		levels = undefined;
		metadata.levels(id, abort.signal).then(
			(l) => (levels = l),
			(error: unknown) => {
				if (!abort.signal.aborted) levels = { error };
			}
		);
		return () => abort.abort();
	});

	/** The query's state, held as loading until the levels are in, or an error if they failed. */
	const shown = $derived.by<QueryState>(() => {
		const s = query.state;
		if (s.status !== "ready" && s.status !== "error") return s;
		if (levels === undefined) return { status: "loading", data: s.data };
		if (!Array.isArray(levels) && s.status === "ready") {
			return { status: "error", error: levels.error, data: s.data };
		}
		return s;
	});

	const retired = $derived.by(() => {
		if (!meta) return undefined;
		const r = meta.entryType.retired ?? meta.dataset.retired;
		if (!r) return undefined;
		const name = meta.entryType.retired ? meta.entryType.label : meta.dataset.label;
		return { name, since: r.since };
	});

	function retry(): void {
		if (levels && !Array.isArray(levels)) levelsTry++;
		query.retry();
	}

	$effect(() => {
		// Only from ready data: while a new input loads, the old places would pair with the new range.
		const s = query.state;
		if (s.status !== "ready" || !meta) return;
		const data = s.data;
		setGeneratedTitle(
			widget.id,
			dataTitle({
				entryLabel: meta.entryType.label,
				places: data.places,
				range: widget.data.dateRange ?? DEFAULT_RANGE
			})
		);
	});
</script>

<div class="flex h-full flex-col">
	{#if picked.hidden > 0}
		<p class="bg-muted text-muted-foreground mb-2 rounded-(--radius-control) px-2 py-1 text-sm">
			{m.chart_hidden_places({ count: formatNumber(picked.hidden), countValue: picked.hidden })}
		</p>
	{/if}
	<div class="min-h-0 flex-1">
		<WidgetState state={shown} {widget} {retired} onretry={retry}>
			{#snippet children(data)}
				<TimeChart
					{data}
					levels={Array.isArray(levels) ? levels : []}
					unit={meta?.entryType.units ?? ""}
					placeNames={new Map(data.places.map((p) => [p.place, p.name]))}
				/>
			{/snippet}
		</WidgetState>
	</div>
</div>
