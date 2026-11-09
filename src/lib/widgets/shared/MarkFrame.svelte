<script lang="ts">
	import type { Snippet } from "svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { thresholdMarks } from "$lib/thresholds/marks.svelte";
	import MarkPulse from "$lib/thresholds/MarkPulse.svelte";

	let { widgetId, children }: { widgetId: string; children: Snippet } = $props();

	const mark = $derived(thresholdMarks[widgetId]);
</script>

<!-- A "now" tile's frame: the threshold outline, its pulse, and the "Alert level reached" strip. -->
<div
	class="relative flex h-full flex-col gap-2 rounded-(--radius-control)"
	data-mark={mark ? "" : undefined}
	style:outline-style={mark ? "solid" : undefined}
	style:outline-width={mark ? "3px" : undefined}
	style:outline-offset={mark ? "-3px" : undefined}
	style:outline-color={mark?.level.color ?? (mark ? "var(--foreground)" : undefined)}
>
	<MarkPulse {mark} width="3px" />
	<div class="min-h-0 flex-1">
		{@render children()}
	</div>
	{#if mark}
		<p class="bg-muted mx-2 mb-2 rounded-(--radius-control) px-2 py-1 text-sm font-medium">
			{m.current_alert_level_reached()}
		</p>
	{/if}
</div>
