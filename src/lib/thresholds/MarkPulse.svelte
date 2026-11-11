<script lang="ts">
	import type { ThresholdMark } from "./marks.svelte";

	let { mark, width }: { mark: ThresholdMark | undefined; width: string } = $props();
</script>

<!-- A threshold mark's pulse, replayed once per crossing (`pulse` > 0; a mark seen on arrival
     doesn't pulse). Its parent is `relative` and rounded like it. Reduced motion: none (app.css). -->
{#if mark && mark.pulse > 0}
	{#key mark.pulse}
		<span
			data-pulse={mark.pulse}
			aria-hidden="true"
			class="pointer-events-none absolute inset-0 rounded-(--radius-control)"
			style:outline="{width} solid {mark.level.color ?? 'var(--foreground)'}"
		></span>
	{/key}
{/if}
