<script lang="ts">
	import type { DayState } from "$lib/calendars/day-state";
	import { readableColor } from "$lib/color";
	import {
		addDays,
		formatMonthShort,
		formatWeekday,
		startOfPacificWeek,
		weekColumnMonthLabels,
		weekColumns
	} from "$lib/format";
	import { figureName, type CalendarData } from "../shared/calendar-data.svelte";
	import { dayLabel, isMarked } from "../shared/day-label";
	import DayGrid from "../shared/DayGrid.svelte";
	import { inkOf, tierPattern } from "../shared/patterns";
	import type { DaySpan } from "../shared/write-selection";

	let {
		data,
		selection,
		onselect,
		label,
		patterns,
		dragging = $bindable(false),
		preview = $bindable(null)
	}: {
		data: CalendarData;
		selection: DaySpan | null;
		onselect: (sel: DaySpan | null) => void;
		label: string;
		/** "Show patterns": each level's tier pattern over its color. */
		patterns: boolean;
		dragging?: boolean;
		preview?: DaySpan | null;
	} = $props();

	/** One column per week, Sunday first. */
	const columns = $derived(weekColumns(data.range.first, data.range.last));
	/**
	 * The grid's rows are the weekdays, each a cell per week: Left/Right then step a week and
	 * Up/Down a day (the "weeks" layout), as the columns are drawn.
	 */
	const rows = $derived(Array.from({ length: 7 }, (_, i) => columns.map((week) => week[i])));
	/** A month label too close to the next (under 3 columns) is left out, so none overlap. */
	const MIN_LABEL_GAP = 3;
	const months = $derived.by(() => {
		const labels = weekColumnMonthLabels(columns);
		let next = Infinity;
		for (let i = labels.length - 1; i >= 0; i--) {
			if (labels[i] === null) continue;
			if (next - i < MIN_LABEL_GAP) labels[i] = null;
			else next = i;
		}
		return labels;
	});

	/** Sun, Tue, Thu and Sat label their rows (as GitHub does); the others stay blank. */
	const weekdays = $derived.by(() => {
		const start = startOfPacificWeek(data.range.first);
		return Array.from({ length: 7 }, (_, i) =>
			i % 2 === 0 ? formatWeekday(addDays(start, i), "short") : null
		);
	});

	const context = $derived({
		figure: figureName(data.figure),
		unit: data.meta?.entryType.units ?? "",
		precision: data.meta?.entryType.precision,
		threshold: data.threshold,
		withYear: data.range.first.slice(0, 4) !== data.range.last.slice(0, 4)
	});
	const name = (s: DayState, selected: boolean) => dayLabel(s, context, selected);

	/** The fill (level color, then the tier pattern over it) and ink of a colored day. */
	function look(s: DayState): { background?: string; fill?: string; ink?: string } {
		const fill = (s.kind === "rated" || s.kind === "today") && s.level?.color;
		if (!fill) return {};
		const pattern = patterns ? tierPattern(s.level!.tier, inkOf(fill)) : null;
		return {
			fill,
			ink: readableColor(fill),
			background: pattern ? `${pattern}, ${fill}` : fill
		};
	}

	let scroller = $state<HTMLElement>();
	/** The range last scrolled to its latest week. */
	let scrolledFor = "";
	// Opens on the latest week (and again when the range changes); never animated.
	$effect(() => {
		const key = `${data.range.first}/${data.range.last}`;
		if (!scroller || data.states.size === 0 || scrolledFor === key) return;
		scrolledFor = key;
		scroller.scrollLeft = scroller.scrollWidth;
	});
</script>

{#snippet monthRow()}
	<div
		aria-hidden="true"
		class="text-muted-foreground text-2xs grid h-4 auto-cols-(--cell) grid-flow-col gap-0.5"
	>
		{#each months as month, i (i)}
			<div class="relative">
				{#if month}
					<span data-month-label class="absolute top-0 left-0 leading-4 whitespace-nowrap">
						{formatMonthShort(month)}
					</span>
				{/if}
			</div>
		{/each}
	</div>
{/snippet}

{#snippet day(s: DayState, flags: { focused: boolean; selected: boolean })}
	{@const l = look(s)}
	{@const dashed = s.kind === "today" || s.kind === "pending"}
	<div
		data-cell
		class={[
			"relative size-full overflow-hidden rounded-xs",
			!l.fill && (s.kind === "pending" || s.kind === "today") && "bg-card",
			!l.fill &&
				(s.kind === "thin" || s.kind === "none" || s.kind === "unrated" || s.kind === "rated") &&
				"bg-muted",
			s.kind === "thin" && "calendar-stripes",
			flags.selected &&
				"shadow-[inset_0_0_0_2px_var(--calendar-selected),inset_0_0_0_3px_var(--calendar-selected-edge)]"
		]}
		style:background={l.background}
		style:outline-style={dashed ? "dashed" : "solid"}
		style:outline-width="var(--swatch-outline-width)"
		style:outline-color={s.kind === "future"
			? "var(--calendar-future-outline)"
			: "var(--swatch-outline-color)"}
		style:outline-offset="calc(var(--swatch-outline-width) * -1)"
	>
		{#if isMarked(s, data.threshold)}
			<span
				data-mark
				class="absolute top-0 right-0 size-[45%] [clip-path:polygon(0_0,100%_0,100%_100%)]"
				style:background-color={l.ink ?? "var(--foreground)"}
			></span>
		{/if}
	</div>
{/snippet}

<!-- Cells about 12–16 px, from the widget's width; narrower widgets scroll sideways. -->
<div class="@container min-w-0" style:--weeks={columns.length}>
	<div
		class="flex gap-1"
		style:--cell="clamp(12px, calc((100cqi - 2.5rem) / var(--weeks) - 0.125rem), 16px)"
	>
		<!-- Outside the scroller, so they stay put while the weeks scroll. -->
		<div
			aria-hidden="true"
			data-weekday-labels
			class="text-muted-foreground text-2xs flex w-7 shrink-0 flex-col gap-0.5 pt-5.5"
		>
			{#each weekdays as weekday, i (i)}
				<div class="h-(--cell) leading-(--cell)">
					{#if weekday}<span data-weekday>{weekday}</span>{/if}
				</div>
			{/each}
		</div>
		<div bind:this={scroller} data-weeks-scroll class="min-w-0 flex-1 overflow-x-auto px-1 py-1">
			<DayGrid
				layout="weeks"
				{rows}
				{data}
				{selection}
				{onselect}
				{name}
				{label}
				bind:dragging
				bind:preview
				header={monthRow}
				cell={day}
				class="w-max"
				sectionClass="flex flex-col gap-0.5"
				rowClass="grid auto-cols-(--cell) auto-rows-(--cell) grid-flow-col gap-0.5"
			/>
		</div>
	</div>
</div>
