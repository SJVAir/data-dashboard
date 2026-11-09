<script lang="ts">
	import type { DayState } from "$lib/calendars/day-state";
	import { readableColor } from "$lib/color";
	import {
		addDays,
		formatMonth,
		formatValue,
		formatWeekday,
		monthGrid,
		monthStarts,
		startOfPacificWeek
	} from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { figureName, type CalendarData } from "../shared/calendar-data.svelte";
	import { dayLabel, isMarked } from "../shared/day-label";
	import DayGrid, { type DayGridSection } from "../shared/DayGrid.svelte";
	import type { DaySpan } from "../shared/write-selection";

	let {
		data,
		selection,
		onselect,
		label,
		dragging = $bindable(false),
		preview = $bindable(null)
	}: {
		data: CalendarData;
		selection: DaySpan | null;
		onselect: (sel: DaySpan | null) => void;
		label: string;
		dragging?: boolean;
		preview?: DaySpan | null;
	} = $props();

	/**
	 * Each month the range touches, whole: days before the range are left empty, and days after
	 * it that are still to come are drawn as such ("This month" keeps its shape early on).
	 */
	const sections = $derived.by<DayGridSection[]>(() => {
		const { first, last } = data.range;
		const today = data.today;
		return monthStarts(first, last).map((month) => ({
			key: month,
			label: formatMonth(month),
			rows: monthGrid(month).map((week) =>
				week.map((d) => (d !== null && d >= first && (d <= last || d > today) ? d : null))
			)
		}));
	});
	const stateOf = (date: string): DayState | undefined =>
		data.states.get(date) ??
		(date > data.range.last && date > data.today && data.states.size > 0
			? { date, kind: "future", value: null, level: null }
			: undefined);

	/** The week's days from its first, for the weekday headings. */
	const weekdays = $derived.by(() => {
		const start = startOfPacificWeek(data.range.first);
		return Array.from({ length: 7 }, (_, i) => addDays(start, i));
	});

	const context = $derived({
		figure: figureName(data.figure),
		unit: data.meta?.entryType.units ?? "",
		precision: data.meta?.entryType.precision,
		threshold: data.threshold,
		withYear: data.range.first.slice(0, 4) !== data.range.last.slice(0, 4)
	});
	const name = (s: DayState, selected: boolean) => dayLabel(s, context, selected);
	const num = (v: number) => formatValue(v, data.meta?.entryType.precision);

	/** The fill, ink and outline of a day. */
	function look(s: DayState): { fill?: string; ink?: string; dashed: boolean } {
		const colored = (s.kind === "rated" || s.kind === "today") && s.level?.color;
		if (colored) {
			const fill = s.level!.color!;
			return { fill, ink: readableColor(fill), dashed: s.kind === "today" };
		}
		return { dashed: s.kind === "today" || s.kind === "pending" };
	}
</script>

{#snippet heading(section: DayGridSection)}
	<div aria-hidden="true" class="text-sm font-medium">{section.label}</div>
	<div role="row" class="grid grid-cols-7 gap-0.5">
		{#each weekdays as day (day)}
			<div role="columnheader" class="text-muted-foreground text-2xs text-center">
				<span aria-hidden="true">{formatWeekday(day, "narrow")}</span>
				<span class="sr-only">{formatWeekday(day, "long")}</span>
			</div>
		{/each}
	</div>
{/snippet}

{#snippet words(full: string, small?: string)}
	<!-- The full words in a roomy month; a short stand-in (or nothing) in a small one. -->
	<span class="hidden [overflow-wrap:anywhere] hyphens-auto @min-[22rem]:block" data-words>
		{full}
	</span>
	{#if small}
		<span class="truncate @min-[22rem]:hidden" data-short>{small}</span>
	{/if}
{/snippet}

{#snippet day(s: DayState, flags: { focused: boolean; selected: boolean })}
	{@const l = look(s)}
	{@const tier = s.level?.tier}
	<div
		data-cell
		data-dashed={l.dashed ? "" : undefined}
		class={[
			"text-2xs relative flex h-full min-h-8 flex-col gap-px overflow-hidden rounded-sm p-1 @min-[22rem]:min-h-12",
			!l.fill && (s.kind === "pending" || s.kind === "today") && "bg-card text-foreground",
			!l.fill && (s.kind === "thin" || s.kind === "none" || s.kind === "unrated") && "bg-muted",
			!l.fill && s.kind === "rated" && "bg-muted",
			s.kind === "thin" && "calendar-stripes text-muted-foreground",
			s.kind === "future" && "text-muted-foreground",
			flags.selected &&
				"shadow-[inset_0_0_0_3px_var(--calendar-selected),inset_0_0_0_4px_var(--calendar-selected-edge)]"
		]}
		style:background-color={l.fill}
		style:color={l.ink}
		style:outline-style={l.dashed ? "dashed" : "solid"}
		style:outline-width="var(--swatch-outline-width)"
		style:outline-color={s.kind === "future"
			? "var(--calendar-future-outline)"
			: "var(--swatch-outline-color)"}
		style:outline-offset="calc(var(--swatch-outline-width) * -1)"
	>
		<span class="font-semibold">{Number(s.date.slice(8))}</span>
		{#if isMarked(s, data.threshold)}
			<span data-mark class="absolute top-0.5 right-1">▲</span>
		{/if}
		{#if s.kind === "rated"}
			{#if s.value !== null}<span data-value>{num(s.value)}</span>{/if}
			{#if s.level}
				{@render words(s.level.label, tier != null ? String(tier) : s.level.label)}
			{/if}
		{:else if s.kind === "today"}
			{#if s.value !== null}
				<span data-value>{num(s.value)}</span>
				{#if s.level}
					{@render words(
						m.calendar_day_level_so_far({ level: s.level.label }),
						tier != null ? String(tier) : s.level.label
					)}
				{/if}
			{:else}
				{@render words(m.calendar_day_no_data_so_far(), "—")}
			{/if}
		{:else if s.kind === "thin"}
			{@render words(m.calendar_not_enough_data())}
		{:else if s.kind === "none"}
			<span>—</span>
			{@render words(m.calendar_no_data())}
		{:else if s.kind === "pending"}
			<span>…</span>
			{@render words(m.calendar_day_not_final_yet())}
		{:else if s.kind === "unrated"}
			{@render words(m.calendar_day_not_rated())}
		{/if}
	</div>
{/snippet}

<DayGrid
	layout="month"
	{sections}
	{data}
	{selection}
	{onselect}
	{name}
	{label}
	{stateOf}
	bind:dragging
	bind:preview
	header={heading}
	cell={day}
	class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))] gap-3 p-2"
	sectionClass="@container flex min-w-0 flex-col gap-1"
	rowClass="grid grid-cols-7 gap-0.5"
/>
