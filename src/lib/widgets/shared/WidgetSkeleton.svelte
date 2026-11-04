<script lang="ts">
	import { onMount } from "svelte";
	import { m } from "$lib/paraglide/messages.js";

	/** A quiet placeholder in a widget's shape, shown only once loading has taken a moment. */
	let { delay = 300 }: { delay?: number } = $props();
	let shown = $state(false);

	onMount(() => {
		const timer = setTimeout(() => (shown = true), delay);
		return () => clearTimeout(timer);
	});
</script>

{#if shown}
	<div class="flex h-full flex-col gap-3" data-skeleton role="status">
		<span class="sr-only">{m.widget_loading()}</span>
		<div class="bg-muted h-4 w-1/3 rounded-(--radius-control) motion-safe:animate-pulse"></div>
		<div class="bg-muted min-h-0 flex-1 rounded-(--radius-control) motion-safe:animate-pulse"></div>
	</div>
{/if}
