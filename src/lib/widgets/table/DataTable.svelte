<script lang="ts">
	import ArrowDown from "@lucide/svelte/icons/arrow-down";
	import ArrowUp from "@lucide/svelte/icons/arrow-up";
	import Download from "@lucide/svelte/icons/download";
	import { Button } from "$lib/components/ui/button";
	import { csvPending, saveWidgetCsv } from "$lib/data/csv";
	import { useApp } from "$lib/store/app.svelte";
	import LevelSwatch from "$lib/components/data/LevelSwatch.svelte";
	import { periodLabel, seriesLabel, type Aggregate } from "$lib/charts/period-label";
	import { layerKind } from "$lib/data/layer-kind";
	import { unavailableMessage } from "$lib/data/messages";
	import { levelFor } from "$lib/data/metadata";
	import type { Resolution } from "$lib/data/schema";
	import type { PlaceInfo, QueryData } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatHourRange, formatNumber, formatPeriod, formatValue } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { DataWidget } from "../shared/data-widget.svelte";
	import WidgetState from "../shared/WidgetState.svelte";
	import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
	import { dataTableType } from "./index";
	import { sourceLabel } from "../shared/source-label";
	import { placeLabel } from "../title";
	import { byDay, overlayColumns, sortRows, wideRows, type OverlayColumn } from "./rows";

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

	/** The pesticide-use dataset: its empty range has its own wording (nothing was reported). */
	const PESTICIDE_USE = "pesticide-use";
	const pesticideMain = $derived(w.picked.layer?.dataset === PESTICIDE_USE);
	/** How the main layer's values combine (the catalog's `aggregate`). */
	const aggregate = $derived<Aggregate>(w.meta ? w.meta.entryType.aggregate : "mean");
	const entryLabel = $derived(w.meta?.entryType.label ?? "");

	/** The caption's period word: "Daily average", "Daily total", or the entry type's label. */
	function caption(data: QueryData): string {
		const resolution = seriesLabel(data.resolution, aggregate, entryLabel);
		return data.fromRaw ? m.table_caption_raw({ resolution }) : m.table_caption({ resolution });
	}

	/**
	 * A main column's header: the place and units, with the layer and its source (station or
	 * filters) when the place has one, as a number overlay's header names it.
	 */
	function mainHeader(info: PlaceInfo): string {
		const place = placeLabel(info, w.viewer);
		if (!info.source && !info.filters?.length) return m.table_place_value({ place, unit });
		return m.table_overlay_place_unit({ layer: sourceLabel(entryLabel, info), place, unit });
	}

	const unit = $derived(w.meta?.entryType.units ?? "");
	const levelList = $derived(w.levelList);
	/** Values with the catalog's display precision (the CSV keeps every digit). */
	const num = (v: number) => formatValue(v, w.meta?.entryType.precision);

	/**
	 * The overlays with ready data and a catalog label, with that label (column headers name it),
	 * whether it is a level or a number layer, and a number layer's units, precision and aggregate.
	 */
	const overlays = $derived(
		w.overlays.flatMap((o) =>
			o.state.status === "ready" && o.meta
				? [
						{
							data: o.state.data,
							levels: o.levels,
							kind:
								layerKind(o.layer, w.catalog) === "number"
									? ("number" as const)
									: ("level" as const),
							aggregate: o.meta.entryType.aggregate,
							layer: o.meta.entryType.label,
							unit: o.meta.entryType.units,
							precision: o.meta.entryType.precision
						}
					]
				: []
		)
	);

	/** A number overlay column's header: the layer and its source, the place, and the units. */
	function overlayHeader(column: OverlayColumn): string {
		const o = overlays[column.overlay];
		const place = placeLabel(column.place, w.viewer);
		if (o.kind === "level") return m.table_overlay_place({ layer: o.layer, place });
		return m.table_overlay_place_unit({
			layer: sourceLabel(o.layer, column.info),
			place,
			unit: o.unit
		});
	}

	/**
	 * What a whole-period cell is: "Monthly total" for a summed layer, "Monthly average" for a mean
	 * (never a total), nothing for a layer whose values don't combine over time. The same words as
	 * the Chart's strip tags.
	 */
	function wholeLabel(resolution: Resolution, aggregate: Aggregate): string {
		return periodLabel(resolution, aggregate) ?? "";
	}

	/**
	 * Why an overlay has no columns, so the Table never drops one the Chart shows or explains:
	 * it failed, or the main's periods are longer than its days.
	 */
	function overlayNotes(data: QueryData): string[] {
		return w.overlays.flatMap((o) => {
			const layer = o.meta?.entryType.label;
			if (!layer) return [];
			const s = o.state;
			const level = layerKind(o.layer, w.catalog) !== "number";
			// Worded as the Chart words it: a number layer says why it's unavailable.
			if (s.status === "unavailable" && !level) return [unavailableMessage(s.reason)];
			if (s.status === "error" || s.status === "unavailable") {
				return [m.chart_overlay_failed({ layer })];
			}
			return s.status === "ready" && level && !byDay(data)
				? [m.table_overlay_by_day({ layer })]
				: [];
		});
	}

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
		<WidgetState
			state={w.shown}
			{widget}
			retired={w.retired}
			onretry={w.retry}
			onchoose={() => openPlacePicker({ widgetId: widget.id })}
			emptyText={pesticideMain ? m.data_none_pesticides() : undefined}
		>
			{#snippet children(data)}
				{@const rows = sortRows(wideRows(data, overlays), sort.column, sort.dir)}
				{@const columns = overlayColumns(data, overlays)}
				{@const extra = extras(data)}
				{@const notes = overlayNotes(data)}
				<div class="flex h-full flex-col">
					<div class="mb-1 flex items-center justify-between gap-2">
						<p class="text-muted-foreground text-sm">
							{caption(data)}
						</p>
						<Button
							variant="ghost"
							size="sm"
							disabled={csvPending(widget.id)}
							onclick={() =>
								void saveWidgetCsv(
									widget,
									(name, contents, type) => app.platform.files.save(name, contents, type),
									w.viewer
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
										{@render head(i, mainHeader(place))}
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
									{#each columns as column (`${column.overlay} ${column.key}`)}
										<th scope="col" class="border-border border-b px-2 py-1 font-semibold">
											{overlayHeader(column)}
										</th>
									{/each}
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
										{#each row.overlays as cell, i (i)}
											{@const o = overlays[columns[i].overlay]}
											<td class="border-border border-b px-2 py-1">
												{#if cell && "label" in cell}
													<LevelSwatch
														size="sm"
														color={cell.color ?? "transparent"}
														label={cell.label}
													/>
												{:else if cell}
													<span class="tabular-nums">{formatValue(cell.mean, o.precision)}</span>
													{#if columns[i].whole}
														<span class="text-muted-foreground">
															{wholeLabel(columns[i].whole!, o.aggregate)}
														</span>
													{/if}
												{/if}
											</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					{#each notes as note, i (i)}
						<p class="text-muted-foreground mt-1 text-xs">{note}</p>
					{/each}
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
