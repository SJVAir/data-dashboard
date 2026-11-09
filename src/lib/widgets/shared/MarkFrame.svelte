<script lang="ts">
	import { getContext, type Snippet } from "svelte";
	import type { Level } from "$lib/data/metadata";
	import type { CurrentReading } from "$lib/data/now/current";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { m } from "$lib/paraglide/messages.js";
	import { resolveThreshold } from "$lib/thresholds/levels";
	import { LOCAL_MARKS_KEY, markLevel } from "$lib/thresholds/mark-level";
	import { thresholdMarks, type ThresholdMark } from "$lib/thresholds/marks.svelte";
	import MarkPulse from "$lib/thresholds/MarkPulse.svelte";

	let {
		widget,
		reading,
		levels,
		now,
		children
	}: {
		widget: WidgetInstance;
		/** The tile's own reading, levels and clock: used only where marks are local (see below). */
		reading: CurrentReading | undefined;
		levels: Level[];
		now: number;
		children: Snippet;
	} = $props();

	// The Get data preview isn't watched: the tile marks itself from its own reading.
	const local = getContext<boolean | undefined>(LOCAL_MARKS_KEY) ?? false;

	const localMark = $derived.by((): ThresholdMark | undefined => {
		if (!local || reading?.status !== "ok") return undefined;
		const threshold = resolveThreshold(widget.thresholds, levels)?.level ?? null;
		const level = markLevel(reading, threshold, levels, now);
		return level ? { level, at: reading.at, pulse: 0 } : undefined;
	});
	const mark = $derived(local ? localMark : thresholdMarks[widget.id]);
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
