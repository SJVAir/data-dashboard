<script lang="ts">
	import type { Level } from "$lib/data/metadata";
	import OverlaySwatch from "./OverlaySwatch.svelte";

	/**
	 * An overlay's legend row: its name ("Burn status in Fresno County") and every level with its
	 * hatched, outlined swatch. Hovering or focusing a level calls `onhighlight` with its key, so
	 * the chart can bring out that level's day bands.
	 */
	let {
		name,
		levels,
		onhighlight
	}: { name: string; levels: Level[]; onhighlight: (key: string | null) => void } = $props();

	const nameId = $props.id();
</script>

<div class="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
	<span id={nameId} class="text-muted-foreground">{name}</span>
	<ul role="list" aria-labelledby={nameId} class="contents">
		{#each levels as level, i (level.key)}
			<!-- Focusable so a keyboard user can bring out this level's bands, as hovering does. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<li
				tabindex="0"
				class="focus-visible:ring-ring inline-flex rounded-sm focus-visible:ring-2 focus-visible:outline-none"
				onfocus={() => onhighlight(level.key)}
				onblur={() => onhighlight(null)}
				onmouseenter={() => onhighlight(level.key)}
				onmouseleave={() => onhighlight(null)}
			>
				<OverlaySwatch {level} index={i} />
			</li>
		{/each}
	</ul>
</div>
