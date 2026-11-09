<script lang="ts">
	import type { WidgetInstance } from "$lib/documents/schema";
	import { CalendarData } from "../calendar-data.svelte";
	import CalendarShell from "../CalendarShell.svelte";

	let {
		widget,
		selection = null,
		dragging = false,
		ondata
	}: {
		widget: WidgetInstance;
		selection?: { start: string; end: string } | null;
		dragging?: boolean;
		/** Hands the test the widget's state to read. */
		ondata?: (data: CalendarData) => void;
	} = $props();

	const data = new CalendarData(() => widget);
	// svelte-ignore state_referenced_locally
	ondata?.(data);
</script>

<CalendarShell {data} {widget} {selection} {dragging}>
	{#snippet grid()}
		<p data-testid="grid">grid {data.states.size}</p>
	{/snippet}
</CalendarShell>
