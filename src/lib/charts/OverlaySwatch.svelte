<script lang="ts">
	import type { Level } from "$lib/data/metadata";
	import { HATCH_TILE, hatch } from "./day-bands";

	/** An overlay level's chip: its color under the hatch its day bands use, outlined, and its label. */
	let { level, index }: { level: Level; index: number } = $props();

	const id = $props.id();
	const lines = $derived(hatch(index));
</script>

<span class="inline-flex items-center gap-1">
	<svg
		data-overlay-swatch
		data-pattern={lines.name}
		aria-hidden="true"
		width="12"
		height="12"
		viewBox="0 0 12 12"
		class="text-muted-foreground shrink-0 rounded-sm"
		style:outline-style="solid"
		style:outline-width="var(--swatch-outline-width)"
		style:outline-color="var(--swatch-outline-color)"
		style:outline-offset="calc(var(--swatch-outline-width) * -1)"
	>
		<defs>
			<pattern id="hatch-{id}" width={HATCH_TILE} height={HATCH_TILE} patternUnits="userSpaceOnUse">
				{#each lines.lines as [x1, y1, x2, y2], i (i)}
					<line {x1} {y1} {x2} {y2} stroke="currentColor" stroke-width="1" />
				{/each}
			</pattern>
		</defs>
		<rect width="12" height="12" fill={level.color ?? "transparent"} />
		<rect width="12" height="12" fill="url(#hatch-{id})" />
	</svg>
	<span>{level.label}</span>
</span>
