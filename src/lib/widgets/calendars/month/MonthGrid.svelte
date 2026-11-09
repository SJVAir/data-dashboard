<script lang="ts">
	import type { DayState } from "$lib/calendars/day-state";
	import { readableColor } from "$lib/color";
	import {
		addDays,
		formatDayOfMonth,
		formatMonth,
		formatNumber,
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
	import { wordsFit, type CellWords } from "./fit";

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
	 * Each month the range touches, whole: days before the range are left empty. When the range
	 * runs to today or later, its month's days after it are drawn as still to come ("This month"
	 * keeps its shape early on); a range that ended earlier leaves them empty.
	 */
	const reachesToday = $derived(data.range.last >= data.today);
	const sections = $derived.by<DayGridSection[]>(() => {
		const { first, last } = data.range;
		const pad = reachesToday;
		return monthStarts(first, last).map((month) => ({
			key: month,
			label: formatMonth(month),
			rows: monthGrid(month).map((week) =>
				week.map((d) => (d !== null && d >= first && (d <= last || pad) ? d : null))
			)
		}));
	});
	const stateOf = (date: string): DayState | undefined =>
		data.states.get(date) ??
		(date > data.range.last && reachesToday && data.states.size > 0
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

	/** Text on a solid backing inside a striped cell, legible over the stripes (WCAG 1.4.3). */
	const BACKED = "bg-muted -mx-0.5 w-fit rounded-xs px-0.5";

	/** The words each drawn day would show in full, with the number of lines above them. */
	const cellWords = $derived.by<CellWords[]>(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, built and read here
		const out = new Map<string, CellWords>();
		const add = (text: string, above: number) => out.set(`${above}|${text}`, { text, above });
		for (const s of data.states.values()) {
			const value = s.value !== null ? 1 : 0;
			if (s.kind === "rated" && s.level) add(s.level.label, 1 + value);
			else if (s.kind === "today" && s.value !== null && s.level)
				add(m.calendar_day_level_so_far({ level: s.level.label }), 2);
			else if (s.kind === "today" && s.value === null) add(m.calendar_day_no_data_so_far(), 1);
			else if (s.kind === "thin") add(m.calendar_not_enough_data(), 1);
			else if (s.kind === "none") add(m.calendar_no_data(), 2);
			else if (s.kind === "pending") add(m.calendar_day_not_final_yet(), 2);
			else if (s.kind === "unrated") add(m.calendar_day_not_rated(), 1);
		}
		return [...out.values()];
	});

	/**
	 * Whether the days show their words, or the tier number (and short stand-ins) instead: words
	 * only when every one fits its cell whole, wrapping at spaces. Measured, as labels come from
	 * metadata and may be translated; again whenever the cells change size.
	 */
	let box = $state<HTMLElement>();
	let fit = $state<"label" | "tier">("tier");
	$effect(() => {
		const el = box;
		const words = cellWords;
		if (!el) return;
		const measure = () => {
			const cells = el.querySelectorAll<HTMLElement>("[data-cell]");
			if (cells.length) fit = wordsFit(cells, words) ? "label" : "tier";
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		let live = true;
		void document.fonts?.ready.then(() => live && measure());
		return () => {
			live = false;
			observer.disconnect();
		};
	});
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

{#snippet words(full: string, small?: string, backed = false)}
	<!-- The full words when they fit the cells (wrapping at spaces only); else a short stand-in. -->
	<span
		class={[
			"hidden break-normal hyphens-manual group-data-[fit=label]/fit:block",
			backed && BACKED
		]}
		data-words
	>
		{full}
	</span>
	{#if small}
		<span class="truncate group-data-[fit=label]/fit:hidden" data-short>{small}</span>
	{/if}
{/snippet}

{#snippet day(s: DayState, flags: { focused: boolean; selected: boolean })}
	{@const l = look(s)}
	{@const tier = s.level?.tier}
	<div
		data-cell
		data-dashed={l.dashed ? "" : undefined}
		class={[
			"text-2xs relative flex h-full flex-col gap-px overflow-hidden rounded-sm px-1 py-0.5",
			!l.fill && (s.kind === "pending" || s.kind === "today") && "bg-card text-foreground",
			!l.fill && (s.kind === "thin" || s.kind === "none" || s.kind === "unrated") && "bg-muted",
			!l.fill && s.kind === "rated" && "bg-muted",
			s.kind === "thin" && "calendar-stripes text-foreground",
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
		<span class={["font-semibold", s.kind === "thin" && BACKED]}>{formatDayOfMonth(s.date)}</span>
		{#if isMarked(s, data.threshold)}
			<span data-mark class="absolute top-0.5 right-1">▲</span>
		{/if}
		{#if s.kind === "rated"}
			{#if s.value !== null}<span data-value>{num(s.value)}</span>{/if}
			{#if s.level}
				{@render words(s.level.label, tier != null ? formatNumber(tier) : s.level.label)}
			{/if}
		{:else if s.kind === "today"}
			{#if s.value !== null}
				<span data-value>{num(s.value)}</span>
				{#if s.level}
					{@render words(
						m.calendar_day_level_so_far({ level: s.level.label }),
						tier != null ? formatNumber(tier) : s.level.label
					)}
				{/if}
			{:else}
				{@render words(m.calendar_day_no_data_so_far(), "—")}
			{/if}
		{:else if s.kind === "thin"}
			{@render words(m.calendar_not_enough_data(), undefined, true)}
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

<!-- Months side by side as the width allows, each filling its share up to a cap (cells about
     9rem wide); a month's weeks share its height equally (at least 3rem each, the month at most
     40rem tall). Narrower or shorter than that, the widget scrolls. -->
<div bind:this={box} data-fit={fit} class="group/fit h-full">
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
		class="grid h-full auto-rows-[minmax(min-content,1fr)] grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-3 p-2"
		sectionClass="grid max-h-[40rem] max-w-[64rem] min-w-0 auto-rows-[minmax(3rem,1fr)] grid-rows-[auto_auto] content-start gap-0.5"
		rowClass="grid grid-cols-7 gap-0.5"
	/>
</div>
