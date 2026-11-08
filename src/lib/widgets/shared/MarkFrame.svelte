<script lang="ts">
	import type { Snippet } from "svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { thresholdMarks } from "$lib/thresholds/marks.svelte";

	let { widgetId, children }: { widgetId: string; children: Snippet } = $props();

	const mark = $derived(thresholdMarks[widgetId]);
</script>

<!-- A "now" tile's frame: the threshold outline, its pulse, and the "At your alert level" strip. -->
<div
	class="relative flex h-full flex-col gap-2 rounded-(--radius-control)"
	data-mark={mark ? "" : undefined}
	style:outline-style={mark ? "solid" : undefined}
	style:outline-width={mark ? "3px" : undefined}
	style:outline-offset={mark ? "-3px" : undefined}
	style:outline-color={mark?.level.color ?? (mark ? "var(--foreground)" : undefined)}
>
	{#if mark}
		{#key mark.pulse}
			<span
				data-pulse={mark.pulse}
				aria-hidden="true"
				class="pointer-events-none absolute inset-0 rounded-(--radius-control)"
				style:outline="3px solid {mark.level.color ?? 'var(--foreground)'}"
			></span>
		{/key}
	{/if}
	<div class="min-h-0 flex-1">
		{@render children()}
	</div>
	{#if mark}
		<p class="bg-muted mx-2 mb-2 rounded-(--radius-control) px-2 py-1 text-sm font-medium">
			{m.current_at_alert_level()}
		</p>
	{/if}
</div>
