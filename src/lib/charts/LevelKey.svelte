<script lang="ts">
	import LevelSwatch from "$lib/components/data/LevelSwatch.svelte";
	import type { Level } from "$lib/data/metadata";
	import { m } from "$lib/paraglide/messages.js";

	/**
	 * Every level of the scale, with its full name; always shown under the chart. Its items join
	 * the parent's wrapping flow (`display: contents`), next to the series key.
	 */
	let { levels }: { levels: Level[] } = $props();
</script>

<ul role="list" aria-label={m.chart_level_key()} class="contents">
	{#each levels as level (level.key)}
		<li class="inline-flex">
			<LevelSwatch size="sm" color={level.color ?? "transparent"} label={level.label} />
		</li>
	{/each}
</ul>
