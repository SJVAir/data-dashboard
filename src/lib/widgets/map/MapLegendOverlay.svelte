<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { Legend, type MapContext } from "@sjvair/map-sdk";
	import { scrollFocusable } from "$lib/components/shared/scroll-focusable";
	import { m } from "$lib/paraglide/messages.js";

	/**
	 * The map's legend, bottom left, never over the toolbar (it scrolls instead). A "Legend" header
	 * folds it at any width, as monitor-map's does; it starts open on a wide widget and folded on a
	 * narrow one, until the person chooses.
	 */
	let {
		map,
		narrow,
		open = $bindable(null)
	}: {
		map: MapContext;
		narrow: boolean;
		/** The person's choice (null until they toggle); bound, so it outlives a new map. */
		open?: boolean | null;
	} = $props();

	const shown = $derived(open ?? !narrow);
	const id = $props.id();
</script>

<div
	class="pointer-events-none absolute top-[calc(var(--mapsdk-toolbar-height,0px)+0.5rem)] bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-col items-start justify-end"
>
	<div
		class="bg-card text-card-foreground border-border shadow-card pointer-events-auto flex min-h-0 max-w-72 flex-col rounded-(--radius-control) border text-xs"
	>
		<button
			type="button"
			aria-expanded={shown}
			aria-controls="{id}-legend"
			class="hover:bg-muted focus-visible:ring-ring flex shrink-0 items-center gap-2 rounded-(--radius-control) px-2 py-1 text-left font-semibold focus-visible:ring-2 focus-visible:outline-none"
			onclick={() => (open = !shown)}
		>
			<span class="flex-1">{m.map_legend_toggle()}</span>
			<ChevronDown
				class={[
					"size-4 shrink-0 transition-transform motion-reduce:transition-none",
					shown && "rotate-180"
				]}
				aria-hidden="true"
			/>
		</button>
		<!-- Kept mounted while folded, so unfolding doesn't rebuild the legend. Scrolls when taller
		     than the map under the toolbar, and is then a Tab stop, so a keyboard can scroll it. A
		     named group, not a landmark: map-sdk's legend inside is the "Legend" region. -->
		<div
			id="{id}-legend"
			hidden={!shown}
			class="border-border min-h-0 overflow-y-auto overscroll-contain border-t p-2"
			role="group"
			aria-label={m.map_legend_scroll()}
			{@attach scrollFocusable}
		>
			<Legend {map} framed={false} />
		</div>
	</div>
</div>
