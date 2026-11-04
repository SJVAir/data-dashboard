<script lang="ts">
	import ArrowDown from "@lucide/svelte/icons/arrow-down";
	import ArrowUp from "@lucide/svelte/icons/arrow-up";
	import Download from "@lucide/svelte/icons/download";
	import { Button } from "$lib/components/ui/button";
	import { saveWidgetCsv } from "$lib/data/csv";
	import { useApp } from "$lib/store/app.svelte";
	import LevelSwatch from "$lib/components/data/LevelSwatch.svelte";
	import { levelFor } from "$lib/data/metadata";
	import type { QueryData } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatHourRange, formatNumber, formatPeriod } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { DataWidget } from "../shared/data-widget.svelte";
	import WidgetState from "../shared/WidgetState.svelte";
	import { dataTableType } from "./index";
	import { sortRows, wideRows } from "./rows";

	let { widget }: { widget: WidgetInstance } = $props();

	const app = useApp();
	const MAX_PLACES = dataTableType.accepts?.maxPlaces ?? 10;
	/**
	 * "Wide enough" for the extra columns: the widget body is as wide as six grid columns. The grid
	 * exposes no column width to widgets, so this is six of twelve columns of a 1280 px page (about
	 * 100 px a column with 16 px gaps), rounded down.
	 */
	const WIDE_PX = 600;
	const w = new DataWidget(() => widget, MAX_PLACES);

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

	const unit = $derived(w.meta?.entryType.units ?? "");
	const levelList = $derived(w.levelList);
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
	{#if w.picked.hidden > 0}
		<p class="bg-muted text-muted-foreground mb-2 rounded-(--radius-control) px-2 py-1 text-sm">
			{m.table_hidden_places({ count: formatNumber(w.picked.hidden), countValue: w.picked.hidden })}
		</p>
	{/if}
	<div class="min-h-0 flex-1">
		<WidgetState state={w.shown} {widget} retired={w.retired} onretry={w.retry}>
			{#snippet children(data)}
				{@const rows = sortRows(wideRows(data), sort.column, sort.dir)}
				{@const extra = extras(data)}
				<div class="flex h-full flex-col">
					<div class="mb-1 flex items-center justify-between gap-2">
						<p class="text-muted-foreground text-sm">
							{data.fromRaw
								? m.table_caption_raw({ resolution: RESOLUTION_LABEL[data.resolution]() })
								: m.table_caption({ resolution: RESOLUTION_LABEL[data.resolution]() })}
						</p>
						<Button
							variant="ghost"
							size="sm"
							onclick={() =>
								void saveWidgetCsv(widget, (name, contents, type) =>
									app.platform.files.save(name, contents, type)
								)}
						>
							<Download aria-hidden="true" />
							{m.table_download_csv()}
						</Button>
					</div>
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
												<span class="text-muted-foreground">{m.table_partial()}</span>
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
