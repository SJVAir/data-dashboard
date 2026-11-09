<script lang="ts">
	import { widgetTitle } from "$lib/actions/widget";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { CalendarData } from "../shared/calendar-data.svelte";
	import { CalendarSelection } from "../shared/calendar-selection.svelte";
	import CalendarShell from "../shared/CalendarShell.svelte";
	import { loadPatterns, patternsOn, setPatternsOn } from "../shared/patterns-pref.svelte";
	import WeekGrid from "./WeekGrid.svelte";

	let { widget }: { widget: WidgetInstance } = $props();

	const app = useApp();
	const data = new CalendarData(() => widget);
	const sel = new CalendarSelection(app, () => widget, data);
	loadPatterns(app.platform, app.space);
	const patterns = $derived(patternsOn());
</script>

<CalendarShell {data} {widget} selection={sel.shown} dragging={sel.dragging} {patterns}>
	{#snippet grid()}
		<WeekGrid
			{data}
			{patterns}
			selection={sel.selection}
			onselect={sel.select}
			label={widgetTitle(widget)}
			bind:dragging={sel.dragging}
			bind:preview={sel.preview}
		/>
	{/snippet}
	{#snippet legendAside()}
		<!-- A switch the viewer keeps (this device), for every contribution calendar. -->
		<label class="text-muted-foreground flex items-center gap-1.5 text-xs">
			<input
				type="checkbox"
				role="switch"
				checked={patterns}
				onchange={(e) => void setPatternsOn(e.currentTarget.checked)}
				class="bg-input checked:bg-primary focus-visible:outline-ring before:bg-background relative h-4 w-7 shrink-0 cursor-pointer appearance-none rounded-full outline-1 -outline-offset-1 outline-(--swatch-outline-color) before:absolute before:top-0.5 before:left-0.5 before:size-3 before:rounded-full checked:before:translate-x-3 focus-visible:outline-2 focus-visible:outline-offset-2"
			/>
			<span>{m.calendar_show_patterns()}</span>
		</label>
	{/snippet}
</CalendarShell>
