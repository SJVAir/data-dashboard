<script lang="ts">
	import type { WidgetInstance } from "$lib/documents/schema";
	import MonthCalendarWidget from "../MonthCalendarWidget.svelte";

	/** Reads the widget each time, so it follows the session's document. */
	let { widget }: { widget: () => WidgetInstance } = $props();
	const current = $derived(widget());
</script>

<MonthCalendarWidget widget={current} />
