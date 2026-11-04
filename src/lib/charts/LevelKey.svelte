<script lang="ts">
	import LevelSwatch from "$lib/components/data/LevelSwatch.svelte";
	import type { Level } from "$lib/data/metadata";
	import { m } from "$lib/paraglide/messages.js";

	/** Every level of the scale, with its full name; always shown under the chart. */
	let { levels }: { levels: Level[] } = $props();
</script>

<ul aria-label={m.chart_level_key()} class="flex flex-wrap gap-x-3 gap-y-1 text-xs">
	{#each levels as level (level.key)}
		<li><LevelSwatch color={level.color ?? "transparent"} label={level.label} /></li>
	{/each}
</ul>
