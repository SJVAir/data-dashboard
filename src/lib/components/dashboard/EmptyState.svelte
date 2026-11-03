<script lang="ts">
	import { m } from "$lib/paraglide/messages.js";
	import AddWidgetButton from "./AddWidgetButton.svelte";

	let {
		allMinimized = false,
		readOnly = false
	}: {
		/** Nothing is on the grid, but the taskbar holds widgets. */
		allMinimized?: boolean;
		/** View mode: nothing can be added. */
		readOnly?: boolean;
	} = $props();
</script>

<div
	class="border-border text-muted-foreground flex flex-col items-center gap-4 rounded-lg border border-dashed p-8 text-center"
>
	<p>{allMinimized ? m.dashboard_all_minimized() : m.dashboard_empty()}</p>
	{#if !readOnly}
		<AddWidgetButton variant="default" />
	{/if}
</div>
