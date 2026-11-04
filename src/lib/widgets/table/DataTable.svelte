<script lang="ts">
	import ArrowDown from "@lucide/svelte/icons/arrow-down";
	import ArrowUp from "@lucide/svelte/icons/arrow-up";
	import { onDestroy, untrack } from "svelte";
	import LevelSwatch from "$lib/components/data/LevelSwatch.svelte";
	import { getMetadata, getQueryClient } from "$lib/data";
	import { LiveQuery } from "$lib/data/live-query.svelte";
	import { levelFor, type CatalogEntry, type Level } from "$lib/data/metadata";
	import type { QueryData, QueryState } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatHourRange, formatNumber, formatPeriod } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { DEFAULT_RANGE } from "../defaults";
	import { chartInput, entryMeta } from "../shared/input";
	import WidgetState from "../shared/WidgetState.svelte";
	import { dataTitle } from "../title";
	import { setGeneratedTitle } from "../titles.svelte";
	import { dataTableType } from "./index";
	import { sortRows, wideRows } from "./rows";

	let { widget }: { widget: WidgetInstance } = $props();

	const MAX_PLACES = dataTableType.accepts?.maxPlaces ?? 10;
	/**
	 * "Wide enough" for the extra columns: the widget body is as wide as six grid columns. The grid
	 * exposes no column width to widgets, so this is six of twelve columns of a 1280 px page (about
	 * 100 px a column with 16 px gaps), rounded down.
	 */
	const WIDE_PX = 600;
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
		setGeneratedTitle(
			widget.id,
			dataTitle({
				entryLabel: meta.entryType.label,
				places: s.data.places,
				range: widget.data.dateRange ?? DEFAULT_RANGE
			})
		);
	});

	let width = $state(0);
	const wide = $derived(width >= WIDE_PX);

	/** Newest first until a header is chosen. */
	let sort = $state<{ column: "t" | number; dir: "asc" | "desc" }>({ column: "t", dir: "desc" });

	function sortBy(column: "t" | number): void {
		sort =
			sort.column === column
				? { column, dir: sort.dir === "asc" ? "desc" : "asc" }
				: { column, dir: column === "t" ? "desc" : "asc" };
	}

	function ariaSort(column: "t" | number): "ascending" | "descending" | undefined {
		if (sort.column !== column) return undefined;
		return sort.dir === "asc" ? "ascending" : "descending";
	}

	const RESOLUTION_LABEL = {
		raw: () => m.chart_series_raw(),
		hour: () => m.chart_series_hour(),
		day: () => m.chart_series_day(),
		month: () => m.chart_series_month(),
		quarter: () => m.chart_series_quarter(),
		season: () => m.chart_series_season(),
		year: () => m.chart_series_year()
	} as const;

	const unit = $derived(meta?.entryType.units ?? "");
	const levelList = $derived(Array.isArray(levels) ? levels : []);
	const num = (v: number) => formatNumber(v);

	/** Extra columns apply to one place only, and worst hour only when the points carry it. */
	function extras(data: QueryData): { worst: boolean; minmax: boolean } {
		const single = wide && data.places.length === 1;
		return {
			minmax: single,
			worst: single && data.series.some((s) => s.points.some((p) => p.worstHour))
		};
	}
</script>

<div class="flex h-full flex-col" bind:clientWidth={width}>
	{#if picked.hidden > 0}
		<p class="bg-muted text-muted-foreground mb-2 rounded-(--radius-control) px-2 py-1 text-sm">
			{m.table_hidden_places({ count: formatNumber(picked.hidden), countValue: picked.hidden })}
		</p>
	{/if}
	<div class="min-h-0 flex-1">
		<WidgetState state={shown} {widget} {retired} onretry={retry}>
			{#snippet children(data)}
				{@const rows = sortRows(wideRows(data), sort.column, sort.dir)}
				{@const extra = extras(data)}
				<div class="flex h-full flex-col">
					<p class="text-muted-foreground mb-1 text-sm">
						{RESOLUTION_LABEL[data.resolution]()}{#if data.fromRaw}
							· {m.table_computed_from_raw()}{/if}
					</p>
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<div
						class="min-h-0 flex-1 overflow-auto"
						role="region"
						aria-label={m.table_scroll_label()}
						tabindex="0"
					>
						<table class="w-full border-separate border-spacing-0 text-left text-sm">
							<thead class="bg-card sticky top-0 z-10">
								<tr>
									{@render head("t", m.table_date())}
									{#each data.places as place, i (place.place)}
										{@render head(i, m.table_place_value({ place: place.name, unit }))}
									{/each}
									{#if extra.worst}
										<th scope="col" class="border-border border-b px-2 py-1 font-semibold">
											{m.table_worst_hour({ unit })}
										</th>
									{/if}
									{#if extra.minmax}
										<th scope="col" class="border-border border-b px-2 py-1 font-semibold">
											{m.table_min({ unit })}
										</th>
										<th scope="col" class="border-border border-b px-2 py-1 font-semibold">
											{m.table_max({ unit })}
										</th>
									{/if}
								</tr>
							</thead>
							<tbody>
								{#each rows as row (row.t)}
									<tr>
										<th scope="row" class="border-border border-b px-2 py-1 font-normal">
											{formatPeriod(new Date(row.t), data.resolution)}
											{#if row.partial}
												<span class="text-muted-foreground">({m.table_partial()})</span>
											{/if}
										</th>
										{#each row.cells as cell, i (i)}
											{@const level = cell ? levelFor(levelList, cell.mean) : undefined}
											<td class="border-border border-b px-2 py-1 tabular-nums">
												{#if cell}
													<span>{num(cell.mean)}</span>
													{#if level}
														<LevelSwatch
															size="sm"
															color={level.color ?? "transparent"}
															label={level.label}
														/>
													{/if}
												{/if}
											</td>
										{/each}
										{#if extra.worst}
											{@const worst = row.cells[0]?.worstHour}
											<td class="border-border border-b px-2 py-1 tabular-nums">
												{#if worst}
													{num(worst.value)}
													<span class="text-muted-foreground">
														{formatHourRange(new Date(worst.t), new Date(worst.t + 3_600_000))}
													</span>
												{/if}
											</td>
										{/if}
										{#if extra.minmax}
											<td class="border-border border-b px-2 py-1 tabular-nums">
												{row.cells[0] ? num(row.cells[0].min) : ""}
											</td>
											<td class="border-border border-b px-2 py-1 tabular-nums">
												{row.cells[0] ? num(row.cells[0].max) : ""}
											</td>
										{/if}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/snippet}
		</WidgetState>
	</div>
</div>

{#snippet head(column: "t" | number, label: string)}
	<th
		scope="col"
		aria-sort={ariaSort(column)}
		class="border-border border-b px-2 py-1 font-semibold"
	>
		<button
			type="button"
			class="focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
			onclick={() => sortBy(column)}
		>
			{label}
			{#if sort.column === column}
				{#if sort.dir === "asc"}<ArrowUp class="size-3" aria-hidden="true" />{:else}<ArrowDown
						class="size-3"
						aria-hidden="true"
					/>{/if}
			{/if}
		</button>
	</th>
{/snippet}
