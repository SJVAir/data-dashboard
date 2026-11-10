<script lang="ts">
	import { widgetTitle } from "$lib/actions/widget";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { useApp } from "$lib/store/app.svelte";
	import { CalendarData } from "../shared/calendar-data.svelte";
	import { CalendarSelection } from "../shared/calendar-selection.svelte";
	import CalendarShell from "../shared/CalendarShell.svelte";
	import MonthGrid from "./MonthGrid.svelte";

	let { widget }: { widget: WidgetInstance } = $props();

	const data = new CalendarData(() => widget);
	const sel = new CalendarSelection(useApp(), () => widget, data);
	let fit = $state<"label" | "number">("number");
</script>

<CalendarShell
	{data}
	{widget}
	selection={sel.shown}
	dragging={sel.dragging}
	numbered={fit === "number"}
>
	{#snippet grid()}
		<MonthGrid
			{data}
			selection={sel.selection}
			onselect={sel.select}
			label={widgetTitle(widget)}
			bind:dragging={sel.dragging}
			bind:preview={sel.preview}
			bind:fit
		/>
	{/snippet}
</CalendarShell>
