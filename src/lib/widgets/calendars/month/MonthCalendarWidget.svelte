<script lang="ts">
	import { widgetTitle } from "$lib/actions/widget";
	import { visibleSelection } from "$lib/calendars/selection";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { useApp } from "$lib/store/app.svelte";
	import { CalendarData } from "../shared/calendar-data.svelte";
	import CalendarShell from "../shared/CalendarShell.svelte";
	import { canWriteSelection, writeSelection, type DaySpan } from "../shared/write-selection";
	import MonthGrid from "./MonthGrid.svelte";

	let { widget }: { widget: WidgetInstance } = $props();

	const app = useApp();
	const data = new CalendarData(() => widget);

	/** Saved with the dashboard; else (shared and read-only views) kept here, in memory. */
	const writable = $derived(canWriteSelection(app, widget.id));
	let local = $state.raw<DaySpan | null | undefined>(undefined);
	const stored = $derived(
		data.selectable
			? visibleSelection(widget.data.timeSubRange, data.selectable, data.range.last)
			: null
	);
	const selection = $derived.by(() => {
		if (writable || local === undefined) return stored;
		return local && data.selectable
			? visibleSelection(local, data.selectable, data.range.last)
			: null;
	});

	let dragging = $state(false);
	let preview = $state.raw<DaySpan | null>(null);

	function onselect(sel: DaySpan | null): void {
		if (writable) writeSelection(app, widget, sel);
		else local = sel;
	}
</script>

<CalendarShell {data} {widget} selection={preview ?? selection} {dragging}>
	{#snippet grid()}
		<MonthGrid
			{data}
			{selection}
			{onselect}
			label={widgetTitle(widget)}
			bind:dragging
			bind:preview
		/>
	{/snippet}
</CalendarShell>
