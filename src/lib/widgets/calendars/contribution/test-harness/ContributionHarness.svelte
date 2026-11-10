<script lang="ts">
	import type { WidgetInstance } from "$lib/documents/schema";
	import ContributionCalendarWidget from "../ContributionCalendarWidget.svelte";

	/** Reads the widgets each time, so they follow the session's document. */
	let { widgets }: { widgets: () => WidgetInstance[] } = $props();
	const current = $derived(widgets());
</script>

{#each current as widget (widget.id)}
	<div data-widget={widget.id} class="h-64">
		<ContributionCalendarWidget {widget} />
	</div>
{/each}
