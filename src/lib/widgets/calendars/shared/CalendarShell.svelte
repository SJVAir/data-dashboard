<script lang="ts">
	import type { Snippet } from "svelte";
	import { thresholdCount, type DayState } from "$lib/calendars/day-state";
	import { selectionSummary } from "$lib/calendars/summary";
	import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
	import type { WidgetInstance } from "$lib/documents/schema";
	import {
		addDays,
		formatDateRange,
		formatMonthName,
		formatNumber,
		formatValue,
		formatWeekdayDate,
		monthStarts
	} from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import LevelChip from "../../shared/LevelChip.svelte";
	import WidgetState from "../../shared/WidgetState.svelte";
	import { figureName, type CalendarData } from "./calendar-data.svelte";
	import CalendarLegend from "./CalendarLegend.svelte";
	import { provideCalendarTip } from "./calendar-tip.svelte";
	import CalendarTooltip from "./CalendarTooltip.svelte";

	let {
		data,
		widget,
		selection,
		grid,
		patterns,
		dragging = false,
		legendAside
	}: {
		data: CalendarData;
		widget: WidgetInstance;
		/** The selected days shown (already limited to the range). */
		selection: { start: string; end: string } | null;
		grid: Snippet;
		/** The contribution calendar's "Show patterns" (passed to the legend). */
		patterns?: boolean;
		/** Drawn at the end of the legend's row (the contribution calendar's switch). */
		legendAside?: Snippet;
		/** A drag is extending the selection: the live region waits until it settles. */
		dragging?: boolean;
	} = $props();

	const tip = provideCalendarTip();
	let host = $state<HTMLElement>();

	const unit = $derived(data.meta?.entryType.units ?? "");
	const num = (v: number) => formatValue(v, data.meta?.entryType.precision);
	const count = (n: number) => formatNumber(n);

	const all = $derived([...data.states.values()]);
	const counts = $derived(data.threshold ? thresholdCount(all, data.threshold) : null);
	/** This month's count, when the range spans several months and reaches into this one. */
	const monthCount = $derived.by(() => {
		const level = data.threshold;
		const { first, last } = data.range;
		const month = data.today.slice(0, 7);
		const starts = monthStarts(first, last);
		if (!level || starts.length < 2 || !starts.includes(`${month}-01`)) return null;
		return thresholdCount(
			all.filter((s) => s.date.startsWith(month)),
			level
		);
	});

	const notes = $derived.by(() => {
		const out: string[] = [];
		if (!data.levelsLoaded) return out;
		if (data.levels.length === 0) out.push(m.calendar_no_levels());
		else if (data.figureFailed) out.push(m.calendar_day_rating_unavailable());
		else if (data.figure === null) out.push(m.calendar_day_rating_unknown());
		if (data.thresholdMissing) out.push(m.calendar_level_missing());
		return out;
	});

	/** The selected days that have a state (days still to come are never selected). */
	const selected = $derived.by(() => {
		if (!selection) return [];
		const out: DayState[] = [];
		for (let d = selection.start; d <= selection.end; d = addDays(d, 1)) {
			const s = data.states.get(d);
			if (s && s.kind !== "future") out.push(s);
		}
		return out;
	});
	const summary = $derived(
		selection && selected.length ? selectionSummary(selected, data.threshold) : null
	);

	/** The selection last announced: set once a selection settles, never for a stored one on load. */
	const keyOf = (sel: typeof selection) => (sel ? `${sel.start}/${sel.end}` : "");
	let announced = $state("");
	// svelte-ignore state_referenced_locally
	let lastKey = keyOf(selection);
	$effect(() => {
		const key = keyOf(selection);
		if (dragging || key === lastKey) return;
		lastKey = key;
		announced = key;
	});
	const announcing = $derived(!!announced && announced === keyOf(selection));
</script>

{#snippet summaryText()}
	{#if summary}
		<span>
			{#if summary.worst && summary.average !== null}
				{m.calendar_selection_summary({
					dates: formatDateRange(summary.start, summary.end),
					days: count(summary.days),
					daysValue: summary.days,
					figure: figureName(data.figure),
					average: num(summary.average),
					unit,
					worstDate: formatWeekdayDate(summary.worst.date),
					worstValue: num(summary.worst.value!)
				})}
			{:else}
				{m.calendar_selection_summary_none_rated({
					dates: formatDateRange(summary.start, summary.end),
					days: count(summary.days),
					daysValue: summary.days
				})}
			{/if}
		</span>
	{/if}
{/snippet}

{#snippet summaryCounts()}
	<!-- With no rated day the summary line already says so: no counts to repeat it. -->
	{#if summary && summary.average !== null}
		{#if summary.atOrAbove !== null && data.threshold}
			<span>
				{m.calendar_selection_at_or_above({
					count: count(summary.atOrAbove),
					countValue: summary.atOrAbove,
					level: data.threshold.label
				})}
			</span>
		{/if}
		{#if summary.unrated > 0}
			<span>
				{m.calendar_selection_not_rated({
					count: count(summary.unrated),
					countValue: summary.unrated
				})}
			</span>
		{/if}
	{/if}
{/snippet}

<div bind:this={host} class="relative flex h-full flex-col">
	<div class="min-h-0 flex-1">
		<WidgetState
			state={data.shown}
			{widget}
			retired={data.retired}
			onretry={data.retry}
			onchoose={() => openPlacePicker({ widgetId: widget.id })}
			ownsEmpty
		>
			<div class="flex h-full flex-col gap-1">
				{#if counts && data.threshold}
					<p class="text-sm" data-calendar-count>
						<span aria-hidden="true">▲</span>
						{m.calendar_threshold_count({
							at: count(counts.at),
							rated: count(counts.rated),
							ratedValue: counts.rated,
							level: data.threshold.label
						})}
					</p>
					{#if monthCount}
						<p class="text-muted-foreground text-xs">
							{m.calendar_threshold_month_count({
								at: count(monthCount.at),
								rated: count(monthCount.rated),
								month: formatMonthName(data.today)
							})}
						</p>
					{/if}
				{/if}
				{#each notes as note (note)}
					<p class="bg-muted text-muted-foreground rounded-(--radius-control) px-2 py-1 text-sm">
						{note}
					</p>
				{/each}
				<div class="min-h-0 flex-1 overflow-auto">{@render grid()}</div>
				{#if summary}
					<p data-calendar-summary class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
						{@render summaryText()}
						{#if summary.worst?.level}
							<LevelChip level={summary.worst.level} size="sm" />
						{/if}
						{@render summaryCounts()}
						<!-- Esc means nothing on a touch screen. -->
						<span class="text-muted-foreground text-xs pointer-coarse:hidden"
							>{m.calendar_selection_clear_hint()}</span
						>
					</p>
				{/if}
				<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
					<CalendarLegend
						levels={data.levels}
						states={data.states}
						threshold={data.threshold}
						{patterns}
					/>
					{@render legendAside?.()}
				</div>
			</div>
		</WidgetState>
	</div>
	<CalendarTooltip {tip} {host} />
	<div role="status" aria-live="polite" aria-atomic="true" class="sr-only">
		{#if announcing && summary}
			{@render summaryText()}
			{#if summary.worst?.level}<span>{summary.worst.level.label}</span>{/if}
			{@render summaryCounts()}
		{/if}
	</div>
</div>
