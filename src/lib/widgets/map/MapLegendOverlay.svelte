<script lang="ts">
	import { Legend, type MapContext } from "@sjvair/map-sdk";
	import { Button } from "$lib/components/ui/button";
	import { m } from "$lib/paraglide/messages.js";

	/**
	 * The map's legend, bottom left, never over the toolbar (it scrolls instead); folded into a
	 * "Legend" button while the widget is narrow.
	 */
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
	class="pointer-events-none absolute top-[calc(var(--mapsdk-toolbar-height,0px)+0.5rem)] bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-col items-start justify-end gap-1"
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
		<!-- Scrolls when taller than the map under the toolbar; focusable, so a keyboard can scroll it.
		     No role or name of its own: map-sdk's legend inside is the "Legend" region. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div
			class="bg-card text-card-foreground border-border shadow-card pointer-events-auto min-h-0 max-w-72 overflow-y-auto overscroll-contain rounded-(--radius-control) border p-2 text-xs"
			tabindex="0"
		>
			<Legend {map} framed={false} />
		</div>
	{/if}
</div>
