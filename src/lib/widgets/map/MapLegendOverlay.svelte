<script lang="ts">
	import { Legend, type MapContext } from "@sjvair/map-sdk";
	import { Button } from "$lib/components/ui/button";
	import { m } from "$lib/paraglide/messages.js";

	/** The map's legend, bottom left; folded into a "Legend" button while the widget is narrow. */
	let {
		map,
		narrow,
		open = $bindable(false)
	}: {
		map: MapContext;
		narrow: boolean;
		/** Whether the folded legend is open; bound, so it outlives a new map. */
		open?: boolean;
	} = $props();
</script>

<div
	class="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-col items-start gap-1"
>
	{#if narrow}
		<Button
			size="sm"
			variant="outline"
			class="pointer-events-auto"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			{m.map_legend_toggle()}
		</Button>
	{/if}
	{#if !narrow || open}
		<div
			class="bg-card text-card-foreground border-border shadow-card pointer-events-auto max-w-72 rounded-(--radius-control) border p-2 text-xs"
		>
			<Legend {map} framed={false} />
		</div>
	{/if}
</div>
